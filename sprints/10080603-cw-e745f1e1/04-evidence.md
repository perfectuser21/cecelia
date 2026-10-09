---
task_id: e745f1e1-982a-4d45-beac-4b56972a2312
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---

### E-1
对应: I-1
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-e745f1e1 && printf 'sprints/10080335-cw-c954ebfd/01-intent.md\nsprints/10080335-cw-c954ebfd/02-spec.md\nsprints/10080335-cw-c954ebfd/03-build.md\nsprints/10080335-cw-c954ebfd/04-evidence.md\n' > /tmp/v_list1.txt && printf 'sprints/06111530-fix-forensics-smoke/sprint-prd.md\n' > /tmp/v_list2.txt && node packages/brain/scripts/ci/contract-exists.mjs --fixture /tmp/v_list1.txt; echo "exit=$?"
```

```output
contract-exists: ✅ 非 harness PR（无 sprints/ 改动），跳过合同存在性校验
exit=0
```

### E-2
对应: I-2
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-e745f1e1 && node packages/brain/scripts/ci/contract-exists.mjs --fixture /tmp/v_list2.txt; echo "exit=$?"
```

```output
contract-exists: ❌ FAIL — 该 PR 改动了 sprints/ 但缺少 contract-draft.md（harness PR 必须带合同）
  缺失文件: contract-draft.md
exit=1
```

### E-3
对应: I-2
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-e745f1e1 && node packages/brain/scripts/ci/contract-exists.mjs --fixture /tmp/v_list2.txt 2>&1 >/dev/null | grep contract-draft.md; echo "exit=${pipestatus[1]}"
```

```output
contract-exists: ❌ FAIL — 该 PR 改动了 sprints/ 但缺少 contract-draft.md（harness PR 必须带合同）
  缺失文件: contract-draft.md
exit=1
```

### E-4
对应: I-3
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-e745f1e1/packages/brain && npx vitest run src/__tests__/ci-defense.test.ts 2>&1 | tail -30
```

```output
 ✓ src/__tests__/ci-defense.test.ts  (7 tests) 156ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### E-5
对应: I-3
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-e745f1e1 && git diff main --stat -- packages/brain; git diff main -- packages/brain/src/__tests__/ci-defense.test.ts | grep '^[+-]' | head -60
```

```output
 .../scripts/ci/__tests__/fixtures/diff-coding-workflow.txt  |  4 ++++
 .../scripts/ci/__tests__/fixtures/diff-harness-prd-only.txt |  1 +
 packages/brain/scripts/ci/contract-exists.mjs               | 10 +++++++++-
 packages/brain/src/__tests__/ci-defense.test.ts             | 13 +++++++++++++
 4 files changed, 27 insertions(+), 1 deletion(-)
+  it('Step4 coding workflow: 仅含 01~04 产物的 sprint diff 不被当 harness PR 拦', () => {
+  it('Step4 harness 残留: 仅含 sprint-prd.md 的 diff 仍被拦并点名 contract-draft.md', () => {
+    expect(code).not.toBe(0);
+    expect(out).toMatch(/contract-draft\.md/);
