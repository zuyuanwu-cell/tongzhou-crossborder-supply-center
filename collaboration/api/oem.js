import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { milestoneUpdateSchema, oemArtifactSchema, oemProjectionSchema, supplierQuoteSchema } from "../shared/contracts.js";

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function assertEnabled() {
  if (!collaborationConfig.oemEnabled) fail("OEM 协同尚未通过国内仓试点上线门禁。", 403, "feature_disabled");
}

function assertPartnerRole(auth) {
  if (!auth?.membership || !["organization_admin", "manager", "operator"].includes(auth.membership.role)) fail("当前岗位无权提交 OEM 协同结果。", 403, "forbidden");
}

async function activeOrganizationByCode(client, code) {
  const result = await client.query("SELECT * FROM organizations WHERE code=$1 AND status='active'", [code]);
  if (!result.rows[0]) fail("目标协作组织不存在或已停用。", 404, "organization_not_found");
  return result.rows[0];
}

function assertOrganizationType(organization, spaceType) {
  const allowed = {
    filing: new Set(["filing_service"]),
    sampling: new Set(["sampling_factory", "production_factory"]),
    packaging_quote: new Set(["packaging_factory"]),
    production: new Set(["production_factory"]),
  };
  if (!allowed[spaceType]?.has(organization.organization_type)) fail("目标组织类型与 OEM 协作空间不匹配。", 409, "organization_type_mismatch");
}

export async function applyOemProjection(input) {
  assertEnabled();
  const projection = oemProjectionSchema.parse(input);
  return withSystem(async (client) => {
    const seen = await client.query("SELECT status FROM integration_inbox WHERE source_event_id=$1", [projection.eventId]);
    if (seen.rows[0]?.status === "applied") return { ok: true, idempotentReplay: true };
    if (!seen.rows[0]) {
      await client.query("INSERT INTO integration_inbox(source_event_id,event_type,payload,status) VALUES ($1,'core.oem_projection',$2,'processing')", [projection.eventId, projection]);
    } else {
      await client.query("UPDATE integration_inbox SET status='processing',attempt_count=attempt_count+1,last_error=NULL WHERE source_event_id=$1", [projection.eventId]);
    }
    try {
      const organization = await activeOrganizationByCode(client, projection.organizationCode);
      assertOrganizationType(organization, projection.spaceType);
      const projectResult = await client.query(
        `INSERT INTO collaboration_projects(organization_id,core_ref_type,core_ref_id,project_type,title,status,public_summary,version)
         VALUES ($1,'oem_project',$2,'oem',$3,'active',$4,$5)
         ON CONFLICT(organization_id,core_ref_type,core_ref_id) DO UPDATE SET
           title=CASE WHEN collaboration_projects.version<=excluded.version THEN excluded.title ELSE collaboration_projects.title END,
           public_summary=CASE WHEN collaboration_projects.version<=excluded.version THEN excluded.public_summary ELSE collaboration_projects.public_summary END,
           version=GREATEST(collaboration_projects.version,excluded.version)
         RETURNING id`,
        [organization.id, projection.publicPayload.projectCode, `${projection.publicPayload.productName} · ${projection.publicPayload.projectCode}`, projection.publicPayload, projection.version],
      );
      const projectId = projectResult.rows[0].id;
      const spaceResult = await client.query(
        `INSERT INTO collaboration_spaces(organization_id,project_id,space_type,title,status,version)
         VALUES ($1,$2,$3,$4,'open',$5)
         ON CONFLICT(organization_id,project_id,space_type) DO UPDATE SET
           title=CASE WHEN collaboration_spaces.version<=excluded.version THEN excluded.title ELSE collaboration_spaces.title END,
           version=GREATEST(collaboration_spaces.version,excluded.version)
         RETURNING id`,
        [organization.id, projectId, projection.spaceType, projection.title, projection.version],
      );
      const spaceId = spaceResult.rows[0].id;
      const existing = await client.query("SELECT id,version FROM work_items WHERE organization_id=$1 AND core_ref_type=$2 AND core_ref_id=$3 FOR UPDATE", [organization.id, projection.coreRefType, projection.coreRefId]);
      if (existing.rows[0] && Number(existing.rows[0].version) > projection.version) {
        await client.query("UPDATE integration_inbox SET status='applied',processed_at=now() WHERE source_event_id=$1", [projection.eventId]);
        return { ok: true, ignoredStaleVersion: true, workItemId: existing.rows[0].id, version: Number(existing.rows[0].version) };
      }
      const itemResult = await client.query(
        `INSERT INTO work_items(organization_id,space_id,core_ref_type,core_ref_id,item_type,title,description,status,priority,public_payload,due_at,version,last_core_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
         ON CONFLICT(organization_id,core_ref_type,core_ref_id) DO UPDATE SET
           space_id=excluded.space_id,item_type=excluded.item_type,title=excluded.title,description=excluded.description,
           status=excluded.status,priority=excluded.priority,public_payload=excluded.public_payload,due_at=excluded.due_at,
           version=excluded.version,last_core_synced_at=now()
         RETURNING *`,
        [organization.id, spaceId, projection.coreRefType, projection.coreRefId, projection.itemType, projection.title, projection.description, projection.status, projection.priority, projection.publicPayload, projection.dueAt || null, projection.version],
      );
      const item = itemResult.rows[0];
      for (const milestone of projection.milestones) {
        await client.query(
          `INSERT INTO production_milestones(organization_id,space_id,work_item_id,milestone_type,title,planned_at,status,public_payload,version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(organization_id,work_item_id,milestone_type) DO UPDATE SET
             title=CASE WHEN production_milestones.version<=excluded.version THEN excluded.title ELSE production_milestones.title END,
             planned_at=CASE WHEN production_milestones.version<=excluded.version THEN excluded.planned_at ELSE production_milestones.planned_at END,
             public_payload=CASE WHEN production_milestones.version<=excluded.version THEN excluded.public_payload ELSE production_milestones.public_payload END,
             version=GREATEST(production_milestones.version,excluded.version)`,
          [organization.id, spaceId, item.id, milestone.milestoneType, milestone.title, milestone.plannedAt || null, milestone.status, milestone.publicPayload, projection.version],
        );
      }
      await client.query(
        `INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_name,body,metadata)
         VALUES ($1,$2,'core.oem_projection','供应链中台','OEM 协同任务已发布或更新',$3)`,
        [organization.id, item.id, { sourceEventId: projection.eventId, version: projection.version, spaceType: projection.spaceType }],
      );
      await client.query(
        `INSERT INTO notifications(organization_id,work_item_id,title,body,channel,delivery_status)
         VALUES ($1,$2,$3,$4,'in_app','sent')`,
        [organization.id, item.id, projection.version === 1 ? "收到新的 OEM 协同任务" : "OEM 协同任务已更新", projection.title],
      );
      await client.query("UPDATE integration_inbox SET status='applied',processed_at=now() WHERE source_event_id=$1", [projection.eventId]);
      return { ok: true, workItemId: item.id, version: Number(item.version), idempotentReplay: false };
    } catch (error) {
      await client.query("UPDATE integration_inbox SET status='failed',last_error=$2 WHERE source_event_id=$1", [projection.eventId, String(error.message || error).slice(0, 2_000)]);
      throw error;
    }
  });
}

async function lockedOemItem(client, auth, workItemId, itemType) {
  const result = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2 FOR UPDATE", [workItemId, auth.organization.id]);
  const item = result.rows[0];
  if (!item) fail("OEM 任务不存在。", 404, "not_found");
  if (item.item_type !== itemType) fail("OEM 提交类型与当前任务不匹配。", 409, "item_type_mismatch");
  if (["completed", "cancelled", "rejected"].includes(item.status)) fail("当前任务状态不允许继续提交。", 409, "invalid_state");
  return item;
}

async function existingCommand(client, organizationId, idempotencyKey) {
  const result = await client.query("SELECT * FROM partner_commands WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, idempotencyKey]);
  return result.rows[0] || null;
}

async function createOemCommand(client, auth, item, { commandType, idempotencyKey, expectedVersion, payload }) {
  const version = Number(expectedVersion);
  if (!Number.isInteger(version) || version <= 0) fail("请提供有效的 If-Match 任务版本。", 428, "version_required");
  if (Number(item.version) !== version) fail("任务已更新，请刷新后重试。", 409, "version_conflict");
  const result = await client.query(
    `INSERT INTO partner_commands(organization_id,work_item_id,command_type,idempotency_key,expected_version,payload,risk_level,status,submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,'medium','pending_sync',$7) RETURNING *`,
    [auth.organization.id, item.id, commandType, idempotencyKey, version, payload, auth.user.id],
  );
  await client.query("UPDATE work_items SET status='pending_sync',version=version+1 WHERE id=$1 AND organization_id=$2", [item.id, auth.organization.id]);
  await client.query("INSERT INTO integration_outbox(event_type,aggregate_type,aggregate_id,payload) VALUES ('partner.command.created','partner_command',$1,$2)", [result.rows[0].id, { commandId: result.rows[0].id, workItemId: item.id, action: commandType }]);
  return result.rows[0];
}

function assertIdempotencyKey(value) {
  const key = String(value || "");
  if (!key || key.length > 160) fail("请提供有效的 Idempotency-Key。", 400, "idempotency_key_required");
  return key;
}

export async function submitSupplierQuote(auth, body, { idempotencyKey, expectedVersion, hasFreshMfa }) {
  assertEnabled();
  assertPartnerRole(auth);
  if (!hasFreshMfa) fail("报价确认需要重新进行二次验证。", 428, "mfa_step_up_required");
  const input = supplierQuoteSchema.parse(body);
  const key = assertIdempotencyKey(idempotencyKey);
  return withOrganization(auth.organization.id, async (client) => {
    const replay = await existingCommand(client, auth.organization.id, key);
    if (replay) return { ok: true, idempotentReplay: true, commandId: replay.id, status: replay.status };
    const item = await lockedOemItem(client, auth, input.workItemId, "packaging_quote");
    const versionResult = await client.query("SELECT COALESCE(MAX(version),0)::int+1 AS version FROM supplier_quotes WHERE organization_id=$1 AND work_item_id=$2", [auth.organization.id, item.id]);
    const quoteResult = await client.query(
      `INSERT INTO supplier_quotes(organization_id,space_id,work_item_id,currency,amount,minimum_order_quantity,lead_time_days,terms,version,submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [auth.organization.id, item.space_id, item.id, input.currency, input.amount, input.minimumOrderQuantity, input.leadTimeDays, input.terms, versionResult.rows[0].version, auth.user.id],
    );
    const quote = quoteResult.rows[0];
    const command = await createOemCommand(client, auth, item, { commandType: "quote_submit", idempotencyKey: key, expectedVersion, payload: { ...input, quoteId: quote.id, quoteVersion: quote.version } });
    await client.query("INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_user_id,actor_name,body,metadata) VALUES ($1,$2,'partner.quote_submit',$3,$4,'已提交密封报价',$5)", [auth.organization.id, item.id, auth.user.id, auth.user.displayName, { commandId: command.id, quoteId: quote.id, version: quote.version }]);
    return { ok: true, idempotentReplay: false, commandId: command.id, quote: { id: quote.id, currency: quote.currency, amount: Number(quote.amount), minimumOrderQuantity: Number(quote.minimum_order_quantity), leadTimeDays: quote.lead_time_days, terms: quote.terms, status: quote.status, version: quote.version } };
  });
}

export async function submitOemArtifact(auth, body, { idempotencyKey, expectedVersion }) {
  assertEnabled();
  assertPartnerRole(auth);
  const input = oemArtifactSchema.parse(body);
  const key = assertIdempotencyKey(idempotencyKey);
  return withOrganization(auth.organization.id, async (client) => {
    const replay = await existingCommand(client, auth.organization.id, key);
    if (replay) return { ok: true, idempotentReplay: true, commandId: replay.id, status: replay.status };
    const itemResult = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2 FOR UPDATE", [input.workItemId, auth.organization.id]);
    const item = itemResult.rows[0];
    if (!item || !["filing_task", "sampling_task", "production_order"].includes(item.item_type)) fail("当前任务不接受该资料提交。", 409, "item_type_mismatch");
    if (["completed", "cancelled", "rejected"].includes(item.status)) fail("当前任务状态不允许继续提交。", 409, "invalid_state");
    const artifactResult = await client.query(
      `INSERT INTO oem_artifacts(organization_id,space_id,artifact_type,title,version,status,public_payload,submitted_by)
       VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7) RETURNING *`,
      [auth.organization.id, item.space_id, input.artifactType, input.title, input.version, input.publicPayload, auth.user.id],
    );
    const artifact = artifactResult.rows[0];
    const command = await createOemCommand(client, auth, item, { commandType: "artifact_submit", idempotencyKey: key, expectedVersion, payload: { ...input, artifactId: artifact.id } });
    await client.query("INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_user_id,actor_name,body,metadata) VALUES ($1,$2,'partner.artifact_submit',$3,$4,$5,$6)", [auth.organization.id, item.id, auth.user.id, auth.user.displayName, input.title, { commandId: command.id, artifactId: artifact.id, artifactType: input.artifactType }]);
    return { ok: true, idempotentReplay: false, commandId: command.id, artifact: { id: artifact.id, artifactType: artifact.artifact_type, title: artifact.title, version: artifact.version, status: artifact.status, publicPayload: artifact.public_payload } };
  });
}

export async function updateProductionMilestone(auth, milestoneId, body, { idempotencyKey, expectedVersion }) {
  assertEnabled();
  assertPartnerRole(auth);
  const input = milestoneUpdateSchema.parse(body);
  const key = assertIdempotencyKey(idempotencyKey);
  return withOrganization(auth.organization.id, async (client) => {
    const replay = await existingCommand(client, auth.organization.id, key);
    if (replay) return { ok: true, idempotentReplay: true, commandId: replay.id, status: replay.status };
    const milestoneResult = await client.query("SELECT m.*,w.version AS work_item_version,w.item_type FROM production_milestones m JOIN work_items w ON w.id=m.work_item_id WHERE m.id=$1 AND m.organization_id=$2 FOR UPDATE", [milestoneId, auth.organization.id]);
    const milestone = milestoneResult.rows[0];
    if (!milestone || milestone.item_type !== "production_order") fail("生产里程碑不存在。", 404, "not_found");
    const workItem = await client.query("SELECT status FROM work_items WHERE id=$1 AND organization_id=$2", [milestone.work_item_id, auth.organization.id]);
    if (["completed", "cancelled", "rejected"].includes(workItem.rows[0]?.status)) fail("当前生产工单状态不允许更新。", 409, "invalid_state");
    if (Number(milestone.work_item_version) !== Number(expectedVersion)) fail("任务已更新，请刷新后重试。", 409, "version_conflict");
    const updated = await client.query(
      `UPDATE production_milestones SET status=$3,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END,
       public_payload=jsonb_set(public_payload,'{note}',to_jsonb($4::text),true),version=version+1
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [milestoneId, auth.organization.id, input.status, input.note],
    );
    const item = { id: milestone.work_item_id, version: Number(milestone.work_item_version), space_id: milestone.space_id };
    const command = await createOemCommand(client, auth, item, { commandType: "milestone_update", idempotencyKey: key, expectedVersion, payload: { milestoneId, ...input } });
    await client.query("INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_user_id,actor_name,body,metadata) VALUES ($1,$2,'partner.milestone_update',$3,$4,$5,$6)", [auth.organization.id, item.id, auth.user.id, auth.user.displayName, input.note, { commandId: command.id, milestoneId, status: input.status }]);
    return { ok: true, idempotentReplay: false, commandId: command.id, milestone: updated.rows[0] };
  });
}

export async function listInternalQuotes({ coreRefId = "" } = {}) {
  assertEnabled();
  const ref = String(coreRefId || "").trim();
  if (!ref) fail("请指定包装询价任务引用。", 400, "core_reference_required");
  return withSystem(async (client) => {
    const result = await client.query(
      `SELECT q.id,q.currency,q.amount,q.minimum_order_quantity,q.lead_time_days,q.terms,q.status,q.version,q.submitted_at,
              o.code AS organization_code,o.name AS organization_name,w.core_ref_id,w.title
         FROM supplier_quotes q JOIN organizations o ON o.id=q.organization_id JOIN work_items w ON w.id=q.work_item_id
        WHERE w.core_ref_id=$1 AND w.item_type='packaging_quote' ORDER BY q.amount,q.lead_time_days,q.submitted_at`,
      [ref],
    );
    return { quotes: result.rows.map((row) => ({ id: row.id, organizationCode: row.organization_code, organizationName: row.organization_name, coreRefId: row.core_ref_id, title: row.title, currency: row.currency, amount: Number(row.amount), minimumOrderQuantity: Number(row.minimum_order_quantity), leadTimeDays: row.lead_time_days, terms: row.terms, status: row.status, version: row.version, submittedAt: new Date(row.submitted_at).toISOString() })) };
  });
}

export async function awardInternalQuote(quoteId, { approvalReference, reviewer }) {
  assertEnabled();
  if (!String(approvalReference || "").trim()) fail("定标前必须提供内部审批单号。", 428, "approval_reference_required");
  return withSystem(async (client) => {
    const quoteResult = await client.query(
      `SELECT q.*,w.core_ref_id,w.id AS target_work_item_id FROM supplier_quotes q JOIN work_items w ON w.id=q.work_item_id
        WHERE q.id=$1 FOR UPDATE`,
      [quoteId],
    );
    const quote = quoteResult.rows[0];
    if (!quote) fail("报价不存在。", 404, "not_found");
    if (quote.status === "awarded") return { ok: true, idempotentReplay: true, quoteId, status: "awarded" };
    if (quote.status !== "submitted") fail("该报价当前不可定标。", 409, "invalid_state");
    await client.query(
      `UPDATE supplier_quotes q SET status=CASE WHEN q.id=$2 THEN 'awarded' ELSE 'declined' END
        FROM work_items w WHERE w.id=q.work_item_id AND w.core_ref_id=$1 AND w.item_type='packaging_quote' AND q.status='submitted'`,
      [quote.core_ref_id, quoteId],
    );
    await client.query(
      `UPDATE work_items SET status=CASE WHEN id=$2 THEN 'completed' ELSE 'rejected' END,version=version+1,last_core_synced_at=now()
        WHERE core_ref_id=$1 AND item_type='packaging_quote'`,
      [quote.core_ref_id, quote.target_work_item_id],
    );
    await client.query(
      `INSERT INTO notifications(organization_id,work_item_id,title,body,channel,delivery_status)
       VALUES ($1,$2,'包装报价已中标',$3,'in_app','sent')`,
      [quote.organization_id, quote.target_work_item_id, `内部审批 ${String(approvalReference).slice(0, 160)} 已完成，供应链中台已确认贵司报价。`],
    );
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,'quote.award','supplier_quote',$3,'awarded',$4)`,
      [quote.organization_id, String(reviewer || "供应链中台").slice(0, 200), quoteId, { approvalReference: String(approvalReference).slice(0, 160), coreRefId: quote.core_ref_id }],
    );
    return { ok: true, quoteId, status: "awarded", coreRefId: quote.core_ref_id };
  });
}

export function assertOemEnabled() {
  assertEnabled();
}
