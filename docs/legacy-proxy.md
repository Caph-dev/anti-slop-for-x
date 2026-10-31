# 旧版代理（worker/）

`worker/` 是 0.1.0 时代的本机代理。扩展从 0.2.0 起改用 BYOK 直连，不再调用它。这一页保留给想自己搭服务端代理的人。

## 它做什么

扩展曾经把 `upstreamBaseUrl`、`upstreamPath` 和 `payload` 一起发给本机代理，由代理转发到上游，`Authorization` 头来自扩展。代理自己不存密钥。

```bash
npm run worker:start
# 默认 http://127.0.0.1:8787
```

- `GET /health` 探活
- `POST /v1/decide` 转发到上游

环境变量：`PORT`（默认 8787）、`HOST`（默认 127.0.0.1）。

## 为什么不能直接把扩展指过来

代理的 `/v1/decide` 契约要求 `upstreamBaseUrl` 和 `payload` 两个字段，而扩展现在直接向上游发决策请求体。两者形状不同，把 `upstreamBaseUrl` 指向代理不会工作。

## 用 curl 手动验证

先启动代理，再执行下面的命令。密钥文件不在仓库里。

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

## 部署到 Cloudflare

`worker/wrangler.toml` 与 `worker/src/cf-worker.ts` 是 Cloudflare Workers 版本。它同样只转发请求，不保存上游密钥。

如果曾用临时名 `slop-shield` 保存过 `~/.config/slop-shield-jev.env`，把它改名成 `~/.config/anti-slop-for-x-jev.env`，或继续 source 旧路径。
