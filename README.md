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
| 凭证 | 从 DSH 宿主凭证服务解析 `COMMANDCODE_API_KEY`；密钥不保存在插件配置或浏览器中。 |
| 语言 | 英文与简体中文的运行时提示词典；按请求提供的 locale 解析，未提供或不支持时回退英文。无需改动词典框架即可增加其他语言。 |

## 准备 DSH

使用兼容的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（版本范围以 [package.json](package.json) 的 `engines.dsh` 为准）和 Command Code 提供的 `user_...` API Key。请勿将 ChatGPT OAuth token 当成 Command Code Key。使用命令行构建需 Node.js 22.19+ 与 pnpm。

## 安装

**当前未发布到 npm。** 从本仓库源码构建安装包，再由 DSH 安装；不要在插件页直接输入未发布的包名。

```sh
cd dsh-commandcode-subscription
pnpm install --frozen-lockfile
pnpm run check
mkdir .artifacts
pnpm pack --pack-destination .artifacts
# 在此目录执行（也可换成该 tgz 的绝对路径）
dsh plugin --profile web add ./.artifacts/dsh-commandcode-subscription-0.1.0.tgz
```

安装后按 DSH 提示重启**当前** Web 进程。若使用其他 profile，改用相应的 `--profile`；桌面端的插件安装方式以当前 DSH 版本说明为准。版本号改变时，安装包文件名也会变化。

在 **DSH 凭证管理器**中配置 `COMMANDCODE_API_KEY`；或在启动 DSH 的进程环境中设置同名变量（由宿主凭证服务解析环境回退）。**不要**把 Key 填入插件配置、聊天消息或网页。模型加载后选择 `commandcode-go` 提供者的模型。没有 Key 时不会向上游发起生成请求。

## 使用与限制

- 仅向固定的 `https://api.commandcode.ai` HTTPS 源站发送生成请求和凭证。模型目录请求无需 Key。网络或流失败后不自动重放生成请求；缺少终止事件会报错。
- 尚不支持 OAuth、账户管理、多 Key 轮换、额度界面、图片附件或 OpenAI/Anthropic 兼容代理；不承诺某个公开模型一定可用。
- 模型描述符中的零美元成本只是 pi-ai 必需的**占位数值**，并不意味着免费。请以服务商实际计费为准。
- 运行时错误支持中英词典，但本插件没有单独的语言切换界面；未收到有效 locale 时显示英文，**不保证自动跟随 DSH 网页语言**。
- 测试使用模拟上游和 DSH 适配器包，尚未使用真实账号或在运行中的 DSH Web / 桌面界面做端到端验收。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run check
```

源代码在 `src/`，`lib/` 是构建产物（不提交），测试在 `tests/`。新增语言时增加词典并登记语言代码，保持键和占位符一致，运行测试验证回退。不要提交密钥、日志或包含真实账号数据的 fixture。

协议与 DSH 集成曾参考本地 `commandcode-go-for-pi`、`commandcode-api-proxy`、`dsh-codex-subscription` 项目；各项目许可证和上游服务条款独立。本项目使用 [MIT 许可证](LICENSE)。
