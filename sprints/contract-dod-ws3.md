# Contract DoD — Workstream 3: 巡检脚本 + 文档登记

**范围**: 新建 `packages/brain/scripts/health-probe.mjs`（独立 Node ESM 脚本）+ 更新 `docs/current/README.md` 巡检表
**大小**: S（脚本 <80 行 + 文档 1 行）
**依赖**: 无（测试用 mock http server 驱动脚本，不依赖 WS1/WS2 产物在位）

## ARTIFACT 条目

- [ ] [ARTIFACT] 新建文件 `packages/brain/scripts/health-probe.mjs`
  Test: node -e "require('fs').accessSync('packages/brain/scripts/health-probe.mjs', require('fs').constants.F_OK)"

- [ ] [ARTIFACT] `packages/brain/scripts/health-probe.mjs` 读取环境变量 `HEALTH_URL`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/health-probe.mjs','utf8');if(!/process\.env\.HEALTH_URL/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/health-probe.mjs` 不 import 第三方 http 库（只用 node:http / node:https）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/health-probe.mjs','utf8');if(/from\s*['\"](axios|node-fetch|got|undici)['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `docs/current/README.md` 的「自动巡检状态」章节包含 `/api/brain/health` 行
  Test: node -e "const c=require('fs').readFileSync('docs/current/README.md','utf8');const sec=c.split('## 自动巡检状态')[1]||'';if(!sec.includes('/api/brain/health'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws3/）

见 `sprints/tests/ws3/selfcheck-probe.test.ts`，覆盖 5 个 `it()`，退出码精确契约（0/1/2）：
- health-probe 对合法 200 + 三字段响应退出码为 0
- health-probe 对缺失 version 字段的响应退出码严格等于 1（validation 失败）
- health-probe 对 HTTP 500 响应退出码严格等于 1（validation 失败）
- health-probe 对 status=degraded 的响应退出码严格等于 1（validation 失败）
- health-probe 对不可达 URL（ECONNREFUSED）退出码严格等于 2（连接失败）
