# Verification

Release: **1.0.1**. Checked on Windows on 2026-10-24. This is a limited verification record, not a claim of exhaustive testing.

## Automated checks

**20 Node tests passed.** They cover domain boundaries, app matching, entry/cooldown behavior, pauses, SQLite initialization and parameter binding, settings refresh, Worker restart, privacy-empty focus, notification failure and timeout.

**18 browser checks passed in connected Chrome.** The preview used the real page/Worker bridge scripts extracted from Hindsight, the same iframe sandbox, temporary SQLite, simulated focus events and captured notification calls. Checks covered empty initial rules, URL normalization, website and app matching, deduplication, cooldown, global and per-rule pause, refresh persistence, startup without stale focus replay, edit/delete, the test-notification button, invalid URL rejection, clearing validation errors, and Enter-to-save inside the sandbox.

These browser notifications were simulated and must not be counted as native notification tests.

## Native host

An unmodified executable from the official Hindsight **0.10.1** Windows release was run with its own data directory. The checks completed were:

- The host recognized and installed the ZIP after its normal permissions review.
- The settings page loaded with no predefined rules and a live Worker heartbeat.
- A website rule for `example.com` saved through the real host bridge.
- A real focus event matched that rule. The plugin database recorded a successful `notifications.send` call with the configured body and `example.com` source, and no runtime error.
- The user confirmed the actual Windows toast with a screenshot showing the plugin title and the exact configured message.

The isolated host was then stopped. No plugin was installed into the user's regular Hindsight data directory. Its installed runtime code matches this release (text line endings are normalized when packaged), and its icon is byte-identical. Later edits completed documentation and release metadata.

## Limits

No exhaustive or long-duration testing has been performed. macOS and Linux, system sleep/recovery, multiple monitors, other browsers and all notification configurations remain unverified. Program matching was exercised in the browser/Worker tests; the native foreground-trigger check used a website. Installation through the upstream public market remains subject to the maintainer's review and merge. This experimental plugin may still have problems or risks.
