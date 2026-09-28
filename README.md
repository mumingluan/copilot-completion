# Copilot Completions

An independent VS Code extension for model-powered inline code completion and predictive edits. It provides Ghost Text (FIM-style inline completions), Next Edit Suggestions (NES), and next-cursor predictions in the editor.

[简体中文](README.zh-CN.md)

> This project is not affiliated with, endorsed by, or an official product of GitHub or Microsoft. “Copilot” in the project history refers to the upstream source project and the upstream APIs this extension builds on.

> For an improved experience that more closely matches the original GitHub Copilot, follow [Localalot](https://github.com/mumingluan/localalot).

## Upstream and this fork

This repository is a fork of [`spite-triangle/copilot-completion`](https://github.com/spite-triangle/copilot-completion). The upstream project provides the starting VS Code extension, Ghost inline completions, NES edits, and their editor integration. This fork retains that project lineage and license while developing completion behavior and model compatibility independently.

Compared with the upstream baseline, this fork focuses on:

- More reliable Ghost completion flow: request cancellation and reuse, cache scoping, speculative prefetch, indentation-aware trimming, duplicate suffix handling, and multiline decisions for YAML/JSON and other structured files.
- Richer completion context: recent edits, related files, language-server symbols and diagnostics, import-aware lookup, and lexical fallbacks when language services are unavailable.
- More robust NES behavior: edit-window resolution, streaming and partial edits, multi-edit acceptance, diagnostics fixes, cache rebasing, response filtering, and next-cursor prediction across files.
- More local model choices: OpenAI-compatible Completions, FIM Completions, Chat Completions, and Responses endpoints, plus Anthropic Messages endpoints where supported by the selected feature.
- Focused editor UX for inline completion, NES, prediction cursor, and the status-bar menu. This fork does not add Agent, chat, inline-chat, or sidebar conversation features.

The fork may diverge from upstream over time. See the [upstream repository](https://github.com/spite-triangle/copilot-completion) for its current implementation and history. This fork is not the Microsoft/GitHub Copilot extension and does not include its hosted Copilot service.

## Features

### Ghost Text inline completions

- Inline suggestions while typing, including single-line and multiline completions.
- Prefix, suffix, recent-edit, neighboring-file, and semantic context for the model prompt.
- Language-aware multiline handling and block parsing, including structured formats such as YAML and JSON.
- Streaming, cancellation, request reuse, caching, suffix trimming, and indentation-aware filtering.
- Works alongside IntelliSense, with settings for pausing suggestions or previewing the selected completion.

### Next Edit Suggestions

- Proposes edits away from the current cursor, shown through VS Code's inline edit experience.
- Preserves sequential edits from a response and supports diagnostic fixes.
- Uses edit history, related files, language-server context, and configurable filtering.
- Predicts a next cursor location in the current or another workspace file.

## Requirements

- VS Code matching the version declared by [`package.json`](package.json).
- A completion model server and its endpoint URL, model name, and optional API key.
- To use NES, enable the proposed API for this extension in VS Code's `argv.json`, then restart VS Code:

```json
{
  "enable-proposed-api": ["young-triangle.copilot-completions"]
}
```

Open the Command Palette and run **Preferences: Configure Runtime Arguments** to locate `argv.json`. VS Code restricts the proposed inline-edit APIs; without this setting, NES may not be available. Ghost inline completions use the stable inline completions API.

## Configure a model

Set the model settings under `cc-completion.ghost` and `cc-completion.nes` in VS Code Settings. Configure the base URL without the endpoint path; the extension appends the selected endpoint.

| Feature | Supported endpoint paths |
|---|---|
| Ghost | `/completions`, `/fim/completions`, `/chat/completions`, `/responses`, `/messages` |
| NES and cursor prediction | `/chat/completions`, `/completions`, `/responses`, `/messages` |

Endpoint compatibility depends on the model server. For example, choose `responses` for an OpenAI Responses API server and `messages` for an Anthropic Messages API server. Streaming can be turned off for endpoints that only return complete responses. The Ghost prompt template is used for completion endpoints; chat-style endpoints receive the prefix and suffix as code insertion context.

Useful settings include:

- `cc-completion.ghost.baseUrl`, `cc-completion.ghost.apiKey`, `cc-completion.ghost.model`, and `cc-completion.ghost.endpoint`.
- `cc-completion.nes.baseUrl`, `cc-completion.nes.apiKey`, `cc-completion.nes.model`, and `cc-completion.nes.endpoint`.
- `cc-completion.ghost.capabilities.limits.max_context_window_tokens` and `cc-completion.nes.capabilities.limits.max_context_window_tokens` to match each model's context capacity.
- `cc-completion.ghost.semanticContextEnabled`, `cc-completion.nes.semanticContextEnabled`, and `cc-completion.nes.neighborFilesEnabled` to control additional prompt context.
- `cc-completion.enable` to enable or disable suggestions by language, and `cc-completion.exclude` to exclude files by glob.

All available settings and defaults are declared in [`package.json`](package.json).

## Build and test

```sh
npm install
npm run compile
npm test
```

To run the extension from source, use the repository's VS Code launch configuration. To create a VSIX, use the packaging workflow supported by `@vscode/vsce`.

## Contributing and upstream sync

Use this repository for fork-specific issues and changes. When syncing upstream, review behavior and configuration changes carefully; the fork has independent modifications to the Ghost, NES, model adapters, settings, and tests.

- Fork: [mumingluan/copilot-completion](https://github.com/mumingluan/copilot-completion)
- Upstream: [spite-triangle/copilot-completion](https://github.com/spite-triangle/copilot-completion)

## License

This fork retains the upstream [MIT license](LICENSE.txt). See the repository for applicable notices and attributions.
