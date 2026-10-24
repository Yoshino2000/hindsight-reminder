# Development

The host references used for this release are the author's [getting started guide](https://github.com/Tomotsugu-dev/hindsight-plugins/blob/bc64edb00a86402e1c10bfff52c651d4fd19f172/docs/zh/getting-started.md), [API](https://github.com/Tomotsugu-dev/hindsight-plugins/blob/bc64edb00a86402e1c10bfff52c651d4fd19f172/docs/zh/api.md), [permissions](https://github.com/Tomotsugu-dev/hindsight-plugins/blob/bc64edb00a86402e1c10bfff52c651d4fd19f172/docs/zh/permissions.md), and [contribution requirements](https://github.com/Tomotsugu-dev/hindsight-plugins/blob/bc64edb00a86402e1c10bfff52c651d4fd19f172/CONTRIBUTING.md).

## Layout and style

The author's published [Focus 0.2.1](https://github.com/Tomotsugu-dev/hindsight-focus/tree/0.2.1) uses small classic scripts, two-space indentation, double quotes and semicolons. Pure rules live in `core.js`, persistence in `store.js`, and DOM code in `ui/main.js`. `background.js` subscribes to host events and serializes work. This plugin follows that organization and uses short comments to explain host constraints. It has no framework, bundler or runtime libraries.

Focus has a larger state model and several writers to the same state, so its store uses optimistic version checks. This reminder keeps UI configuration and Worker runtime under different keys instead, retaining the existing 1.0.0 data format. The small test-facing store factory is also retained. These choices avoid changing storage semantics merely for a style match.

No source or image is copied from Focus. The plain DOM interface, rule engine and icon here are original to this plugin. User strings are assigned with `textContent`, never parsed as HTML.

## Checks

```text
npm test
python scripts/package.py
```

On Windows, the build shortcut is `npm run build`, which uses the Python launcher. Building needs only Python's standard library; tests use Node's built-in test runner and SQLite.

To preview the page and Worker, place the Hindsight source checkout next to this repository as `Hindsight`, then run `python scripts/preview.py --port 8765`. Open `http://127.0.0.1:8765`. The preview extracts the host's actual page and Worker bridge scripts, applies its page sandbox, and uses a temporary SQLite database. Focus events are simulated and notifications are captured in the preview page. Close the server to discard the temporary data.

The browser scenarios under `test/browser/` are functions that accept a Playwright `page`; run them against a fresh preview session. They cover CRUD, persistence, cooldowns, privacy-empty fields and host failure. Preview results must be reported separately from native host checks.

## Package and market

`scripts/package.py` uses an explicit list: manifest, original PNG, runtime scripts, UI files, both READMEs and license. Host-injected `_page.js`/`_worker.js`, tests, tools and user data are excluded. The archive is deterministic for a given source tree; its root is directly installable.

Publish a new three-part version for every changed package; do not replace a previously published zip. Market metadata must match the manifest and the downloadable zip's SHA-256. The market icon must be byte-identical to the package's `icon.png`.
