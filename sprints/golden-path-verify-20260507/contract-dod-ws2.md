---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 单元层守护断言（fallback）

**范围**: 复跑 PR #2816 自带 unit test；该文件不存在时补 4 项 BEHAVIOR 单元测试守护 `runHarnessInitiativeRouter` 行为
**大小**: M（约 150–250 行 TS + vitest）
**依赖**: 与 WS1 并行；E2E 脚本 Step 5 依赖本 workstream 产物存在

## ARTIFACT 条目

- [ ] [ARTIFACT] fallback 测试文件存在
  Test: `node -e "require('fs').accessSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts')"`

- [ ] [ARTIFACT] 测试 import 真实生产代码 `runHarnessInitiativeRouter`（不是空 stub）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');if(!c.includes('runHarnessInitiativeRouter')||!c.includes('packages/brain/src/executor.js'))process.exit(1)"`

- [ ] [ARTIFACT] 测试至少 4 个 it() 块（对应 PRD 4 个边界情况）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');const m=c.match(/\\bit\\s*\\(/g)||[];if(m.length<4)process.exit(1)"`

- [ ] [ARTIFACT] 测试覆盖 watchdog 分支（grep 关键字）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');for(const k of ['watchdog','AbortError','failure_class'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] 文档里写明 PRD 引用的 unit test 文件是否存在的判定逻辑
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/contract-draft.md','utf8');if(!c.includes('executor-harness-initiative-status-writeback.test.js'))process.exit(1)"`

- [ ] [ARTIFACT] 测试文件含 4 个固定 it() 名（合同 Test Contract 行 WS2）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');for(const k of ['graph 返回 final={} (无 error) → router 返回 ok=true','graph 返回 final.error=\"evaluator_fail\" → router 返回 ok=false','compiled.stream 抛 AbortError(watchdog)','compiled.stream 抛任意未知异常'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] commit 1 红日志归档（TDD Red 证据：exit ≠ 0 且 4 项断言全 fail）
  Test: `node -e "const fs=require('fs');const p='sprints/golden-path-verify-20260507/run-baseline-red/ws2-baseline-red.log';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');const m=c.match(/× .*(graph 返回 final=\\{\\}|graph 返回 final\\.error=|compiled\\.stream 抛 AbortError|compiled\\.stream 抛任意未知异常)/g)||[];if(m.length<4)process.exit(1)"`

- [ ] [ARTIFACT] graph 入口写法统一（测试源码内除 it() 名描述外不出现 compiled.invoke 残留）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');if(/compiled\.invoke\b/.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/status-writeback-unit.test.ts`，4 个固定 `it()`：
- `graph 返回 final={} (无 error) → router 返回 ok=true`
- `graph 返回 final.error="evaluator_fail" → router 返回 ok=false`
- `compiled.stream 抛 AbortError(watchdog) → 写 failure_class=watchdog_deadline 并返回 ok=false`
- `compiled.stream 抛任意未知异常 → router 异常上抛（不静默吞）`

每条对应合同术语小节里 `compiled.stream({ streamMode: 'updates' })` 的统一写法（`compiled.stream` 是该写法的字面前缀，不是 `compiled.invoke()` 旧措辞）。

## TDD 纪律提示

WS2 必须两次 commit：
1. **commit 1（Red）**：仅 `tests/ws2/status-writeback-unit.test.ts` + 红日志 `run-baseline-red/ws2-baseline-red.log`（exit ≠ 0，4 项 ✗）；
2. **commit 2（Green）**：补齐 mock / 测试与生产签名对齐 → 4 项断言全 PASS。

CI / Evaluator 通过 `run-baseline-red/ws2-baseline-red.log` 取证"先红再绿"。
