# Contract DoD — Workstream 2: 端到端冒烟脚本 + validators

**范围**:
- 新建 `packages/brain/test/time-endpoints.smoke.mjs`（Final E2E 阶段执行的真机冒烟脚本）
- 脚本必须导出 3 个纯函数 validator（`validateIsoBody` / `validateTimezoneBody` / `validateUnixBody`），便于在不启动 Brain 的前提下做单元测试
- 主入口对 `localhost:5221`（可被 `BRAIN_BASE` 覆盖）3 个 `/api/brain/time/*` 端点逐一发 GET，全 PASS exit 0，任一 FAIL exit 1

**大小**: S（新增 ≤ 60 行）

**依赖**: 无（与 WS1 在代码层完全独立）

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `packages/brain/test/time-endpoints.smoke.mjs` 存在
  Test: node -e "require('fs').accessSync('packages/brain/test/time-endpoints.smoke.mjs')"

- [ ] [ARTIFACT] 脚本含 `export function validateIsoBody`（命名导出）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');if(!/export\s+function\s+validateIsoBody\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 `export function validateTimezoneBody`（命名导出）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');if(!/export\s+function\s+validateTimezoneBody\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 `export function validateUnixBody`（命名导出）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');if(!/export\s+function\s+validateUnixBody\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 脚本引用 `process.env.BRAIN_BASE`（提供可覆盖的 base URL）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');if(!/process\.env\.BRAIN_BASE/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 脚本含对 3 个端点路径的引用（`/api/brain/time/iso` / `/timezone` / `/unix`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');for(const p of ['/api/brain/time/iso','/api/brain/time/timezone','/api/brain/time/unix']){if(!c.includes(p)){console.error('missing path',p);process.exit(1)}}"

- [ ] [ARTIFACT] 脚本含 `process.exit(1)` 的失败路径（任一端点失败时退出非零）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');if(!/process\.exit\(\s*1\s*\)/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 脚本总行数 ≤ 60（满足 SC-003 LOC ≤ 100 总约束）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/test/time-endpoints.smoke.mjs','utf8');const n=c.split('\\n').length;if(n>60){console.error('too many lines:',n);process.exit(1)}"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/smoke-validators.test.ts`，覆盖：
- validateIsoBody accepts valid ISO 8601 with millisecond precision and Z suffix
- validateIsoBody accepts valid ISO 8601 with millisecond precision and ±HH:MM offset suffix
- validateIsoBody rejects body missing iso field
- validateIsoBody rejects iso string without millisecond fraction
- validateIsoBody rejects iso string without timezone suffix
- validateIsoBody rejects non-object body (null / string / number)
- validateTimezoneBody accepts {timezone, offset, iso} with all three fields valid
- validateTimezoneBody rejects body missing timezone field
- validateTimezoneBody rejects body missing offset field
- validateTimezoneBody rejects offset in HHMM (no-colon) format
- validateTimezoneBody rejects offset with single-digit hour (+8:00)
- validateUnixBody accepts a 10-digit positive integer (seconds)
- validateUnixBody rejects 13-digit millisecond value
- validateUnixBody rejects zero and negative integers
- validateUnixBody rejects string representation of integer
- validateUnixBody rejects non-integer (float) value
