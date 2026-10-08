---
task_id: 6350b768-b097-4441-84bb-903a8762f430
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 验收证据：coding workflow runner 状态查看脚本 status.mjs

### E-1
对应: I-1
verdict: PASS
```command
cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__/status.test.mjs 2>&1 | tail -30
```
```output
 RUN  v1.6.1 /Users/administrator/worktrees/cecelia-cw/cw-6350b768/packages/brain

 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs  (7 tests) 74ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### E-2
对应: I-1
verdict: PASS
```command
grep -nE "it\(|pr_url|failed_activity|reason_code|倒序|mtime|utimes" /Users/administrator/worktrees/cecelia-cw/cw-6350b768/packages/brain/scripts/coding-workflow/runner/__tests__/status.test.mjs
```
```output
40:  fs.utimesSync(completed, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
41:  fs.utimesSync(partial, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
46:  it('completed 回执含 pr_url', () => {
50:    expect(row.pr_url).toBe(PR_URL);
55:  it('partial 回执含 failed_activity 与 reason_code', () => {
59:    expect(row.failed_activity).toBe('build');
60:    expect(row.reason_code).toBe('tests_failed');
62:    expect(text).toContain('failed_activity=build');
63:    expect(text).toContain('reason_code=tests_failed');
66:  it('按修改时间倒序（函数与 CLI 文本输出）', () => {
```

### E-3
对应: I-2
verdict: PASS
```command
node /Users/administrator/worktrees/cecelia-cw/cw-6350b768/packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /tmp/cw-nonexistent-dir-6350b768; echo "exit=$?"
```
```output
没有运行记录（/tmp/cw-nonexistent-dir-6350b768）
exit=0
```

### E-4
对应: I-3
verdict: PASS
```command
cd /Users/administrator/worktrees/cecelia-cw/cw-6350b768/packages/brain && npx vitest run scripts/coding-workflow/runner 2>&1 | tail -30
```
```output
 ✓ scripts/coding-workflow/runner/__tests__/run-once.test.mjs  (19 tests) 6951ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs  (11 tests) 2719ms
 ✓ scripts/coding-workflow/runner/__tests__/plan.test.mjs  (18 tests) 93ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-cifix.test.mjs  (9 tests) 4591ms
 ✓ scripts/coding-workflow/runner/__tests__/install.test.mjs  (9 tests) 271ms
 ✓ scripts/coding-workflow/runner/__tests__/runner-sh.test.mjs  (6 tests) 1437ms
 ✓ scripts/coding-workflow/runner/__tests__/status.test.mjs  (7 tests) 75ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-deps.test.mjs  (8 tests) 2088ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-retention.test.mjs  (3 tests) 739ms
 ✓ scripts/coding-workflow/runner/__tests__/sandbox-env.test.mjs  (2 tests) 1ms

 Test Files  10 passed (10)
      Tests  92 passed (92)
```
