# Contract DoD — Workstream 2: `/timezone` 端点（只新增文件，不改 time-api.js）

**范围**: 新建 `scripts/harness-dogfood/routes/timezone.js`（导出 `{path: '/timezone', handler}`，handler 返回 `{timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}`）；新建 `scripts/harness-dogfood/__tests__/timezone.test.js`（node:test runtime 兼容层）。**严禁修改** `time-api.js` / `routes/iso.js` / `__tests__/iso.test.js` / `__tests__/not-found.test.js`。依赖 WS1 的 routes 自动加载器识别新文件。

**大小**: S（routes/timezone.js 约 10-15 行 + 兼容层测试约 30-40 行）

**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/routes/timezone.js` 文件存在
  Test: test -f scripts/harness-dogfood/routes/timezone.js

- [ ] [ARTIFACT] routes/timezone.js 导出 `{path, handler}` 形状
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/timezone.js','utf8');if(!/(module\.exports\s*=\s*\{[\s\S]*path[\s\S]*handler|exports\.path|exports\.handler)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/timezone.js 含 `/timezone` 路径字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/timezone.js','utf8');if(!/['\x22]\/timezone['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/timezone.js 含 `Intl.DateTimeFormat` 调用
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/timezone.js','utf8');if(!/Intl\.DateTimeFormat/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/timezone.js 含 `resolvedOptions` 调用（真读进程 timezone，非硬编码）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/timezone.js','utf8');if(!/resolvedOptions/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/timezone.js 含 `'timezone'` 响应字段字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/timezone.js','utf8');if(!/['\x22]timezone['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 源码**不含** `/timezone` 字面量（负向断言：WS2 未污染 WS1 骨架）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/\/timezone/.test(c)){console.error('FAIL: WS2 不得向 time-api.js 写入 /timezone，它只能在 routes/timezone.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `Intl.DateTimeFormat` 字面量（负向断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/Intl\.DateTimeFormat/.test(c)){console.error('FAIL: timezone 实现必须在 routes/timezone.js，不在 time-api.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `resolvedOptions` 字面量（负向断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/resolvedOptions/.test(c)){console.error('FAIL: resolvedOptions 必须在 routes/timezone.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `'timezone'` 响应字段字面量（负向断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/['\x22]timezone['\x22]/.test(c)){console.error('FAIL: timezone 字段字面量必须在 routes/timezone.js');process.exit(1)}"

- [ ] [ARTIFACT] WS1 骨架存续：time-api.js 仍含 `not_found` 兜底（正向断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/not_found/.test(c))process.exit(1)"

- [ ] [ARTIFACT] WS1 骨架存续：time-api.js 仍含 `method_not_allowed` 兜底
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/method_not_allowed/.test(c))process.exit(1)"

- [ ] [ARTIFACT] WS1 骨架存续：time-api.js 仍含 `readdirSync` 自动加载器
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/readdirSync\s*\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：scripts/harness-dogfood/__tests__/timezone.test.js 文件存在
  Test: test -f scripts/harness-dogfood/__tests__/timezone.test.js

- [ ] [ARTIFACT] PRD 兼容层：__tests__/timezone.test.js 使用 Node 内置 node:test
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/timezone.test.js','utf8');if(!/node:test/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：__tests__/timezone.test.js 真实 require time-api.js
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/timezone.test.js','utf8');if(!/(require|from)\s*\(?['\x22][.\/]+time-api/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：node --test __tests__/timezone.test.js 子进程 exit 0
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 30 node --test scripts/harness-dogfood/__tests__/timezone.test.js > /tmp/tz-nodetest.log 2>&1 && grep -qE '^# pass [1-9]' /tmp/tz-nodetest.log"

- [ ] [ARTIFACT] Round 4 锁死：`vitest run sprints/tests/ws2/` 未报 "No test files found"（vitest 真扫到本 WS 测试）
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws2/ > /tmp/ws2-disc.stdout 2> /tmp/ws2-disc.stderr; if grep -q 'No test files found' /tmp/ws2-disc.stderr /tmp/ws2-disc.stdout; then echo 'FAIL: vitest 未发现 sprints/tests/ws2/';cat /tmp/ws2-disc.stderr;exit 1;fi"

- [ ] [ARTIFACT] Round 4 锁死：`vitest run sprints/tests/ws2/` stdout 含 `sprints/tests/ws2/timezone.test.ts` 路径
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws2/ > /tmp/ws2-disc.stdout 2>&1 || true; grep -q 'sprints/tests/ws2/timezone.test.ts' /tmp/ws2-disc.stdout"

- [ ] [ARTIFACT] Round 4 锁死：`vitest run sprints/tests/ws2/` 摘要行 Tests 计数为 7（Red 阶段 7 failed，Green 阶段 7 passed）
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws2/ > /tmp/ws2-disc.stdout 2>&1 || true; grep -qE 'Tests[[:space:]]+[0-9]+[[:space:]]+(failed|passed)[[:space:]]*\\(7\\)' /tmp/ws2-disc.stdout"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws2/）

见 `sprints/tests/ws2/timezone.test.ts`，共 7 个 it，覆盖：
- GET /timezone 返回 200 且 timezone 字段为非空字符串
- GET /timezone 返回的 timezone 严格等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）
- GET /timezone 的 Content-Type 为 application/json
- routes["/timezone"] 为 handler 函数（自动加载器识别新文件）
- WS2 合并后 /iso 端点仍正常 200 响应（骨架未被污染）
- WS2 合并后 time-api.js 源码不含 timezone 相关字面量（物理隔离契约）
- PRD 兼容层 runtime：node --test __tests__/timezone.test.js exit 0
