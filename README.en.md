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
| Model conversations | Refreshes the public model catalog and retries after startup failures; temporarily shows one built-in placeholder when offline. The catalog does not prove account entitlement. |
| Model settings | When a Command Code model is selected, a gear beside the composer opens model search, verified reasoning levels, and catalog-listed Standard/Fast/Ultrafast model variants. The selected reasoning level is sent with generation requests. |
| Streaming | Converts native NDJSON into DSH text, reasoning, tool-call, and tool-result events; supports cancellation. |
| Image understanding | Enables DSH image attachments for models known to accept image input and sends bounded image data in the native request. |
| Credentials and accounts | A dedicated **Command Code accounts** page in DSH settings adds, selects, and logs out multiple API keys. Keys live in DSH's host credential records; an existing `COMMANDCODE_API_KEY` is imported as the first account. |
| Usage | Opens a plugin usage dialog. With a Command Code model selected, the composer shows a 5h quota strip; hover to see 5h, 1w, and 1m quota bars, refreshed every 30 seconds. Percentages appear only when the provider reports a cap. |
| Languages | Runtime message dictionaries for English and Simplified Chinese; resolves a request-provided locale and falls back to English for missing or unsupported locales. More languages can be added through the same dictionary framework. |

## Prepare DSH

Use a compatible [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation (see `engines.dsh` in [package.json](package.json)) and a Command Code `user_...` API key. A ChatGPT OAuth token is **not** a Command Code key. Building from source requires Node.js 22.19+ and pnpm.

## Install

On the DSH **Plugins → Add plugin** page, paste either source into **Package name or address**:

- **GitHub (repository source):** `github:LingBrian/dsh-commandcode-subscription`
- **npm (after release):** `dsh-commandcode-subscription@0.1.13`

Click **Install** and follow the restart prompt. The GitHub repository includes the prebuilt plugin entry, so installation does not need to run a build script; the npm route installs the published, prebuilt package. To install a later release, replace the npm version with the desired published version.

**Desktop installation:** In the DSH Desktop app, open **Plugins → Add plugin**, paste either address above, and install. Restart the app if prompted. Desktop and Web use separate plugin profiles, so install into each profile you use. If the DSH CLI is available, explicitly target the Desktop profile:

```sh
dsh plugin --profile desktop add github:LingBrian/dsh-commandcode-subscription
# or
dsh plugin --profile desktop add dsh-commandcode-subscription@0.1.13
```

For the Web profile with an existing CLI:

```sh
dsh plugin --profile web add dsh-commandcode-subscription@0.1.13
```

To build a source archive for development or offline installation, run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack --pack-destination .artifacts
```

Then install the generated `.artifacts/*.tgz` as the plugin address. For npm installs, use a version that has been published.

Configure `COMMANDCODE_API_KEY` in the **DSH credential manager**, or set the same variable in the DSH process environment (the host credential service resolves its environment fallback). **Never** put the key in plugin settings, a chat message, or another website. After loading, select a model from the `commandcode-go` provider. Without a key, generation does not contact the upstream service.

**Multiple accounts:** Open the dedicated **Command Code accounts** section in DSH settings. Click **Log in**, enter a Command Code API key, and save it. The plugin verifies the key with Command Code before storing it in a DSH credential record. Each card shows the account and plan above 5h, 1w, and 1m remaining quota bars. Use its checkbox to choose the active conversation account. **Log out** removes the active account and selects another saved account when available. The visible page polls every 30 seconds and supports manual refresh. An existing `COMMANDCODE_API_KEY` is imported on the first add; after all accounts are logged out, that legacy key is not automatically reactivated. A newly entered key passes through the authenticated DSH connection to the host and is not saved in browser storage. Up to 10 accounts can be stored.

**View usage:** Open **Command Code usage** in plugin settings and select **View usage**. The host reads Command Code account endpoints on demand; the API key never reaches the browser. You can refresh the dialog. If some endpoints fail, the available data remains visible with a partial-data notice. Consult your Command Code account for authoritative billing.

**Model settings:** With a Command Code model selected, click the gear beside the composer to choose a model, reasoning level, or speed. Reasoning choices appear only on models with verified support; “Model default” omits `reasoning_effort`. Speed switches between separate model IDs in the live Command Code catalog and appears only when multiple variants of the selected family are available. After changing the model or speed, choose an effort supported by the new model.

If the network or host connection does not respond, the usage dialog reports a timeout after 35 seconds and lets you retry. A failed catalog read at startup is retried in the background; DSH's model list updates after a successful read.

**Image understanding:** Select a model marked for image input in the catalog, such as `deepseek/deepseek-v4.1-flash` or `deepseek/deepseek-v4-flash-vision-exp`, and attach an image in the DSH composer. The vision list is maintained from Command Code's official model table and intersected with the current catalog. The DSH attachment service prepares each request image with a 1 MiB byte target and an approximately 2048 × 2048 pixel budget; encoded images in one request are capped at 20 MiB. Model access still depends on the Command Code account; the public catalog does not guarantee entitlement.

## Scope and limitations

### Fixes in 0.1.4

- Merges developer instructions from DSH history into the upstream system prompt, fixing request preparation failures.
- Handles multi-step Command Code streams, reused event IDs, and omitted text-end events so partial output can finish normally.
- Distinguishes failures during request preparation, transport, and response parsing without exposing upstream error bodies or API keys.

- Only the fixed `https://api.commandcode.ai` HTTPS origin receives generation requests and the key. The model catalog request needs no key. Generation is not replayed after network or stream errors; a missing finish event is an error.
- No OAuth, account management, multi-key rotation, or OpenAI/Anthropic-compatible proxy. A public model listing does not guarantee access. Image input is enabled only for known models, not the entire catalog.
- The model descriptor's zero-dollar cost is a **pi-ai placeholder**, not a free-usage claim. Refer to provider billing.
- Runtime error dictionaries support English and Chinese, but there is no plugin-specific language switch. Without a valid locale passed to a request, messages remain English; **automatic synchronization with the DSH Web language is not guaranteed**.
- Tests use a mock upstream and DSH adapter packages. No real account or end-to-end acceptance in a running DSH Web or desktop GUI has been performed.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Sources live in `src/`, and generated `lib/` is committed for direct GitHub installs; after changing sources, run `pnpm run build` and commit the matching `lib/` updates. Tests live in `tests/`. To add a language, register a dictionary and keep keys and placeholders in sync; run the tests to check fallback behavior. Do not commit API keys, logs, or fixtures with real account data.

## References

- [dsh-commandcode](https://github.com/Plocr/dsh-commandcode): Command Code account usage endpoints and field parsing.
- [dsh-codex-subscription](https://github.com/WSL043/dsh-codex-subscription): DSH usage dialog and quota bar interaction.
- [commandcode-go-for-pi](https://github.com/gonegirl07/commandcode-go-for-pi): Command Code protocol implementation.
- [commandcode-api-proxy](https://github.com/thaolaptrinh/commandcode-api-proxy): Command Code protocol and model catalog reference.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): Plugin host.

Their licenses and upstream terms remain independent. This project is [MIT licensed](LICENSE).
