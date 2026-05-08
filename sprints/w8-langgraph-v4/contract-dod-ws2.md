---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 故障注入 A/B/C 自愈观测 helper（含 R4 evidence 落盘+回放 + R6 mount snapshot + R7 cred check + R8 lenient/skipped）

**范围**: 实现 `scripts/acceptance/w8-v4/fault-inject.mjs` 十一函数：findContainerForTask / pollLlmRetryEvents / pollHarnessInterruptPending / injectInitiativeDeadlineOverdue（**R8 lenient**） / assertWatchdogMarkedFailed / recordInjectionTimestamp / replayInjectionEvidence（**R8 skipped fallback**） / **snapshotWorkspaceMount**（R6） / **diffWorkspaceMounts**（R6） / **checkCredentialInvalidEvent**（R7） / **recordSkippedInjection**（R8）
**大小**: L
**依赖**: Workstream 1（共享 DB query helper / 错误约定）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/acceptance/w8-v4/fault-inject.mjs` 文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('scripts/acceptance/w8-v4/fault-inject.mjs'))process.exit(1)"

- [ ] [ARTIFACT] fault-inject.mjs 导出十一个具名函数（R2 7 + R3 新增 4：snapshotWorkspaceMount / diffWorkspaceMounts / checkCredentialInvalidEvent / recordSkippedInjection）
  Test: node -e "import('./scripts/acceptance/w8-v4/fault-inject.mjs').then(m => { for (const fn of ['findContainerForTask','pollLlmRetryEvents','pollHarnessInterruptPending','injectInitiativeDeadlineOverdue','assertWatchdogMarkedFailed','recordInjectionTimestamp','replayInjectionEvidence','snapshotWorkspaceMount','diffWorkspaceMounts','checkCredentialInvalidEvent','recordSkippedInjection']) { if (typeof m[fn] !== 'function') process.exit(1); } })"

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

- [ ] [ARTIFACT] (R6) snapshotWorkspaceMount 调用 'docker exec brain ls' + '/workspace' 字面量；写入 `mount-${label}.txt` 字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.includes('docker exec brain ls') || !c.includes('/workspace')) process.exit(1); if(!c.match(/mount-\\$\\{[^}]+\\}\\.txt|mount-\\$\\{label\\}/)) process.exit(1);"

- [ ] [ARTIFACT] (R7) checkCredentialInvalidEvent SQL 含 `event_type='credential_invalid'` 字面量；抛错信息含 'credential_invalid: aborting acceptance'
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.match(/event_type\\s*=\\s*['\"]credential_invalid['\"]/)) process.exit(1); if(!c.includes('credential_invalid: aborting acceptance')) process.exit(1);"

- [ ] [ARTIFACT] (R8) recordSkippedInjection 写文件名 pattern 含 'skipped' 字面量；replayInjectionEvidence 含 'inject-c-skipped.json' 字面量 fallback
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/fault-inject.mjs','utf8'); if(!c.includes('-skipped.json') && !c.includes('-skipped\\\\.json')) process.exit(1); if(!c.includes('inject-c-skipped.json')) process.exit(1);"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/fault-inject.test.ts`，覆盖：
- `findContainerForTask` 给定多容器时取第一个；空时抛错
- `pollLlmRetryEvents` 当 retry 超过 capMax=3 时抛错（不静默）
- `pollHarnessInterruptPending` 在超时窗口内未见 pending 时抛错且错误含 task_id
- **(R8 改)** `injectInitiativeDeadlineOverdue` 仅 UPDATE phase=running 行；rowCount=0 时返回 0 不抛错（lenient 默认）
- `assertWatchdogMarkedFailed` 校验 phase=failed AND failure_reason='watchdog_overdue'，缺一不可（任一不满足都抛错）
- **(R4)** `recordInjectionTimestamp` 写 `${dir}/inject-${kind.toLowerCase()}.json` 含 kind/taskId/injectTs/target/meta；不存在的 dir 自动 mkdir -p
- **(R4 + R8)** `replayInjectionEvidence` 读取 inject-{a,b}.json + inject-c.json 或 inject-c-skipped.json 三件齐全返回数组（含 status 字段）；任意 kind 完全缺失时抛错
- **(R6)** `snapshotWorkspaceMount` 调 exec 写 `${dir}/mount-${label}.txt`；不存在的 dir 自动 mkdir -p
- **(R6)** `diffWorkspaceMounts` line-by-line diff 返回 `{added, removed}` 数组；写到 outPath 内容非空
- **(R7)** `checkCredentialInvalidEvent` 0 rows 返回 0 不抛错；≥ 1 rows 抛错信息含 `credential_invalid: aborting acceptance`
- **(R8)** `recordSkippedInjection` 写 `${dir}/inject-${kind.toLowerCase()}-skipped.json` 含 kind/taskId/reason/injectTs/meta；不存在的 dir 自动 mkdir -p
