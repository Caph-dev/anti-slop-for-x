# 项目约定 / Project conventions

> 只放本仓库特有的约定；通用规则见用户级 `~/.pi/agent/AGENTS.md`。

## 「打包并更新 release」的固定流程

用户说「打包并更新 release」时，按顺序做完整套，不要漏掉 `npm run unpacked` 这一步：

1. **同步版本号**（5 处，缺一不可）：
   - `package.json`
   - `extension/package.json`
   - `worker/package.json`
   - `package-lock.json`（根 `version` + `packages[""]` + `packages.extension` + `packages.worker`）
   - `extension/wxt.config.ts` 的 `manifest.version`
2. **更新 `CHANGELOG.md`**：把 `未发布 / Unreleased` 段落改成 `## X.Y.Z — YYYY-MM-DD`。
3. **构建**（一条命令搞定，含门禁）：

   ```bash
   npm run release:build
   ```

   它依次执行 `typecheck` → `test` → `zip`（产物 `extension/.output/anti-slop-for-x-extension-X.Y.Z-chrome.zip`）→ 镜像到 `unpacked/chrome-mv3`。
   **zip 与 unpacked 必须出自同一次构建**，所以不要用「先 `npm run unpacked` 再单独 zip」的顺序手动拼，直接跑这一条。

4. **提交 → 打 tag → push → 建 release**：

   ```bash
   git add -A && git commit -m "..."
   git tag -a vX.Y.Z -m "Anti Slop for X vX.Y.Z"
   git push origin main && git push origin vX.Y.Z
   gh release create vX.Y.Z extension/.output/anti-slop-for-x-extension-X.Y.Z-chrome.zip \
     --title "..." --notes-file <notes> --verify-tag
   ```

   提交与 push 属于对外可见动作：工作区若有非本次任务的改动，先问用户。

5. **release notes 必须写明未验证项**（真实 key 端到端调用、浏览器运行时 UI 等），不要把探测性结论写成已验证。

## 其他约定

- `unpacked/` 是给 Chrome「加载已解压的扩展程序」用的稳定目录，已在 `.gitignore` 中，永远不进仓库、不进 release 资产。
- `extension/.output/` 每次构建会被重写，不要让 Chrome 长期加载它。
- 版本号仍是手写常量，改版本时按上面 5 处同步；不要只改 `wxt.config.ts`。
