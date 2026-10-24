"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");
const {
  createHost,
  createStore,
  createWorker,
  waitFor,
} = require("./helpers.cjs");
const website = (values) =>
  core.normalizeRule({
    id: "site",
    type: "website",
    target: "bilibili.com",
    message: "请专注当前任务",
    ...values,
  });

test("background has no preconfigured monitoring rules and does not notify on startup", async () => {
  const host = createHost();
  const worker = await createWorker(host);
  assert.equal((await worker.store.loadConfig()).rules.length, 0);
  assert.deepEqual(host.notifications, []);
  assert.equal((await worker.store.loadRuntime()).lastFocus, null);
  host.db.close();
});

test("website events send real API payloads; same domain does not flood; privacy redaction resets", async () => {
  const host = createHost();
  await createStore(host.call).saveConfig({
    rules: [website({ cooldownSeconds: 0 })],
  });
  const worker = await createWorker(host);
  await worker.focus({
    app: "chrome.exe",
    host: "www.bilibili.com",
    title: "DO NOT SAVE TITLE",
  });
  assert.deepEqual(host.notifications, ["请专注当前任务"]);
  worker.clock.now += 1000;
  await worker.focus({
    app: "chrome.exe",
    host: "bilibili.com",
    title: "CHANGED TITLE",
  });
  assert.equal(host.notifications.length, 1);
  worker.clock.now += 1000;
  await worker.focus({ app: "chrome.exe", host: null, title: "hidden" });
  worker.clock.now += 1000;
  await worker.focus({ app: "chrome.exe", host: "bilibili.com" });
  assert.equal(host.notifications.length, 2);
  const state = await worker.store.loadRuntime();
  assert.equal(JSON.stringify(state).includes("TITLE"), false);
  assert.deepEqual(state.recentHosts, ["bilibili.com"]);
  host.db.close();
});

test("configuration changes reach the live background without a restart", async () => {
  const host = createHost();
  const store = createStore(host.call);
  const worker = await createWorker(host);
  await worker.focus({ app: "Code", host: null });
  await store.saveConfig({
    rules: [
      website({
        type: "app",
        target: "Code.exe",
        matchMode: "exact",
        cooldownSeconds: 0,
      }),
    ],
  });
  await worker.refresh();
  await waitFor(() => host.notifications.length === 1);
  await store.saveConfig({
    enabled: false,
    rules: [website({ type: "app", target: "Code" })],
  });
  await worker.refresh();
  worker.clock.now += 1000;
  await worker.focus({ away: true });
  worker.clock.now += 1000;
  await worker.focus({ app: "Code.exe" });
  assert.equal(host.notifications.length, 1);
  host.db.close();
});

test("persisted cooldown survives a background restart and stale focus is not replayed", async () => {
  const host = createHost();
  await createStore(host.call).saveConfig({ rules: [website()] });
  const worker = await createWorker(host);
  await worker.focus({ host: "bilibili.com", app: "Chrome" });
  assert.equal(host.notifications.length, 1);
  const restarted = await createWorker(host, { now: 110000 });
  assert.equal((await restarted.store.loadRuntime()).lastFocus, null);
  await restarted.refresh();
  assert.equal(host.notifications.length, 1);
  await restarted.focus({ host: "bilibili.com", app: "Chrome" });
  assert.equal(host.notifications.length, 1);
  restarted.clock.now = 180000;
  await restarted.focus({ away: true });
  restarted.clock.now += 1000;
  await restarted.focus({ host: "bilibili.com", app: "Chrome" });
  assert.equal(host.notifications.length, 2);
  host.db.close();
});

test("notification errors appear in runtime and do not claim successful delivery", async () => {
  const host = createHost();
  host.failNotifications = true;
  await createStore(host.call).saveConfig({ rules: [website()] });
  const worker = await createWorker(host);
  await worker.focus({ host: "bilibili.com" });
  assert.match(
    (await worker.store.loadRuntime()).lastError,
    /Notifications denied/,
  );
  assert.equal((await worker.store.loadRuntime()).lastNotification, null);
  assert.equal(host.notifications.length, 0);
  host.db.close();
});

test("a host notification that never replies times out without blocking later focus events", async () => {
  const host = createHost();
  await createStore(host.call).saveConfig({
    rules: [website({ cooldownSeconds: 0 })],
  });
  const worker = await createWorker(host);
  host.hangNotifications = true;
  const pending = worker.focus({ host: "bilibili.com" });
  await waitFor(
    () => host.calls.some((call) => call.method === "notifications.send"),
    "hanging notification",
  );
  worker.expireTimeouts();
  await pending;
  assert.match((await worker.store.loadRuntime()).lastError, /超时/);
  assert.equal((await worker.store.loadRuntime()).lastNotification, null);
  host.hangNotifications = false;
  worker.clock.now += 1000;
  await worker.focus({ away: true });
  worker.clock.now += 1000;
  await worker.focus({ host: "bilibili.com" });
  assert.equal(host.notifications.length, 1);
  assert.equal((await worker.store.loadRuntime()).lastError, null);
  host.db.close();
});
