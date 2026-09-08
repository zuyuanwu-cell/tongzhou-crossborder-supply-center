function text(value) {
  return String(value ?? "").trim();
}

function positiveNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function isoTime(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function publicError(error) {
  if (error instanceof Error) return error.message || error.name || "Task failed";
  return text(error) || "Task failed";
}

function restoredTaskMap(restoredState) {
  if (restoredState?.tasks && !Array.isArray(restoredState.tasks) && typeof restoredState.tasks === "object") {
    return restoredState.tasks;
  }
  if (Array.isArray(restoredState?.tasks)) {
    return Object.fromEntries(restoredState.tasks.filter((task) => task?.id).map((task) => [task.id, task]));
  }
  return {};
}

export function createSyncScheduler({
  heartbeatMs = 15_000,
  laneLimits = { light: 4, external: 1 },
  retryBaseMs = 60_000,
  restoredState = {},
  now = () => new Date(),
  random = Math.random,
  persist = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  const tasks = new Map();
  const restoredTasks = restoredTaskMap(restoredState);
  const runningByLane = new Map();
  const runningPromises = new Map();
  let timer = null;

  function nowDate() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  function jitter(task) {
    const maximum = positiveNumber(task.jitterMs, 0);
    return maximum ? Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * maximum) : 0;
  }

  function laneLimit(lane) {
    return Math.max(1, Number(laneLimits?.[lane]) || (lane === "external" ? 1 : 4));
  }

  function laneRunning(lane) {
    return Number(runningByLane.get(lane)) || 0;
  }

  function persistenceSnapshot() {
    const persistedTasks = {};
    for (const task of tasks.values()) {
      persistedTasks[task.id] = {
        id: task.id,
        label: task.label,
        enabled: task.enabled,
        lane: task.lane,
        intervalMs: task.intervalMs,
        status: task.running ? "running" : task.status,
        lastStartedAt: task.lastStartedAt,
        lastCompletedAt: task.lastCompletedAt,
        lastSuccessAt: task.lastSuccessAt,
        lastSkippedAt: task.lastSkippedAt,
        lastDurationMs: task.lastDurationMs,
        lastError: task.lastError,
        failureCount: task.failureCount,
        nextRunAt: task.nextRunAt,
      };
    }
    return { updatedAt: nowDate().toISOString(), tasks: persistedTasks };
  }

  function saveState() {
    try {
      persist(persistenceSnapshot());
    } catch (error) {
      console.error("[sync-scheduler] failed to persist state", error);
    }
  }

  function scheduleAfter(task, delayMs) {
    task.nextRunAt = new Date(nowDate().getTime() + Math.max(0, delayMs) + jitter(task)).toISOString();
  }

  function register(definition = {}) {
    const id = text(definition.id);
    if (!id) throw new Error("Sync task id is required");
    if (tasks.has(id)) throw new Error(`Sync task already registered: ${id}`);
    if (typeof definition.run !== "function") throw new Error(`Sync task ${id} requires a run function`);
    const restored = restoredTasks[id] || {};
    const currentTime = nowDate().getTime();
    const persistedNext = Date.parse(text(restored.nextRunAt));
    const initialDelayMs = positiveNumber(definition.initialDelayMs, 0);
    const task = {
      id,
      label: text(definition.label) || id,
      enabled: definition.enabled !== false,
      lane: text(definition.lane) || "light",
      priority: Number(definition.priority) || 0,
      intervalMs: positiveNumber(definition.intervalMs, 60_000, 1_000),
      initialDelayMs,
      jitterMs: positiveNumber(definition.jitterMs, 0),
      run: definition.run,
      running: false,
      status: restored.status === "failed" ? "failed" : "idle",
      lastStartedAt: isoTime(restored.lastStartedAt),
      lastCompletedAt: isoTime(restored.lastCompletedAt),
      lastSuccessAt: isoTime(restored.lastSuccessAt),
      lastSkippedAt: isoTime(restored.lastSkippedAt),
      lastDurationMs: positiveNumber(restored.lastDurationMs, 0),
      lastError: text(restored.lastError),
      failureCount: positiveNumber(restored.failureCount, 0),
      nextRunAt: Number.isFinite(persistedNext) && persistedNext > currentTime
        ? new Date(persistedNext).toISOString()
        : new Date(currentTime + initialDelayMs + jitter({ jitterMs: definition.initialJitterMs || definition.jitterMs })).toISOString(),
    };
    tasks.set(id, task);
    saveState();
    return task;
  }

  function taskDue(task, at = nowDate()) {
    const dueAt = Date.parse(task.nextRunAt || "");
    return task.enabled && !task.running && (!Number.isFinite(dueAt) || dueAt <= at.getTime());
  }

  function launch(task) {
    const lane = task.lane;
    if (laneRunning(lane) >= laneLimit(lane)) return false;
    const started = nowDate();
    task.running = true;
    task.status = "running";
    task.lastStartedAt = started.toISOString();
    task.lastError = "";
    runningByLane.set(lane, laneRunning(lane) + 1);
    saveState();

    const completion = Promise.resolve()
      .then(() => task.run({ id: task.id, startedAt: task.lastStartedAt }))
      .then((result) => {
        const completed = nowDate();
        task.lastCompletedAt = completed.toISOString();
        task.lastDurationMs = Math.max(0, completed.getTime() - started.getTime());
        task.status = "idle";
        if (result?.skipped) {
          task.lastSkippedAt = task.lastCompletedAt;
        } else {
          task.lastSuccessAt = task.lastCompletedAt;
          task.failureCount = 0;
          task.lastError = "";
        }
        scheduleAfter(task, task.intervalMs);
        return result;
      })
      .catch((error) => {
        const completed = nowDate();
        task.lastCompletedAt = completed.toISOString();
        task.lastDurationMs = Math.max(0, completed.getTime() - started.getTime());
        task.status = "failed";
        task.failureCount += 1;
        task.lastError = publicError(error);
        const retryDelay = Math.min(task.intervalMs, positiveNumber(retryBaseMs, 60_000, 1_000) * (2 ** Math.min(6, task.failureCount - 1)));
        scheduleAfter(task, retryDelay);
        return null;
      })
      .finally(() => {
        task.running = false;
        runningByLane.set(lane, Math.max(0, laneRunning(lane) - 1));
        runningPromises.delete(task.id);
        saveState();
      });
    runningPromises.set(task.id, completion);
    return true;
  }

  async function tick() {
    const at = nowDate();
    const due = [...tasks.values()]
      .filter((task) => taskDue(task, at))
      .sort((left, right) => right.priority - left.priority || Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt) || left.id.localeCompare(right.id));
    let started = 0;
    for (const task of due) {
      if (launch(task)) started += 1;
    }
    return { started, due: due.length };
  }

  function start() {
    if (timer) return;
    void tick();
    timer = setIntervalImpl(() => { void tick(); }, positiveNumber(heartbeatMs, 15_000, 1_000));
    timer?.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
  }

  async function trigger(id) {
    const task = tasks.get(text(id));
    if (!task) throw new Error(`Unknown sync task: ${id}`);
    if (task.running) return { started: false, reason: "running", task: publicTask(task) };
    task.nextRunAt = nowDate().toISOString();
    saveState();
    const result = await tick();
    return { started: result.started > 0 && task.running, reason: task.running ? "started" : "queued", task: publicTask(task) };
  }

  async function waitForIdle() {
    while (runningPromises.size) {
      await Promise.allSettled([...runningPromises.values()]);
    }
  }

  function publicTask(task) {
    return {
      id: task.id,
      label: task.label,
      enabled: task.enabled,
      lane: task.lane,
      intervalMs: task.intervalMs,
      status: task.running ? "running" : task.status,
      running: task.running,
      lastStartedAt: task.lastStartedAt,
      lastCompletedAt: task.lastCompletedAt,
      lastSuccessAt: task.lastSuccessAt,
      lastSkippedAt: task.lastSkippedAt,
      lastDurationMs: task.lastDurationMs,
      lastError: task.lastError,
      failureCount: task.failureCount,
      nextRunAt: task.nextRunAt,
    };
  }

  function status() {
    const publicTasks = [...tasks.values()].map(publicTask);
    return {
      enabled: Boolean(timer),
      heartbeatMs: positiveNumber(heartbeatMs, 15_000, 1_000),
      generatedAt: nowDate().toISOString(),
      counts: {
        tasks: publicTasks.length,
        running: publicTasks.filter((task) => task.running).length,
        failed: publicTasks.filter((task) => task.status === "failed").length,
      },
      tasks: publicTasks,
    };
  }

  return { register, start, status, stop, tick, trigger, waitForIdle };
}
