import { BUSINESS_CHAIN_FORMS, BUSINESS_CHAIN_FORM_ORDER, BUSINESS_CHAIN_FULL_SYNC_INTERVAL_MS } from "./business-chain-config.js";
import { normalizeBusinessChainRecords } from "./business-chain-normalize.js";

export function createBusinessChainSyncService({ store, fetchDataList }) {
  let runningPromise = null;
  let runState = { running: false, startedAt: "", completedAt: "", currentForm: "", reason: "", results: [] };

  async function syncForm(formKey, { forceFull = false } = {}) {
    const form = BUSINESS_CHAIN_FORMS[formKey];
    if (!form) throw new Error(`未知业务链路表单：${formKey}`);
    const previous = store.first("SELECT * FROM bc_sync_state WHERE form_key = ?", [formKey]);
    const lastFullAt = Date.parse(String(previous?.last_full_sync_at || ""));
    const full = forceFull || !Number.isFinite(lastFullAt) || Date.now() - lastFullAt >= BUSINESS_CHAIN_FULL_SYNC_INTERVAL_MS;
    const startedAt = Date.now();
    store.markSyncStarted(formKey, form);
    try {
      let records;
      if (!full && previous?.last_success_at) {
        const overlapFrom = new Date(Math.max(0, Date.parse(previous.last_success_at) - 10 * 60 * 1000)).toISOString();
        try {
          records = await fetchDataList(form, {
            maxPages: form.maxPages,
            filter: { rel: "and", cond: [{ field: "updateTime", method: "gte", value: [overlapFrom] }] },
          });
        } catch {
          records = await fetchDataList(form, { maxPages: form.maxPages });
        }
      } else {
        records = await fetchDataList(form, { maxPages: form.maxPages });
      }
      const documents = normalizeBusinessChainRecords(formKey, records);
      store.upsertForm(formKey, form, documents, { full, durationMs: Date.now() - startedAt });
      return { formKey, label: form.label, ok: true, full, count: documents.length, durationMs: Date.now() - startedAt };
    } catch (error) {
      store.markSyncFailed(formKey, form, error instanceof Error ? error.message : String(error), Date.now() - startedAt);
      throw error;
    }
  }

  async function executeSync({ reason = "scheduled", forceFull = false, formKeys = BUSINESS_CHAIN_FORM_ORDER } = {}) {
    runState = { running: true, startedAt: new Date().toISOString(), completedAt: "", currentForm: "", reason, results: [] };
    for (const formKey of formKeys) {
      runState.currentForm = formKey;
      try {
        runState.results.push(await syncForm(formKey, { forceFull }));
      } catch (error) {
        runState.results.push({ formKey, label: BUSINESS_CHAIN_FORMS[formKey]?.label || formKey, ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const relationResult = store.rebuildRelations();
    runState = { ...runState, running: false, currentForm: "", completedAt: new Date().toISOString(), relationResult };
    return runState;
  }

  function sync(options = {}) {
    if (runningPromise) return runningPromise;
    runningPromise = executeSync(options).finally(() => { runningPromise = null; });
    return runningPromise;
  }

  function start(options = {}) {
    if (runningPromise) return { accepted: false, reason: "already_running", state: status() };
    void sync(options).catch((error) => console.error("[business-chain] background sync failed", error));
    return { accepted: true, state: status() };
  }

  function status() {
    return { ...runState, forms: store.syncStates() };
  }

  return { start, status, sync, syncForm };
}
