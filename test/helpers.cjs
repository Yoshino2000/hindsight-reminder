"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
require("../core.js");
const { createStore } = require("../store.js");

function createHost(database) {
  const db = database || new DatabaseSync(":memory:");
  const calls = [];
  const notifications = [];
  const host = {
    db,
    calls,
    notifications,
    failNotifications: false,
    hangNotifications: false,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "notifications.send") {
        if (host.hangNotifications) return new Promise(() => {});
        if (host.failNotifications) throw new Error("Notifications denied");
        notifications.push(params.body);
        return null;
      }
      if (!params || !Array.isArray(params.params))
        throw new Error("params must be scalar array");
      if (
        params.params.some(
          (value) =>
            value !== null &&
            !["number", "string", "boolean"].includes(typeof value),
        )
      ) {
        throw new Error("SQL parameters must be scalar");
      }
      const query = db.prepare(params.sql);
      const values = params.params.map((value) =>
        typeof value === "boolean" ? Number(value) : value,
      );
      if (method === "db.query")
        return query.all(...values).map((row) => ({ ...row }));
      if (method === "db.execute") {
        const result = query.run(...values);
        return {
          changes: Number(result.changes),
          lastInsertRowid: Number(result.lastInsertRowid),
        };
      }
      throw new Error("Unknown method: " + method);
    },
  };
  return host;
}

async function waitFor(condition, label = "operation") {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for " + label);
}

async function createWorker(host, clock = { now: 100000 }) {
  const listeners = new Map();
  const intervals = [];
  const errors = [];
  const timeouts = new Map();
  function scheduleTimeout(callback, delay) {
    const handle = setTimeout(() => {
      timeouts.delete(handle);
      callback();
    }, delay);
    timeouts.set(handle, callback);
    return handle;
  }
  function cancelTimeout(handle) {
    clearTimeout(handle);
    timeouts.delete(handle);
  }
  class ClockDate extends Date {
    constructor(...values) {
      super(...(values.length ? values : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  }
  const sandbox = {
    console: { error: (...values) => errors.push(values), log() {}, warn() {} },
    URL,
    TextEncoder,
    crypto: webcrypto,
    Date: ClockDate,
    setTimeout: scheduleTimeout,
    clearTimeout: cancelTimeout,
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    hindsight: {
      call: host.call,
      on(name, callback) {
        listeners.set(name, callback);
      },
    },
  };
  const context = vm.createContext(sandbox);
  sandbox.self = sandbox;
  sandbox.importScripts = (...names) => {
    for (const name of names)
      vm.runInContext(fs.readFileSync(path.join(ROOT, name), "utf8"), context, {
        filename: name,
      });
  };
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "background.js"), "utf8"),
    context,
    { filename: "background.js" },
  );
  const store = createStore(host.call);
  await waitFor(
    async () => (await store.loadRuntime()).workerStartedAt === clock.now,
    "worker initialization",
  );
  return {
    clock,
    errors,
    store,
    expireTimeouts() {
      for (const [handle, callback] of [...timeouts]) {
        cancelTimeout(handle);
        callback();
      }
    },
    async focus(event) {
      listeners.get("focus.changed")({
        at: new Date(clock.now).toISOString(),
        away: false,
        ...event,
      });
      await waitFor(async () => {
        const state = await store.loadRuntime();
        return (
          state.lastFocus &&
          state.lastFocus.at === new Date(clock.now).toISOString()
        );
      }, "focus processing");
    },
    async refresh() {
      for (const callback of intervals) callback();
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  };
}

module.exports = { createHost, createStore, createWorker, waitFor };
