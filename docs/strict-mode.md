# Strict mode（已关闭）

Strict 模式在 v0.7.0 时关闭。v0.10.0 的改动没有接入自动屏蔽路径，也没有 `STRICT_ENABLED` 启动开关；旧 `strict` 设置按「仅记录」运行。当前决策见 [ROADMAP](../ROADMAP.md) 和 [issue #2](https://github.com/Caph-dev/anti-slop-for-x/issues/2)。

下文是 v0.7.0 之前的历史设计与验证记录，不描述当前代码，也不是重新开启的操作指南。

## 它做什么

分数达到 `max(0.9, 折叠阈值)` 且证据来自决策模型时，扩展调用 `POST /1.1/blocks/create.json` 屏蔽作者。低于折叠阈值的回复不处理，介于两者之间的只折叠。

关掉之后还有两档：手动（只显示疑似 AI 率）和自动折叠（默认）。

## 为什么关掉

自动屏蔽会写入你的 X 账号，而且对方能感知。误判一次就是无故拉黑一个真人，并出现在对方通知里。而这条路径从未在真实浏览器会话中跑过。已有的是类型检查、单元测试、构建，和一个 TLA+ 模型。它们都回答不了一个问题：X 是否接受这个账号发出的 `blocks/create.json`。

## 关闭前的闸门

代码里这几道闸都在，重新开启时会一起生效。

| 闸门 | 行为 | 位置 |
|---|---|---|
| 证据门槛 | 只有 `evidence === 'model'` 的分数能触发。仅预筛、`prefilterOnly`、模型报错回退，一律只折叠 | `extension/lib/mode.ts` |
| 最小间隔 | 两次自动动作至少 20 秒 | `extension/lib/auto-guard.ts` |
| 日上限 | 每天 30 次，跨标签与刷新共享 | 同上 |
| 熔断 | X 返回 403 或 429 时暂停 1 小时 | 同上 |
| 去重 | 按 `userId`（未知时 handle）记账 7 天 | 同上 |
| 出队复查 | 执行前重查启用状态、模式、白名单、自己的帖子 | `extension/entrypoints/content.ts` |
| 留痕 | 最近 50 条动作写入 `chrome.storage.local` | `extension/lib/action-log.ts` |
| 撤销 | popup 经 x.com 标签页调用 `blocks/destroy.json`，并把账号加入白名单 | `extension/entrypoints/background.ts` |

## TLA+ 模型

`AutoBlock.tla`（在仓库外的 scratch 目录里跑）检查了这些规则：无模型证据不得屏蔽、账本与屏蔽集合一致、撤销后账号仍在账本、日上限、无死锁、调用只能在 Strict 下发起。

它抓到一个真问题：出队检查通过后还有两次存储往返，期间把模式切走，屏蔽请求照样发出。修复是在调用前重新读取模式。这个修复在 v0.6.0 之后进的主线，也在关闭后的代码里。

模型没覆盖的东西：多标签页、真实时钟、0.9 阈值本身、403 和 429 的退避曲线、撤销的白名单副作用、跨日重置。所以它是这次改动的一块证据，不是全部。

## 重新开启要做的

见 [issue #2](https://github.com/Caph-dev/anti-slop-for-x/issues/2)。任何重新设计都需要单独决策，并验证真实屏蔽、撤销和限速行为；旧测试开关已不适用于当前识别流程。

## 已知缺口

- 去重按 handle 记账，`userId` 尚未从 DOM 解析。
- 没有作者级证据累积，一条高分回复就足以触发。
- 已经发出的请求无法撤销，没有 AbortController。
