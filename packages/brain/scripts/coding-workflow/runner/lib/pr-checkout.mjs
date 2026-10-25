// 原运行现场保留同名分支时，后续门禁使用独立Git索引，仍保持真实PR分支身份。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';

const MARKER = 'coding-workflow-pr-checkout.json';
const fail = () => new Error('worktree_add_failed');

export async function addPrCheckout(cfg, branch, worktree) {
  const listed = await git(cfg.repo, ['worktree', 'list', '--porcelain', '-z']);
  if (listed.code !== 0) throw fail();
  const occupied = listed.stdout.split('\0').includes(`branch refs/heads/${branch}`);
  if (!occupied) {
    const added = await git(cfg.repo, ['worktree', 'add', '-B', branch, worktree, `origin/${branch}`]);
    if (added.code !== 0) throw fail();
    return;
  }

  const head = await git(cfg.repo, ['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`]);
  const origin = await git(cfg.repo, ['remote', 'get-url', 'origin']);
  const push = await git(cfg.repo, ['remote', 'get-url', '--push', 'origin']);
  if ([head, origin, push].some(r => r.code !== 0) || !/^[0-9a-f]{40}$/.test(head.stdout.trim())) throw fail();
  // 共享只读对象，独立refs/index；不覆盖、解锁或删除原失败工作树。
  const cloned = await git(cfg.repo, ['clone', '--shared', '--no-checkout', '--no-hardlinks', '--', cfg.repo, worktree]);
  if (cloned.code !== 0) throw fail();
  fs.writeFileSync(path.join(worktree, '.git', MARKER), JSON.stringify({
    schema: 1, repo: fs.realpathSync(cfg.repo), worktree: fs.realpathSync(worktree), branch,
  }), { mode: 0o600, flag: 'wx' });
  const remote = await git(worktree, ['remote', 'set-url', 'origin', origin.stdout.trim()]);
  const pushRemote = await git(worktree, ['remote', 'set-url', '--push', 'origin', push.stdout.trim()]);
  const checked = await git(worktree, ['checkout', '-B', branch, head.stdout.trim()]);
  if ([remote, pushRemote, checked].some(r => r.code !== 0)) throw fail();
}

/** null表示普通linked worktree；独立仓库只有归属及路径全部吻合才清理，绝不删主仓分支。 */
export function removePrCheckout(cfg, worktree, branch) {
  try {
    const gitDir = path.join(worktree, '.git');
    if (!fs.lstatSync(gitDir).isDirectory()) return null;
    if (fs.lstatSync(worktree).isSymbolicLink()) return false;
    const marker = path.join(gitDir, MARKER);
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.size > 8192) return false;
    const record = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (record.schema !== 1 || record.repo !== fs.realpathSync(cfg.repo)
      || record.worktree !== fs.realpathSync(worktree)
      || typeof record.branch !== 'string' || (branch && record.branch !== branch)) return false;
    fs.rmSync(worktree, { recursive: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' && !fs.existsSync(path.join(worktree, '.git'))) return null;
    return false;
  }
}
