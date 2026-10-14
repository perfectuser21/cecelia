// 专用 clone 自更新：只快进，保留运行态文件，不删除或覆盖人的现场。
import fs from 'node:fs';
import path from 'node:path';
import { runtimeProcess } from './runtime-process.mjs';

const runtimePath = p => p === '.cecelia/hb.sh' || /^\.cecelia\/lights\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.live$/.test(p);
const operationFiles = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG'];

export async function updateClone(repo, log, { signal } = {}) {
  const git = async (...args) => {
    const result = await runtimeProcess('git', ['-C', repo, ...args], { signal });
    if (result.code !== 0 || result.terminated || signal?.aborted) throw new Error('git_failed');
    return result.stdout;
  };
  const validate = async () => {
    if ((await git('symbolic-ref', '--short', 'HEAD')).trim() !== 'main') throw new Error('not_main');
    const gitDir = path.resolve(repo, (await git('rev-parse', '--git-dir')).trim());
    if (operationFiles.some(p => fs.existsSync(path.join(gitDir, p)))) throw new Error('git_operation_in_progress');
    const status = await git('status', '--porcelain=v1', '-z', '--untracked-files=all');
    const records = status.split('\0');
    if (records.pop() !== '') throw new Error('invalid_status');
    const runtime = [];
    for (const record of records) {
      if (!record.startsWith('?? ') || !runtimePath(record.slice(3))) throw new Error('dirty');
      runtime.push(record.slice(3));
    }
    return runtime;
  };
  try {
    await validate();
    const before = (await git('rev-parse', 'HEAD')).trim();
    await git('fetch', '-q', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    const target = (await git('rev-parse', 'origin/main')).trim();
    // 本地 ahead 或分叉都不抹掉。即使干净也不允许 hard reset。
    await git('merge-base', '--is-ancestor', before, target);
    const runtime = await validate();
    if ((await git('rev-parse', 'HEAD')).trim() !== before) throw new Error('head_changed');
    const incoming = (await git('ls-tree', '-r', '--name-only', '-z', target)).split('\0').filter(Boolean);
    if (incoming.some(p => runtime.some(r => r === p || r.startsWith(`${p}/`)))) throw new Error('runtime_collision');
    await git('-c', 'merge.autoStash=false', 'merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', target);
    if (before !== target) log(`已自更新到 origin/main ${(await git('rev-parse', '--short', 'HEAD')).trim()}`);
    return true;
  } catch (error) {
    if (error.message === 'runtime_process_cleanup_unverified') throw error;
    // 不打印 git stderr（remote 配置可能带认证）；任何读取失败也按不安全处理。
    log('工作区不干净或不满足安全快进条件，跳过自更新（不破坏现场）');
    return false;
  }
}

// 首次部署旧启动器不能自更新时，安装器在同一外锁/停用周期窗口调用此入口。
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const { strictLock } = await import('./runtime-lock.mjs');
  const control = new AbortController(); const stop = () => control.abort();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  let lock, preserveLock = false;
  try {
    lock = strictLock(process.env.CODING_WF_LOCK_DIR || path.join(process.env.HOME, '.cecelia'));
    if (!lock) throw new Error('runtime_update_runner_busy');
    if (!path.isAbsolute(process.argv[2] || '')) throw new Error('runtime_update_repo_invalid');
    const ok = await updateClone(process.argv[2], message => console.error(message), { signal: control.signal });
    if (!ok || control.signal.aborted) throw new Error('runtime_update_refused');
  } catch (error) {
    preserveLock = error.message === 'runtime_process_cleanup_unverified';
    console.error(/^runtime_/.test(error.message) ? error.message : 'runtime_update_failed'); process.exitCode = 1;
  }
  finally { if (!preserveLock) lock?.release(); process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
