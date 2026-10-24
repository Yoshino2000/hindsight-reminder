// The background entry point: serialize focus events, refresh settings and keep a small runtime snapshot.
"use strict";
importScripts("core.js", "store.js");

const core = ReminderCore;
const REFRESH_MS = 2000;
const HEARTBEAT_MS = 15000;
const CALL_TIMEOUT_MS = 8000;
const store = ReminderStore.createStore((method, params) =>
  hindsight.call(method, params),
);
let config;
let runtime = ReminderStore.defaultRuntime();
let engine;
let lastFocus = null;
let queue = Promise.resolve();
let refreshing = false;
let started = false;

function notify(body) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("通知请求超时，无法确认系统是否已接收。")),
      CALL_TIMEOUT_MS,
    );
    Promise.resolve()
      .then(() => hindsight.call("notifications.send", { body }))
      .then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
  });
}

function remember(list, value) {
  return value
    ? [
        value,
        ...(Array.isArray(list) ? list : []).filter((item) => item !== value),
      ].slice(0, 8)
    : list || [];
}

async function persist() {
  runtime.heartbeatAt = Date.now();
  runtime.cooldowns = engine ? engine.snapshot() : {};
  await store.saveRuntime(runtime);
}

async function initialize() {
  if (started) return;
  config = await store.loadConfig();
  runtime = await store.loadRuntime();
  engine = new core.RuleEngine(runtime.cooldowns);
  runtime.workerStartedAt = Date.now();
  runtime.lastError = null;
  runtime.lastFocus = null; // A stored focus is not proof that this window is still active.
  runtime.history = Array.isArray(runtime.history)
    ? runtime.history.slice(0, 30)
    : [];
  runtime.recentApps = Array.isArray(runtime.recentApps)
    ? runtime.recentApps.slice(0, 8)
    : [];
  runtime.recentHosts = Array.isArray(runtime.recentHosts)
    ? runtime.recentHosts.slice(0, 8)
    : [];
  await persist();
  started = true;
}

async function evaluate(event, refreshOnly) {
  await initialize();
  const next = await store.loadConfig();
  const changed = next.revision !== config.revision;
  config = next;
  if (event) {
    lastFocus = core.cleanFocus(event);
    runtime.lastFocus = lastFocus;
    runtime.recentApps = remember(runtime.recentApps, lastFocus.app);
    runtime.recentHosts = remember(runtime.recentHosts, lastFocus.host);
  }
  if (!lastFocus || (refreshOnly && !changed)) return;
  const candidates = engine.evaluate(config, lastFocus, Date.now());
  for (const candidate of candidates) {
    // Check immediately before each notification; a rule can be disabled while another RPC runs.
    const latest = await store.loadConfig();
    const rule = latest.rules.find((item) => item.id === candidate.rule.id);
    if (
      !latest.enabled ||
      !rule ||
      !core.matches(rule, lastFocus) ||
      JSON.stringify(rule) !== JSON.stringify(candidate.rule)
    )
      continue;
    try {
      await notify(rule.message);
      const at = Date.now();
      engine.recordSent(rule.id, at);
      runtime.lastError = null;
      const entry = {
        at,
        ruleId: rule.id,
        ruleName: rule.name,
        source: candidate.source,
        message: rule.message,
      };
      runtime.lastNotification = entry;
      runtime.history = [entry, ...runtime.history].slice(0, 30);
      // Persist successful delivery immediately so a restart respects its cooldown.
      await persist();
    } catch (error) {
      runtime.lastError = "发送提醒失败：" + String(error.message || error);
    }
  }
  await persist();
}

function schedule(task) {
  queue = queue.then(task).catch(async (error) => {
    runtime.lastError = String(error.message || error);
    console.error("提醒插件：", error);
    try {
      await persist();
    } catch (storageError) {
      console.error("提醒插件存储：", storageError);
    }
  });
  return queue;
}

// Register before initialization so changes arriving while SQLite opens are queued, not lost.
hindsight.on("focus.changed", (event) => {
  schedule(() => evaluate(event, false));
});
schedule(initialize);
setInterval(() => {
  if (refreshing) return;
  refreshing = true;
  schedule(async () => {
    try {
      await evaluate(null, true);
      if (Date.now() - (runtime.heartbeatAt || 0) >= HEARTBEAT_MS)
        await persist();
    } finally {
      refreshing = false;
    }
  });
}, REFRESH_MS);
