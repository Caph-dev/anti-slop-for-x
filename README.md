# Anti Slop for X

在 X（x.com）上检测 AI 注水 / 机器人回复：本地关键词预筛 +（可选）决策模型；超过阈值则折叠并显示分数/原因；**Mute / Block 仅在你点击时触发**。扩展不含任何 key、也不含服务器：你填自己的上游 endpoint 与 key（BYOK），请求直接从扩展发往你配置的地址。

> 参考了 [slop-filter](https://github.com/adamnroman/slop-filter)（MIT）与 [BotBlind 指南](https://botblind.app/how-to-hide-ai-replies-on-x)；**未 fork**，独立实现。

## 目录结构

```
anti-slop-for-x/
  extension/   # WXT + TypeScript，Chrome MV3
  worker/      # 本地 Node mock 代理（CF Worker 脚手架稍后部署）
  docs/        # 隐私政策草稿、架构说明
```

## 怎么装（Chrome 加载未打包扩展）

1. 安装依赖：

```bash
cd anti-slop-for-x
npm install
```

2. 生成一份稳定的未打包目录（Chrome 长期加载就用它，会自动先构建）：

```bash
npm run unpacked        # = npm run build + 镜像到 unpacked/chrome-mv3
```

3. 打开 Chrome → `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择：

```text
unpacked/chrome-mv3
```

4. 打开扩展「选项」页配置（见下）。

### 为什么单独放 `unpacked/`

`extension/.output/chrome-mv3` 每次构建都会被重写、旧 hash 文件名会消失，Chrome 加载着它会报 manifest 读不到、必须重新加载。`npm run unpacked` 会整体替换 `unpacked/chrome-mv3`（先写临时目录再改名，不会出现半成品，也不会残留旧 chunk）。

- 改代码后重新跑 `npm run unpacked`，再到 `chrome://extensions` 点一次刷新按钮即可。
- `unpacked/` 在 `.gitignore` 里，不会进仓库，也不会进 release 资产；要发给别人用请用 `npm run zip` 的产物或 release 里的 zip。

需要一次拿到「商店 zip」和「未打包目录」时：

```bash
npm run release:build   # typecheck + test + zip + 镜像到 unpacked/chrome-mv3
```

两者出自同一次构建，所以 zip 里的代码和你本地加载的完全一致。

开发模式可用：

```bash
npm run dev -w extension
```

## 本地 Worker（旧版代理，扩展已不再使用）

`v0.1.0` 之前扩展经由本机代理转发；现在走 BYOK 直连，这一节仅在你想自己搭服务端代理时参考。

```bash
npm run worker:start
# 默认 http://127.0.0.1:8787
```

- `GET /health` — 探活  
- `POST /v1/decide` — 接收 `upstreamBaseUrl` / `payload` 并转发，`Authorization` 来自请求本身

环境变量：`PORT`（默认 8787）、`HOST`（默认 127.0.0.1）。

> 注意：该代理当前的 body 契约与扩展的直连请求不同，不能直接把 `upstreamBaseUrl` 指向它。

CF 部署见 `worker/wrangler.toml` 与 `worker/src/cf-worker.ts`。

### 用 curl 打通 Worker → Jev

先启动 Worker，再（**不要把 key 写进仓库**）：

密钥文件不在仓库里。若你还留着临时名时期的 `~/.config/slop-shield-jev.env`，改名为下面这个路径，或继续 source 旧文件即可（见 [CHANGELOG](CHANGELOG.md)）。

```bash
set -a; source ~/.config/anti-slop-for-x-jev.env; set +a

curl -sS http://127.0.0.1:8787/health

curl -sS -X POST http://127.0.0.1:8787/v1/decide \
  -H "Authorization: Bearer $JEV_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "protocol": "jev",
    "upstreamBaseUrl": "https://api.typesafe.ai/v1",
    "upstreamPath": "/systemone",
    "model": "jev-latest",
    "payload": {
      "model": "jev-latest",
      "state": { "post": { "text": "Great point! This is a game-changer" } },
      "questions": {
        "is_slop": {
          "type": "noul",
          "instructions": "does this look like AI engagement bait / bot reply on X"
        }
      }
    }
  }'
```

## 端点选择（3 档）

选项页的 **Endpoint** 决定 Base URL、决策路径与协议；选中官方预设时这三个字段自动填好并锁定，选 `Custom` 才能编辑。**Model 始终可改**，预设只提供默认值。

| Endpoint | Base URL | Path | Protocol | 默认 Model |
|---|---|---|---|---|
| TypeSafe / Jev（官方） | `https://api.typesafe.ai/v1` | `/systemone` | `jev` | `jev-latest` |
| OpenAI Decisions（官方，契约未验证） | `https://api.openai.com/v1` | `/decisions` | `openai-decisions` | `gpt-6-luna` |
| Custom endpoint | 你填 | 你填 | 你选 | 你填 |

- 两个官方预设的 origin 已在 `host_permissions` 里，保存不会弹权限窗。
- 选 `Custom` 且换到别的 origin 时，点「保存」会让 Chrome 弹出该 origin 的访问授权（`optional_host_permissions`）；拒绝授权后请求会失败并提示重新保存。
- 旧版设置（没有 `endpointPreset` 字段）会按 Base URL + 协议 + 有效 path 自动归位；凡是和官方预设不完全一致的，一律归为 `Custom`，不会被静默改指。
- OpenAI 预设的验证程度：`POST https://api.openai.com/v1/decisions` 存在且会对 `Authorization: Bearer` 返回 `invalid_api_key`（说明接受 API key 鉴权），但**模型 id 与 `predicate/choice/score` 请求/响应契约尚未用真实 key 端到端验证**。若你的账号要求别的形状，请选 `Custom`。

### Key 放哪？

- key 只存在 `chrome.storage.local`，只发往你填的 Base URL；扩展包、仓库、release 产物里都没有 key。
- 请求在 background service worker 里发出（content script 受页面 CORS 限制，service worker 有 host permission 不受限）。
- 局限：能读你 Chrome profile 目录的本机进程仍能拿到明文 key，这是任何「把 key 存在浏览器里」的方案都躲不掉的。
- **不要**把真实 Jev key 提交进本仓库，也不要把选项页截图连 key 一起发出去。

## 预筛与模型如何配合

1. **本地预筛**（BotBlind 风格）：套话、"It's not X, it's Y"、空洞夸赞、模板 emoji、用户名尾随数字、超快长回复、DM/空投诱饵等 → 得到 0..1 分数。  
2. 分数已很高或命中硬规则 → **可直接折叠**，不必打模型。  
3. 勾选「仅预筛」→ 永不调用模型。  
4. 否则边缘样本经 background service worker 打决策模型，与预筛分混合后与阈值比较。  
5. 按帖子 id 缓存；并发限制 + 视口触发；可白名单账号；可关自动扫描，点扩展图标手动扫当前页。

## Mute / Block 怎么用

- 折叠条（或边缘样本操作条）上的 **Mute / Block** 按钮。  
- **只有你点击才会执行**，没有静默自动拉黑。  
- 优先点 X 原生「···」菜单；失败则尝试同登录态下的 X web API（需浏览器已登录 x.com）。  
- Headless / 无界面环境：原生菜单点击不可用，请在真实浏览器会话中使用。

## 测试

```bash
npm test -w extension
```

## Firefox / 上架尚未完成

- v1 只保证 **Chrome MV3**；WXT 结构便于以后加 Firefox，但尚未适配与打包验证。  
- Chrome Web Store：需正式隐私政策定稿、商店截图、更精致图标、权限最小化复核、付费/账号流程（若有）等；当前 `docs/privacy-policy.md` 仅为草稿。

## License

MIT. 参考代码来自 MIT 项目 slop-filter，本仓库为独立实现。
