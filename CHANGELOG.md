# Changelog

## 0.1.0 — rename

临时产品名 **Slop Shield**（包名 `slop-shield`，Worker `slop-shield-proxy`）改为 **Anti Slop for X**（包名 `anti-slop-for-x`，Cloudflare Worker `name` 为 `anti-slop-for-x-proxy`）。

The temporary name **Slop Shield** (`slop-shield`, Worker `slop-shield-proxy`) is now **Anti Slop for X** (`anti-slop-for-x`, Cloudflare Worker `name` `anti-slop-for-x-proxy`).

- 扩展设置：`chrome.storage.local` 的 `slopShieldSettings` 会在下次读取时迁到 `antiSlopForXSettings` 并删除旧键，已保存的选项不会丢。
- Settings: `chrome.storage.local` key `slopShieldSettings` is copied to `antiSlopForXSettings` on the next read, then the old key is removed.
- 本地 Jev 密钥文件文档路径：`~/.config/anti-slop-for-x-jev.env`（原先 `~/.config/slop-shield-jev.env`）。文件不在仓库里；把旧文件改名，或继续 `source` 旧路径即可。
- Local Jev env path in docs: `~/.config/anti-slop-for-x-jev.env` (was `~/.config/slop-shield-jev.env`). That file is not in the repo; rename it, or keep sourcing the old path.
- 尚未部署的备用鉴权头由 `X-Slop-Shield-Token` 改为 `X-Anti-Slop-Token`（仅 `worker/src/cf-worker.ts` 与架构说明）。
- The unused alternate auth header is `X-Anti-Slop-Token` (was `X-Slop-Shield-Token`), in `worker/src/cf-worker.ts` and the architecture note only.
