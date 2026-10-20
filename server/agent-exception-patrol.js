import { randomUUID } from "node:crypto";
import { buildExceptionObservations } from "./agent-exception-rules.js";

function dateParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, hour: Number(read("hour")) };
}

export function createAgentExceptionPatrol({
  store,
  collect,
  notifySevere = async () => {},
  notifyDigest = async () => {},
  now = () => new Date(),
  timezone = "Asia/Shanghai",
  severeCooldownMs = 60 * 60 * 1000,
  enabled = true,
  notificationsEnabled = true,
} = {}) {
  let activeRun = null;

  async function run({ reason = "scheduled" } = {}) {
    if (activeRun) return activeRun;
    activeRun = Promise.resolve().then(async () => {
      const scanId = randomUUID();
      const collected = await collect({ reason, scanId });
      const built = buildExceptionObservations({ ...collected, now });
      const complete = collected?.complete !== false && built.complete;
      const result = store.reconcileCases(built.observations, { scanId, complete });
      const notificationResults = [];
      for (const item of [...result.detected, ...result.escalated]) {
        if (item.severity !== "critical") continue;
        if (!notificationsEnabled) {
          notificationResults.push({ caseId: item.id, sent: false, reason: "notifications_disabled" });
          continue;
        }
        const last = Date.parse(item.lastNotifiedAt || "");
        if (Number.isFinite(last) && now().getTime() - last < severeCooldownMs) {
          notificationResults.push({ caseId: item.id, sent: false, reason: "cooldown" });
          continue;
        }
        try {
          await notifySevere(item, { reason, kind: result.detected.some((candidate) => candidate.id === item.id) ? "detected" : "escalated" });
          store.markCaseNotified(item.id, item.severity);
          notificationResults.push({ caseId: item.id, sent: true });
        } catch (error) {
          notificationResults.push({ caseId: item.id, sent: false, reason: error?.message || "notification_failed" });
        }
      }
      store.setState("patrol:last_run", {
        scanId,
        reason,
        complete,
        sources: built.sources,
        observed: result.observed,
        detected: result.detected.length,
        escalated: result.escalated.length,
        resolved: result.resolved.length,
        duplicatesSuppressed: Math.max(0, result.observed - result.detected.length - result.escalated.length - result.changed.length),
        finishedAt: now().toISOString(),
      });
      return { ...result, sources: built.sources, notifications: notificationResults };
    }).catch((error) => {
      store.setState("patrol:last_run", {
        reason,
        complete: false,
        error: error?.message || "巡检失败",
        finishedAt: now().toISOString(),
      });
      throw error;
    }).finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  async function sendDailyDigestIfDue() {
    if (!notificationsEnabled) return { sent: false, reason: "notifications_disabled" };
    const current = now();
    const local = dateParts(current, timezone);
    if (local.hour < 9) return { sent: false, reason: "before_window" };
    const last = store.getState("patrol:last_digest", {});
    if (last?.date === local.date) return { sent: false, reason: "already_sent" };
    const cases = store.listCases({ status: "open", limit: 500 }, {});
    const investigating = store.listCases({ status: "investigating", limit: 500 }, {});
    const actionPending = store.listCases({ status: "action_pending", limit: 500 }, {});
    const activeCases = [...cases, ...investigating, ...actionPending];
    await notifyDigest(activeCases, { date: local.date, timezone });
    const state = { date: local.date, sentAt: current.toISOString(), caseCount: activeCases.length };
    store.setState("patrol:last_digest", state);
    return { sent: true, ...state };
  }

  function status() {
    const lastRun = store.getState("patrol:last_run", null);
    return {
      enabled,
      notificationsEnabled,
      running: Boolean(activeRun),
      lastRun,
      lastDigest: store.getState("patrol:last_digest", null),
      lastRunAt: lastRun?.finishedAt || "",
      lastError: lastRun?.error || "",
    };
  }

  return { run, sendDailyDigestIfDue, status };
}
