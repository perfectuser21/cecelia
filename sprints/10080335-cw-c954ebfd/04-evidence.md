---
task_id: c954ebfd-469f-4006-a95f-b277fa6564f6
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---

### E-1
对应: I-1
verdict: PASS
```command
CODING_WF_AUTOMERGE=0 bash packages/brain/scripts/coding-workflow/runner/install.sh --dry-run 2>&1 | grep -n -B2 -A2 AUTOMERGE
```
```output
38-    <key>CODING_WF_MAIN_LOG</key>
39-    <string>/Users/administrator/Library/Logs/coding-workflow-runner.log</string>
40:    <key>CODING_WF_AUTOMERGE</key>
41-    <string>0</string>
42-  </dict>
```

### E-2
对应: I-2
verdict: PASS
```command
env -u CODING_WF_AUTOMERGE bash packages/brain/scripts/coding-workflow/runner/install.sh --dry-run 2>&1 | grep -c AUTOMERGE
```
```output
0
```

### E-3
对应: I-3
verdict: PASS
```command
cd packages/brain && ls vitest.config.* 2>/dev/null; npx vitest run scripts/coding-workflow/runner/__tests__ 2>&1 | tail -25
```
```output
 ✓ scripts/coding-workflow/runner/__tests__/run-once.test.mjs  (19 tests) 6420ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs  (11 tests) 2626ms
 ✓ scripts/coding-workflow/runner/__tests__/install.test.mjs  (9 tests) 199ms
 ✓ scripts/coding-workflow/runner/__tests__/plan.test.mjs  (13 tests) 2ms
 ✓ scripts/coding-workflow/runner/__tests__/runner-sh.test.mjs  (6 tests) 1270ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-retention.test.mjs  (3 tests) 717ms

 Test Files  6 passed (6)
      Tests  61 passed (61)
```

### E-4
对应: I-3
verdict: PASS
```command
cd packages/brain/scripts/coding-workflow/runner/__tests__ && ls; grep -n "AUTOMERGE" install.test.mjs | head -20; cd /Users/administrator/worktrees/cecelia-cw/cw-c954ebfd && node --test packages/brain/scripts/coding-workflow/runner/__tests__/*.test.mjs 2>&1 | tail -15
```
```output
94:  it('设置 CODING_WF_AUTOMERGE=0：写进 plist 的 EnvironmentVariables，且 plist 合法', () => {
95:    const r = runInstall(['--dry-run'], { ...env, CODING_WF_AUTOMERGE: '0' });
124:  it('未设置 CODING_WF_AUTOMERGE：plist 不出现该键，也不留占位或空行', () => {
130:    expect(plist).not.toContain('CODING_WF_AUTOMERGE');
```
