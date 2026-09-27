import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function rows(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const output = [];
    while (statement.step()) output.push(statement.getAsObject());
    return output;
  } finally {
    statement.free();
  }
}

function json(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function rowToDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    formKey: row.form_key,
    sourceFormId: row.source_form_id,
    sourceDataId: row.source_data_id,
    documentType: row.document_type,
    documentTypeLabel: row.document_type_label,
    chainId: row.chain_id || "",
    documentNo: row.document_no || "",
    contractNo: row.contract_no || "",
    contractLineNo: row.contract_line_no || "",
    upstreamNos: json(row.upstream_nos_json, []),
    linkedRecordIds: json(row.linked_record_ids_json, []),
    status: row.status || "",
    customerId: row.customer_id || "",
    customerName: row.customer_name || "",
    supplierId: row.supplier_id || "",
    supplierName: row.supplier_name || "",
    currency: row.currency || "CNY",
    quantity: Number(row.quantity || 0),
    amount: Number(row.amount || 0),
    payableAmount: Number(row.payable_amount || 0),
    paidAmount: Number(row.paid_amount || 0),
    occurredAt: row.occurred_at || "",
    updatedAt: row.updated_at || "",
    isInternal: Boolean(row.is_internal),
    internalInferred: Boolean(row.internal_inferred),
  };
}

export async function initBusinessChainStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS bc_documents (
      id TEXT PRIMARY KEY,
      form_key TEXT NOT NULL,
      source_form_id TEXT NOT NULL,
      source_data_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_type_label TEXT NOT NULL,
      chain_id TEXT,
      document_no TEXT,
      contract_no TEXT,
      contract_line_no TEXT,
      upstream_nos_json TEXT NOT NULL DEFAULT '[]',
      linked_record_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT,
      customer_id TEXT,
      customer_name TEXT,
      supplier_id TEXT,
      supplier_name TEXT,
      currency TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      payable_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      occurred_at TEXT,
      updated_at TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      internal_inferred INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      indexed_at TEXT NOT NULL,
      UNIQUE(source_form_id, source_data_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_documents_type ON bc_documents(document_type, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_bc_documents_chain ON bc_documents(chain_id, document_type);
    CREATE INDEX IF NOT EXISTS idx_bc_documents_no ON bc_documents(document_no);
    CREATE INDEX IF NOT EXISTS idx_bc_documents_contract ON bc_documents(contract_no);
    CREATE INDEX IF NOT EXISTS idx_bc_documents_supplier ON bc_documents(supplier_id, supplier_name);
    CREATE TABLE IF NOT EXISTS bc_document_lines (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      line_uuid TEXT,
      sku TEXT,
      name TEXT,
      unit TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      reference_no TEXT,
      contract_no TEXT,
      contract_line_no TEXT,
      linked_record_ids_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY(document_id) REFERENCES bc_documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_bc_lines_document ON bc_document_lines(document_id);
    CREATE INDEX IF NOT EXISTS idx_bc_lines_sku ON bc_document_lines(sku);
    CREATE INDEX IF NOT EXISTS idx_bc_lines_uuid ON bc_document_lines(line_uuid);
    CREATE TABLE IF NOT EXISTS bc_relations (
      id TEXT PRIMARY KEY,
      from_document_id TEXT NOT NULL,
      to_document_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      match_method TEXT NOT NULL,
      confidence REAL NOT NULL,
      UNIQUE(from_document_id, to_document_id, relation_type)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_relations_from ON bc_relations(from_document_id);
    CREATE INDEX IF NOT EXISTS idx_bc_relations_to ON bc_relations(to_document_id);
    CREATE TABLE IF NOT EXISTS bc_sync_state (
      form_key TEXT PRIMARY KEY,
      source_form_id TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      last_started_at TEXT,
      last_success_at TEXT,
      last_full_sync_at TEXT,
      last_error TEXT,
      record_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }
  function all(sql, params = []) {
    return rows(db, sql, params);
  }
  function first(sql, params = []) {
    return rows(db, sql, params)[0] || null;
  }
  function run(sql, params = []) {
    db.run(sql, params);
  }
  function transaction(fn) {
    db.run("BEGIN TRANSACTION");
    try {
      const value = fn();
      db.run("COMMIT");
      persist();
      return value;
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function markSyncStarted(formKey, form) {
    const now = new Date().toISOString();
    transaction(() => {
      run(`INSERT INTO bc_sync_state (form_key, source_form_id, label, status, last_started_at, updated_at)
        VALUES (?, ?, ?, 'running', ?, ?)
        ON CONFLICT(form_key) DO UPDATE SET status='running', last_started_at=excluded.last_started_at, last_error='', updated_at=excluded.updated_at`,
      [formKey, form.entryId, form.label, now, now]);
    });
  }

  function markSyncFailed(formKey, form, error, durationMs = 0) {
    const now = new Date().toISOString();
    transaction(() => {
      run(`INSERT INTO bc_sync_state (form_key, source_form_id, label, status, last_error, duration_ms, updated_at)
        VALUES (?, ?, ?, 'failed', ?, ?, ?)
        ON CONFLICT(form_key) DO UPDATE SET status='failed', last_error=excluded.last_error, duration_ms=excluded.duration_ms, updated_at=excluded.updated_at`,
      [formKey, form.entryId, form.label, String(error || "同步失败").slice(0, 1000), durationMs, now]);
    });
  }

  function upsertForm(formKey, form, documents, { full = false, durationMs = 0 } = {}) {
    const now = new Date().toISOString();
    transaction(() => {
      for (const document of documents) {
        run(`INSERT INTO bc_documents (
          id, form_key, source_form_id, source_data_id, document_type, document_type_label, chain_id,
          document_no, contract_no, contract_line_no, upstream_nos_json, linked_record_ids_json, status,
          customer_id, customer_name, supplier_id, supplier_name, currency, quantity, amount,
          payable_amount, paid_amount, occurred_at, updated_at, is_internal, internal_inferred, raw_json, indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          chain_id=excluded.chain_id, document_no=excluded.document_no, contract_no=excluded.contract_no,
          contract_line_no=excluded.contract_line_no, upstream_nos_json=excluded.upstream_nos_json,
          linked_record_ids_json=excluded.linked_record_ids_json, status=excluded.status,
          customer_id=excluded.customer_id, customer_name=excluded.customer_name, supplier_id=excluded.supplier_id,
          supplier_name=excluded.supplier_name, currency=excluded.currency, quantity=excluded.quantity,
          amount=excluded.amount, payable_amount=excluded.payable_amount, paid_amount=excluded.paid_amount,
          occurred_at=excluded.occurred_at, updated_at=excluded.updated_at, is_internal=excluded.is_internal,
          internal_inferred=excluded.internal_inferred, raw_json=excluded.raw_json, indexed_at=excluded.indexed_at`, [
          document.id, document.formKey, document.sourceFormId, document.sourceDataId, document.documentType,
          document.documentTypeLabel, document.chainId, document.documentNo, document.contractNo,
          document.contractLineNo, JSON.stringify(document.upstreamNos || []), JSON.stringify(document.linkedRecordIds || []),
          document.status, document.customerId, document.customerName, document.supplierId, document.supplierName,
          document.currency, document.quantity, document.amount, document.payableAmount, document.paidAmount,
          document.occurredAt, document.updatedAt, document.isInternal ? 1 : 0, document.internalInferred ? 1 : 0,
          JSON.stringify(document.raw || {}), now,
        ]);
        run("DELETE FROM bc_document_lines WHERE document_id = ?", [document.id]);
        for (const line of document.lines || []) {
          run(`INSERT INTO bc_document_lines (
            id, document_id, line_uuid, sku, name, unit, quantity, amount, reference_no,
            contract_no, contract_line_no, linked_record_ids_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            line.id, document.id, line.lineUuid || "", line.sku || "", line.name || "", line.unit || "",
            Number(line.quantity || 0), Number(line.amount || 0), line.referenceNo || "", line.contractNo || "",
            line.contractLineNo || "", JSON.stringify(line.linkedRecordIds || []),
          ]);
        }
      }
      if (full && documents.length) {
        const ids = new Set(documents.map((document) => document.id));
        for (const row of all("SELECT id FROM bc_documents WHERE form_key = ?", [formKey])) {
          if (!ids.has(row.id)) run("DELETE FROM bc_documents WHERE id = ?", [row.id]);
        }
      }
      run(`INSERT INTO bc_sync_state (
        form_key, source_form_id, label, status, last_started_at, last_success_at, last_full_sync_at,
        last_error, record_count, duration_ms, updated_at
      ) VALUES (?, ?, ?, 'success', ?, ?, ?, '', ?, ?, ?)
      ON CONFLICT(form_key) DO UPDATE SET status='success', last_success_at=excluded.last_success_at,
        last_full_sync_at=CASE WHEN excluded.last_full_sync_at<>'' THEN excluded.last_full_sync_at ELSE bc_sync_state.last_full_sync_at END,
        last_error='', record_count=excluded.record_count, duration_ms=excluded.duration_ms, updated_at=excluded.updated_at`,
      [formKey, form.entryId, form.label, now, now, full ? now : "", documents.length, durationMs, now]);
    });
  }

  function rebuildRelations() {
    const documents = all("SELECT * FROM bc_documents").map(rowToDocument);
    const byRecordId = new Map();
    const byDocumentNo = new Map();
    const contractsByNo = new Map();
    for (const document of documents) {
      if (document.sourceDataId) byRecordId.set(document.sourceDataId, document);
      if (document.documentNo) byDocumentNo.set(document.documentNo.trim().toUpperCase(), document);
      if (document.documentType === "sales_contract" && document.contractNo) contractsByNo.set(document.contractNo.trim().toUpperCase(), document);
    }
    const relations = [];
    for (const document of documents) {
      if (document.documentType === "sales_contract") document.chainId = document.chainId || `CHN-${document.sourceDataId}`;
      const contract = contractsByNo.get(document.contractNo.trim().toUpperCase());
      if (contract && contract.id !== document.id) relations.push({ from: document, to: contract, type: "belongs_to_contract", method: "contract_no", confidence: 1 });
      for (const linkedId of document.linkedRecordIds) {
        const target = byRecordId.get(String(linkedId));
        if (target && target.id !== document.id) relations.push({ from: document, to: target, type: "linked_record", method: "source_data_id", confidence: 1 });
      }
      for (const upstreamNo of document.upstreamNos) {
        const target = byDocumentNo.get(String(upstreamNo).trim().toUpperCase());
        if (target && target.id !== document.id) relations.push({ from: document, to: target, type: "upstream_document", method: "document_no", confidence: 0.98 });
      }
    }
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      for (const relation of relations) {
        if (!relation.from.chainId && relation.to.chainId) {
          relation.from.chainId = relation.to.chainId;
          changed = true;
        }
        if (!relation.to.chainId && relation.from.chainId) {
          relation.to.chainId = relation.from.chainId;
          changed = true;
        }
      }
      if (!changed) break;
    }
    transaction(() => {
      run("DELETE FROM bc_relations");
      for (const document of documents) run("UPDATE bc_documents SET chain_id = ? WHERE id = ?", [document.chainId || "", document.id]);
      const seen = new Set();
      for (const relation of relations) {
        const key = `${relation.from.id}|${relation.to.id}|${relation.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        run("INSERT INTO bc_relations (id, from_document_id, to_document_id, relation_type, match_method, confidence) VALUES (?, ?, ?, ?, ?, ?)", [
          key, relation.from.id, relation.to.id, relation.type, relation.method, relation.confidence,
        ]);
      }
    });
    return { documents: documents.length, relations: relations.length };
  }

  function syncStates() {
    return all("SELECT * FROM bc_sync_state ORDER BY label").map((row) => ({
      formKey: row.form_key, sourceFormId: row.source_form_id, label: row.label, status: row.status,
      lastStartedAt: row.last_started_at || "", lastSuccessAt: row.last_success_at || "", lastFullSyncAt: row.last_full_sync_at || "",
      lastError: row.last_error || "", recordCount: Number(row.record_count || 0), durationMs: Number(row.duration_ms || 0),
    }));
  }

  persist();
  return { all, dbPath, first, markSyncFailed, markSyncStarted, persist, rebuildRelations, rowToDocument, run, syncStates, transaction, upsertForm };
}
