---
task_id: 5f8029c7-6f55-441a-b7d0-70688ac0cfb9
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5", "01-intent.md#I-6", "01-intent.md#I-7", "01-intent.md#I-8", "01-intent.md#I-9"]
---

### E-1
对应: I-1
verdict: PASS
```command
sed -n '145,204p' packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs
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

### E-2
对应: I-2
verdict: PASS
```command
rg -n 'sha\(Buffer|authority_digest_mismatch|authority_non_regular_file|authority_file_missing|authority_revision_unavailable|authority_path_invalid|authority_source_unsupported' packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
```
```output
84:      expect(resolveAuthority(root, [ref(a, sha(Buffer.from([0,255,10])) )])[0]).toMatchObject({ status: 'found', digest: sha(Buffer.from([0,255,10])) });
85:      expect(resolveAuthority(root, [ref(b, sha(Buffer.from([1,254,10])) )])[0].status).toBe('found');
86:      expect(resolveAuthority(root, [ref(a, '0'.repeat(64))])[0].reason).toBe('authority_digest_mismatch');
89:      expect(resolveAuthority(root, [{ ...ref(git(root, 'rev-parse', 'HEAD').trim(), '0'.repeat(64)), path: 'link.md' }])[0].reason).toBe('authority_non_regular_file');
92:      expect(resolveAuthority(root, [{ ...ref(git(root, 'rev-parse', 'HEAD').trim(), '0'.repeat(64)), path: 'jump/secret.md' }])[0].reason).toBe('authority_non_regular_file');
103:      expect(resolveAuthority(root, [ref])[0].reason).toBe('authority_file_missing');
104:      expect(resolveAuthority(root, [{ ...ref, revision: 'f'.repeat(40) }])[0].reason).toBe('authority_revision_unavailable');
105:      expect(resolveAuthority(root, [{ ...ref, path: '../secret' }])[0].reason).toBe('authority_path_invalid');
106:      expect(resolveAuthority(root, [{ ...ref, path: 'https://example.com/rule' }])[0].reason).toBe('authority_source_unsupported');
```

### E-3
对应: I-3
verdict: PASS
```command
rg -n 'object_id|authority_refs|authority_required|legacy/unconfigured|authority_required_missing|authority_receipt_mismatch' packages/brain/scripts/coding-workflow/new-task.mjs packages/brain/scripts/coding-workflow/activities/intent.mjs packages/brain/scripts/coding-workflow/lib/intent.mjs
```
```output
packages/brain/scripts/coding-workflow/lib/intent.mjs:63:  if (authorityFacts === null) lines.push('## 旧资料引用事实', '', 'legacy/unconfigured：旧任务未声明权威资料，保留原有要求的未知状态。', '');
packages/brain/scripts/coding-workflow/activities/intent.mjs:40:  const managed = task?.payload?.authority_required === true || task?.payload?.authority !== undefined
packages/brain/scripts/coding-workflow/activities/intent.mjs:41:    || task?.payload?.object_id !== undefined || task?.payload?.authority_refs !== undefined
packages/brain/scripts/coding-workflow/activities/intent.mjs:46:    if (task?.payload?.authority_required !== true || input.authority_required !== true
packages/brain/scripts/coding-workflow/activities/intent.mjs:48:      return fail('fatal', 'authority_receipt_mismatch');
packages/brain/scripts/coding-workflow/new-task.mjs:43:    const declaredObject = inherit('object_id');
packages/brain/scripts/coding-workflow/new-task.mjs:44:    const declaredRefs = inherit('authority_refs');
packages/brain/scripts/coding-workflow/new-task.mjs:85:    payload.authority_required = true;
packages/brain/scripts/coding-workflow/new-task.mjs:87:    payload.object_id = t.authority.object_id;
packages/brain/scripts/coding-workflow/new-task.mjs:88:    payload.authority_refs = t.authority.refs;
```

### E-4
对应: I-4
verdict: PASS
```command
sed -n '1,90p' docs/registry/coding-workflow-authority.json
```
```output
{
  "object_id": "coding-workflow",
  "refs": [
    { "ref_id": "spec", "kind": "spec", "path": "packages/brain/scripts/coding-workflow/runner/README.md", "required": true },
    { "ref_id": "rule", "kind": "rule", "path": "packages/brain/scripts/coding-workflow/prompts/repo-rules/cecelia.md", "required": true },
    { "ref_id": "sample", "kind": "sample", "path": "packages/brain/scripts/coding-workflow/__tests__/fixtures/activity-fixture.mjs", "required": true },
    { "ref_id": "implementation", "kind": "implementation", "path": "packages/brain/scripts/coding-workflow/activities/intent.mjs", "required": true }
  ]
}
```

### E-5
对应: I-5
verdict: PASS
```command
git log -9 --format='%h %s' -- packages/brain/scripts/coding-workflow
```
```output
a57d063a9 test(coding): enumerate owned fixture processes without host access
a3c7546ac test(coding): cover owned process enumeration in native sandbox
e56ecc303 test(coding): support isolated runner fixtures over IPC
c77446c95 fix(coding-workflow): run Brain fixtures over explicit IPC in isolated verification
9da00120c test(coding-workflow): cover isolated Brain transport and Git replacement
becf97199 fix(coding-workflow): bind authority refs to trusted index commit
817a465db feat(coding-workflow): bind intent to fixed authority references
efc8576db test(coding-workflow): cover managed intent and runner boundaries
51aa5b2a3 test(coding-workflow): cover fixed authority references and receipts
```

### E-6
对应: I-6
verdict: PASS
```command
rg -n 'authority_path_mismatch|authority_index_untrusted|authority_revision_untrusted|package.json|status === .found.' packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs
```
```output
packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs:109:  it('真实 CLI 在建单前按可信清单拒绝 package.json 路径替换', async () => {
packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs:116:    const replaced = { ...authority, refs: authority.refs.map((ref) => ({ ...ref, path: 'package.json', revision, digest })) };
packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs:120:    expect(r.stderr).toContain('authority_path_mismatch');
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs:31:      expect(resolveAuthority(root, refs, { trustedSha: bound }).every((r) => r.status === 'found')).toBe(true);
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs:32:      const replaced = refs.map((r) => ({ ...r, path: 'package.json', digest: sha('{}') }));
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs:33:      expect(validateAuthority({ object_id: 'coding-workflow', refs: replaced }, index)).toContain('authority_path_mismatch');
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs:39:      expect(() => loadAuthorityIndex(root, forgedSha)).toThrow('authority_index_untrusted');
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs:40:      expect(resolveAuthority(root, refs.map((r) => ({ ...r, revision: forgedSha, digest: sha(`${r.kind} B`) })), { trustedSha: bound })[0].reason).toBe('authority_revision_untrusted');
```

### E-7
对应: I-7
verdict: PASS
```command
sed -n '365,391p' packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs
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

### E-8
对应: I-8
verdict: PASS
```command
rg -n 'TCP|Response.url|重定向|IPC|HTTP' packages/brain/scripts/coding-workflow/runner/README.md packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs
```
```output
packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs:1:// 测试专用：默认真实 HTTP；隔离验证可显式选择 Node 子进程 IPC。
packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs:38:// 显式 IPC 验证不声称测过 TCP；默认命令同时执行 HTTP 与 IPC。
packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs:82:describe('IPC fixture 隔离与退出', () => {
packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs:107:  it('断开IPC令等待请求失败，子进程能退出', async () => {
```

### E-9
对应: I-9
verdict: PASS
```command
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```
```output
 RUN  v1.6.1 /Users/administrator/worktrees/cecelia-cw/cw-5f8029c7/packages/brain

 ✓ scripts/coding-workflow/runner/__tests__/run-once.test.mjs  (28 tests) 16802ms
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs  (46 tests) 2532ms
 ✓ scripts/coding-workflow/__tests__/intent.test.mjs  (42 tests) 1692ms
 ✓ scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs  (11 tests) 4877ms
 ✓ scripts/coding-workflow/__tests__/authority-refs.test.mjs  (4 tests) 1329ms
 ✓ scripts/coding-workflow/__tests__/protocol.test.mjs  (47 tests) 117ms
 ✓ scripts/coding-workflow/__tests__/brain-transport.test.mjs  (11 tests) 433ms
 ✓ scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs  (5 tests) 4024ms

 Test Files  8 passed (8)
      Tests  194 passed (194)
   Start at  08:10:54
   Duration  32.77s (transform 42ms, setup 175ms, collect 64ms, tests 31.81s, environment 0ms, prepare 158ms)
```

### E-10
对应: I-1
verdict: PASS
```command
sed -n '1,230p' packages/brain/scripts/coding-workflow/lib/intent.mjs
```
```output
    for (const fact of authorityFacts) {
      lines.push(`- object_id: ${fact.object_id}`, `  ref_id: ${fact.ref_id}`, `  kind: ${fact.kind}`,
        `  path: ${fact.path}`, `  revision: ${fact.revision}`, `  digest: ${fact.actual_digest ?? fact.digest}`,
        `  required: ${fact.required}`, `  status: ${fact.status}`, `  reason: ${fact.reason ?? ''}`);
    }
```

### E-11
对应: I-4
verdict: PASS
```command
rg -n 'intent_sha256|chain_tampered|01-intent.md|legacy/unconfigured|authorityFacts' packages/brain/scripts/coding-workflow/lib/intent.mjs packages/brain/scripts/coding-workflow/activities/intent.mjs packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs
```
```output
packages/brain/scripts/coding-workflow/lib/intent.mjs:63:  if (authorityFacts === null) lines.push('## 旧资料引用事实', '', 'legacy/unconfigured：旧任务未声明权威资料，保留原有要求的未知状态。', '');
packages/brain/scripts/coding-workflow/activities/intent.mjs:87:  fs.writeFileSync(intentPath, renderIntent({ taskId, title: task?.title, items, description: task?.description, authorityFacts }));
packages/brain/scripts/coding-workflow/activities/intent.mjs:92:    // 验收标准的指纹：后续活动比对，发现被改即 chain_tampered
packages/brain/scripts/coding-workflow/activities/intent.mjs:93:    outputs: { intent_file: INTENT_FILE, intent_ids: items.map((_, i) => `I-${i + 1}`), intent_sha256: sha256File(intentPath) },
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:176:    expect(r.result.outputs.intent_sha256).toBe(crypto.createHash('sha256').update(md).digest('hex'));
```

### E-12
对应: I-7
verdict: PASS
```command
sed -n '118,140p' packages/brain/scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs
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
对应: I-8
verdict: PASS
```command
sed -n '1,220p' packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
```
```output
      git(root, 'replace', original, substitute);
      expect(git(root, 'show', `${original}:rule.md`)).toBe('substituted');
      expect(loadAuthorityIndex(root, original).refs).toEqual(refs);
      expect(resolveAuthority(root, [{ ...refs[0], revision: original, digest: sha('original') }], { trustedSha: original })[0].status).toBe('found');
      expect(resolveAuthority(root, [{ ...refs[0], revision: original, digest: sha('substituted') }], { trustedSha: original })[0].reason).toBe('authority_digest_mismatch');
```

### E-14
对应: I-9
verdict: PASS
```command
pgrep -P 1
```
```output
sysmon request failed with error: sysmond service not found
pgrep: Cannot get process list
```

### E-15
对应: I-9
verdict: PASS
```command
rg -n 'SIGKILL|expectGone|detached|CODING_WF_TEST_PROCESS_ENUM|cleanupOwnedProcesses|installOwnedPgrep' packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs
```
```output
packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs:11:  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {registerOwnedProcess} from ${JSON.stringify(moduleUrl.href)};registerOwnedProcess();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`], {env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:true});
packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs:14:  } catch(error) { child.kill('SIGKILL'); fs.rmSync(root,{recursive:true,force:true}); throw error; }
packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs:15:  return {m,root,env,child,async clean(){await m.cleanupOwnedProcesses(env);fs.rmSync(root,{recursive:true,force:true});}};
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs:9:import { createOwnedRegistry, installOwnedPgrep, cleanupOwnedProcesses } from './helpers/owned-processes.mjs';
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs:10:import { expectGone } from '../../__tests__/helpers/procs.mjs';
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs:417:    const mode = process.env.CODING_WF_TEST_PROCESS_ENUM;
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs:419:    const enumeration = mode === 'owned' ? installOwnedPgrep(sb.root, owned) : {};
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs:437:      for (const pid of pids) await expectGone(pid, `后代进程 ${pid}`, { cleanup: false });
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs:438:    } finally { await cleanupOwnedProcesses(owned); }
```

### E-16
对应: I-5
verdict: PASS
```command
git ls-tree -r --name-only 51aa5b2a3 packages/brain/scripts/coding-workflow/lib/authority-refs.mjs packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
```
```output
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
```

### E-17
对应: I-4
verdict: PASS
```command
git diff 95d3d6b96..HEAD --name-only
```
```output
docs/registry/coding-workflow-authority.json
packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs
packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs
packages/brain/scripts/coding-workflow/__tests__/fixtures/brain-fetch-preload.mjs
packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs
packages/brain/scripts/coding-workflow/__tests__/helpers/procs.mjs
packages/brain/scripts/coding-workflow/__tests__/helpers/run-activity.mjs
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs
packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs
packages/brain/scripts/coding-workflow/activities/intent.mjs
packages/brain/scripts/coding-workflow/lib/authority-refs.mjs
packages/brain/scripts/coding-workflow/lib/intent.mjs
packages/brain/scripts/coding-workflow/new-task.mjs
packages/brain/scripts/coding-workflow/runner/README.md
packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/executor-ipc-preload.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/fake-executor.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/helpers/owned-processes.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs
packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs
packages/brain/scripts/coding-workflow/runner/run-once.mjs
```

### E-18
对应: I-3
verdict: PASS
```command
sed -n '32,102p' packages/brain/scripts/coding-workflow/activities/intent.mjs
```
```output
    authorityFacts = resolveAuthority(input.trusted_repo, authority.refs, { trustedSha: input.authority_index_sha })
      .map((fact) => ({ ...fact, object_id: authority.object_id }));
    const blocked = authorityFacts.find((fact) => fact.required && fact.status !== 'found');
    if (blocked) return fail('fatal', blocked.reason, { evidence: [{ ref_id: blocked.ref_id, path: blocked.path }] });
```
