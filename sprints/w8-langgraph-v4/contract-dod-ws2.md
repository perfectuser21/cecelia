---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 故障注入 A/B/C 自愈观测 helper（含 R4 evidence 落盘+回放）

**范围**: 实现 `scripts/acceptance/w8-v4/fault-inject.mjs` 七函数：findContainerForTask / pollLlmRetryEvents / pollHarnessInterruptPending / injectInitiativeDeadlineOverdue / assertWatchdogMarkedFailed / **recordInjectionTimestamp** / **replayInjectionEvidence**
**大小**: L
**依赖**: Workstream 1（共享 DB query helper / 错误约定）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/acceptance/w8-v4/fault-inject.mjs` 文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('scripts/acceptance/w8-v4/fault-inject.mjs'))process.exit(1)"

- [ ] [ARTIFACT] fault-inject.mjs 导出七个具名函数（原 5 + R4 新增 2）
  Test: node -e "import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(m => { for (const fn of ['findContainerForTask','pollLlmRetryEvents','pollHarnessInterruptPending','injectInitiativeDeadlineOverdue','assertWatchdogMarkedFailed','recordInjectionTimestamp','replayInjectionEvidence']) { if (typeof m[fn] !== 'function') process.exit(1); } })"

- [ ] [ARTIFACT] 含 LLM_RETRY cap 常量 = 3（与 W2 配套，防漂移）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.match(/cap.*=.*3|MAX.*RETRY.*=.*3|capMax.*=.*3/i)) process.exit(1);"

- [ ] [ARTIFACT] injectInitiativeDeadlineOverdue 内的 SQL 含 `phase='running'` WHERE 子句（防止误改 failed/completed 行）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.match(/phase\\s*=\\s*['\"]running['\"]/)) process.exit(1);"

- [ ] [ARTIFACT] assertWatchdogMarkedFailed 内含 'watchdog_overdue' 字面量校验
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.includes('watchdog_overdue')) process.exit(1);"

- [ ] [ARTIFACT] recordInjectionTimestamp 落盘文件名 pattern 含 `inject-${kind...}.json` 字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.match(/inject-\\$\\{[^}]+\\}\\.json|inject-\\$\\{[^}]+\\.[^}]+\\}\\.json/)) process.exit(1);"

- [ ] [ARTIFACT] replayInjectionEvidence 文件读取 含 'inject-a.json' / 'inject-b.json' / 'inject-c.json' 三个 kind 字面量或 ['A','B','C'] 数组
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); const hasFiles = c.includes('inject-a.json') && c.includes('inject-b.json') && c.includes('inject-c.json'); const hasArr = c.match(/\\[\\s*['\"]A['\"]\\s*,\\s*['\"]B['\"]\\s*,\\s*['\"]C['\"]\\s*\\]/); if (!hasFiles && !hasArr) process.exit(1);"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/fault-inject.test.ts`，覆盖：
- `findContainerForTask` 给定多容器时取第一个；空时抛错
- `pollLlmRetryEvents` 当 retry 超过 capMax=3 时抛错（不静默）
- `pollHarnessInterruptPending` 在超时窗口内未见 pending 时抛错且错误含 task_id
- `injectInitiativeDeadlineOverdue` 仅 UPDATE phase=running 行；返回受影响行数 ≥1，否则抛错
- `assertWatchdogMarkedFailed` 校验 phase=failed AND failure_reason='watchdog_overdue'，缺一不可（任一不满足都抛错）
- **(R4)** `recordInjectionTimestamp` 写 `${dir}/inject-${kind.toLowerCase()}.json` 含 kind/taskId/injectTs/target/meta；不存在的 dir 自动 mkdir -p
- **(R4)** `replayInjectionEvidence` 读取 inject-{a,b,c}.json 三件齐全返回数组；缺文件抛错并指出哪个 kind 缺
