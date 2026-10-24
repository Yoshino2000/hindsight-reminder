// The settings page. User text is rendered as text nodes; actions call the host bridge after validation.
(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const state = {
    store: null,
    config: null,
    runtime: null,
    ready: false,
    busy: false,
    polling: false,
    editingId: null,
    deletingId: null,
    runtimeError: "",
  };
  let pollTimer = null;
  const errorText = (error) =>
    error instanceof Error ? error.message : String(error);
  const core = () => window.ReminderCore;

  function notice(text, tone = "success") {
    const element = byId("feedback");
    element.textContent = text;
    element.className = `notice notice--${tone}`;
    element.hidden = false;
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll("[data-mutation]").forEach((element) => {
      element.disabled = busy || !state.ready;
    });
    byId("save-rule").textContent = busy ? "正在保存…" : "保存规则";
    refreshDetectionButtons();
  }

  function renderConfig() {
    const rules = state.config?.rules || [];
    byId("master-enabled").checked = Boolean(state.config?.enabled);
    byId("master-description").textContent = state.config
      ? state.config.enabled
        ? "按已开启的规则提醒"
        : "已暂停所有规则提醒"
      : "设置尚未读取";
    byId("enabled-count").textContent = state.config
      ? String(rules.filter((rule) => rule.enabled).length)
      : "—";
    byId("rule-count").textContent = String(rules.length);
    byId("empty-state").hidden = rules.length !== 0;
    const list = byId("rules-list");
    list.replaceChildren();
    rules.forEach((rule) => list.append(renderRule(rule)));
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function actionButton(text, className, action) {
    const button = node("button", className, text);
    button.type = "button";
    button.dataset.mutation = "";
    button.disabled = state.busy || !state.ready;
    button.addEventListener("click", action);
    return button;
  }

  function renderRule(rule) {
    const article = node(
      "article",
      rule.enabled ? "rule" : "rule rule--disabled",
    );
    const top = node("div", "rule-top");
    top.append(
      node("span", "rule-symbol", rule.type === "website" ? "网" : "程"),
    );
    const main = node("div", "rule-main");
    main.append(node("h3", "rule-name", rule.name));
    main.append(node("p", "rule-target", rule.target));
    const toggle = node("label", "switch");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.checked = rule.enabled;
    checkbox.disabled = state.busy || !state.ready;
    checkbox.dataset.mutation = "";
    checkbox.setAttribute(
      "aria-label",
      `${rule.enabled ? "停用" : "启用"}规则：${rule.name}`,
    );
    checkbox.addEventListener("change", () => {
      const enabled = checkbox.checked;
      void commit(
        (config) => {
          config.rules = config.rules.map((item) =>
            item.id === rule.id ? { ...item, enabled } : item,
          );
        },
        `已${enabled ? "启用" : "停用"}「${rule.name}」。`,
      );
    });
    const track = node("span", "switch-track");
    track.setAttribute("aria-hidden", "true");
    toggle.append(checkbox, track);
    top.append(main, toggle);
    const matchLabel =
      rule.type === "website"
        ? rule.includeSubdomains
          ? "含子域名"
          : "仅此域名"
        : rule.matchMode === "exact"
          ? "名称完全相同"
          : "名称包含";
    const bottom = node("div", "rule-bottom");
    bottom.append(
      node(
        "span",
        "rule-meta",
        `${rule.enabled ? "已开启" : "已停用"} · ${matchLabel} · 冷却 ${rule.cooldownSeconds} 秒`,
      ),
    );
    const actions = node("div", "rule-actions");
    actions.append(actionButton("编辑", "text-button", () => openEditor(rule)));
    actions.append(
      actionButton("删除", "text-button text-button--danger", () => {
        state.deletingId = state.deletingId === rule.id ? null : rule.id;
        renderConfig();
      }),
    );
    bottom.append(actions);
    article.append(top, node("p", "rule-message", rule.message), bottom);
    if (state.deletingId === rule.id) {
      const confirm = node("div", "delete-confirm");
      confirm.append(node("p", "", "删除后这条规则将不再提醒。"));
      const buttons = node("div");
      buttons.append(
        actionButton("取消", "button button--small button--quiet", () => {
          state.deletingId = null;
          renderConfig();
        }),
      );
      buttons.append(
        actionButton(
          "确认删除",
          "button button--small button--danger",
          async () => {
            const saved = await commit((config) => {
              config.rules = config.rules.filter((item) => item.id !== rule.id);
            }, `已删除「${rule.name}」。`);
            if (saved) {
              if (state.editingId === rule.id) closeEditor();
              state.deletingId = null;
              renderConfig();
            }
          },
        ),
      );
      confirm.append(buttons);
      article.append(confirm);
    }
    return article;
  }

  async function commit(change, message) {
    if (!state.ready || state.busy || !state.config) return false;
    const next = {
      ...state.config,
      rules: state.config.rules.map((rule) => ({ ...rule })),
    };
    setBusy(true);
    try {
      change(next);
      const normalized = core().normalizeConfig(next);
      const saved = await state.store.saveConfig(normalized);
      state.config = core().normalizeConfig(saved);
      renderConfig();
      notice(message);
      return true;
    } catch (error) {
      renderConfig();
      notice(`保存失败：${errorText(error)}`, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function syncEditorType() {
    const isWebsite = byId("rule-type").value === "website";
    byId("website-options").hidden = !isWebsite;
    byId("app-options").hidden = isWebsite;
    byId("target-label").textContent = isWebsite ? "目标域名" : "目标程序名称";
    byId("rule-target").placeholder = isWebsite
      ? "例如 example.com"
      : "例如最近检测到的程序名称";
    byId("target-hint").textContent = isWebsite
      ? "仅匹配域名，不区分网页路径。网站检测需要在 Hindsight 中开启域名记录。"
      : "以最近检测到的程序名称为准；选择“包含”时可以只填名称的一部分。";
  }

  function openEditor(rule = null, prefill = null) {
    if (!state.ready || state.busy) return;
    state.editingId = rule?.id || null;
    state.deletingId = null;
    byId("rule-form").reset();
    byId("editor-heading").textContent = rule ? "编辑规则" : "新建规则";
    byId("rule-name").value = rule?.name || "";
    byId("rule-type").value = rule?.type || prefill?.type || "website";
    byId("rule-target").value = rule?.target || prefill?.target || "";
    byId("rule-message").value = rule?.message || "";
    byId("rule-cooldown").value =
      rule?.cooldownSeconds ?? core().DEFAULT_COOLDOWN_SECONDS;
    byId("include-subdomains").checked = rule?.includeSubdomains !== false;
    byId("match-mode").value = rule?.matchMode || "contains";
    byId("rule-enabled").checked = rule?.enabled !== false;
    syncEditorType();
    byId("editor").hidden = false;
    renderConfig();
    byId("editor").scrollIntoView({ behavior: "smooth", block: "start" });
    byId(prefill ? "rule-name" : "rule-target").focus({ preventScroll: true });
  }

  function closeEditor() {
    state.editingId = null;
    byId("rule-form").reset();
    byId("editor").hidden = true;
    if (byId("feedback").classList.contains("notice--error"))
      byId("feedback").hidden = true;
  }

  function fillLatest(type) {
    const target =
      type === "website"
        ? state.runtime?.lastFocus?.host
        : state.runtime?.lastFocus?.app;
    if (!target || !state.ready || state.busy) return;
    byId("rule-type").value = type;
    byId("rule-target").value = target;
    syncEditorType();
    byId("rule-target").focus();
  }

  async function submitRule(event) {
    event.preventDefault();
    if (!state.ready || state.busy) return;
    let rule;
    try {
      rule = core().normalizeRule({
        id: state.editingId || core().createId(),
        name: byId("rule-name").value,
        type: byId("rule-type").value,
        target: byId("rule-target").value,
        message: byId("rule-message").value,
        cooldownSeconds: Number(byId("rule-cooldown").value),
        enabled: byId("rule-enabled").checked,
        includeSubdomains: byId("include-subdomains").checked,
        matchMode: byId("match-mode").value,
      });
    } catch (error) {
      notice(errorText(error), "error");
      return;
    }
    const editing = Boolean(state.editingId);
    const saved = await commit(
      (config) => {
        if (editing)
          config.rules = config.rules.map((item) =>
            item.id === rule.id ? rule : item,
          );
        else config.rules.push(rule);
      },
      `「${rule.name}」已保存${rule.enabled ? "并开启" : "，暂未开启"}。${state.config.enabled ? "" : "全局提醒目前已暂停。"}`,
    );
    if (saved) closeEditor();
  }

  function saveFromEditor(event) {
    event.preventDefault();
    if (!state.ready || state.busy || !byId("rule-form").reportValidity())
      return;
    void submitRule(event);
  }

  function timestampMillis(timestamp) {
    let value = NaN;
    if (typeof timestamp === "number") value = timestamp;
    else if (typeof timestamp === "string" && timestamp.trim()) {
      const numeric = Number(timestamp);
      value = Number.isFinite(numeric) ? numeric : Date.parse(timestamp);
    }
    return value > 0 && Number.isFinite(new Date(value).getTime())
      ? value
      : NaN;
  }

  function formatTime(timestamp) {
    const value = timestampMillis(timestamp);
    if (!Number.isFinite(value)) return "";
    return new Date(value).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function ago(timestamp) {
    const value = timestampMillis(timestamp);
    if (!Number.isFinite(value)) return "";
    const age = Math.max(0, Date.now() - value);
    if (age < 5000) return "刚刚";
    if (age < 60000) return `${Math.floor(age / 1000)} 秒前`;
    if (age < 3600000) return `${Math.floor(age / 60000)} 分钟前`;
    return formatTime(timestamp);
  }

  function refreshDetectionButtons() {
    const disabled = !state.ready || state.busy;
    const focus = state.runtime?.lastFocus;
    byId("fill-host").disabled = disabled || !focus?.host;
    byId("use-host").disabled = disabled || !focus?.host;
    byId("fill-app").disabled = disabled || !focus?.app;
    byId("use-app").disabled = disabled || !focus?.app;
  }

  function renderRecent(values, type, listId, sectionId) {
    const recent = Array.isArray(values)
      ? [
          ...new Set(
            values.filter((value) => typeof value === "string" && value),
          ),
        ].slice(0, 6)
      : [];
    byId(sectionId).hidden = recent.length === 0;
    const list = byId(listId);
    list.replaceChildren();
    recent.forEach((target) =>
      list.append(
        actionButton(target, "chip", () => openEditor(null, { type, target })),
      ),
    );
  }

  function renderRuntime() {
    const runtime = state.runtime;
    const heartbeat = timestampMillis(runtime?.heartbeatAt);
    const heartbeatValid = Number.isFinite(heartbeat) && heartbeat > 0;
    const recent = heartbeatValid && Date.now() - heartbeat <= 45000;
    byId("worker-dot").className =
      `status-dot${recent ? " status-dot--active" : " status-dot--warning"}`;
    byId("worker-status").textContent = recent
      ? "后台有响应"
      : heartbeatValid
        ? "后台心跳已过期"
        : "尚未检测到后台";
    byId("worker-detail").textContent = recent
      ? `最近心跳：${ago(heartbeat)}`
      : "请检查插件是否已启用；页面打开不代表后台正在运行";
    const focus = runtime?.lastFocus;
    byId("focus-app").textContent = focus?.app || "尚无记录";
    byId("focus-host").textContent = focus?.host || "尚无域名记录";
    byId("focus-time").textContent = focus?.at ? ago(focus.at) : "等待采样";
    byId("focus-time").title = focus?.at ? formatTime(focus.at) : "";
    byId("focus-state").textContent = focus
      ? focus.away
        ? "最近一次采样为离开状态，当前不会据此触发提醒。"
        : "显示最近一次前台采样；检测变化可能有约 5 秒延迟。"
      : "后台收到新的前台采样后，这里会自动更新。";
    renderRecent(
      runtime?.recentHosts,
      "website",
      "recent-hosts",
      "recent-hosts-section",
    );
    renderRecent(
      runtime?.recentApps,
      "app",
      "recent-apps",
      "recent-apps-section",
    );
    const notification = runtime?.lastNotification;
    byId("last-notification-title").textContent = notification
      ? notification.ruleName || "最近提醒"
      : "还没有通知记录";
    byId("last-notification-body").textContent = notification
      ? notification.message
      : "规则触发后，通知内容会显示在这里。";
    byId("last-notification-time").textContent = notification
      ? [formatTime(notification.at), notification.source]
          .filter(Boolean)
          .join(" · ")
      : "";
    byId("last-error-box").hidden = !runtime?.lastError;
    byId("last-error").textContent = runtime?.lastError || "";
    byId("runtime-error").hidden = !state.runtimeError;
    byId("runtime-error").textContent = state.runtimeError;
    refreshDetectionButtons();
  }

  async function refreshRuntime() {
    if (!state.ready || state.polling) return;
    state.polling = true;
    try {
      state.runtime = await state.store.loadRuntime();
      state.runtimeError = "";
    } catch (error) {
      state.runtimeError = `暂时无法读取后台状态：${errorText(error)}`;
    } finally {
      state.polling = false;
      renderRuntime();
    }
  }

  async function testNotification() {
    if (
      !state.ready ||
      state.busy ||
      typeof window.hindsight?.call !== "function"
    )
      return;
    setBusy(true);
    byId("test-notification").textContent = "正在发送…";
    let timeout = null;
    let timedOut = false;
    try {
      await Promise.race([
        Promise.resolve().then(() =>
          window.hindsight.call("notifications.send", {
            body: "这是一条前台提醒测试通知。愿你在合适的时刻，记起想做的事。",
          }),
        ),
        new Promise((_, reject) => {
          timeout = window.setTimeout(() => {
            timedOut = true;
            reject(new Error("等待系统回复超时"));
          }, 8000);
        }),
      ]);
      notice("测试通知已提交给系统，请查看系统通知。");
    } catch (error) {
      notice(
        timedOut
          ? "等待系统回复超时，无法确认通知是否已提交。请先查看系统通知后再重试。"
          : `测试通知未能提交：${errorText(error)}`,
        "error",
      );
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      byId("test-notification").textContent = "发送一条测试通知";
      setBusy(false);
    }
  }

  byId("add-rule").addEventListener("click", () => openEditor());
  byId("close-editor").addEventListener("click", closeEditor);
  byId("rule-type").addEventListener("change", syncEditorType);
  // The plugin iframe does not allow forms: save through the bridge, never a native submission.
  byId("save-rule").addEventListener("click", saveFromEditor);
  byId("rule-form").addEventListener("submit", (event) =>
    event.preventDefault(),
  );
  byId("rule-form").addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.isComposing &&
      event.target.tagName === "INPUT"
    ) {
      saveFromEditor(event);
    }
  });
  byId("fill-host").addEventListener("click", () => fillLatest("website"));
  byId("fill-app").addEventListener("click", () => fillLatest("app"));
  byId("use-host").addEventListener("click", () =>
    openEditor(null, {
      type: "website",
      target: state.runtime?.lastFocus?.host,
    }),
  );
  byId("use-app").addEventListener("click", () =>
    openEditor(null, { type: "app", target: state.runtime?.lastFocus?.app }),
  );
  byId("test-notification").addEventListener("click", () => {
    void testNotification();
  });
  byId("master-enabled").addEventListener("change", () => {
    const enabled = byId("master-enabled").checked;
    void commit(
      (config) => {
        config.enabled = enabled;
      },
      enabled ? "全局提醒已开启。" : "全局提醒已暂停。",
    );
  });

  async function start() {
    try {
      if (
        window.parent === window ||
        typeof window.hindsight?.call !== "function"
      ) {
        throw new Error(
          "请从 Hindsight 的插件页面打开此设置页；直接打开本地文件无法读取或保存设置。",
        );
      }
      if (
        typeof core()?.normalizeRule !== "function" ||
        typeof window.ReminderStore?.createStore !== "function"
      ) {
        throw new Error("页面资源没有完整加载，请重新打开插件页面。");
      }
      state.store = window.ReminderStore.createStore(
        window.hindsight.call.bind(window.hindsight),
      );
      state.config = core().normalizeConfig(await state.store.loadConfig());
      state.ready = true;
      byId("connection").hidden = true;
      renderConfig();
      setBusy(false);
      await refreshRuntime();
      pollTimer = window.setInterval(() => {
        void refreshRuntime();
      }, 3000);
    } catch (error) {
      state.ready = false;
      byId("connection").className = "notice notice--error";
      byId("connection").textContent = errorText(error);
      byId("connection").hidden = false;
      byId("worker-status").textContent = "尚未连接";
      byId("worker-detail").textContent = "设置未加载，所有修改操作均不可用";
      renderConfig();
      setBusy(false);
    }
  }

  window.addEventListener("pagehide", () => {
    if (pollTimer !== null) window.clearInterval(pollTimer);
  });
  void start();
})();
