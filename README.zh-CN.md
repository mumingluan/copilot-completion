# Copilot Completions

一个独立的 VS Code 插件，为本地或自托管模型提供编辑器内代码补全和预测性编辑，包括虚影补全（Ghost Text/FIM）、下一处编辑建议（NES）和预测光标。

[English](README.md)

> 本项目与 GitHub、Microsoft 无隶属关系，也不是其官方产品。项目历史中的“Copilot”指上游项目及本扩展沿用的上游接口。

> 如需更好的、更接近原版 GitHub Copilot 的体验，请关注 [Localalot](https://github.com/mumingluan/localalot)。

## 上游与本分支

本仓库 fork 自 [`spite-triangle/copilot-completion`](https://github.com/spite-triangle/copilot-completion)。上游提供了 VS Code 插件基础、虚影补全、NES 编辑建议及其编辑器集成。本分支保留项目来源和许可证，并独立改进补全行为及模型接口兼容性。

相较于上游基线，本分支主要关注：

- 更可靠的虚影补全流程：请求取消与复用、缓存隔离、输入后的预取、缩进感知裁剪、重复后缀处理，以及 YAML/JSON 等结构化文件的多行判断。
- 更丰富的补全上下文：近期编辑、相关文件、语言服务符号和诊断、沿导入路径查找，以及语言服务不可用时的词法回退。
- 更稳健的 NES：编辑窗口解析、流式及部分编辑、多处编辑连续接受、诊断修复、缓存重定位、响应过滤和跨文件预测光标。
- 更多本地模型接口：OpenAI 兼容的 Completions、FIM Completions、Chat Completions、Responses，以及相关功能支持的 Anthropic Messages。
- 专注编辑器内补全、NES、预测光标和状态栏菜单的使用体验。本分支不包含 Agent、聊天窗口、行内聊天或侧边栏对话功能。

本分支会随开发逐渐偏离上游。上游当前实现和历史请查看[原仓库](https://github.com/spite-triangle/copilot-completion)。本项目不是 Microsoft/GitHub Copilot 插件，也不包含 Copilot 托管服务。

## 功能

### 虚影补全

- 输入时显示行内建议，支持单行和多行续写。
- 为模型提示提供前缀、后缀、近期编辑、相邻文件和语义上下文。
- 按语言处理多行补全和代码块边界，包括 YAML、JSON 等结构化格式。
- 支持流式输出、取消、请求复用、缓存、后缀裁剪和缩进过滤。
- 可与 IntelliSense 同时工作，并可配置暂停建议或基于当前选中项预览。

### 下一处编辑建议

- 可建议当前光标以外的修改位置，并通过 VS Code 的行内编辑界面预览和接受。
- 支持按顺序呈现同一响应中的多处编辑，并支持诊断修复。
- 利用编辑历史、相关文件、语言服务上下文和可配置过滤器。
- 可预测当前文件或其他工作区文件中的下一处光标位置。

## 使用要求

- VS Code 版本需满足 [`package.json`](package.json) 声明的要求。
- 准备兼容的模型服务、接口地址、模型名称和可选 API Key。
- 使用 NES 前，需要在 VS Code 的 `argv.json` 中为本扩展启用 Proposed API，并重启 VS Code：

```json
{
  "enable-proposed-api": ["young-triangle.copilot-completions"]
}
```

可在命令面板运行 **Preferences: Configure Runtime Arguments** 打开 `argv.json`。VS Code 对 Proposed API 有访问限制；未启用时 NES 可能无法使用。虚影补全使用稳定版 Inline Completions API。

## 配置模型

在 VS Code 设置中配置 `cc-completion.ghost` 和 `cc-completion.nes` 下的模型选项。基础 URL 不要包含接口路径，插件会根据 endpoint 设置追加路径。

| 功能 | 支持的接口路径 |
|---|---|
| 虚影补全 | `/completions`、`/fim/completions`、`/chat/completions`、`/responses`、`/messages` |
| NES 和预测光标 | `/chat/completions`、`/completions`、`/responses`、`/messages` |

具体兼容性取决于模型服务。例如，OpenAI Responses API 服务选择 `responses`，Anthropic Messages API 服务选择 `messages`。仅支持完整响应的服务可以关闭流式输出。虚影补全的 prompt 模板用于 completion 接口；chat 类接口会收到前缀和后缀作为代码插入上下文。

常用设置：

- `cc-completion.ghost.baseUrl`、`cc-completion.ghost.apiKey`、`cc-completion.ghost.model`、`cc-completion.ghost.endpoint`。
- `cc-completion.nes.baseUrl`、`cc-completion.nes.apiKey`、`cc-completion.nes.model`、`cc-completion.nes.endpoint`。
- `cc-completion.ghost.capabilities.limits.max_context_window_tokens` 和 `cc-completion.nes.capabilities.limits.max_context_window_tokens`：分别匹配模型的上下文容量。
- `cc-completion.ghost.semanticContextEnabled`、`cc-completion.nes.semanticContextEnabled` 和 `cc-completion.nes.neighborFilesEnabled`：控制额外提示上下文。
- `cc-completion.enable`：按语言启用或关闭建议；`cc-completion.exclude`：按 glob 排除文件。

全部设置及默认值以 [`package.json`](package.json) 为准。

## 构建与测试

```sh
npm install
npm run compile
npm test
```

从源码运行扩展，请使用仓库提供的 VS Code 启动配置。VSIX 可通过 `@vscode/vsce` 支持的打包流程生成。

## 贡献与同步上游

本仓库用于跟踪本分支的问题和改动。同步上游时请仔细检查行为和配置变化；本分支已独立修改 Ghost、NES、模型适配器、设置和测试。

- Fork：[mumingluan/copilot-completion](https://github.com/mumingluan/copilot-completion)
- 上游：[spite-triangle/copilot-completion](https://github.com/spite-triangle/copilot-completion)

## 许可证

本分支保留上游的 [MIT 许可证](LICENSE.txt)。其他适用声明和来源信息请见仓库文件。
