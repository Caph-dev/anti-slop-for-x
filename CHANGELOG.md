# Changelog

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
