# Anti Slop for X

在 X（x.com）上给回复打「疑似 AI 或机器人」分数，再按分数标记、折叠或自动屏蔽。

[English](README.en.md) · [CHANGELOG](CHANGELOG.md) · [架构说明](docs/architecture.md)

当前版本 v0.6.0。只在 Chrome 上验证过，未上架 Chrome Web Store。

## 目录结构

```
extension/  Chrome MV3 扩展，WXT + TypeScript
worker/     0.1.0 时代的本机代理，扩展已不再调用
docs/       架构、Strict 模式设计、旧版代理、隐私政策
ROADMAP.md  计划中与暂时关闭的功能
```

## 它怎么工作

1. content script 读取时间线上已经渲染出来的回复。
2. 本地关键词预筛给出 0..1 的初分。命中强特征就直接判定，不打模型。
3. 边缘样本发给你配置的决策模型，模型分与预筛分混合。
4. 结果按当前模式处理：只标记、折叠，或进入自动屏蔽队列。

扩展不含密钥，也不中转流量。你填自己的 endpoint 和 key，请求由 background service worker 直接发往该地址。评分只在本机和你选定的上游之间流转。

## 安装

需要 Node.js 20.12 或更高版本，这是 `wxt` 的 `engines` 要求。

```bash
npm install
npm run unpacked
```

1. 打开 `chrome://extensions`，启用开发者模式。
2. 点「加载已解压的扩展程序」，选择 `unpacked/chrome-mv3`。
3. 在扩展选项页填入 endpoint 和 key。
4. 打开任意 x.com 页面，点工具栏图标，确认面板能打开。

`npm run unpacked` 先构建，再把产物镜像到 `unpacked/chrome-mv3`。改完代码重跑这条命令，然后到扩展页点一次刷新按钮。

## 配置

选项页的 Endpoint 决定 Base URL、决策路径和协议。选中官方预设时这三项自动填好并锁定，选 Custom 才能编辑。Model 始终可改，预设只提供默认值。

| Endpoint | Base URL | Path | Protocol | 默认 Model |
|---|---|---|---|---|
| TypeSafe / Jev（官方） | `https://api.typesafe.ai/v1` | `/systemone` | `jev` | `jev-latest` |
| OpenAI Decisions（官方） | `https://api.openai.com/v1` | `/decisions` | `openai-decisions` | `gpt-6-luna` |
| Custom endpoint | 你填 | 你填 | 你选 | 你填 |

两个官方预设的 origin 已在 `host_permissions` 中，保存不会弹权限窗。选 Custom 并换到其他域名时，保存会触发 Chrome 对该 origin 的授权请求；拒绝授权后请求会失败，重新保存可以再申请。

key 只存在 `chrome.storage.local`，只发往你选的 Base URL。能读你 Chrome profile 目录的本机进程仍能取到明文 key，任何把密钥存在浏览器里的方案都有这个限制。

OpenAI 预设用真实 key 验证过：`gpt-6-luna` 出现在 `/v1/models`，`POST https://api.openai.com/v1/decisions` 返回 HTTP 200，`answers[]` 与解析器一致。该响应已固化为测试夹具 `extension/tests/fixtures/openai-decisions-real.json`。

## 两个模式

选项页的 Mode 决定评分之后发生什么。

| 模式 | 超过阈值时 | 会改你的 X 账号 |
|---|---|---|
| 手动 Manual | 只显示疑似 AI 率，内容不隐藏 | 否 |
| 自动折叠 Auto Fold（默认） | 折叠回复 | 否 |

两个模式都不写你的 X 账号。静音和屏蔽只在你自己点的时候执行。

### Strict 模式已关闭

曾有一档「严厉」模式：模型分数达到 `max(0.9, 阈值)` 时自动屏蔽作者。它在 v0.7.0 时关闭，代码保留，开关是 `extension/lib/mode.ts` 里的 `STRICT_ENABLED`。

原因是自动屏蔽会写入你的 X 账号，对方也能感知，而这条路径从未在真实浏览器会话中验证过。现在即使 `chrome.storage.local` 里还留着 `strict`，加载时也会降级成自动折叠；原值不删除，重新开启时会恢复。

设计与闸门写在 [docs/strict-mode.md](docs/strict-mode.md)，重新开启的条件在 [issue #2](https://github.com/Caph-dev/anti-slop-for-x/issues/2)。

## 界面

工具栏图标打开 popup，面板显示当前 endpoint、模型、模式、扫描范围和状态，并提供「扫描当前页」和「选项」两个按钮。扫描结束会报告处理了多少条，扫不到内容时说明原因。面板底部的自动动作日志在 Strict 关闭期间始终为空。

超过阈值的回复折叠成一条整行宽的卡片。

```text
疑似 AI/机器人 55%   [展开] [静音] [屏蔽]
```

- 点**展开**还原回复内容。卡片收起后时间戳后面出现一个可点击的 `AI? 55%` 药丸，点它可以重新折叠。
- 卡片悬停提示里保留原始打分细节，界面上只显示疑似 AI 率。
- 分数没到阈值但达到阈值的 70% 时不折叠，只在时间戳后加一个 `AI? nn%` 标记。

### 静音与屏蔽

沿用 X 自己的术语。

| 操作 | 效果 |
|---|---|
| 静音 Mute | 你不再看到这个账号的推文，对方不会收到通知，仍能关注你 |
| 屏蔽 Block | 对方无法关注你或与你互动，你也看不到对方 |

手动静音和屏蔽优先点 X 原生「···」菜单，失败再走同登录态下的 web API。无界面环境里原生菜单点不到，需要在真实浏览器会话中使用。

## 已知限制

- 只保证 Chrome MV3。WXT 结构便于以后加 Firefox，但尚未适配。
- 未上架 Chrome Web Store，当前只能从源码加载，或解压 release 里的 zip。
- Strict 模式关闭。自动屏蔽的限速、熔断、撤销链路未经真机验证，因此不提供入口，见 [ROADMAP](ROADMAP.md)。
- 去重按 handle 记账，`userId` 尚未从 DOM 解析。
- `worker/` 是 0.1.0 时代的代理，扩展已不再调用，说明见 [docs/legacy-proxy.md](docs/legacy-proxy.md)。

## 开发

| 命令 | 作用 |
|---|---|
| `npm run dev` | WXT 开发模式 |
| `npm run build` | 构建到 `extension/.output/chrome-mv3` |
| `npm run unpacked` | 构建并镜像到 `unpacked/chrome-mv3` |
| `npm test` | 运行单元测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run zip` | 产出可上传商店的 zip |
| `npm run release:build` | 类型检查、测试、zip、镜像未打包目录 |

## 文档

- [架构说明](docs/architecture.md)：请求链路、端点预设、BYOK 边界
- [Strict 模式设计](docs/strict-mode.md)：闸门、TLA+ 模型、重新开启的条件
- [路线图](ROADMAP.md)：暂时关闭的功能与已知缺口
- [旧版代理](docs/legacy-proxy.md)：`worker/` 的用途与 curl 示例
- [隐私政策草稿](docs/privacy-policy.md)
- [变更记录](CHANGELOG.md)

## License

MIT。参考了 [slop-filter](https://github.com/adamnroman/slop-filter)（MIT）与 [BotBlind 指南](https://botblind.app/how-to-hide-ai-replies-on-x)，未 fork，独立实现。
