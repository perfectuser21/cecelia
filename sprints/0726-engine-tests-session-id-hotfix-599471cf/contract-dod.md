# Contract DoD — cecelia-run dry-run 恢复 `--session-id`

Task ID: `58b733b8-ff1f-4120-a394-5bf8e38d4049`

## 行为验收

- [x] [BEHAVIOR] dry-run 输出含 --session-id UUID
  - Test File: `sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts`
  - Test: manual:bash -lc 'npx vitest run sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts --reporter=verbose'
  - 期望：真实执行 dry-run 后可提取唯一 `--session-id <uuid>`。

- [x] [BEHAVIOR] session id 单次生成且环境变量与 CLI 同值
  - Test File: `sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts`
  - Test: manual:bash -lc 'npx vitest run sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts --reporter=verbose'
  - 期望：`CLAUDE_SESSION_ID` 与 `--session-id` 的 UUID 完全相同，CLI flag 恰出现一次。

- [x] [BEHAVIOR] launcher-dry-run 既有回归通过
  - Test File: `packages/engine/tests/launcher/launcher-dry-run.test.ts`
  - Test: manual:bash -lc 'cd packages/engine && npx vitest run tests/launcher/launcher-dry-run.test.ts --reporter=verbose'
  - 期望：既有 launcher dry-run 回归池全绿。

- [x] [BEHAVIOR] packages/engine 全量测试与 GitHub engine-tests 全绿
  - Test File: `sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts`
  - Test: manual:bash -lc 'cd packages/engine && npx vitest run --reporter=verbose'
  - 期望：本地 engine 全量测试全绿；push 后 GitHub `engine-tests` 成功。

## 产物验收

- [x] [ARTIFACT] `sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts` 在 `(Red)` commit 新增，且 Red 是目标断言失败。
  - Test: manual:bash -lc 'test -f sprints/0726-engine-tests-session-id-hotfix-599471cf/tests/cecelia-run-session-id.test.ts'

- [x] [ARTIFACT] `sprints/0726-engine-tests-session-id-hotfix-599471cf/e2e-verify.sh` 存在、可执行并真跑完整链路。
  - Test: manual:bash -lc 'test -x sprints/0726-engine-tests-session-id-hotfix-599471cf/e2e-verify.sh && bash sprints/0726-engine-tests-session-id-hotfix-599471cf/e2e-verify.sh'

- [x] [ARTIFACT] TDD commit 顺序为先 `(Red)` 后 `(Green)`，Red 后合同测试未改。
  - Test: manual:bash -lc 'git log --oneline origin/main..HEAD | grep -q "(Red)" && git log --oneline origin/main..HEAD | grep -q "(Green)"'

- [x] [ARTIFACT] PR 标题或正文含完整 task id，且 diff 不含 PR #4339 的 sprint/合同文件。
  - Test: manual:bash -lc 'git diff --name-only origin/main...HEAD | grep -vq "sprints/07260710-harness-gate-cycle-hotfix"'

## E2E 验收

```bash
bash sprints/0726-engine-tests-session-id-hotfix-599471cf/e2e-verify.sh
```

## 未覆盖真实链路清单

N/A。

