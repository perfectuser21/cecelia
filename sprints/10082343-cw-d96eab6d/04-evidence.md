---
task_id: d96eab6d-6e93-41c2-91c2-945cb19ffc51
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 验收证据：runner 状态查看显示 CI 自动修复记录

### E-1
对应: I-1
verdict: PASS

```command
cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs 2>&1 | tail -20
```

```output
 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs  (9 tests) 89ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### E-2
对应: I-1
verdict: PASS

```command
grep -n "cifix\|ci_fix\|pull/77\|pushed" /Users/administrator/worktrees/cecelia-cw/cw-d96eab6d/packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs
```

```output
100:  it('有 cifix 状态文件的任务带 ci_fix 摘要，状态文件本身不成为任务行', () => {
104:      outputs: { pr_url: 'https://github.com/x/y/pull/77' },
106:    fs.writeFileSync(path.join(dir, 'cifix-77.json'), JSON.stringify({
107:      attempts: [{ pr: 77, result: 'push_failed' }, { pr: 77, result: 'pushed' }],
110:    expect(rows.find((r) => r.task_id === CIFIX_ID).ci_fix).toEqual({ attempts: 2, last_result: 'pushed' });
111:    expect(rows.some((r) => r.task_id === 'cifix-77')).toBe(false);
113:    expect(line).toContain('ci_fix=2次');
114:    expect(line).toContain('pushed');
117:  it('没有 cifix 状态文件的任务 ci_fix 为 null 且文本行不含 ci_fix', () => {
121:    expect(rows.find((r) => r.task_id === COMPLETED_ID).ci_fix).toBeNull();
123:    expect(lineOf(text, COMPLETED_ID)).not.toContain('ci_fix');
124:    expect(lineOf(text, PARTIAL_ID)).not.toContain('ci_fix');
```

### E-3
对应: I-1
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-d96eab6d/packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs --reporter=verbose 2>&1 | grep -E "✓|×|cifix|ci_fix|Tests"
```

```output
 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs > collectStatus / formatStatus > 有 cifix 状态文件的任务带 ci_fix 摘要，状态文件本身不成为任务行
 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs > collectStatus / formatStatus > 没有 cifix 状态文件的任务 ci_fix 为 null 且文本行不含 ci_fix
      Tests  9 passed (9)
```

### E-4
对应: I-1
verdict: PASS

```command
D=$(mktemp -d /tmp/cw-verify-XXXX) && printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/x/y/pull/77"},"activities":[{"key":"intent","status":"completed"}]}' > $D/task-with-cifix.json && printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/x/y/pull/5"},"activities":[{"key":"intent","status":"completed"}]}' > $D/task-no-cifix.json && printf '%s' '{"attempts":[{"pr":77,"result":"push_failed"},{"pr":77,"result":"pushed"}]}' > $D/cifix-77.json && node /Users/administrator/worktrees/cecelia-cw/cw-d96eab6d/packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir $D
```

```output
task-no-cifix  completed  2026-10-08T15:46:29.276Z  https://github.com/x/y/pull/5
task-with-cifix  completed  2026-10-08T15:46:29.276Z  https://github.com/x/y/pull/77  ci_fix=2次 last=pushed
```

### E-5
对应: I-2
verdict: PASS

```command
D=$(mktemp -d /tmp/cw-verify-XXXX) && printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/x/y/pull/77"},"activities":[{"key":"intent","status":"completed"}]}' > $D/task-with-cifix.json && printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/x/y/pull/5"},"activities":[{"key":"intent","status":"completed"}]}' > $D/task-no-cifix.json && printf '%s' '{"attempts":[{"pr":77,"result":"push_failed"},{"pr":77,"result":"pushed"}]}' > $D/cifix-77.json && node /Users/administrator/worktrees/cecelia-cw/cw-d96eab6d/packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir $D
```

```output
task-no-cifix  completed  2026-10-08T15:46:29.276Z  https://github.com/x/y/pull/5
```

### E-6
对应: I-2
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-d96eab6d/packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs --reporter=verbose 2>&1 | grep -E "✓|×|cifix|ci_fix|Tests"
```

```output
 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs > collectStatus / formatStatus > 没有 cifix 状态文件的任务 ci_fix 为 null 且文本行不含 ci_fix
```

### E-7
对应: I-3
verdict: PASS

```command
cd /Users/administrator/worktrees/cecelia-cw/cw-d96eab6d/packages/brain && npx vitest run scripts/coding-workflow/runner 2>&1 | tail -15
```

```output
 ✓ scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs  (11 tests) 3050ms
 ✓ scripts/coding-workflow/runner/__tests__/plan.test.mjs  (18 tests) 101ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-cifix.test.mjs  (9 tests) 4796ms
 ✓ scripts/coding-workflow/runner/__tests__/install.test.mjs  (9 tests) 223ms
 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs  (9 tests) 89ms
 ✓ scripts/coding-workflow/runner/__tests__/runner-sh.test.mjs  (6 tests) 1552ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-deps.test.mjs  (8 tests) 2159ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-retention.test.mjs  (3 tests) 850ms
 ✓ scripts/coding-workflow/runner/__tests__/sandbox-env.test.mjs  (2 tests) 2ms

 Test Files  10 passed (10)
      Tests  94 passed (94)
```
