
 RUN  v4.1.10 /Users/administrator/worktrees/task-63db6f8a/session-e0a01267

 × tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记 2ms
   → ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 × tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > payload 三元组齐全且禁用 token/github_token/anthropic_token/thin_prd 0ms
   → ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 × tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > initiative_runs 含 skill-relay-claude-headed 或 foreground 且 phase 拒绝 failed/unknown 0ms
   → ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 × tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > local_api E2E wrapper 完整验证当前 task/run/smoke 外部真相，无 mock/吞错 0ms
   → ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > e2e-verify.sh 调用 claude-headed-dispatch-smoke.sh 并校验 allowlist 登记
Error: ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 ❯ readWrapper tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:15:10
     13|
     14| function readWrapper(): string {
     15|   return readFileSync(wrapperPath, 'utf8');
       |          ^
     16| }
     17|
 ❯ tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:20:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > payload 三元组齐全且禁用 token/github_token/anthropic_token/thin_prd
Error: ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 ❯ readWrapper tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:15:10
     13|
     14| function readWrapper(): string {
     15|   return readFileSync(wrapperPath, 'utf8');
       |          ^
     16| }
     17|
 ❯ tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:26:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > initiative_runs 含 skill-relay-claude-headed 或 foreground 且 phase 拒绝 failed/unknown
Error: ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 ❯ readWrapper tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:15:10
     13|
     14| function readWrapper(): string {
     15|   return readFileSync(wrapperPath, 'utf8');
       |          ^
     16| }
     17|
 ❯ tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:38:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts > headed smoke contract (task 63db6f8a) [BEHAVIOR] > local_api E2E wrapper 完整验证当前 task/run/smoke 外部真相，无 mock/吞错
Error: ENOENT: no such file or directory, open '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh'
 ❯ readWrapper tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:15:10
     13|
     14| function readWrapper(): string {
     15|   return readFileSync(wrapperPath, 'utf8');
       |          ^
     16| }
     17|
 ❯ tests/regression/relay-63db6f8a/headed-smoke-contract.test.ts:49:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/Users/administrator/worktrees/task-63db6f8a/session-e0a01267/sprints/07151400-relay-63db6f8a/e2e-verify.sh' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  1 failed (1)
      Tests  4 failed (4)
   Start at  23:23:30
   Duration  126ms (transform 14ms, setup 0ms, import 19ms, tests 3ms, environment 0ms)

