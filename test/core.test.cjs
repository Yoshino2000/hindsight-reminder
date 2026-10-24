"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");
const rule = (values) =>
  core.normalizeRule({
    id: "r1",
    type: "website",
    target: "bilibili.com",
    message: "记得休息",
    ...values,
  });
const config = (values) => core.normalizeConfig({ rules: [rule()], ...values });

test("full website URLs become canonical domains; paths are not retained", () => {
  assert.equal(
    rule({ target: "https://WWW.BILIBILI.COM/video/BV123?foo=bar" }).target,
    "bilibili.com",
  );
  assert.equal(
    core.normalizeHost("https://例子.测试/"),
    "xn--fsqu00a.xn--0zwm56d",
  );
});

test("matches subdomains at domain boundaries, never suffix spoofing", () => {
  assert.equal(core.matches(rule(), { host: "live.bilibili.com" }), true);
  for (const host of [
    "notbilibili.com",
    "bilibili.com.evil.example",
    "evil-bilibili.com",
  ]) {
    assert.equal(core.matches(rule(), { host }), false);
  }
  assert.equal(
    core.matches(rule({ includeSubdomains: false }), {
      host: "live.bilibili.com",
    }),
    false,
  );
});

test("app matching supports case, exe suffix and explicit exact vs contains", () => {
  const app = rule({ type: "app", target: "Code.exe", matchMode: "exact" });
  assert.equal(core.matches(app, { app: "CODE" }), true);
  assert.equal(core.matches(app, { app: "code.exe" }), true);
  assert.equal(core.matches(app, { app: "Code Helper" }), false);
  assert.equal(
    core.matches({ ...app, matchMode: "contains" }, { app: "Code Helper" }),
    true,
  );
});

test("disabled, away, empty or redacted focus never matches", () => {
  assert.equal(
    core.matches(rule({ enabled: false }), { host: "bilibili.com" }),
    false,
  );
  assert.equal(
    core.matches(rule(), { host: "bilibili.com", away: true }),
    false,
  );
  assert.equal(
    core.matches(rule(), { host: null, title: "bilibili.com" }),
    false,
  );
  assert.deepEqual(
    core.cleanFocus({
      title: "private title",
      app: "Chrome",
      host: null,
      away: false,
    }).host,
    null,
  );
  assert.equal("title" in core.cleanFocus({ title: "secret" }), false);
});

test("validates targets, payloads, rule count and future schema", () => {
  for (const target of [
    "*.example.com",
    "file:///tmp/x",
    "https://u:p@example.com",
    "a b.com",
  ]) {
    assert.throws(() => rule({ target }));
  }
  assert.throws(() => rule({ type: "app", target: "C:\\App\\code.exe" }));
  for (const cooldownSeconds of [-1, 1.5, 86401, "bad"])
    assert.throws(() => rule({ cooldownSeconds }));
  assert.throws(() => rule({ message: " " }));
  assert.throws(() => config({ rules: [rule(), rule()] }));
  assert.throws(() => config({ schemaVersion: 2 }));
  assert.throws(() =>
    config({
      rules: Array.from({ length: 101 }, (_, i) => rule({ id: String(i) })),
    }),
  );
});

test("entry triggers once, not on title/path changes or after just waiting", () => {
  const engine = new core.RuleEngine();
  const c = config({ rules: [rule({ cooldownSeconds: 0 })] });
  assert.equal(engine.evaluate(c, { host: "bilibili.com" }, 1000).length, 1);
  engine.recordSent("r1", 1000);
  assert.equal(
    engine.evaluate(c, { host: "bilibili.com", title: "new title" }, 2000)
      .length,
    0,
  );
  assert.equal(
    engine.evaluate(c, { host: "live.bilibili.com" }, 100000).length,
    0,
  );
  engine.evaluate(c, { host: "github.com" }, 100001);
  assert.equal(engine.evaluate(c, { host: "bilibili.com" }, 100002).length, 1);
});

test("cooldown suppresses re-entry, expires only for a later entry, persists on restart", () => {
  const engine = new core.RuleEngine();
  const c = config();
  assert.equal(engine.evaluate(c, { host: "bilibili.com" }, 100000).length, 1);
  engine.recordSent("r1", 100000);
  engine.evaluate(c, { away: true }, 105000);
  assert.equal(engine.evaluate(c, { host: "bilibili.com" }, 110000).length, 0);
  assert.equal(engine.evaluate(c, { host: "bilibili.com" }, 180000).length, 0);
  const restarted = new core.RuleEngine(engine.snapshot());
  assert.equal(
    restarted.evaluate(c, { host: "bilibili.com" }, 120000).length,
    0,
  );
  engine.evaluate(c, { away: true }, 180001);
  assert.equal(engine.evaluate(c, { host: "bilibili.com" }, 180002).length, 1);
});

test("global pause and per-rule pause stop sends, re-enable is subject to cooldown", () => {
  const engine = new core.RuleEngine();
  const event = { host: "bilibili.com" };
  assert.equal(
    engine.evaluate(config({ enabled: false }), event, 100000).length,
    0,
  );
  assert.equal(
    engine.evaluate(
      config({ rules: [rule({ enabled: false })] }),
      event,
      100001,
    ).length,
    0,
  );
  assert.equal(engine.evaluate(config(), event, 100002).length, 1);
});

test("cooldowns and active matching are independent across rules", () => {
  const rules = [rule(), rule({ id: "r2", type: "app", target: "Chrome" })];
  const engine = new core.RuleEngine({ r1: 100000 });
  const result = engine.evaluate(
    config({ rules }),
    { host: "bilibili.com", app: "chrome.exe" },
    110000,
  );
  assert.deepEqual(
    result.map((item) => item.rule.id),
    ["r2"],
  );
});
