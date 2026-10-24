// Rule validation and entry matching. No host calls: the page, Worker and tests share these rules.
(function (root) {
  "use strict";

  const DEFAULT_COOLDOWN_SECONDS = 60;
  const MAX_RULES = 100;

  function createId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    return (
      "rule-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 11)
    );
  }

  function text(value, label, maximum) {
    if (typeof value !== "string" || !value.trim())
      throw new Error("请填写" + label + "。");
    const result = value.trim();
    if (result.length > maximum)
      throw new Error(label + "最多 " + maximum + " 个字符。");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
      throw new Error(label + "含有无法使用的控制字符。");
    }
    return result;
  }

  function normalizeHost(value) {
    const source = text(value, "网站域名", 2048);
    if (source.includes("*") || /\s/.test(source)) {
      throw new Error("网站请填写域名或网址，不使用通配符；子域名可单独勾选。");
    }
    let url;
    try {
      url = new URL(source.includes("://") ? source : "https://" + source);
    } catch (_) {
      throw new Error("网站格式不正确，例如 bilibili.com。");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("请填写 http / https 网站或域名，不要包含账号和密码。");
    }
    let host = url.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    if (
      !host ||
      host.length > 253 ||
      host.startsWith(".") ||
      host.includes("..")
    ) {
      throw new Error("网站域名不正确。");
    }
    if (!host.startsWith("[") && !/^[a-z0-9.-]+$/.test(host))
      throw new Error("网站域名不正确。");
    return host;
  }

  function normalizeApp(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/\.exe$/i, "");
  }

  function normalizeRule(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("规则格式不正确。");
    if (!["website", "app"].includes(input.type))
      throw new Error("请选择网站或程序规则。");
    const rawTarget = text(
      input.target,
      input.type === "website" ? "网站域名" : "程序名称",
      256,
    );
    if (input.type === "app" && /[\\/\r\n]/.test(rawTarget)) {
      throw new Error(
        "程序请填写名称（例如 Code 或 Code.exe），不要填写文件路径。",
      );
    }
    const target =
      input.type === "website" ? normalizeHost(rawTarget) : rawTarget;
    const cooldownSeconds =
      input.cooldownSeconds == null || input.cooldownSeconds === ""
        ? DEFAULT_COOLDOWN_SECONDS
        : Number(input.cooldownSeconds);
    if (
      !Number.isInteger(cooldownSeconds) ||
      cooldownSeconds < 0 ||
      cooldownSeconds > 86400
    ) {
      throw new Error("冷却时间请输入 0 到 86400 之间的整数秒数。");
    }
    const matchMode = input.matchMode == null ? "contains" : input.matchMode;
    if (!["contains", "exact"].includes(matchMode))
      throw new Error("程序匹配方式不正确。");
    const id = input.id == null ? createId() : text(input.id, "规则编号", 100);
    if (input.enabled != null && typeof input.enabled !== "boolean")
      throw new Error("规则开关格式不正确。");
    if (
      input.includeSubdomains != null &&
      typeof input.includeSubdomains !== "boolean"
    ) {
      throw new Error("子域名开关格式不正确。");
    }
    return {
      id,
      name:
        input.name && String(input.name).trim()
          ? text(input.name, "规则名称", 60)
          : target,
      type: input.type,
      target,
      message: text(input.message, "通知内容", 500),
      enabled: input.enabled !== false,
      cooldownSeconds,
      includeSubdomains: input.includeSubdomains !== false,
      matchMode,
    };
  }

  function normalizeConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("设置格式不正确。");
    if (input.schemaVersion != null && input.schemaVersion !== 1)
      throw new Error("此版本无法读取这份设置，请保留数据并更新插件。");
    if (input.enabled != null && typeof input.enabled !== "boolean")
      throw new Error("总开关格式不正确。");
    const source = input.rules == null ? [] : input.rules;
    if (!Array.isArray(source) || source.length > MAX_RULES)
      throw new Error("最多保存 " + MAX_RULES + " 条规则。");
    const rules = source.map(normalizeRule);
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
      throw new Error("规则编号重复，请重新添加该规则。");
    return {
      schemaVersion: 1,
      enabled: input.enabled !== false,
      rules,
      revision: typeof input.revision === "string" ? input.revision : "initial",
    };
  }

  function cleanFocus(event) {
    if (!event || typeof event !== "object")
      return {
        at: new Date().toISOString(),
        app: null,
        host: null,
        away: true,
      };
    const app =
      typeof event.app === "string" && event.app.trim()
        ? event.app.slice(0, 256)
        : null;
    let host = null;
    if (typeof event.host === "string" && event.host.trim()) {
      try {
        host = normalizeHost(event.host);
      } catch (_) {
        /* Missing or unsupported domains do not match. */
      }
    }
    return {
      at: typeof event.at === "string" ? event.at : new Date().toISOString(),
      app: event.away ? null : app,
      host: event.away ? null : host,
      away: Boolean(event.away),
    };
  }

  function matches(rule, event) {
    if (!rule.enabled || !event || event.away) return false;
    if (rule.type === "website") {
      if (!event.host) return false;
      let host;
      try {
        host = normalizeHost(event.host);
      } catch (_) {
        return false;
      }
      return (
        host === rule.target ||
        (rule.includeSubdomains && host.endsWith("." + rule.target))
      );
    }
    const actual = normalizeApp(event.app);
    const target = normalizeApp(rule.target);
    return (
      Boolean(actual && target) &&
      (rule.matchMode === "exact" ? actual === target : actual.includes(target))
    );
  }

  function signature(rule) {
    return JSON.stringify([
      rule.type,
      rule.target,
      rule.message,
      rule.cooldownSeconds,
      rule.includeSubdomains,
      rule.matchMode,
    ]);
  }

  class RuleEngine {
    constructor(cooldowns) {
      this.active = new Map();
      this.cooldowns = new Map();
      for (const [id, at] of Object.entries(cooldowns || {})) {
        if (Number.isFinite(at) && at > 0) this.cooldowns.set(id, at);
      }
    }

    evaluate(config, event, now) {
      const previous = this.active;
      const current = new Map();
      const pending = [];
      if (config.enabled && event && !event.away) {
        for (const rule of config.rules) {
          if (!matches(rule, event)) continue;
          const fingerprint = signature(rule);
          current.set(rule.id, fingerprint);
          if (previous.get(rule.id) === fingerprint) continue;
          const last = this.cooldowns.get(rule.id);
          // If the system clock goes backwards, keep suppressing until the cooldown expires.
          if (last != null && now - last < rule.cooldownSeconds * 1000)
            continue;
          pending.push({
            rule,
            source: rule.type === "website" ? event.host : event.app,
          });
        }
      }
      this.active = current;
      const validIds = new Set(config.rules.map((rule) => rule.id));
      for (const id of this.cooldowns.keys())
        if (!validIds.has(id)) this.cooldowns.delete(id);
      return pending;
    }

    recordSent(id, now) {
      this.cooldowns.set(id, now);
    }
    snapshot() {
      return Object.fromEntries(this.cooldowns);
    }
  }

  const api = {
    DEFAULT_COOLDOWN_SECONDS,
    MAX_RULES,
    createId,
    normalizeHost,
    normalizeApp,
    normalizeRule,
    normalizeConfig,
    cleanFocus,
    matches,
    RuleEngine,
  };
  root.ReminderCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
