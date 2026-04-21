# Contract DoD — Workstream 3: `server.js` 挂载 + 集成测试纳入 CI

**范围**: 修改 `packages/brain/server.js` 引入并挂载 time Router 到 `/api/brain/time`；把 3 个端点的行为测试放到 Brain vitest 默认会收到的路径（`packages/brain/src/__tests__/routes/time-routes.test.js` 或等价位置），使 CI 实际运行这些断言。该 CI 测试文件是**长期 SSOT**；`sprints/tests/ws{N}/` 仅作一次性 GAN Red 证据，合并时归档。
**大小**: S（描述性标签；R2 已删除"server.js diff 新增行数 ≤ 5"这类无法机械化的约束）
**依赖**: Workstream 1 + Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `server.js` 含 time 路由 import 语句（相对路径指向 `./src/routes/time.js`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/time\.js['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 在 `/api/brain/time` 挂载 time Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/time['\"]\s*,/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] Brain 默认测试目录下存在覆盖 time 路由的 vitest 测试文件（会被 `packages/brain/vitest.config.js` 的 include 规则匹配到）
  Test: bash -c "ls packages/brain/src/__tests__/routes/time*.test.js packages/brain/src/__tests__/time*.test.js packages/brain/src/__tests__/integration/time*.test.js 2>/dev/null | head -1 | grep -q '.'"

- [ ] [ARTIFACT] 该测试文件同时涉及 `/api/brain/time/iso`、`/api/brain/time/unix`、`/api/brain/time/timezone` 三条端点
  Test: bash -c "F=\$(ls packages/brain/src/__tests__/routes/time*.test.js packages/brain/src/__tests__/time*.test.js packages/brain/src/__tests__/integration/time*.test.js 2>/dev/null | head -1); grep -c '/api/brain/time/iso' \"\$F\" | grep -q '^[1-9]'; grep -c '/api/brain/time/unix' \"\$F\" | grep -q '^[1-9]'; grep -c '/api/brain/time/timezone' \"\$F\" | grep -q '^[1-9]'"

- [ ] [ARTIFACT] `sprints/tests/` 下的 GAN Red 证据**不**进入 Brain vitest 默认 include（即 `packages/brain/vitest.config.js` include 模式不应匹配到仓库根下的 `sprints/` 目录）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(/sprints\//.test(c))process.exit(1)"

- [ ] [ARTIFACT] 仍未新增 npm 依赖（对照 main 基线）
  Test: bash -c "git fetch origin main --depth=1 >/dev/null 2>&1 || true; node -e \"const base=JSON.parse(require('child_process').execSync('git show origin/main:packages/brain/package.json').toString());const cur=JSON.parse(require('fs').readFileSync('packages/brain/package.json','utf8'));const added=Object.keys(cur.dependencies||{}).filter(k=>!(base.dependencies||{})[k]);if(added.length)process.exit(1)\""

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/mount-integration.test.js`，覆盖：
- 路由挂在生产路径 `/api/brain/time` 时，`/iso` / `/unix` / `/timezone?tz=UTC` 均返回 200 + `Content-Type` 含 `application/json`，body 结构正确
- 挂在生产路径时，`/timezone`（缺 tz）返回 400 + `Content-Type` 含 `application/json`
- Router 只暴露 GET：POST `/api/brain/time/iso` 返回 404 或 405，且同地址 GET 返回 200（证明挂载生效）
- Router 不带 catch-all：已知路径 `/iso` 返回 200，未知路径 `/does-not-exist` 返回 404
- 并发请求三条端点全部成功且返回 JSON
