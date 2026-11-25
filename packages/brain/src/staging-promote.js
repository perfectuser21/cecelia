import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// promote_status 状态机取值
export const PROMOTE_STATUS = {
  PENDING_PROMOTE: 'pending_promote', // 等主理人确认
  PROMOTING: 'promoting',             // 回流接口已接受，promote 进行中
  PROMOTED: 'promoted',               // promote 成功
  AUTO_PROMOTED: 'auto_promoted',     // 内部线自动 promote 成功（终态）
  PROMOTE_FAILED: 'promote_failed',   // promote 失败
  NA: 'n_a',                          // verdict≠PASS，不进 promote
};

export const ZENITHJOY_STAGING_RETIRED = 'zenithjoy_staging_retired';

const REPO_ALIAS = /^(?:(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?perfectuser21\/)?(cecelia|zenithjoy(?:-[a-z0-9._-]+)?)(?:\.git)?\/?$/i;
const GITHUB_PR = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/pull\/\d+(?:[/?#]|$)/i;

export function resolveLine(baseRepo) {
  const repo = REPO_ALIAS.exec(String(baseRepo ?? '').trim())?.[1]?.toLowerCase();
  if (repo === 'cecelia') return 'internal';
  if (repo?.startsWith('zenithjoy')) return 'customer';
  return 'unknown';
}

export function resolveStagingLine(payload = {}, resultPrUrl) {
  const { base_repo, baseRepo, pr_url, pr_urls } = payload ?? {};
  const urls = [resultPrUrl, pr_url, ...(Array.isArray(pr_urls) ? pr_urls : [])];
  const repos = [base_repo, baseRepo, ...urls.map(url => GITHUB_PR.exec(String(url ?? ''))?.[1])]
    .filter(repo => typeof repo === 'string' && repo.trim());
  const lines = repos.map(resolveLine);
  if (lines.includes('customer')) return 'customer';
  return lines.length && lines.every(line => line === 'internal') ? 'internal' : 'unknown';
}

export function decidePromote({ verdict, baseRepo }) {
  const line = resolveLine(baseRepo);
  if (verdict !== 'PASS' || line === 'customer') {
    return { action: 'none', promoteStatus: PROMOTE_STATUS.NA, line };
  }
  if (line === 'internal') {
    return { action: 'auto', promoteStatus: PROMOTE_STATUS.AUTO_PROMOTED, line };
  }
  return { action: 'pending', promoteStatus: PROMOTE_STATUS.PENDING_PROMOTE, line };
}

/**
 * 内部线自动 promote。**必须注入 promoteExec**；无注入则 fail-safe 拒绝
 * （防测试/误调误打真生产 :5211 live）。
 * @param {{promoteExec?:Function}} deps  promoteExec() → { ok:boolean, output:string }
 * @returns {Promise<{ok:boolean, promoteStatus:string, output:string}>}
 */
export async function runInternalPromote(deps = {}) {
  const promoteExec = deps.promoteExec;
  if (typeof promoteExec !== 'function') {
    return {
      ok: false,
      promoteStatus: PROMOTE_STATUS.PROMOTE_FAILED,
      output: 'no promoteExec injected (fail-safe: refuse to touch production)',
    };
  }
  try {
    const r = await promoteExec();
    return {
      ok: !!r?.ok,
      promoteStatus: r?.ok ? PROMOTE_STATUS.PROMOTED : PROMOTE_STATUS.PROMOTE_FAILED,
      output: String(r?.output || '').slice(0, 2000),
    };
  } catch (err) {
    return { ok: false, promoteStatus: PROMOTE_STATUS.PROMOTE_FAILED, output: `promote error: ${err.message}` };
  }
}

/**
 * 生产用默认 promoteExec：跑 in-repo scripts/promote-dashboard.sh（内部线 Cecelia dashboard）。
 * 仅由生产调用方注入；测试绝不用此实现。
 *
 * 防自杀：注入 CECELIA_SKIP_BRAIN_PROMOTE=1。promote-dashboard.sh 默认会跑 brain-deploy
 * 重启 Brain 容器，而 harness promote 正在该 Brain 容器内执行——不跳过会把执行它自己的
 * Brain 重启掉，pipeline 自杀。内部线只推 dashboard，无需重建 brain。
 */
export function defaultPromoteExec(repoRoot) {
  return function promoteExec() {
    const script = path.join(repoRoot, 'scripts/promote-dashboard.sh');
    try {
      const output = execFileSync('bash', [script], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CECELIA_SKIP_BRAIN_PROMOTE: '1' },
      });
      return { ok: true, output };
    } catch (err) {
      return { ok: false, output: `${err.message}\n${err.stdout || ''}\n${err.stderr || ''}` };
    }
  };
}

export function getRepoRoot() {
  // P1#3（2026-06-27 审计）：Brain 跑在 docker 容器时文件在 /app/src/，
  // path.resolve(import.meta.url, '../../..') 解析成 '/' → promote 脚本/回档锚点路径全错。
  // 容器 bind-mount 的 repo 根由 env REPO_ROOT 提供 → 优先用它；裸机直跑（无 REPO_ROOT）回退相对解析。
  // 一处修好所有 caller（含 routes/staging.js 的 /promote 放行接口此前裸调的两处）。
  if (process.env.REPO_ROOT) return process.env.REPO_ROOT;
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '../../..');
}
