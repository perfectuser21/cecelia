import { execSync } from 'node:child_process';

/**
 * 跨进程 git 状态同步 helper。
 *
 * 场景：proposer/generator 等节点跑在 task container 内，git push origin 后，
 * brain 容器自己的本地 git 库 origin tracking **不会自动更新** —
 * 必须显式 fetch + 用 **正确 refspec** 才能让 git show origin/<branch> 拿到。
 *
 * 关键：git fetch origin <branch> 只更新 FETCH_HEAD，**不更新 refs/remotes/origin/<branch>**。
 * 必须用 git fetch origin <branch>:refs/remotes/origin/<branch> 显式 refspec。
 *
 * @param {string} worktreePath - cwd
 * @param {string} branch - origin 上的分支名
 * @param {string} file - 分支上的文件路径
 * @returns {Promise<string>} 文件内容
 */
export async function fetchAndShowOriginFile(worktreePath, branch, file) {
  // 1. fetch 用显式 refspec 更新 refs/remotes/origin/<branch>
  try {
    execSync(`git fetch origin ${branch}:refs/remotes/origin/${branch}`, {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (fetchErr) {
    console.warn(
      `[git-fence] git fetch origin ${branch} failed: ${(fetchErr.message || '').slice(0, 200)}, continuing to git show (will report specific error)`
    );
  }

  // 2. git show 拿内容；失败抛具体错（show 错最直观）
  return execSync(`git show origin/${branch}:${file}`, {
    cwd: worktreePath,
    encoding: 'utf8',
  });
}
