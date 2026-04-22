# Contract DoD — Workstream 3: `/unix` 端点（只新增文件，不改 time-api.js）

**范围**: 新建 `scripts/harness-dogfood/routes/unix.js`（导出 `{path: '/unix', handler}`，handler 返回 `{unix: Math.floor(Date.now()/1000)}`）；新建 `scripts/harness-dogfood/__tests__/unix.test.js`（node:test runtime 兼容层）。**严禁修改** `time-api.js` 或 WS1/WS2 的任何文件。依赖 WS1 的 routes 自动加载器识别新文件。与 WS2 无文件交集。

**大小**: S（routes/unix.js 约 10-15 行 + 兼容层测试约 30-40 行）

**依赖**: Workstream 1（与 WS2 无顺序耦合）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/harness-dogfood/routes/unix.js` 文件存在
  Test: test -f scripts/harness-dogfood/routes/unix.js

- [ ] [ARTIFACT] routes/unix.js 导出 `{path, handler}` 形状
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/unix.js','utf8');if(!/(module\.exports\s*=\s*\{[\s\S]*path[\s\S]*handler|exports\.path|exports\.handler)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/unix.js 含 `/unix` 路径字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/unix.js','utf8');if(!/['\x22]\/unix['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/unix.js 含 `Math.floor(Date.now()/1000)` 秒级转换（杜绝毫秒级实现）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/unix.js','utf8');if(!/Math\.floor\s*\(\s*Date\.now\s*\(\s*\)\s*\/\s*1000\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] routes/unix.js 含 `'unix'` 响应字段字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/routes/unix.js','utf8');if(!/['\x22]unix['\x22]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] time-api.js 源码**不含** `/unix` 字面量（负向断言：WS3 未污染 WS1 骨架）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/\/unix/.test(c)){console.error('FAIL: WS3 不得向 time-api.js 写入 /unix，它只能在 routes/unix.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `Math.floor` 字面量（负向断言：秒级转换只能在 routes/unix.js）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/Math\.floor/.test(c)){console.error('FAIL: Math.floor 必须在 routes/unix.js');process.exit(1)}"

- [ ] [ARTIFACT] time-api.js 源码**不含** `'unix'` 响应字段字面量（负向断言）
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(/['\x22]unix['\x22]/.test(c)){console.error('FAIL: unix 字段字面量必须在 routes/unix.js');process.exit(1)}"

- [ ] [ARTIFACT] WS1 骨架存续：time-api.js 仍含 `not_found` 兜底
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/not_found/.test(c))process.exit(1)"

- [ ] [ARTIFACT] WS1 骨架存续：time-api.js 仍含 `method_not_allowed` 兜底
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/method_not_allowed/.test(c))process.exit(1)"

- [ ] [ARTIFACT] WS1 骨架存续：time-api.js 仍含 `readdirSync` 自动加载器
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/time-api.js','utf8');if(!/readdirSync\s*\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：scripts/harness-dogfood/__tests__/unix.test.js 文件存在
  Test: test -f scripts/harness-dogfood/__tests__/unix.test.js

- [ ] [ARTIFACT] PRD 兼容层：__tests__/unix.test.js 使用 Node 内置 node:test
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/unix.test.js','utf8');if(!/node:test/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：__tests__/unix.test.js 真实 require time-api.js
  Test: node -e "const c=require('fs').readFileSync('scripts/harness-dogfood/__tests__/unix.test.js','utf8');if(!/(require|from)\s*\(?['\x22][.\/]+time-api/.test(c))process.exit(1)"

- [ ] [ARTIFACT] PRD 兼容层：node --test __tests__/unix.test.js 子进程 exit 0
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 30 node --test scripts/harness-dogfood/__tests__/unix.test.js > /tmp/unix-nodetest.log 2>&1 && grep -qE '^# pass [1-9]' /tmp/unix-nodetest.log"

- [ ] [ARTIFACT] Round 4 锁死：`vitest run sprints/tests/ws3/` 未报 "No test files found"
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws3/ > /tmp/ws3-disc.stdout 2> /tmp/ws3-disc.stderr; if grep -q 'No test files found' /tmp/ws3-disc.stderr /tmp/ws3-disc.stdout; then echo 'FAIL: vitest 未发现 sprints/tests/ws3/';cat /tmp/ws3-disc.stderr;exit 1;fi"

- [ ] [ARTIFACT] Round 4 锁死：`vitest run sprints/tests/ws3/` stdout 含 `sprints/tests/ws3/unix.test.ts` 路径
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws3/ > /tmp/ws3-disc.stdout 2>&1 || true; grep -q 'sprints/tests/ws3/unix.test.ts' /tmp/ws3-disc.stdout"

- [ ] [ARTIFACT] Round 4 锁死：`vitest run sprints/tests/ws3/` 摘要行 Tests 计数为 8（Red 8 failed / Green 8 passed）
  Test: bash -c "cd \$(git rev-parse --show-toplevel) && timeout 60 ./node_modules/.bin/vitest run sprints/tests/ws3/ > /tmp/ws3-disc.stdout 2>&1 || true; grep -qE 'Tests[[:space:]]+[0-9]+[[:space:]]+(failed|passed)[[:space:]]*\\(8\\)' /tmp/ws3-disc.stdout"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws3/）

见 `sprints/tests/ws3/unix.test.ts`，共 8 个 it，覆盖：
- GET /unix 返回 200 且 unix 字段为正整数
- GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒
- GET /unix 的 unix 字段不是毫秒级（不应比当前秒时间戳大三位数以上）
- GET /unix 的 Content-Type 为 application/json
- routes["/unix"] 为 handler 函数（自动加载器识别新文件）
- WS3 合并后 /iso 端点仍正常 200 响应（骨架未被污染）
- WS3 合并后 time-api.js 源码不含 unix 相关字面量（物理隔离契约）
- PRD 兼容层 runtime：node --test __tests__/unix.test.js exit 0
