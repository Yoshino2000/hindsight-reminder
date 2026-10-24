# Website and app reminders

[简体中文](intro/zh/README.md) · English

A reminder plugin for [Hindsight](https://github.com/Tomotsugu-dev/Hindsight). Choose a website or application, write a message, and receive a system notification when you enter it in the foreground. The settings page is currently in Simplified Chinese.

## Features

- **Website and application rules**: match a domain, optionally include its subdomains, or match an application name exactly or by a contained phrase.
- **Your own messages**: each rule has a message, enable switch and cooldown. There is also a switch to pause all rules.
- **Entry reminders**: staying on the same target or changing its window title does not keep sending notifications. A cooldown suppresses rapid re-entry.
- **Recent activity**: use the recently observed app name or domain to fill a rule. The page also shows the background heartbeat and recent notification status.
- **Local settings**: rules and cooldowns stay in the plugin's own database when its page closes or the plugin updates. A new install has no predefined rules.

## Installation

Requires Hindsight **0.10.0 or later**. Download `hindsight-reminder-1.0.1.zip` from [Releases](https://github.com/Yoshino2000/hindsight-reminder/releases). In Hindsight, open **Settings → Plugins → Install from file**, open the package folder, put the zip there without extracting it, refresh, and install it after reviewing its permissions.

Open the plugin from the sidebar, add a rule and save it. Website detection also needs Hindsight's **Record browser website domains** setting. App rules use the name reported by Hindsight, not an executable path; use the recent activity panel when unsure of the name.

## Permissions and data

The plugin requests `focus.changed`, `focus.app`, `focus.title` and `notifications`, and **1 MB** of its own SQLite storage. Hindsight provides the website domain under `focus.title`, so installation marks that permission as high risk. The matching code uses app names and domains; it discards event window titles.

The database contains rules, cooldowns, the latest focus snapshot, up to eight recent apps and domains each, up to thirty successful notification API calls, and runtime status. It does not use network services or read Hindsight's historical statistics. Uninstalling lets you choose whether to keep the plugin data.

## Limits and testing

Only the foreground window and active browser tab are observed, at Hindsight's sampling rate of about five seconds. Brief visits can be missed. Matching uses domains, not URL paths. Missing or privacy-filtered fields are treated as unknown. Closing Hindsight or disabling the plugin stops detection.

Notifications use the plugin name as their title and do not request a sound. A successful API call means that the request was submitted; notification permissions and Do Not Disturb can still affect its display. A timed-out request is not automatically retried, because it may already have reached the host.

This is an experimental personal plugin. It has not undergone exhaustive testing and may have problems or risks. See [verification notes](docs/verification.md) for the exact host versions, checks and remaining gaps.

## Development

No runtime libraries or bundler are required. The classic scripts follow the small-module layout used by the author's Focus plugin; no Focus implementation or artwork is included.

- `background.js`: focus subscription, serialized work and settings refresh.
- `core.js`: validation and entry/cooldown rules, shared by the page, Worker and tests.
- `store.js`: parameterized SQLite calls; configuration and runtime use separate keys.
- `ui/main.js`: DOM rendering, manual form validation and status polling.

With Node.js 22.13 or newer, run `npm test`. Build with Python 3 using `python scripts/package.py` (Windows: `py -3 -X utf8 scripts/package.py`). The script verifies the package and writes its SHA-256 beside the zip in `dist/`.

The optional preview host is documented in [development notes](docs/development.md). It uses temporary data and simulated notifications, and does not replace real Hindsight testing.

## License

[MIT](LICENSE). The plugin icon is original artwork included under the same license.
