# Contract DoD — Workstream 3: `server.js` 挂载 + 集成测试 + Red 证据归档

**范围**:
① 修改 `packages/brain/server.js` 引入并挂载 time Router 到 `/api/brain/time`，保持现有 `if (!process.env.VITEST)` boot guard 不变。
② 把 3 个端点的行为测试落到 Brain vitest 默认 include 会收到的路径（`packages/brain/src/__tests__/routes/time-routes.test.js`），使 CI 实际运行这些断言；**至少一条 `it` 必须通过 `import app from '../../../server.js'` 直接消费默认导出**，做端到端挂载验证（风险 2 的可测试性前置条件）。
③ 把 `sprints/tests/ws{1,2,3}/` 归档到 `sprints/archive/<sprint-slug>/tests/ws{1,2,3}/`（`git mv`），保证 Red 证据保留可审计但不进入 `npm run brain:test`（风险 1 落地）。
**大小**: S（描述性标签；R2 起已删除"server.js diff 新增行数 ≤ 5"这类无法机械化的约束）
**依赖**: Workstream 1 + Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `server.js` 含 time 路由 import 语句（相对路径指向 `./src/routes/time.js`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/import\s+\w+\s+from\s+['\"]\.\/src\/routes\/time\.js['\"]/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 在 `/api/brain/time` 挂载 time Router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/app\.use\(\s*['\"]\/api\/brain\/time['\"]\s*,/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] `server.js` 保留 `if (!process.env.VITEST)` boot guard（测试 import 不启 HTTP listen / 避免副作用）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/server.js','utf8');if(!/if\s*\(\s*!\s*process\.env\.VITEST\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Brain 默认测试目录下存在覆盖 time 路由的 vitest 测试文件（会被 `packages/brain/vitest.config.js` 的 include 规则匹配到）
  Test: bash -c "ls packages/brain/src/__tests__/routes/time*.test.js packages/brain/src/__tests__/time*.test.js packages/brain/src/__tests__/integration/time*.test.js 2>/dev/null | head -1 | grep -q '.'"

- [ ] [ARTIFACT] 该 CI SSOT 测试文件同时涉及 `/api/brain/time/iso`、`/api/brain/time/unix`、`/api/brain/time/timezone` 三条端点
  Test: bash -c "F=\$(ls packages/brain/src/__tests__/routes/time*.test.js packages/brain/src/__tests__/time*.test.js packages/brain/src/__tests__/integration/time*.test.js 2>/dev/null | head -1); grep -c '/api/brain/time/iso' \"\$F\" | grep -q '^[1-9]'; grep -c '/api/brain/time/unix' \"\$F\" | grep -q '^[1-9]'; grep -c '/api/brain/time/timezone' \"\$F\" | grep -q '^[1-9]'"

- [ ] [ARTIFACT] CI SSOT 测试文件至少一处 `import` 语句直接引用 `../../../server.js`（端到端挂载验证入口）
  Test: bash -c "F=\$(ls packages/brain/src/__tests__/routes/time*.test.js packages/brain/src/__tests__/time*.test.js packages/brain/src/__tests__/integration/time*.test.js 2>/dev/null | head -1); node -e \"const c=require('fs').readFileSync(process.argv[1],'utf8');if(!/import\s+\w+\s+from\s+['\\\"]\.\.\/\.\.\/\.\.\/server\.js['\\\"]/.test(c))process.exit(1)\" \"\$F\""

- [ ] [ARTIFACT] `sprints/tests/` 下的 GAN Red 证据**不**进入 Brain vitest 默认 include（反向断言：`packages/brain/vitest.config.js` include 模式不应匹配到仓库根下的 `sprints/` 目录）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(/sprints\//.test(c))process.exit(1)"

- [ ] [ARTIFACT] Generator 合并 PR 中，`sprints/tests/ws1/`、`sprints/tests/ws2/`、`sprints/tests/ws3/` 目录**已被移除**（已归档，不再残留于原路径）
  Test: node -e "const fs=require('fs');for(const d of ['sprints/tests/ws1','sprints/tests/ws2','sprints/tests/ws3']){if(fs.existsSync(d))process.exit(1)}"

- [ ] [ARTIFACT] 归档目录 `sprints/archive/*/tests/ws1/`、`sprints/archive/*/tests/ws2/`、`sprints/archive/*/tests/ws3/` 存在且各含至少一个 `.test.js` 文件（Red 证据已迁移保留可审计）
  Test: bash -c "ls sprints/archive/*/tests/ws1/*.test.js 2>/dev/null | grep -q '.' && ls sprints/archive/*/tests/ws2/*.test.js 2>/dev/null | grep -q '.' && ls sprints/archive/*/tests/ws3/*.test.js 2>/dev/null | grep -q '.'"

- [ ] [ARTIFACT] 仍未新增 npm 依赖（对照 main 基线）
  Test: bash -c "git fetch origin main --depth=1 >/dev/null 2>&1 || true; node -e \"const base=JSON.parse(require('child_process').execSync('git show origin/main:packages/brain/package.json').toString());const cur=JSON.parse(require('fs').readFileSync('packages/brain/package.json','utf8'));const added=Object.keys(cur.dependencies||{}).filter(k=>!(base.dependencies||{})[k]);if(added.length)process.exit(1)\""

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/mount-integration.test.js`，覆盖：
- 路由挂在生产路径 `/api/brain/time` 时，`/iso` / `/unix` / `/timezone?tz=UTC` 均返回 200 + `Content-Type` 含 `application/json`，body 结构正确
- 挂在生产路径时，`/timezone`（缺 tz）返回 400 + `Content-Type` 含 `application/json`
- Router 只暴露 GET：POST `/api/brain/time/iso` 返回 404 或 405，且同地址 GET 返回 200（证明挂载生效）
- Router 不带 catch-all：已知路径 `/iso` 返回 200，未知路径 `/does-not-exist` 返回 404
- 并发请求三条端点全部成功且返回 JSON
- **R3 新增**：`server.js` 默认导出 app 在生产接线下真实把 time router 挂在 `/api/brain/time`（`import app from '../../../packages/brain/server.js'` + supertest 端到端断言，防止 ARTIFACT 文本匹配通过但运行时未挂载）
