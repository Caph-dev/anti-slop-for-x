# Anti Slop for X

在 X（x.com）上检测 AI 注水 / 机器人回复：本地关键词预筛 +（可选）决策模型；超过阈值则折叠并显示分数/原因；**Mute / Block 仅在你点击时触发**。扩展只与自有 Worker 代理通信，不直连上游模型 API。

> 参考了 [slop-filter](https://github.com/adamnroman/slop-filter)（MIT）与 [BotBlind 指南](https://botblind.app/how-to-hide-ai-replies-on-x)；**未 fork**，独立实现。

## 目录结构

```
anti-slop-for-x/
  extension/   # WXT + TypeScript，Chrome MV3
  worker/      # 本地 Node mock 代理（CF Worker 脚手架稍后部署）
  docs/        # 隐私政策草稿、架构说明
```

## 怎么装（Chrome 加载未打包扩展）

1. 安装依赖并构建：

```bash
cd anti-slop-for-x
npm install
npm run build
```

2. 打开 Chrome → `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」。
3. 选择构建产物目录（一般为）：

```text
extension/.output/chrome-mv3
```

（若目录名因 WXT 版本略有不同，以 `extension/.output/` 下实际 `manifest.json` 所在文件夹为准。）

4. 打开扩展「选项」页配置（见下）。

开发模式可用：

```bash
npm run dev -w extension
```

## 怎么跑本地 Worker（mock / proxy）

当前 **不绑定真实 Cloudflare 账号**。本地 Node 服务即可：

```bash
npm run worker:start
# 默认 http://127.0.0.1:8787
```

- `GET /health` — 探活  
- `POST /v1/decide` — 转发扩展带来的 `Authorization` 与 `payload` 到上游  

环境变量：`PORT`（默认 8787）、`HOST`（默认 127.0.0.1）。

以后若部署 CF：见 `worker/wrangler.toml` 与 `worker/src/cf-worker.ts`，再把选项里的 Worker 地址改成线上 URL。

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
    "upstreamBaseUrl": "https://ai.caph.me/v1",
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

## 怎么把设置指到 Jev

在扩展选项页：

| 字段 | 建议值 |
|------|--------|
| Protocol | `TypeSafe / Jev` |
| Worker base URL | `http://127.0.0.1:8787` |
| Upstream base URL | `https://ai.caph.me/v1` |
| Decisions path | `/systemone` |
| Model | `jev-latest` |
| API key | 填入你的 Jev key（只存 `chrome.storage.local`） |

也支持 **OpenAI Decisions**（`predicate` / `choice` / `score`）：协议选对应项，path 通常为 `/decisions`，上游换成兼容端点。

### Key 放哪？

- **推荐**：key 只在扩展存储；Worker 只做 CORS 安全代理并转发 `Authorization`。  
- **备选（CF 部署后）**：Worker 用 secret 存上游 key，扩展带自签 token；见 `docs/architecture.md`。  
- **不要**把真实 Jev key 提交进本仓库。

## 预筛与模型如何配合

1. **本地预筛**（BotBlind 风格）：套话、"It's not X, it's Y"、空洞夸赞、模板 emoji、用户名尾随数字、超快长回复、DM/空投诱饵等 → 得到 0..1 分数。  
2. 分数已很高或命中硬规则 → **可直接折叠**，不必打模型。  
3. 勾选「仅预筛」→ 永不调用模型。  
4. 否则边缘样本经 Worker 打决策模型，与预筛分混合后与阈值比较。  
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
