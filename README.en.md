<div align="center">

# DSH Command Code Subscription

[中文](README.md) · **English**

**Use Command Code Go models in DeepSeek Harness**

The DSH credential service manages your Command Code API key. The plugin connects directly to the native NDJSON generation endpoint—no local HTTP proxy required.

[![CI](https://github.com/LingBrian/dsh-commandcode-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/LingBrian/dsh-commandcode-subscription/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)

[Features](#features) · [Install](#install) · [Scope and limitations](#scope-and-limitations) · [Development](#development)

</div>

> **Experimental and not affiliated with Command Code.** This plugin uses the undocumented `/alpha/generate` endpoint; the protocol and CLI-version requirement may change without notice. Review the provider's terms, your account's entitlement, and actual billing before use. “Subscription” is the project name; this is **not** a ChatGPT/Codex subscription or OAuth login.

## Features

| Feature | Current implementation |
| --- | --- |
| Model conversations | Refreshes the public model catalog; shows one built-in placeholder model when offline. The catalog does not prove account entitlement. |
| Streaming | Converts native NDJSON into DSH text, reasoning, tool-call, and tool-result events; supports cancellation. |
| Credentials | Resolves `COMMANDCODE_API_KEY` through DSH's host credential service. The key is never saved in plugin settings or sent to the browser. |
| Languages | Runtime message dictionaries for English and Simplified Chinese; resolves a request-provided locale and falls back to English for missing or unsupported locales. More languages can be added through the same dictionary framework. |

## Prepare DSH

Use a compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation (see `engines.dsh` in [package.json](package.json)) and a Command Code `user_...` API key. A ChatGPT OAuth token is **not** a Command Code key. Building from source requires Node.js 22.19+ and pnpm.

## Install

**Not yet published to npm.** Build the archive from this repository and install it through DSH; do not enter an unpublished package name into the plugin page.

```sh
cd dsh-commandcode-subscription
pnpm install --frozen-lockfile
pnpm run check
mkdir .artifacts
pnpm pack --pack-destination .artifacts
# Run in this directory (or use the absolute path to the archive)
dsh plugin --profile web add ./.artifacts/dsh-commandcode-subscription-0.1.0.tgz
```

Restart the **existing** DSH Web process if prompted. Use the appropriate `--profile` for other profiles; follow your DSH version's instructions for desktop plugin installation. The archive filename changes when the version changes.

Configure `COMMANDCODE_API_KEY` in the **DSH credential manager**, or set the same variable in the DSH process environment (the host credential service resolves its environment fallback). **Never** put the key in plugin settings, a chat message, or a browser request. After loading, select a model from the `commandcode-go` provider. Without a key, generation does not contact the upstream service.

## Scope and limitations

- Only the fixed `https://api.commandcode.ai` HTTPS origin receives generation requests and the key. The model catalog request needs no key. Generation is not replayed after network or stream errors; a missing finish event is an error.
- No OAuth, account management, multi-key rotation, quota UI, image attachments, or OpenAI/Anthropic-compatible proxy. A public model listing does not guarantee access.
- The model descriptor's zero-dollar cost is a **pi-ai placeholder**, not a free-usage claim. Refer to provider billing.
- Runtime error dictionaries support English and Chinese, but there is no plugin-specific language switch. Without a valid locale passed to a request, messages remain English; **automatic synchronization with the DSH Web language is not guaranteed**.
- Tests use a mock upstream and DSH adapter packages. No real account or end-to-end acceptance in a running DSH Web or desktop GUI has been performed.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Sources live in `src/`, generated `lib/` is not committed, and tests live in `tests/`. To add a language, register a dictionary and keep keys and placeholders in sync; run the tests to check fallback behavior. Do not commit API keys, logs, or fixtures with real account data.

Protocol and DSH integration were researched using local `commandcode-go-for-pi`, `commandcode-api-proxy`, and `dsh-codex-subscription` references. Their licenses and upstream terms remain independent. This project is [MIT licensed](LICENSE).
