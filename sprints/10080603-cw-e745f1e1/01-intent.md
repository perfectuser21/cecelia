---
task_id: e745f1e1-982a-4d45-beac-4b56972a2312
step: intent
upstream: []
---
# contract-exists 不把 coding workflow 的 sprint 当 harness PR 拦

### I-1
diff 清单只含 sprints/10080335-cw-c954ebfd/01-intent.md、02-spec.md、03-build.md、04-evidence.md 时，node packages/brain/scripts/ci/contract-exists.mjs --fixture <清单文件> 退出码为 0

### I-2
diff 清单只含 sprints/06111530-fix-forensics-smoke/sprint-prd.md 时，node packages/brain/scripts/ci/contract-exists.mjs --fixture <清单文件> 退出码非 0 且 stderr 含 contract-draft.md

### I-3
cd packages/brain && npx vitest run src/__tests__/ci-defense.test.ts 全部通过，且新增覆盖上述两种情况的测试
