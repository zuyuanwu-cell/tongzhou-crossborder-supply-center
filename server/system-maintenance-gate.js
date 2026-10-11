const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createSystemMaintenanceGate({ now = () => Date.now() } = {}) {
  let maintenance = null;
  let activeMutations = 0;
  const idleWaiters = new Set();

  function notifyIdle() {
    if (activeMutations !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function beginRequest(method) {
    if (!MUTATING_METHODS.has(String(method || "").toUpperCase())) {
      return { allowed: true, release: () => {} };
    }
    if (maintenance) {
      return {
        allowed: false,
        retryAfterSeconds: 5,
        reason: maintenance.reason,
        release: () => {},
      };
    }
    activeMutations += 1;
    let released = false;
    return {
      allowed: true,
      release() {
        if (released) return;
        released = true;
        activeMutations = Math.max(0, activeMutations - 1);
        notifyIdle();
      },
    };
  }

  async function enter(reason = "system_maintenance", { timeoutMs = 120_000 } = {}) {
    if (maintenance) throw new Error("System maintenance is already active");
    maintenance = { reason, startedAt: new Date(now()).toISOString() };
    if (!activeMutations) return { ...maintenance };

    let timeout;
    let idleResolver;
    try {
      await Promise.race([
        new Promise((resolve) => {
          idleResolver = resolve;
          idleWaiters.add(resolve);
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Timed out waiting for active writes to finish")), timeoutMs);
          timeout.unref?.();
        }),
      ]);
      return { ...maintenance };
    } catch (error) {
      maintenance = null;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (idleResolver) idleWaiters.delete(idleResolver);
    }
  }

  function leave() {
    maintenance = null;
  }

  function status() {
    return {
      active: Boolean(maintenance),
      reason: maintenance?.reason || "",
      startedAt: maintenance?.startedAt || "",
      activeMutations,
    };
  }

  return { beginRequest, enter, leave, status };
}
