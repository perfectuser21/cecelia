# Contract DoD — watchdog-gh-compat

## Sprint
07162330-watchdog-gh-compat

## DoD 条目

### [BEHAVIOR] B1 — 老版 gh `--json` 报错时不保守跳过，走 pr view 路径并正确判定 CI 红

**验收断言**：
- `execFn` 对 `gh pr checks "${url}" --json state` 抛出 `Error('unknown flag: --json')` 且 `err.stdout = ''`
- `execFn` 对 `gh pr view "${url}" --json statusCheckRollup,mergeStateStatus` 返回 `{"statusCheckRollup":[{"state":"FAILURE"}],"mergeStateStatus":"DIRTY"}`
- 调用 `resumeStalledRelayRuns` 后 `out.resumed === 1`（触发重点火，不再保守跳过）

```bash
# manual:bash — 修复后执行此命令验证 B1
cd /workspace/packages/brain && node -e "
import { resumeStalledRelayRuns } from './src/harness-relay-watchdog.js';
const mockTask = { id: 'test-task-id', status: 'in_progress', payload: { orchestrator: 'skill-relay' }, pr_url: null, title: 'test' };
const mockPool = {
  query: async (sql, params) => {
    if (sql.includes('SELECT DISTINCT')) return { rows: [{ initiative_id: 'test-task-id', phase: 'running', pr_url: 'https://github.com/perfectuser21/cecelia/pull/999', orchestrator_host: 'skill-relay-session', attempts: 1, deadline_at: null, started_at: new Date().toISOString(), completed_at: null, tmux_killed_at: null }] };
    if (sql.includes('SELECT id, status')) return { rows: [mockTask] };
    return { rows: [] };
  }
};
const callLog = [];
const mockExecFn = (cmd) => {
  callLog.push(cmd);
  if (cmd.includes('gh pr view') && cmd.includes('statusCheckRollup')) {
    return JSON.stringify({ statusCheckRollup: [{ state: 'FAILURE' }], mergeStateStatus: 'DIRTY' });
  }
  if (cmd.includes('gh pr checks') && cmd.includes('--json')) {
    const err = new Error('unknown flag: --json');
    err.stdout = '';
    throw err;
  }
  if (cmd.includes('gh pr view') && cmd.includes('state')) {
    return JSON.stringify({ state: 'OPEN' });
  }
  if (cmd.includes('docker ps')) return '';
  throw new Error('Unexpected cmd: ' + cmd);
};
const out = await resumeStalledRelayRuns({ pool: mockPool, execFn: mockExecFn, spawnFn: async () => ({ ok: true, containerId: 'test-container' }) });
console.log('resumed:', out.resumed, '— expected: 1');
if (out.resumed !== 1) process.exit(1);
console.log('B1 PASS');
" --input-type=module
```

### [BEHAVIOR] B2 — `_parseBaseRepo` 正确返回 `perfectuser21/zenithjoy-skills`

**验收断言**：
- `_parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills')` 返回 `'perfectuser21/zenithjoy-skills'`
- 不得返回 `null`，不得返回 `'perfectuser21/zenithjoy-workspace'`

```bash
# manual:bash — 修复后执行此命令验证 B2
cd /workspace/packages/brain && node -e "
import { _parseBaseRepo } from './src/harness-relay-watchdog.js';
const result = _parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills');
console.log('result:', result);
if (result !== 'perfectuser21/zenithjoy-skills') {
  console.error('FAIL: expected perfectuser21/zenithjoy-skills, got', result);
  process.exit(1);
}
console.log('B2 PASS');
" --input-type=module
```

### [BEHAVIOR] B3 — `statusCheckRollup` 为空数组时判定 pending，不触发重点火

**验收断言**：
- `execFn` 返回 `{"statusCheckRollup":[],"mergeStateStatus":"CLEAN"}`
- `out.resumed === 0`（保守策略：无检查项 → pending → 不重点火）

```bash
# manual:bash — 修复后执行此命令验证 B3
cd /workspace/packages/brain && node -e "
import { resumeStalledRelayRuns } from './src/harness-relay-watchdog.js';
const mockTask = { id: 'task-b3', status: 'in_progress', payload: { orchestrator: 'skill-relay' }, pr_url: null, title: 'test' };
const mockPool = {
  query: async (sql) => {
    if (sql.includes('SELECT DISTINCT')) return { rows: [{ initiative_id: 'task-b3', phase: 'running', pr_url: 'https://github.com/perfectuser21/cecelia/pull/888', orchestrator_host: 'skill-relay-session', attempts: 1, deadline_at: null, started_at: new Date().toISOString(), completed_at: null, tmux_killed_at: null }] };
    if (sql.includes('SELECT id, status')) return { rows: [mockTask] };
    return { rows: [] };
  }
};
const mockExecFn = (cmd) => {
  if (cmd.includes('gh pr view') && cmd.includes('state')) return JSON.stringify({ state: 'OPEN' });
  if (cmd.includes('gh pr view') && cmd.includes('statusCheckRollup')) return JSON.stringify({ statusCheckRollup: [], mergeStateStatus: 'CLEAN' });
  if (cmd.includes('gh pr checks') && cmd.includes('--json')) { const err = new Error('unknown flag: --json'); err.stdout = ''; throw err; }
  if (cmd.includes('docker ps')) return '';
  throw new Error('Unexpected: ' + cmd);
};
const out = await resumeStalledRelayRuns({ pool: mockPool, execFn: mockExecFn, spawnFn: async () => ({ ok: true }) });
console.log('resumed:', out.resumed, '— expected: 0 (pending, no refire)');
if (out.resumed !== 0) process.exit(1);
console.log('B3 PASS');
" --input-type=module
```

### [BEHAVIOR] B4 — 既有测试全 PASS（回归保护）

**验收断言**：
- `packages/brain/tests/` 下所有现有测试（autonomous-sessions、gate3-sha-account、learnings-task-id-binding、quarantine-no-evidence、slot-allocator-env-respect）全部通过

```bash
# manual:bash — 验证既有测试不回退
cd /workspace/packages/brain && npm test -- --reporter=verbose 2>&1 | tail -20
```

### [BEHAVIOR] B5 — 合同测试文件（failing 先行）存在且 vitest 可识别

**验收断言**：
- 文件 `sprints/07162330-watchdog-gh-compat/tests/harness-relay-watchdog-ghcompat.test.js` 存在
- 修复前执行 `vitest run` 时 B1/B2 对应测试失败（failing state confirmed）

```bash
# manual:bash — 在修复前确认 failing 状态
cd /workspace/packages/brain && npx vitest run /workspace/sprints/07162330-watchdog-gh-compat/tests/harness-relay-watchdog-ghcompat.test.js --reporter=verbose 2>&1 | grep -E "FAIL|PASS|×|✓"
```

## 完成标准总结

| 条目 | 状态 | 验证方式 |
|------|------|----------|
| B1 老版gh报错不保守跳过 | 合同测试 PASS | vitest + manual:bash |
| B2 _parseBaseRepo zenithjoy-skills | 合同测试 PASS | vitest + manual:bash |
| B3 空 statusCheckRollup → pending | 合同测试 PASS | manual:bash |
| B4 既有测试回归 | 全 PASS | npm test |
| B5 failing test 先行 | 测试文件存在 | 文件存在 + 修复前 failing |
