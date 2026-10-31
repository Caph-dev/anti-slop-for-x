# Changelog

## 未发布 / Unreleased

新增调试模式：在 popup 里打开后，页面上每条已渲染且有正文的推文都显示自己的 AI 率，只读、不折叠、不屏蔽。
Added a debug mode: turn it on in the popup and every rendered post with text on the page shows its own AI rate. Read-only — nothing is folded or blocked.

- 新设置 `debugMode`（默认关闭），开关在工具栏 popup；content script 监听 `chrome.storage.onChanged`，翻转时先恢复所有已挂载的卡片（含之前被折叠的推文），再按新模式重扫。
- New `debugMode` setting (off by default) with the toggle in the toolbar popup. The content script watches `chrome.storage.onChanged`, restores every mounted card (including posts folded earlier) and rescans under the new policy.
- 调试评分绕过「短文本 / 自己的帖子 / 白名单」这类纯降噪跳过，否则它们只会显示 `0%`；`prefilterOnly`、阈值和模型配置照常生效。
- Debug scoring bypasses the noise-only skips (short text / own posts / whitelist), which would otherwise just print `0%`; `prefilterOnly`, the threshold and the model settings still apply.
- 调试分数写进独立的缓存命名空间 `debug:`，普通折叠路径读不到：白名单账号不会被一个调试分数折叠，调试也不会复用普通的跳过结果。
- Debug scores live in their own cache namespace (`debug:`), invisible to the normal fold path: a whitelisted account can never be folded by a debug score, and debug never reuses a skipped normal result.
- 每个徽标显示 `AI 42% · 模型/预筛/缓存/模型失败`，颜色与正常模式的分档一致（高于阈值 / 临界 / 无关），悬停给出 reason 与命中的预筛特征。
- Each badge reads `AI 42% · model/prefilter/cached/model failed`, coloured with the normal policy bands (over threshold / borderline / irrelevant); hover shows the reason and the prefilter hits that fired.
- 调试模式下不进入 `decide()`，自动屏蔽路径也不会执行；页面切换时用 generation 计数丢弃上一套设置算出的在途结果，避免刚打开调试就被旧扫描折叠。
- Debug never reaches `decide()`, and the auto-block path cannot run. A generation counter discards scores that resolve after a settings change, so a scan started before debug was enabled cannot fold a post.
- 扫描状态抽到 `extension/lib/scan-state.ts`：每次评分登记一张带唯一 id 的 ticket，同一 DOM 节点上的同一推文在结果返回前不会重复提交，过期任务也不会清掉新任务的登记；挂载前再核对节点仍在文档中且仍属原推文与当前设置，避免 X 复用节点时把 A 的分数挂到 B 上；被丢弃的在途结果不写入缓存（`scorePost` 的 `shouldCache`）。同一推文若同时出现在多个 DOM 节点，仍可能各发一次请求。
- Scan bookkeeping moved to `extension/lib/scan-state.ts`: every score registers a ticket with a unique id, so the same post on the same DOM node is never submitted twice while in flight and a stale task cannot clear a newer registration. Before rendering, the node is re-checked to still be in the document and to still belong to the same post and settings, so X recycling a node cannot put post A's score on post B. Discarded in-flight results no longer write to the cache (`shouldCache` on `scorePost`). The same post appearing in two DOM nodes can still cost two requests.
- `storage.onChanged` 只处理设置键，日志与 auto-guard 的写入不再作废正在进行的扫描。缓存失效与展示切换分开判断：同一次保存既改模型又翻转调试时，普通缓存和 `debug:` 缓存都会清；关闭总开关会作废在途结果并移除已注入的 UI。`maxConcurrency` 改为 `limiter.setMax()` 原地调整（`lib/concurrency.ts`），旧队列与新上限共用一个 limiter。模型、key、提示词、跳过规则等影响评分的设置变化会清空缓存并重新评分，只改阈值时仅重绘徽标分档。
- `storage.onChanged` now reacts only to the settings key, so action-log and auto-guard writes no longer invalidate scans in progress. Cache invalidation and presentation changes are decided separately: one save that changes the model *and* flips debug clears both the normal and the `debug:` cache. Switching the extension off invalidates in-flight results and removes the injected UI. `maxConcurrency` is adjusted in place through `limiter.setMax()` (`lib/concurrency.ts`), so the old queue and the new cap share one limiter. Edits that change scoring (model, key, prompt, skip rules) clear the cache and re-score; a threshold-only edit just recolours the badges.
- 调试模式覆盖 `autoScan`（只读诊断应由开关本身触发扫描），但总开关 `enabled` 仍然有效。无正文的推文（纯图片/视频）不显示评分，而不是伪造 `0%`。
- Debug mode overrides `autoScan` (the toggle itself starts the read-only scan), while the global `enabled` switch still applies. Posts with no text (media-only) show no score instead of a fake `0%`.
- 新增 `extension/lib/debug.ts`、`extension/lib/scan-state.ts` 及对应测试，外加 `tests/concurrency.test.ts`、`tests/score-invalidation.test.ts`；`scorePost` 增加可选的 `cacheKey` / `shouldCache`，`clearCache` 支持按前缀清理。测试覆盖：真实 `scorePost` 走模型路径时上游延迟返回、期间失效 → 不写缓存；重复触发只提交一次、失效后结果不渲染；并发上限上调与下调时队列的行为。content script 里的 DOM 挂载路径仍没有自动化测试。未在真实浏览器里跑过 UI，也未用真实 key 端到端验证。
- Added `extension/lib/debug.ts`, `extension/lib/scan-state.ts` and their tests, plus `tests/concurrency.test.ts` and `tests/score-invalidation.test.ts`; `scorePost` gained optional `cacheKey` / `shouldCache`, and `clearCache` can drop a prefix. Tests cover the real `scorePost` model path with a delayed upstream that is invalidated mid-request (no cache write), one submission under repeated triggers, no render after invalidation, and queue behaviour when the concurrency cap is raised or lowered. The content script's DOM mounting path still has no automated test. The UI has not been run in a real browser, and no real-key end-to-end call was made.

判定规则重写：目标是降低「短、平、像模板」这类误报，只有文本里出现具体的 AI 痕迹才扣分。实际分类效果未验证。
Rewrote the classification rules so that shortness and plainness stop counting as evidence on their own; only a concrete tell in the text does. The actual classification effect is unverified.

- 默认提示词由一句话换成一份规则（`extension/lib/prompt.ts` 的 `DEFAULT_PROMPT`）：列举 assistant 口吻、「不是 X 而是 Y」、空泛夸奖、引流/空投、模板对称与装饰 emoji 等具体痕迹；并明确短、干、正式、非母语、无 emoji、中日韩文本都是正常人类语域，不因「读起来很套路」加分。
- The one-line default prompt became a rule set (`DEFAULT_PROMPT` in `extension/lib/prompt.ts`): assistant voice, "not X but Y", generic praise, promo/airdrop bait, template symmetry and decorative emoji are the tells; shortness, dryness, formality, non-native grammar, no emoji and CJK text are declared normal human register, and "it reads generic" is not a reason to score high.
- 指向机器人账号的指令（如 `@bot 落实这一点`）被定义为「不足以判定机器写作」，而不是「一定由人写成」：正文里出现 bot 只说明作者写了这个词，多账号同一句也可能是真人复制公开指令；如果同一句话还带其他痕迹（引流、assistant 口吻、装饰 emoji），照样扣分。
- A directive addressed to a bot account (e.g. `@bot 落实这一点`) is defined as insufficient evidence of machine authorship, not as proof a person wrote it: naming a bot only shows what the author typed, and the same line across accounts can be people copying a public instruction. If the line also carries another tell (promo bait, assistant voice, emoji decor), it still scores.
- Jev 与 OpenAI Decisions 两个适配器共用同一份提示词与判定说明，`is_slop` / `bait_kind` / `bot_likelihood` 三个问题一起改。共用文案不等于三个答案必然一致：非 `human` 的 `bait_kind` 仍自带 0.55 下限，正好等于默认阈值，模型只要选错桶，这一条就足以让分数过线。
- Both adapters (Jev and OpenAI Decisions) now share one prompt and one set of question descriptions, with `is_slop` / `bait_kind` / `bot_likelihood` changed together. Shared wording does not make the three answers agree: a non-`human` `bait_kind` still floors the score at 0.55, the default threshold, so one wrong bucket is enough to cross it.
- 空提示词或只有空白的提示词现在回落到当前默认（此前回落的是一句话旧文案）；存储里与旧默认一致的文案在加载时升级为新默认，用户自己写过的提示词不动。保存提示词本来就算「评分设置变更」，会清缓存并重扫页面。
- An empty or whitespace-only prompt now falls back to the current default (it used to fall back to the old one-liner), and a stored copy of the old default is upgraded on load while a user-written prompt is left alone. Saving a prompt already counts as a scoring-settings change, so it clears the cache and rescans.
- 自定义提示词只替换 `is_slop` 这一问；`bait_kind` 与 `bot_likelihood` 保留固定措辞，因为模型必须按名字从固定桶/档位里作答。想让自定义规则也左右这两个问题，目前做不到。
- A custom prompt replaces the `is_slop` question only; `bait_kind` and `bot_likelihood` keep their fixed wording because the model must answer by name from fixed buckets/levels. Custom rules cannot currently steer those two.
- 未用真实 key 验证分数变化，也没有在浏览器里看过这些帖子折叠与否：规则重写是朝减少误报的方向改，实际百分比与假阴性都仍取决于上游模型。上报的三个账号与三条阳性对照记在 `extension/tests/fixtures/prompt-regression-cases.json`，留给以后在真实 key 下评估。
- The score change is not verified with a real key, and folding was not observed in a browser: the rewrite is aimed at fewer false positives, while the actual percentages and any lost spam recall still depend on the upstream model. The three reported accounts plus three positive controls live in `extension/tests/fixtures/prompt-regression-cases.json` for later evaluation against a real key.

## 0.7.1 — 2026-10-31

- 安装说明改为下载 release 产物，不再要求 `npm install` 和 `npm run unpacked`；构建步骤移到「开发」节。
- Install now means downloading a release asset. `npm install` and `npm run unpacked` moved to the Development section.
- README 不再提到 Strict 模式。选项页只剩两档，文档不必解释一个不存在的选项。相关设计与 issue 仍保留在 `ROADMAP.md` 和 `docs/strict-mode.md`。
- The README no longer mentions strict mode. The options page offers two modes, so the docs do not explain an option that is not there. The design and the issue stay in `ROADMAP.md` and `docs/strict-mode.md`.
- release 资产改名为 `vX.Y.Z.zip`，不再带产品名。`npm run release:build` 末尾由 `scripts/name-release-asset.mjs` 重命名，并保证 `extension/.output` 里只有一个 zip。
- Release assets are named `vX.Y.Z.zip` with no product name. `npm run release:build` renames through `scripts/name-release-asset.mjs` and leaves a single zip in `extension/.output`.
- 两份 README 的版本号同步到 0.7.1。
- Both READMEs now report 0.7.1.

## 0.7.0 — 2026-10-31

Strict 模式（自动屏蔽）暂时关闭，代码保留；README 重写为中英两份。
Strict mode (automatic blocking) is switched off, the code stays, and the README became a Chinese and an English pair.

- 选项页不再提供 Strict。`extension/lib/mode.ts` 新增 `STRICT_ENABLED = false`，`decide()` 把 `strict` 当作 `auto-fold` 处理；`settings.ts` 在加载时同样降级，存储里的原值不删除，重新开启会恢复。
- The options page no longer offers Strict. `extension/lib/mode.ts` gained `STRICT_ENABLED = false`, `decide()` treats `strict` as `auto-fold`, and `settings.ts` applies the same downgrade on load. The stored value is kept, so re-enabling restores it.
- `extension/tests/mode.test.ts` 里 Strict 的断言改用 `describe.skipIf(!STRICT_ENABLED)`，开关打开后自动恢复执行；新增两条用例锁住「关闭期间永不自动屏蔽」。
- The strict assertions in `extension/tests/mode.test.ts` moved behind `describe.skipIf(!STRICT_ENABLED)` and run again when the flag flips; two new cases lock the off behaviour.
- 新增 `ROADMAP.md` 与 `docs/strict-mode.md`；重新开启的条件记录在 [issue #2](https://github.com/Caph-dev/anti-slop-for-x/issues/2)。
- Added `ROADMAP.md` and `docs/strict-mode.md`; the re-enabling checklist lives in issue #2.
- 自动屏蔽在调用前重新读取模式与启用状态。TLA+ 模型（`AutoBlock.tla`，TLC）发现一个窗口：出队检查通过后还有两次存储往返（`isHandled`、`reserveAutoAction`），期间关掉 Strict 仍会发出屏蔽请求。
- The automatic block path re-reads the mode and enabled flag right before the call. A TLA+ model (`AutoBlock.tla`, checked with TLC) found a window: after the dequeue check, two storage round trips ran before the call, so turning strict mode off in between still blocked the author.
- README 的两处错误描述一并修正：旧开头称「Mute / Block 仅在你点击时触发」，旧安全边界段称自动屏蔽「无法在扩展内撤销」。`worker/` 的用法说明移到 `docs/legacy-proxy.md`。
- Two wrong README claims are fixed: mute and block were described as click-only, and auto-blocks as impossible to undo. The `worker/` usage notes moved to `docs/legacy-proxy.md`.

## 0.6.0 — 2026-10-31

三档运行模式（手动 / 自动折叠 / 严厉）+ 自动动作的安全加固与一键撤销。
Three scan modes (manual / auto fold / strict) plus safety rails and one-click undo for automatic actions.

- 新增 `scanMode` 设置：`manual`（只显示疑似 AI 率）、`auto-fold`（默认，折叠）、`strict`（折叠 + 超 0.9 自动屏蔽作者）；决策逻辑抽到 `extension/lib/mode.ts` 并带测试。
- New `scanMode` setting (manual / auto-fold / strict), with the decision logic in `extension/lib/mode.ts`.
- 自动屏蔽要求**模型证据**：`DecisionResult.evidence` 记录分数来源，缓存改写 `source` 后仍保留；仅预筛、`prefilterOnly`、模型报错回退的分数一律不触发屏蔽。
- Auto-block now requires model evidence (`DecisionResult.evidence`), so prefilter-only and model-error fallbacks can fold but never block.
- 新增 `extension/lib/auto-guard.ts`：20 秒最小间隔、每日 30 次上限、403/429 熔断 1 小时、按 `userId`（无则 handle）的 7 天持久去重，状态存 `chrome.storage.local`。
- New `extension/lib/auto-guard.ts`: 20s minimum interval, 30/day cap, 1h meltdown on 403/429, and a 7-day ledger keyed by userId (handle when unknown).
- 自动动作出队前重新校验启用状态、模式、白名单与自己的帖子；成功后才写入去重账本。
- Queued auto actions re-validate enabled/mode/whitelist before running, and only mark an account handled after a successful call.
- 自动动作日志改由 background service worker 单点写入，避免多标签 read-modify-write 丢条目；记录 userId 与失败原因。
- The action log is now written by the background worker so parallel tabs cannot drop entries.
- 手动静音/屏蔽仍走原生 `···` 菜单；自动动作只走 cookie API，不再弹出菜单。
- Manual clicks still use X's native menu; automatic actions only use the cookie API.
- 新增**一键撤销**：popup 日志里自动屏蔽的条目可撤销，经任意 x.com 标签页调用 `blocks/destroy.json` 解除屏蔽，并把该账号加入白名单，避免 Strict 再次屏蔽；日志条目标记为已撤销。
- Added one-click undo for automatic blocks: the popup calls `blocks/destroy.json` from an open x.com tab, whitelists the account so strict mode does not re-block it, and marks the log entry as undone.

## 0.5.0 — 2026-10-31

折叠卡片的三处体验调整：可再次折叠、静音/屏蔽加上语义说明、卡片不再显示内部字段。
Three fold-card UX changes: the reply can be folded again, mute/block explain themselves, and the card no longer prints internal fields.

- 折叠后可再次折叠：展开时卡片从推文里移除（避免在 X 的 flex 行里再次挤压正文），改为在时间戳后放一个可点击的 `AI? nn%` 药丸，点它重新折叠。
- Re-foldable: expanding removes the card (it must not stay inside X's flex row) and leaves a clickable `AI? nn%` pill next to the timestamp that folds the reply again.
- 卡片不再显示 `model:predicate=…, score=…, kind=…; pre=…` 这类内部字段，只显示疑似 AI 率；原始打分细节移到卡片的悬停提示里。
- The card no longer prints internal fields; it shows just the AI likelihood, with the raw breakdown moved into the card's tooltip.
- 「静音」「屏蔽」加上悬停说明，区分两者语义（静音＝你不再看到对方，对方无感知；屏蔽＝对方无法关注或与你互动）；README 增加对照表。
- Mute and Block now carry hover explanations of the difference, and the README gained a comparison table.

## 0.4.0 — 2026-10-31

修复折叠卡片与被折叠推文并排显示的布局 bug，以及 badge 模式下游离的动作条。
Fixed the folded card rendering beside the tweet it folded, and the stray action bar in badge mode.

- 修复折叠卡片与被折叠推文并排显示的布局 bug。`article[data-testid="tweet"]` 在 X 上是 `display:flex; flex-direction:row`（头像列 + 内容列），`article.prepend(bar)` 让折叠卡成了横向 flex 项，把正文挤到右侧。现在折叠时直接对 `article` 设 `display:block` 并用内联样式隐藏它的子节点，不再依赖可能被 React 重写的 class。
- Fixed the folded card rendering side by side with the tweet. X's tweet article is a flex row (avatar column + content column), so prepending the fold card made it a horizontal sibling that squeezed the body. Folding now forces the article to block layout and hides its children with inline styles, tracked per tweet so Expand/unmount restore the exact original values.
- 修复 badge 模式下「静音/屏蔽」小按钮条飘在推文右侧、盖住操作行的问题：badge 现在只显示百分比标记，不再额外挂动作条（静音/屏蔽仍可从折叠卡和 X 原生菜单进入）。
- Fixed the borderline badge's stray mute/block bar being flex-positioned at the right edge over the action row; the badge is now passive.

## 0.3.2 — 2026-10-31

工具栏图标从「静默扫描」改为显式面板。
The toolbar icon goes from a silent scan to an explicit popup.


- 工具栏图标改为弹出面板（`extension/entrypoints/popup`）：显示端点/模型/范围/状态摘要，提供「扫描当前页」与「选项」两个入口；扫描结束后回报处理条数，扫不到时说明原因。
- The toolbar icon now opens a popup showing endpoint/model/scope/status plus "Scan current page" and "Options"; scans report how many posts were scored and explain when there was nothing to scan.
- 移除 `background.ts` 的 `chrome.action.onClicked`（有 `default_popup` 后 Chrome 不再触发它）。旧行为是「点击即扫描且无反馈」，在 `/home` 上因为默认 `scanScope: replies-only` 跳过所有主帖，看起来像完全没反应。
- Removed `chrome.action.onClicked`; the old behaviour scanned silently and, on `/home`, skipped every non-reply because of the default `scanScope: replies-only`, which looked like a dead button.
- `scanVisible()` 现在返回实际打分的条数，`handleArticle()` 返回是否处理；content script 的 `ANTI_SLOP_SCAN_NOW` 响应带上 `scanned` 计数。
- `scanVisible()` now returns the number of posts scored and the content script replies with that count.

## 0.3.1 — 2026-10-31

OpenAI Decisions 预设从「契约未验证」转为已验证；选项页去掉多余提示文本。
The OpenAI Decisions preset is now verified, and the options page lost its redundant hint text.

- **OpenAI Decisions 预设有真实 key 验证**（2026-10-31）：`gpt-6-luna` 存在于 `/v1/models`（key 有效，130 个模型可见），`POST https://api.openai.com/v1/decisions` 返回 HTTP 200，响应 `answers[]` 的 `probability` / `choice` / `score` 与解析器一致。真实响应已作为夹具加入 `extension/tests/fixtures/openai-decisions-real.json`，并有回归测试锁住打分结果。
- **The OpenAI Decisions preset is now verified with a real key** (2026-10-31): `gpt-6-luna` appears in `/v1/models`, the endpoint returns HTTP 200, and `answers[]` matches the parser. The real response is now a test fixture with a regression test.
- 选项页删掉两段多余提示文本（`presetNote`、`keyHint`）以及「契约未验证」标注；`keyHint` 的内联默认文案还停留在 Worker 代理时代，已一并移除。
- Removed two redundant hint paragraphs from the options page plus the "contract unverified" label; the `keyHint` inline default still described the old Worker proxy.

## 0.3.0 — 2026-10-31

本版只改工具链与发布流程，扩展运行时行为与 0.2.0 相同。
Tooling and release-flow only; runtime behaviour is unchanged from 0.2.0.

### 稳定的未打包目录 / Stable unpacked build

- 新增 `npm run unpacked`：构建后把 `extension/.output/chrome-mv3` 整体镜像到 `unpacked/chrome-mv3`，供 Chrome「加载已解压的扩展程序」长期加载。
- New `npm run unpacked` mirrors the build into `unpacked/chrome-mv3` for Chrome's "Load unpacked".
- 新增 `scripts/sync-unpacked.mjs`：先复制到临时目录再改名替换，Chrome 不会看到半成品；整体替换保证不残留上一次构建的 hash chunk；只允许替换 `unpacked/chrome-mv3`。
- New `scripts/sync-unpacked.mjs` stages the copy then renames it into place, replaces the folder wholesale (no stale hashed chunks), and refuses to touch anything but `unpacked/chrome-mv3`.
- `unpacked/` 加入 `.gitignore`，构建产物不进仓库、不进 release 资产。
- `unpacked/` is git-ignored and never shipped.

### 发布命令 / Release command

- 新增 `npm run release:build`：`typecheck` → `test` → `zip` → 同步 `unpacked`，zip 与未打包目录出自同一次构建。
- New `npm run release:build` runs typecheck, tests, zip and the unpacked mirror from a single build.
- 新增项目级 `AGENTS.md`，固定「打包并更新 release」的流程：版本号 5 处同步、CHANGELOG 段落、`release:build`、tag 与 `gh release create`、release notes 必须写明未验证项。
- Added a project-level `AGENTS.md` documenting the whole release flow.

## 0.2.0 — 2026-10-31

### 端点预设 / Endpoint presets

内置 3 档端点：TypeSafe / Jev 官方、OpenAI Decisions 官方、Custom。
Three endpoints ship built in: TypeSafe / Jev official, OpenAI Decisions official, and Custom.

- 新增 `endpointPreset` 设置与 `extension/lib/endpoints.ts`；预设拥有 Base URL / path / 协议，选中时选项页自动填充并锁定这三项；model 始终可改，预设只给默认值。
- New `endpointPreset` setting backed by `extension/lib/endpoints.ts`; a preset owns base URL, path and protocol, which the options page fills and locks. `model` stays editable with the preset value as its default.
- 官方预设：`jev-official`（`https://api.typesafe.ai/v1` + `/systemone`，`jev`，`jev-latest`）与 `openai-official`（`https://api.openai.com/v1` + `/decisions`，`openai-decisions`，`gpt-6-luna`）。
- Presets: `jev-official` and `openai-official` as above.
- 两个官方预设的 origin 加入 `host_permissions`（`https://api.typesafe.ai/*`、`https://api.openai.com/*`），保存不弹授权窗；`custom` 仍走 `optional_host_permissions`。
- Both preset origins are declared in `host_permissions`, so they need no prompt; `custom` still uses `optional_host_permissions`.
- OpenAI 预设标记为「契约未验证」：已探测该路由存在且接受 Bearer 鉴权，但 model id 与报文形状未用真实 key 验证。
- The OpenAI preset is labelled contract-unverified: the route exists and accepts Bearer auth, but the model id and payload shape are not verified with a real key.
- 旧设置（无 `endpointPreset`）按 base URL + 协议 + 有效 path 反推预设；显式 path 缺失时按旧默认 `/systemone` 比较，所以 OpenAI base + 无 path 的旧配置会保持 `custom`，不会被悄悄改到 `/decisions`。
- Legacy settings are mapped back to a preset only on an exact match; anything else becomes `custom`.

### BYOK 直连 / Direct BYOK calls

去掉代理层：扩展直接请求你配置的上游 endpoint，不再需要 Worker / 本地代理。
Dropped the proxy layer: the extension now calls your configured upstream endpoint directly.

- 删除「Worker 代理地址」设置项（`workerBaseUrl`），请求改为 `extension/lib/upstream-client.ts` 直发上游；`proxy-client.ts` 移除。
- Removed the `workerBaseUrl` setting; requests go out via `extension/lib/upstream-client.ts`; `proxy-client.ts` is gone.
- 请求在 background service worker 发出（content script 的 fetch 永远受页面 CORS 约束），模型调用仍经由 `ANTI_SLOP_DECIDE` 消息。
- Model calls stay in the background service worker, since content-script fetches are subject to the page's CORS policy.
- 自定义 base URL 走 `optional_host_permissions` + 保存/测试时的 `chrome.permissions.request()`。
- Custom base URLs use `optional_host_permissions` plus a runtime permission request from the options page.
- `buildUpstreamUrl()` 要求 https，仅对 `127.0.0.1` / `localhost` 放行 http，避免 key 明文发往远端。
- `buildUpstreamUrl()` requires https except for loopback hosts, so the key is never sent in clear text to a remote endpoint.
- 选项页「测试」按钮改为真实发一次模型请求并显示分数，不再打 `/health`。
- The options page Test button now performs one real model call and reports the score.
- `worker/` 保留但扩展不再使用；其 `/v1/decide` 契约与直连请求不同。
- `worker/` is kept but unused; its `/v1/decide` contract differs from the direct request.

## 0.1.0 — rename

临时产品名 **Slop Shield**（包名 `slop-shield`，Worker `slop-shield-proxy`）改为 **Anti Slop for X**（包名 `anti-slop-for-x`，Cloudflare Worker `name` 为 `anti-slop-for-x-proxy`）。

The temporary name **Slop Shield** (`slop-shield`, Worker `slop-shield-proxy`) is now **Anti Slop for X** (`anti-slop-for-x`, Cloudflare Worker `name` `anti-slop-for-x-proxy`).

- 扩展设置：`chrome.storage.local` 的 `slopShieldSettings` 会在下次读取时迁到 `antiSlopForXSettings` 并删除旧键，已保存的选项不会丢。
- Settings: `chrome.storage.local` key `slopShieldSettings` is copied to `antiSlopForXSettings` on the next read, then the old key is removed.
- 本地 Jev 密钥文件文档路径：`~/.config/anti-slop-for-x-jev.env`（原先 `~/.config/slop-shield-jev.env`）。文件不在仓库里；把旧文件改名，或继续 `source` 旧路径即可。
- Local Jev env path in docs: `~/.config/anti-slop-for-x-jev.env` (was `~/.config/slop-shield-jev.env`). That file is not in the repo; rename it, or keep sourcing the old path.
- 尚未部署的备用鉴权头由 `X-Slop-Shield-Token` 改为 `X-Anti-Slop-Token`（仅 `worker/src/cf-worker.ts` 与架构说明）。
- The unused alternate auth header is `X-Anti-Slop-Token` (was `X-Slop-Shield-Token`), in `worker/src/cf-worker.ts` and the architecture note only.
