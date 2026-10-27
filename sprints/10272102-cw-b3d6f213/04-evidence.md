---
task_id: b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5", "01-intent.md#I-6", "01-intent.md#I-7", "01-intent.md#I-8", "01-intent.md#I-9"]
---

### E-1
对应: I-1
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/intent.test.mjs  (42 tests) 1678ms
 ✓ scripts/coding-workflow/__tests__/authority-refs.test.mjs  (4 tests) 1313ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-2
对应: I-1
verdict: PASS
```command
sed -n '55,90p' packages/brain/scripts/coding-workflow/lib/intent.mjs
```
```output
/** 渲染 01-intent.md：frontmatter + 标题 + 可选 `## 背景`（task.description）+ 每条 `### I-n`。 */
export function renderIntent({ taskId, title, items, description, authorityFacts = undefined }) {
  const heading = squash(title ?? '') || String(taskId);
  const lines = ['---', `task_id: ${taskId}`, 'step: intent', 'upstream: []', '---', `# ${heading}`, ''];
  const background = typeof description === 'string' ? description.trim() : '';
  if (background) lines.push('## 背景', '', escapeAnchors(background), '');
  if (authorityFacts === null) lines.push('## 旧资料引用事实', '', 'legacy/unconfigured：旧任务未声明权威资料，保留原有要求的未知状态。', '');
  else if (authorityFacts !== undefined) {
    lines.push('## 旧资料引用事实', '');
    for (const fact of authorityFacts) {
      lines.push(`- object_id: ${fact.object_id}`, `  ref_id: ${fact.ref_id}`, `  kind: ${fact.kind}`,
        `  path: ${fact.path}`, `  revision: ${fact.revision}`, `  digest: ${fact.actual_digest ?? fact.digest}`,
        `  required: ${fact.required}`, `  status: ${fact.status}`, `  reason: ${fact.reason ?? ''}`);
    }
    lines.push('');
  }
  items.forEach((item, i) => {
    lines.push(`### I-${i + 1}`, item, '');
  });
  return `${lines.join('\n')}`;
}
```

### E-3
对应: I-2
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/authority-refs.test.mjs  (4 tests) 1313ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-4
对应: I-3
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs  (46 tests) 2522ms
 ✓ scripts/coding-workflow/__tests__/intent.test.mjs  (42 tests) 1678ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-5
对应: I-4
verdict: PASS
```command
sed -n '150,230p' packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs
```
```output
  it('受管任务按固定 Git commit 写引用事实与文件摘要', async () => {
    initCommittableRepo(worktree, path.join(worktree, '.hooks'));
    git(worktree, 'remote', 'add', 'origin', 'https://www.github.com/perfectuser21/cecelia.git');
    fs.writeFileSync(path.join(worktree, 'rule.md'), '原规则\n');
    fs.mkdirSync(path.join(worktree, 'docs/registry'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'docs/registry/coding-workflow-authority.json'), JSON.stringify({
      object_id: 'coding-workflow', refs: ['spec', 'rule', 'sample', 'implementation'].map((kind) => ({ ref_id: kind, kind, path: 'rule.md', required: true })),
    }));
    git(worktree, 'add', '.'); git(worktree, 'commit', '-qm', 'rule');
    const revision = git(worktree, 'rev-parse', 'HEAD').trim();
    const trusted = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-trusted-'));
    git(worktree, 'clone', '-q', worktree, trusted);
    git(trusted, 'update-ref', 'refs/remotes/origin/main', revision);
    const authority = { object_id: 'coding-workflow', refs: ['spec', 'rule', 'sample', 'implementation'].map((kind) => ({ ref_id: kind, kind, path: 'rule.md', revision,
      digest: crypto.createHash('sha256').update('原规则\n').digest('hex'), required: true })) };
    reply.body = { id: TASK_ID, title: '受管', description: '背景', payload: { acceptance: ['A'], authority_required: true, authority, base_sha: revision, repo: 'cecelia' } };
    const r = await runActivityProcess(ENTRY, input({ authority, authority_required: true, initial_base_sha: revision,
      trusted_repo: trusted, authority_index_sha: revision }));
    expect(r.exitCode, r.stderr).toBe(0);
    const md = fs.readFileSync(intentFile(), 'utf8');
    expect(md).toContain('## 旧资料引用事实');
    expect(md).toContain(`revision: ${revision}`);
    expect(md).toContain('status: found');
    expect(md).toContain('### I-1\nA');
    expect(r.result.outputs.intent_sha256).toBe(crypto.createHash('sha256').update(md).digest('hex'));
    fs.rmSync(trusted, { recursive: true, force: true });
  });
```

### E-6
对应: I-4
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/intent.test.mjs  (42 tests) 1678ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-7
对应: I-5
verdict: PASS
```command
node -e 'const r=require("/Users/administrator/.cecelia/coding-workflow-runner/0c7aa78f-c899-4210-b42e-7be31d0eef18.json"); const a=r.activities.find(x=>x.key==="build").attempts[0].transport.stderr.split("\n").flatMap(x=>{try{return [JSON.parse(x)]}catch{return []}}); for(const n of [94,96]) {const i=a.filter(x=>x.item?.id==="item_"+n).at(-1)?.item; console.log("item_"+n,"exit="+i.exit_code); for(const line of i.aggregated_output.split("\n").filter(x=>/expected|Received|authority_non_regular_file|authority_file_missing|Tests  |Test Files /.test(x))) console.log(line)}'
```
```output
item_94 exit=1
     → expected 'authority_file_missing' to be 'authority_non_regular_file' // Object.is equality
AssertionError: expected 'authority_file_missing' to be 'authority_non_regular_file' // Object.is equality
+ Received
- authority_non_regular_file
+ authority_file_missing
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
item_96 exit=0
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### E-8
对应: I-5
verdict: PASS
```command
shasum -a 256 /Users/administrator/.cecelia/coding-workflow-runner/0c7aa78f-c899-4210-b42e-7be31d0eef18.json
```
```output
1d989c24cd8d7e69e1e567e7380726decda006b0fa780af4f93f81180aa4c37a  /Users/administrator/.cecelia/coding-workflow-runner/0c7aa78f-c899-4210-b42e-7be31d0eef18.json
```

### E-9
对应: I-5
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs  (46 tests) 2522ms
 ✓ scripts/coding-workflow/__tests__/intent.test.mjs  (42 tests) 1678ms
 ✓ scripts/coding-workflow/__tests__/protocol.test.mjs  (47 tests) 114ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-10
对应: I-6
verdict: PASS
```command
sed -n '90,175p' packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs
```
```output
  it('真实 CLI 在建单前按可信清单拒绝 package.json 路径替换', async () => {
    const { clone, authority } = managedFixture(dir);
    fs.writeFileSync(path.join(clone, 'package.json'), '{}');
    git(clone, 'add', 'package.json'); git(clone, 'commit', '-qm', 'trusted package');
    const revision = git(clone, 'rev-parse', 'HEAD').trim();
    git(clone, 'update-ref', 'refs/remotes/origin/main', revision);
    const digest = crypto.createHash('sha256').update('{}').digest('hex');
    const replaced = { ...authority, refs: authority.refs.map((ref) => ({ ...ref, path: 'package.json', revision, digest })) };
    const r = await runScript([plan({ title: '路径替换', acceptance: ['A'], object_id: replaced.object_id,
      authority_refs: replaced.refs }), '--dry-run'], { CODING_WF_TRUSTED_REPO: clone });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('authority_path_mismatch');
    expect(r.stdout).toBe('');
  });
```

### E-11
对应: I-6
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs  (46 tests) 2522ms
 ✓ scripts/coding-workflow/__tests__/authority-refs.test.mjs  (4 tests) 1313ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-12
对应: I-7
verdict: PASS
```command
sed -n '115,140p' packages/brain/scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs
```
```output
  it('Brain 里已有运行结果（result.coding_workflow 等）而本机无痕迹：不认领该条，继续下一条', async () => {
    brain = await startFakeBrain({
      tasks: [
        codingTask(T1, { created_at: '2026-10-08T00:00:00.000Z', result: { coding_workflow: { pr_url: PR } } }),
        codingTask(T2, { created_at: '2026-10-08T01:00:00.000Z', result: { runner: { host: 'x' }, other: 1 } }),
        codingTask('ccccccc3-0000-4000-8000-000000000003', { created_at: '2026-10-08T02:00:00.000Z', result: { coding_workflow_runner: { reason_code: 'x' } } }),
        codingTask('ddddddd4-0000-4000-8000-000000000004', { created_at: '2026-10-08T03:00:00.000Z', result: { unrelated: true, coding_workflow: {} } }),
      ],
    });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_AUTOMERGE: '0' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(claims().map((c) => c.path)).toEqual(['/api/brain/tasks/ddddddd4-0000-4000-8000-000000000004/claim']);
    expect(r.stderr).toContain(T1);
  }, 30000);
```

### E-13
对应: I-7
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/runner/__tests__/run-once.test.mjs  (28 tests) 16796ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs  (11 tests) 4912ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-14
对应: I-8
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/__tests__/brain-transport.test.mjs  (11 tests) 435ms
 ✓ scripts/coding-workflow/__tests__/authority-refs.test.mjs  (4 tests) 1313ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
```

### E-15
对应: I-8
verdict: PASS
```command
sed -n '1,105p' packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs
```
```output
// 测试专用：默认真实 HTTP；隔离验证可显式选择 Node 子进程 IPC。
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 1024 * 1024;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const PRELOAD = new URL('../fixtures/brain-fetch-preload.mjs', import.meta.url);
const namespace = 'coding-test-brain-v1';

export async function startTestBrain(handler) {
  if (typeof handler !== 'function') throw new TypeError('test_brain_handler_required');
  const mode = process.env.CODING_WF_TEST_TRANSPORT ?? 'http';
  if (!['http', 'ipc'].includes(mode)) throw new Error('test_brain_transport_invalid');
  if (mode === 'http') {
    const server = http.createServer(async (req, res) => {
```

### E-16
对应: I-9
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 ✓ scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs  (5 tests) 4097ms
 Test Files  8 passed (8)
      Tests  194 passed (194)
   Duration  32.83s (transform 42ms, setup 173ms, collect 65ms, tests 31.87s, environment 0ms, prepare 156ms)
```

### E-17
对应: I-9
verdict: PASS
```command
sed -n '1,125p' packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs
```
```output
it('真实PID/PPID登记可枚举并清理忽略TERM的独立进程组',async()=>{
  const f=await fixture();try{
    expect(f.m.ownedChildren(process.pid,f.env)).toEqual([f.child.pid]);
    f.child.kill('SIGTERM');expect(f.m.ownedChildren(process.pid,f.env)).toEqual([f.child.pid]);
    await f.m.cleanupOwnedProcesses(f.env);
    expect(()=>process.kill(f.child.pid,0)).toThrow();
  }finally{await f.clean();}
});
it('错误凭据、坏登记、未知父节点明确报错，无宿主枚举回退',async()=>{
  const f=await fixture();try{
    expect(()=>f.m.ownedChildren(process.pid,{...f.env,CW_TEST_PROCESS_KEY:'bad'})).toThrow(/registry/);
    expect(()=>f.m.ownedChildren(1,f.env)).toThrow(/unknown/);
```

### E-18
对应: I-2
verdict: PASS
```command
sed -n '1,145p' packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
```
```output
  it('同路径两个 commit 读取各自原字节，拒绝坏摘要和 symlink', async () => {
    const { resolveAuthority } = await import('../lib/authority-refs.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-authority-'));
    try {
      initCommittableRepo(root, path.join(root, '.hooks'));
      fs.writeFileSync(path.join(root, 'rule.md'), Buffer.from([0, 255, 10]));
      git(root, 'add', 'rule.md'); git(root, 'commit', '-qm', 'first');
      const a = git(root, 'rev-parse', 'HEAD').trim();
      fs.writeFileSync(path.join(root, 'rule.md'), Buffer.from([1, 254, 10]));
      git(root, 'commit', '-qam', 'second');
      const b = git(root, 'rev-parse', 'HEAD').trim();
      const ref = (revision, digest) => ({ ref_id: 'rule', kind: 'rule', path: 'rule.md', revision, digest, required: true });
      expect(resolveAuthority(root, [ref(a, sha(Buffer.from([0,255,10])) )])[0]).toMatchObject({ status: 'found', digest: sha(Buffer.from([0,255,10])) });
      expect(resolveAuthority(root, [ref(b, sha(Buffer.from([1,254,10])) )])[0].status).toBe('found');
      expect(resolveAuthority(root, [ref(a, '0'.repeat(64))])[0].reason).toBe('authority_digest_mismatch');
```

### E-19
对应: I-7
verdict: PASS
```command
sed -n '365,440p' packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs
```
```output
  it('失败路径：回执 partial/verify 失败 → PATCH failed 含 failed_activity/reason_code，worktree 保留', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { FAKE_EXEC_MODE: 'failed' }));
    expect(r.exitCode, r.stderr).toBe(1);
    expect(brain.patches.map((p) => p.body.status)).toEqual(['in_progress', 'failed']);
    const info = brain.patches[1].body.result.coding_workflow_runner;
    expect(info.pr_url).toBeUndefined();
    expect(info).toEqual({
      status: 'partial',
      failed_activity: 'verify',
      reason_code: 'verification_failed',
      receipt_path: path.join(sb.logDir, `${T1}.json`),
      host: os.hostname(),
    });
    const [{ envelope: { input: { worktree } } }] = readJsonLines(sb.execLog);
    expect(fs.existsSync(worktree)).toBe(true);
    expect(readJsonLines(sb.ghLog)).toEqual([]);
  }, 30000);
```

### E-20
对应: I-9
verdict: PASS
```command
sed -n '365,440p' packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs
```
```output
  it('执行器超时 → 按进程树杀掉执行器及独立进程组的全部后代（忽略 SIGTERM 的也不留），PATCH failed executor_timeout', async () => {
    brain = await startFakeBrain({ tasks: [codingTask(T1)] });
    const treePids = path.join(sb.root, 'tree.pids');
    const owned = createOwnedRegistry(sb.root);
    const mode = process.env.CODING_WF_TEST_PROCESS_ENUM;
    if (mode !== undefined && mode !== 'owned') throw Error('test_process_enum_invalid');
    const enumeration = mode === 'owned' ? installOwnedPgrep(sb.root, owned) : {};
    try {
      const started = Date.now();
      const r = await runOnceProcess(runnerEnv(sb, brain.url, {
        ...owned, ...enumeration,
        CW_TEST_PROCESS_MODULE: new URL('./helpers/owned-processes.mjs', import.meta.url).href,
        FAKE_EXEC_MODE: 'hang-tree',
        FAKE_EXEC_TREE_PIDS: treePids,
        CODING_WF_RUN_TIMEOUT_MS: '1500',
        CODING_WF_KILL_GRACE_MS: '300',
      }));
      expect(r.exitCode, r.stderr).toBe(1);
      expect(Date.now() - started).toBeLessThan(20000);
      const last = brain.patches.at(-1).body;
      expect(last.status).toBe('failed');
      expect(last.result.coding_workflow_runner.reason_code).toBe('executor_timeout');
      const pids = fs.readFileSync(treePids, 'utf8').trim().split('\n').map(Number);
      expect(pids).toHaveLength(2);
      for (const pid of pids) await expectGone(pid, `后代进程 ${pid}`, { cleanup: false });
    } finally { await cleanupOwnedProcesses(owned); }
  }, 30000);
```
