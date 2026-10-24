"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHost, createStore } = require("./helpers.cjs");
const core = require("../core.js");

test("UI and worker stores initialize concurrently without overwriting persisted settings", async () => {
  const host = createHost();
  const ui = createStore(host.call);
  const worker = createStore(host.call);
  await Promise.all([ui.loadConfig(), worker.loadConfig()]);
  const saved = await ui.saveConfig({
    rules: [
      core.normalizeRule({
        type: "app",
        target: "Code",
        message: "提醒'中文\n下一行",
      }),
    ],
  });
  assert.deepEqual(await worker.loadConfig(), saved);
  assert.deepEqual(await createStore(host.call).loadConfig(), saved);
  assert.equal(
    host.db
      .prepare("SELECT COUNT(*) AS n FROM reminder_store WHERE key='config'")
      .get().n,
    1,
  );
  host.db.close();
});

test("runtime writes never clobber UI configuration", async () => {
  const host = createHost();
  const store = createStore(host.call);
  const saved = await store.saveConfig({ enabled: false });
  await store.saveRuntime({ heartbeatAt: 1234, history: [] });
  assert.deepEqual(await store.loadConfig(), saved);
  assert.equal((await store.loadRuntime()).heartbeatAt, 1234);
  host.db.close();
});

test("SQL payloads use parameters, including malicious-looking rule text", async () => {
  const host = createHost();
  const store = createStore(host.call);
  const message = "'); DROP TABLE reminder_store; --";
  await store.saveConfig({
    rules: [core.normalizeRule({ type: "app", target: "Code", message })],
  });
  assert.equal((await store.loadConfig()).rules[0].message, message);
  assert.ok(host.calls.every((call) => !call.params.sql.includes(message)));
  host.db.close();
});

test("corrupted stored configuration is surfaced without automatic replacement", async () => {
  const host = createHost();
  const store = createStore(host.call);
  await store.loadConfig();
  host.db
    .prepare("UPDATE reminder_store SET value='broken json' WHERE key='config'")
    .run();
  await assert.rejects(store.loadConfig(), /损坏/);
  assert.equal(
    host.db.prepare("SELECT value FROM reminder_store WHERE key='config'").get()
      .value,
    "broken json",
  );
  host.db.close();
});

test("unavailable host rejects clearly instead of pretending a save worked", async () => {
  const store = createStore(async () => {
    throw new Error("Permission denied");
  });
  await assert.rejects(store.saveConfig({}), /Permission denied/);
});
