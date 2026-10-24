async (page) => {
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  await page.setViewportSize({ width: 1440, height: 1180 });
  await page.waitForFunction(() => window.preview?.ready === true);
  const frame = page.frameLocator("#plugin-ui");
  await frame.locator("#add-rule").waitFor({ state: "visible" });
  const count = () => page.evaluate(() => window.preview.notifications.length);
  const focus = async (value) => {
    await page.evaluate(value => window.preview.sendFocus(value), value);
    await page.waitForTimeout(250);
  };
  const waitCount = number => page.waitForFunction(number => window.preview.notifications.length >= number, number);
  const addRule = async (name, type, target, message, cooldown) => {
    await frame.locator("#add-rule").click();
    await frame.locator("#rule-name").fill(name);
    await frame.locator("#rule-type").selectOption(type);
    await frame.locator("#rule-target").fill(target);
    await frame.locator("#rule-message").fill(message);
    await frame.locator("#rule-cooldown").fill(String(cooldown));
    if (type === "app") await frame.locator("#match-mode").selectOption("exact");
    await frame.locator("#save-rule").click();
    await frame.locator("#editor").waitFor({ state: "hidden" });
  };

  check(await count() === 0, "初次启动无预置目标、无通知");
  await addRule("视频网站提醒", "website", "https://WWW.BILIBILI.COM/video/test", "现在是专注时间，先完成手头任务。", 60);
  check((await frame.locator("#rules-list").innerText()).includes("bilibili.com"), "网页地址规范化为域名并保存");
  await page.locator("#plugin-ui").evaluate(element => element.contentWindow.location.reload());
  await frame.locator("#rules-list .rule").waitFor();
  check(await frame.locator("#rules-list .rule").count() === 1, "刷新设置页后规则仍保留");

  await focus({ app: "chrome.exe", host: "bilibili.com", title: "DO NOT PERSIST THIS WINDOW TITLE" });
  await waitCount(1);
  check(await count() === 1, "网站焦点事件产生对应通知");
  await focus({ app: "chrome.exe", host: "live.bilibili.com", title: "new title" });
  check(await count() === 1, "停留同一规则范围不重复提醒");
  await focus({ app: "chrome.exe", host: "github.com" });
  await focus({ app: "chrome.exe", host: "bilibili.com" });
  check(await count() === 1, "冷却期内离开再进入不刷屏");

  await addRule("编辑器提醒", "app", "Code.exe", "写代码前，先列一个小目标。", 0);
  await focus({ app: "Code", host: null });
  await waitCount(2);
  check((await page.evaluate(() => window.preview.notifications.at(-1).body)).includes("小目标"), "程序名称忽略exe后缀并匹配通知正文");
  await focus({ away: true });
  await focus({ app: "CODE.EXE", host: null });
  await waitCount(3);
  check(await count() === 3, "零秒冷却仍按每次进入触发");

  const appRule = frame.locator("#rules-list .rule").filter({ hasText: "编辑器提醒" });
  await appRule.locator('input[type="checkbox"]').uncheck();
  await focus({ away: true });
  await focus({ app: "Code", host: null });
  check(await count() === 3, "单条规则停用后不通知");
  await appRule.locator('input[type="checkbox"]').check();
  await waitCount(4);
  await frame.locator("#master-enabled").uncheck();
  await focus({ away: true });
  await focus({ app: "Code", host: null });
  check(await count() === 4, "全局暂停阻止全部规则通知");
  await frame.locator("#master-enabled").check();
  await waitCount(5);

  await appRule.getByRole("button", { name: "编辑", exact: true }).click();
  await frame.locator("#rule-message").fill("切换到编辑器了，记得整理笔记。");
  await frame.locator("#save-rule").click();
  await frame.locator("#editor").waitFor({ state: "hidden" });
  await waitCount(6);
  check((await page.evaluate(() => window.preview.notifications.at(-1).body)).includes("整理笔记"), "修改通知内容无需重启即生效");

  const siteRule = frame.locator("#rules-list .rule").filter({ hasText: "视频网站提醒" });
  await siteRule.getByRole("button", { name: "删除", exact: true }).click();
  await siteRule.getByRole("button", { name: "取消", exact: true }).click();
  check(await frame.locator("#rules-list .rule").count() === 2, "取消删除不改变规则");

  await frame.locator("#test-notification").click();
  await waitCount(7);
  check((await page.evaluate(() => window.preview.notifications.at(-1).body)).includes("测试通知"), "测试通知按钮走真实桥接API");

  await frame.locator("#add-rule").click();
  await frame.locator("#rule-name").fill("无效地址检查");
  await frame.locator("#rule-target").fill("file:///private/data");
  await frame.locator("#rule-message").fill("不会保存");
  await frame.locator("#save-rule").click();
  await page.waitForTimeout(100);
  check(await frame.locator("#editor").isVisible() && await frame.locator("#rules-list .rule").count() === 2, "无效地址显示错误且不保存");
  await frame.locator("#close-editor").click();

  const runtime = await frame.locator("body").evaluate(async () => {
    return window.ReminderStore.createStore(window.hindsight.call.bind(window.hindsight)).loadRuntime();
  });
  check(!JSON.stringify(runtime).includes("DO NOT PERSIST"), "运行状态不保存窗口标题");
  await page.evaluate(() => window.preview.restartWorker());
  await focus({ app: "Code.exe", host: null });
  await waitCount(8);
  check(await frame.locator("#rules-list .rule").count() === 2, "后台重启仍读取已保存规则");
  await page.waitForTimeout(3200);
  check((await frame.locator("#worker-status").innerText()) === "后台有响应", "UI读取后台心跳与最近检测");

  await page.locator("#plugin-ui").evaluate(element => { element.style.height = "1050px"; });
  await page.locator("#plugin-ui").screenshot({ path: "output/playwright/plugin-settings-desktop.png" });
  await page.setViewportSize({ width: 480, height: 1050 });
  await page.locator("#plugin-ui").evaluate(element => { element.style.height = "1900px"; });
  await page.waitForTimeout(250);
  const noOverflow = await frame.locator("body").evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(noOverflow, "窄屏布局无横向溢出");
  await page.locator("#plugin-ui").screenshot({ path: "output/playwright/plugin-settings-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1180 });
  await page.locator("#plugin-ui").evaluate(element => { element.style.height = "1050px"; });

  await siteRule.getByRole("button", { name: "删除", exact: true }).click();
  await siteRule.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.waitForTimeout(200);
  check(await frame.locator("#rules-list .rule").count() === 1, "确认删除后持久移除规则");
  const standalone = await page.context().newPage();
  await standalone.goto("http://127.0.0.1:8765/plugin/ui/index.html");
  await standalone.waitForTimeout(400);
  check(await standalone.locator("#add-rule").isDisabled(), "脱离宿主直接打开时禁止假保存");
  await standalone.close();
  return { checks: results, notificationsCaptured: await count(), screenshots: ["plugin-settings-desktop.png", "plugin-settings-mobile.png"] };
}
