/* eslint-disable no-undef */ // Node ESM 全局(process/fetch/console/AbortSignal)
// A 道执行器 — 已批准 Contract 后,把活跑到 PR(开 PR 即止,不自管合并)。
//
// 职责边界(与 main 裁决一致):
//   runALane 只负责「跑到开 PR」并返回真实 PR 句柄。
//   CI 监控 + 低风险自动合并交给接力链下一棒 engine-pr-watchdog;
//   「低风险」边界判定归 conductor 分诊层(见 conductor.mjs),本文件不实现合并。
//
// 两态:
//   dry-run(默认): 只按 Contract 打印 4 步计划,不发一条外部命令、不开 PR。demo 天然走这条,安全。
//   live(opts.dryRun===false 或 env ALANE_LIVE=1): 真起 A 道——
//     engine-worktree(独立 worktree+cp-* 分支)
//       → TDD(commit1 失败测试 Red / commit2 实现 Green,棘轮: Red 必先于 Green)
//       → push → gh pr create → 解析真实 PR URL。
//   绝不在 main 直接提交;所有 git 变更命令都带 worktree cwd。
//
// 外部命令(git / gh / worktree-manage.sh)全部走可注入的 exec runner,
// 默认包一层 execFileSync(同步、捕获 stdout);测试注入假 runner,不真跑。

import { execFileSync } from 'node:child_process';
import path from 'node:path';

// 默认 runner: 同步执行,返回 trim 后的 stdout。失败抛错(冒泡给调用方)。
function defaultExec(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

// worktree-manage.sh 末行 echo 出 worktree 路径,从输出里捞最后一个 worktrees 绝对路径。
function parseWorktreePath(out) {
  const lines = String(out).split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/(\/[^\s]+\/worktrees\/[^\s]+)/);
    if (m) return m[1];
  }
  // 兜底: 末行若本身是绝对路径
  const last = lines[lines.length - 1] || '';
  return last.startsWith('/') ? last : '';
}

// gh pr create 输出里捞 PR URL。
function parsePrUrl(out) {
  const m = String(out).match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
  return m ? m[0] : '';
}

// 安全的 task 名 → worktree slug(worktree-manage.sh 用它拼分支/路径)。
function taskSlug(task) {
  const raw = task.id || task.title || 'alane-task';
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}

// dry-run 计划(4 步): 给 demo / 看效果用,不真跑。
function planSteps(task, contract) {
  return [
    `① engine-worktree: 为「${task.title}」建独立 worktree + cp-* 分支(隔离在前)`,
    `② TDD commit1(Red): 写失败测试 ${contract.tests.join('; ')}`,
    `③ TDD commit2(Green): 实现 ${contract.files.join(', ')}`,
    `④ push → 开 PR(gh pr create);开完交 engine-pr-watchdog 盯 CI,低风险合并归 conductor 判`,
  ];
}

/**
 * 跑一条 A 道。
 * @param {{id?:string,title:string}} task
 * @param {{approach:string,files:string[],tests:string[],risk:string}} contract  已批准 Contract
 * @param {{exec?:Function,dryRun?:boolean,repoRoot?:string}} [opts]
 * @returns {{pr:string,status:string,steps?:string[],branch?:string,worktree?:string}}
 */
export function runALane(task, contract, opts = {}) {
  const exec = opts.exec || defaultExec;
  // DRY_RUN 守护: 默认 dry-run。显式 dryRun:false 或 env ALANE_LIVE=1 才真跑。
  const live = opts.dryRun === false || process.env.ALANE_LIVE === '1';
  const steps = planSteps(task, contract);

  if (!live) {
    console.log(`   ▸ A道[dry-run] 据已批准 Contract(${contract.approach.slice(0, 30)}…),将执行:`);
    steps.forEach((s) => console.log(`     ${s}`));
    return { pr: '<dry-run: 未开 PR>', status: 'dry-run', steps };
  }

  // ── live: 真起 A 道 ───────────────────────────────────────────────
  const repoRoot = opts.repoRoot || process.cwd();
  const wtScript = path.join(repoRoot, 'packages/engine/skills/dev/scripts/worktree-manage.sh');
  const slug = taskSlug(task);

  // ① engine-worktree: 建独立 worktree + cp-* 分支(在主仓库跑,解析它 echo 的路径)
  const wtOut = exec('bash', [wtScript, 'init-or-check', slug], { cwd: repoRoot });
  const worktree = parseWorktreePath(wtOut);
  if (!worktree) throw new Error(`worktree-manage.sh 未输出可解析的 worktree 路径:\n${wtOut}`);

  // 拿到该 worktree 当前分支(cp-*),后续所有 git 操作都在 worktree cwd 内进行
  const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktree });
  if (!/^cp-/.test(branch)) throw new Error(`worktree 分支非 cp-*(拒绝在 main 操作): ${branch}`);

  // ② TDD commit1(Red): 失败测试先落地。实现产物由 fresh-context worker 写进 worktree;
  //    本执行器负责编排 + 跑命令 + 守棘轮(Red commit 必须先于 Green commit)。
  exec('git', ['add', '-A'], { cwd: worktree });
  exec('git', ['commit', '-m', `test: ${task.title} 失败测试(Red)`], { cwd: worktree });

  // ③ TDD commit2(Green): 实现,让测试转绿。
  exec('git', ['add', '-A'], { cwd: worktree });
  exec('git', ['commit', '-m', `feat: ${task.title} 实现(Green)`], { cwd: worktree });

  // ④ push 当前 cp-* 分支 → gh pr create 开 PR
  exec('git', ['push', '-u', 'origin', branch], { cwd: worktree });
  const prOut = exec(
    'gh',
    ['pr', 'create', '--fill', '--head', branch, '--title', `feat: ${task.title}`],
    { cwd: worktree },
  );
  const pr = parsePrUrl(prOut) || prOut;

  return { pr, status: 'opened', branch, worktree, steps };
}
