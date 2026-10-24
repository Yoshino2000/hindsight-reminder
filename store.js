// Settings and runtime state in this plugin's SQLite database. Separate keys keep heartbeat writes
// from replacing settings saved by the page. The injected call also supports isolated tests.
(function (root) {
  "use strict";
  function defaultRuntime() {
    return {
      workerStartedAt: null,
      heartbeatAt: null,
      lastFocus: null,
      lastNotification: null,
      lastError: null,
      recentApps: [],
      recentHosts: [],
      history: [],
      cooldowns: {},
    };
  }

  function createStore(hostCall) {
    if (typeof hostCall !== "function")
      throw new Error("请在 Hindsight 中打开插件设置页。");
    let readyPromise;
    const call = (method, params) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error("连接 Hindsight 超时，请在应用内重新打开插件。")),
          8000,
        );
        Promise.resolve()
          .then(() => hostCall(method, params))
          .then(
            (value) => {
              clearTimeout(timeout);
              resolve(value);
            },
            (error) => {
              clearTimeout(timeout);
              reject(error instanceof Error ? error : new Error(String(error)));
            },
          );
      });

    function ready() {
      if (!readyPromise) {
        readyPromise = call("db.execute", {
          sql: "CREATE TABLE IF NOT EXISTS reminder_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
          params: [],
        })
          .then(() =>
            call("db.execute", {
              sql: "INSERT OR IGNORE INTO reminder_store (key,value) VALUES (?,?)",
              params: [
                "config",
                JSON.stringify(root.ReminderCore.normalizeConfig({})),
              ],
            }),
          )
          .catch((error) => {
            readyPromise = null;
            throw error;
          });
      }
      return readyPromise;
    }

    async function read(key) {
      await ready();
      const rows = await call("db.query", {
        sql: "SELECT value FROM reminder_store WHERE key = ?",
        params: [key],
      });
      if (!Array.isArray(rows))
        throw new Error("Hindsight 返回的存储数据格式不正确。");
      if (!rows.length) return null;
      try {
        return JSON.parse(rows[0].value);
      } catch (_) {
        throw new Error("已保存的数据损坏，请保留插件数据，勿覆盖设置。");
      }
    }

    async function write(key, value) {
      await ready();
      const json = JSON.stringify(value);
      if (new TextEncoder().encode(json).length > 180000)
        throw new Error("设置或记录过大，请减少规则或通知内容。");
      await call("db.execute", {
        sql: "INSERT INTO reminder_store (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params: [key, json],
      });
    }

    return {
      async loadConfig() {
        const value = await read("config");
        return root.ReminderCore.normalizeConfig(value || {});
      },
      async saveConfig(value) {
        const config = root.ReminderCore.normalizeConfig(value);
        config.revision = root.ReminderCore.createId();
        await write("config", config);
        return config;
      },
      async loadRuntime() {
        const value = await read("runtime");
        if (
          value != null &&
          (typeof value !== "object" || Array.isArray(value))
        )
          throw new Error("运行状态格式不正确。");
        return Object.assign(defaultRuntime(), value || {});
      },
      async saveRuntime(value) {
        await write("runtime", value);
      },
    };
  }

  const api = { createStore, defaultRuntime };
  root.ReminderStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
