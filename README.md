<div align="center">

# DSH Command Code Subscription

**中文** · [English](README.en.md)

**在 DeepSeek Harness 中使用 Command Code Go 模型**

通过 DSH 凭证服务管理 Command Code API Key，直接对接原生 NDJSON 生成接口，无需运行本地 HTTP 代理。

[![CI](https://github.com/LingBrian/dsh-commandcode-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/LingBrian/dsh-commandcode-subscription/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)

[功能](#功能) · [安装](#安装) · [使用与限制](#使用与限制) · [开发](#开发)

</div>

> **实验性项目，非 Command Code 官方产品。** 当前使用未公开文档的 `/alpha/generate` 接口；接口和 CLI 版本要求可能随时变化。使用前请核对服务条款、账号授权和实际计费。这里的 “Subscription” 是项目名称，**不是** ChatGPT/Codex 订阅，也不表示支持 OAuth 登录。

## 功能

| 功能 | 当前实现 |
| --- | --- |
| 模型对话 | 从公开模型目录刷新列表，离线时展示一个内置占位模型；目录不代表账号权限。 |
| 流式输出 | 将原生 NDJSON 转成 DSH 文本、推理、工具调用和工具结果事件；支持取消。 |
| 图片理解 | 对已知支持图片的模型开放 DSH 图片附件，并将受限大小的图片转为原生请求内容。 |
| 凭证 | 从 DSH 宿主凭证服务解析 `COMMANDCODE_API_KEY`；密钥不保存在插件配置或浏览器中。 |
| 语言 | 英文与简体中文的运行时提示词典；按请求提供的 locale 解析，未提供或不支持时回退英文。无需改动词典框架即可增加其他语言。 |

## 准备 DSH

使用兼容的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（版本范围以 [package.json](package.json) 的 `engines.dsh` 为准）和 Command Code 提供的 `user_...` API Key。请勿将 ChatGPT OAuth token 当成 Command Code Key。使用命令行构建需 Node.js 22.19+ 与 pnpm。

## 安装

在 DSH 的 **Plugins → Add plugin** 页面，可选择以下任一来源并粘贴到 **Package name or address**：

- **GitHub（仓库源码）**：`github:LingBrian/dsh-commandcode-subscription`
- **npm（已发布）**：`dsh-commandcode-subscription@0.1.5`

点击 **Install** 并按提示重启。GitHub 仓库包含预构建的插件入口，不需要安装时运行构建脚本；npm 方式安装已发布的预构建包。若安装新版本，可将 npm 地址中的版本号换成所需版本。

**Desktop 安装：**在 DSH Desktop 应用中打开 **Plugins → Add plugin**，粘贴上述任一地址并安装；按提示重启应用。桌面端和 Web 端使用各自的插件 profile，需分别安装。若已安装桌面版 CLI，也可显式安装到对应 profile：

```sh
dsh plugin --profile desktop add github:LingBrian/dsh-commandcode-subscription
# 或
dsh plugin --profile desktop add dsh-commandcode-subscription@0.1.5
```

已有 CLI 的 Web profile 安装命令：

```sh
dsh plugin --profile web add dsh-commandcode-subscription@0.1.5
```

从源码打包（开发或离线安装）时，在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack --pack-destination .artifacts
```

再将生成的 `.artifacts/*.tgz` 作为插件地址安装。npm 安装地址使用已发布的版本号。

在 **DSH 凭证管理器**中配置 `COMMANDCODE_API_KEY`；或在启动 DSH 的进程环境中设置同名变量（由宿主凭证服务解析环境回退）。**不要**把 Key 填入插件配置、聊天消息或网页。模型加载后选择 `commandcode-go` 提供者的模型。没有 Key 时不会向上游发起生成请求。

**图片理解：**选择目录中标有图片输入能力的模型（例如 `deepseek/deepseek-v4-flash-vision-exp`），在 DSH 输入框添加图片后发送。图片由 DSH 附件服务处理，单张请求图片最大 1 MiB、尺寸预算约 2048 × 2048 像素，单次请求的编码图片总量最大 20 MiB。模型是否可用仍取决于 Command Code 账号权限；公开目录并不保证权限。

## 使用与限制

### 0.1.4 修复

- 将 DSH 历史中的开发者指令并入上游系统提示词，修复对话开始前的请求构造错误。
- 接受 Command Code 多步骤响应、复用事件 ID 和省略文本结束事件的流，修复输出部分内容后中断的问题。
- 失败信息按请求构造、网络请求和响应解析阶段区分；不回显上游错误正文或 API Key。

- 仅向固定的 `https://api.commandcode.ai` HTTPS 源站发送生成请求和凭证。模型目录请求无需 Key。网络或流失败后不自动重放生成请求；缺少终止事件会报错。
- 尚不支持 OAuth、账户管理、多 Key 轮换、额度界面或 OpenAI/Anthropic 兼容代理；不承诺某个公开模型一定可用。图片能力仅对已知模型开放，不代表目录中所有模型都支持视觉输入。
- 模型描述符中的零美元成本只是 pi-ai 必需的**占位数值**，并不意味着免费。请以服务商实际计费为准。
- 运行时错误支持中英词典，但本插件没有单独的语言切换界面；未收到有效 locale 时显示英文，**不保证自动跟随 DSH 网页语言**。
- 测试使用模拟上游和 DSH 适配器包，尚未使用真实账号或在运行中的 DSH Web / 桌面界面做端到端验收。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run check
```

源代码在 `src/`，`lib/` 是随仓库提交的构建产物，供 GitHub 安装来源直接使用；修改源码后运行 `pnpm run build` 并提交对应的 `lib/` 更新。测试在 `tests/`。新增语言时增加词典并登记语言代码，保持键和占位符一致，运行测试验证回退。不要提交密钥、日志或包含真实账号数据的 fixture。

协议与 DSH 集成曾参考本地 `commandcode-go-for-pi`、`commandcode-api-proxy`、`dsh-codex-subscription` 项目；各项目许可证和上游服务条款独立。本项目使用 [MIT 许可证](LICENSE)。
