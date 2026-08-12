import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureHarnessWorktree } from '../harness-worktree.js';

const exec = promisify(execFile);
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))));

async function repo(origin) {
  const root = await mkdtemp(join(tmpdir(), 'harness-recovery-')); roots.push(root);
  await exec('git', ['init', root]); await writeFile(join(root, 'README.md'), 'fixture\n');
  await exec('git', ['-C', root, 'add', 'README.md']);
  await exec('git', ['-C', root, '-c', 'user.name=Harness', '-c', 'user.email=h@example.invalid', 'commit', '-m', 'fixture']);
  await exec('git', ['-C', root, 'remote', 'add', 'origin', origin]); return root;
}
function gitAt(root, canonical) { return async (_cmd, args) => { const a=[...args]; const c=a.indexOf('-C'); if(c>=0&&a[c+1]===canonical&&a.includes('get-url')) return {stdout:`${canonical}\n`,stderr:''}; if(c>=0)a[c+1]=root; return exec('git',a); }; }

describe('harness worktree recovery', () => {
  it('canonicalizes credential-bearing origin', async () => {
    const clean='https://github.com/perfectuser21/cecelia.git'; const root=await repo('https://x-access-token:secret@github.com/perfectuser21/cecelia.git'); let removals=0;
    await ensureHarnessWorktree({taskId:'12345678-x',baseRepo:clean,statFn:async()=>true,execFn:gitAt(root,clean),rmFn:async()=>{removals++},tokenFn:async()=>'',logFn:()=>{},isKernelWorkspaceActive:async()=>false}); expect(removals).toBe(0);
  });
  it('redacts credential-bearing origin logs', async () => {
    const clean='https://github.com/perfectuser21/cecelia.git'; const root=await repo('https://x-access-token:secret@github.com/other/repo.git'); const logs=[];
    await ensureHarnessWorktree({taskId:'12345678-x',baseRepo:clean,statFn:async()=>true,execFn:gitAt(root,clean),rmFn:async()=>{},tokenFn:async()=>'',logFn:x=>logs.push(x),isKernelWorkspaceActive:async()=>false}).catch(()=>{}); expect(logs.join('\n')).not.toContain('x-access-token:'); expect(logs.join('\n')).not.toContain('secret');
  });
  it('protects active detached Kernel workspace', async () => {
    const clean='https://github.com/perfectuser21/cecelia.git'; const root=await repo('https://github.com/other/repo.git'); await exec('git',['-C',root,'checkout','--detach','HEAD']); let removals=0;
    await ensureHarnessWorktree({taskId:'12345678-x',baseRepo:clean,statFn:async()=>true,execFn:gitAt(root,clean),rmFn:async()=>{removals++},tokenFn:async()=>'',logFn:()=>{},isKernelWorkspaceActive:async()=>true}); expect(removals).toBe(0);
  });
});
