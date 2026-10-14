// QA 回归 smoke 固化（审计 #9，决策 c8621227 / b8030661 / 4fe863c3）：从 qa-gate.mjs 拆出（C6）。
// 裁判 PASS 后把 PASS 的 API 命令逐条在预览上预跑，跑通的固化成本仓 smoke 并登记。目录与登记文件、碰生产口径按仓库
// （repos.json qa_smoke / production_re，经 cfg.repoProfile）；本仓不固化（qa_smoke=null，zenithjoy 第一阶段）只记 smoke_note。
import fs from 'node:fs';
import path from 'node:path';
import { run, git } from './proc.mjs';
import { buildQaSmoke, selectQaSmokeItems, registerSmoke } from '../../lib/qa-smoke.mjs';
import { productionMatchers } from '../../lib/qa-report.mjs';
import { touchesApiSurface, onlyMarkdownFiles } from '../../lib/pr-kind.mjs';
import { qaSmokeOf, productionPatterns } from '../../lib/repo-profile.mjs';
import { isRecordFile } from './qa-records.mjs';

const PREFLIGHT_TIMEOUT_MS = 60 * 1000;

/** 未固化的 PASS 条目及原因（other_port / local_path / production / browser / not_preview / preflight_failed:退出码），拼进 smoke_note。 */
const skippedNote = (skipped = []) => (skipped.length ? `；剔除 ${skipped.map((x) => `${x.id}(${x.reason})`).join(',')}` : '');

/**
 * 固化前逐条预跑（C2b）：每个 T-n 单独用 bash 跑一遍（BRAIN_URL=预览地址、SMOKE_ALLOW_WRITE=1，60s 超时），
 * 返回跑不通的 [{ id, reason: 'preflight_failed:<退出码|timeout>' }]。预览地址指向生产（production：本仓口径片段，缺省默认仓）→ 一条都不跑，全部剔除。
 */
export async function preflightSmoke(worktree, smoke, previewUrl, production = null) {
  const origin = String(previewUrl ?? '').replace(/\/+$/, '');
  if (productionMatchers(production).target.test(origin)) return smoke.commands.map((c) => ({ id: c.id, reason: 'preflight_failed:production_target' }));
  const failed = [];
  for (const c of smoke.commands) {
    const r = await run('bash', ['-c', `set -euo pipefail\n${c.command}`], {
      cwd: worktree, env: { BRAIN_URL: origin, SMOKE_ALLOW_WRITE: '1' }, timeoutMs: PREFLIGHT_TIMEOUT_MS,
    });
    if (r.code !== 0) failed.push({ id: c.id, reason: `preflight_failed:${r.timedOut ? 'timeout' : r.code ?? 'spawn'}` });
  }
  return failed;
}

/** PR 相对 main 改了 API 面没有；diff 取不到按「改了」算（不默认放行）。 */
export async function prTouchesApi(worktree) {
  const r = await git(worktree, ['diff', '--name-only', 'origin/main...HEAD']);
  return r.code !== 0 || touchesApiSurface(r.stdout.split('\n').filter(Boolean));
}

/** 只有提交与现场均证明为普通 Markdown 才跳过固化；任一未知沿用原固化/缺失门。 */
async function prOnlyMarkdown(worktree, branch) {
  try {
    const base = await git(worktree, ['merge-base', 'origin/main', 'HEAD']);
    if (base.code !== 0 || !/^[a-f0-9]{40}$/.test(base.stdout.trim())) return false;
    const files = new Set();
    const productFiles = new Set();
    let committedProduct = false;
    // 分别检查，防止已提交源码被工作区回退抵消，或暂存源码被未暂存回退抵消。
    for (const refs of [[base.stdout.trim(), 'HEAD'], ['--cached', 'HEAD'], []]) {
      const r = await git(worktree, ['diff', '--raw', '--no-abbrev', '-z', '--no-renames', '--ignore-submodules=none', ...refs]);
      if (r.code !== 0) return false;
      const entries = r.stdout.split('\0');
      if (entries.pop() !== '') return false;
      for (let i = 0; i < entries.length; i += 2) {
        // 不允许可执行文件、symlink、submodule、冲突或未知 raw 结构伪装成 .md。
        const file = entries[i + 1];
        if (!/^:(?:100644|000000) (?:100644|000000) [a-f0-9]+ [a-f0-9]+ [AMD]$/.test(entries[i]) || typeof file !== 'string') return false;
        files.add(file);
        if (!isRecordFile(file, branch)) {
          productFiles.add(file);
          if (refs[0] === base.stdout.trim()) committedProduct = true;
        }
      }
    }
    const untracked = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
    if (untracked.code !== 0) return false;
    const extra = untracked.stdout.split('\0');
    if (extra.pop() !== '') return false;
    for (const file of extra) { files.add(file); if (!isRecordFile(file, branch)) productFiles.add(file); }
    if (!committedProduct || !onlyMarkdownFiles([...productFiles])) return false;
    for (const file of files) {
      try {
        const stat = fs.lstatSync(path.join(worktree, file));
        if (!stat.isFile() || (stat.mode & 0o111)) return false;
      } catch (error) {
        if (error.code !== 'ENOENT' || extra.includes(file)) return false;
      }
    }
    return true;
  } catch { return false; }
}

/**
 * QA 与裁判都通过：把 PASS 的 T-n API 命令逐条在预览上预跑，跑通的固化成回归 smoke 并登记（审计 #9，决策 c8621227），
 * 返回要随 QA 记录一并提交的路径；没有可固化的条目返回 []。
 * 结果写进 s.smoke / s.smoke_note（决策 b8030661）：没有可固化命令时保留分支上已有版本（不删不改），说明哪轮保留哪版。
 * 一条都没固化、分支上也没有前轮版本、QA 有 PASS 的 API 条目且 PR 改了 API 面 → s.smoke_missing（afterJudge 据此升级，决策 4fe863c3）。
 */
export async function solidifyQa(ctx, pr, s, round, worktree, intent, reportFile, previewUrl) {
  delete s.smoke_missing;
  delete s.smoke_gap;
  const paths = qaSmokeOf(ctx.cfg.repoProfile);
  if (!paths) {
    s.smoke_note = `本仓不固化回归 smoke（repos.json qa_smoke=null，第 ${round} 轮）`;
    return [];
  }
  if (await prOnlyMarkdown(worktree, pr.headRefName)) {
    s.smoke_note = `第 ${round} 轮产品仅普通纯 Markdown 文档改动，不固化 API 回归 smoke（按本任务既有 QA 记录规则分类；预览 health 验收不扩大任务范围）`;
    return [];
  }
  const file = `${paths.dir}/cw-${String(intent.taskId).slice(0, 8)}-qa-smoke.sh`;
  try {
    const args = { taskId: intent.taskId, previewUrl, reportText: fs.readFileSync(path.join(worktree, intent.sprintDir, reportFile), 'utf8') };
    const first = buildQaSmoke(args);
    const failed = first ? await preflightSmoke(worktree, first, previewUrl, productionPatterns(ctx.cfg.repoProfile)) : [];
    if (failed.length) ctx.log(`QA 门 PR #${pr.number}：预跑失败剔除 ${failed.map((x) => `${x.id}(${x.reason})`).join(',')}`);
    const preflight = first ? `；预跑 ${first.items.length} 条通过 ${first.items.length - failed.length} 条` : '';
    const smoke = failed.length ? buildQaSmoke({ ...args, exclude: failed }) : first;
    if (!smoke) {
      const { skipped, api } = selectQaSmokeItems({ ...args, exclude: failed });
      const why = `${preflight}${skippedNote(skipped)}`;
      ctx.log(`QA 门 PR #${pr.number}：QA 报告里没有可固化（预跑通过）的 API 验收命令，不生成回归 smoke${why}`);
      const kept = fs.existsSync(path.join(worktree, file));
      s.smoke_note = (kept
        ? `第 ${round} 轮 QA 报告无可固化的 API 验收命令，保留第 ${s.smoke?.round ?? '?'} 轮版本 ${file}`
        : `本任务无回归 smoke（第 ${round} 轮 QA 报告无可固化的 API 验收命令）`) + why;
      if (!kept && api.length > 0 && await prTouchesApi(worktree)) {
        s.smoke_missing = true;
        s.smoke_gap = { round, api_items: api, skipped };
      }
      return [];
    }
    const changed = registerSmoke(worktree, smoke, paths);
    s.smoke = { round, file, items: smoke.items, at: new Date().toISOString() };
    s.smoke_note = `第 ${round} 轮固化 ${file}（${smoke.items.join(',')}）${preflight}${skippedNote(smoke.skipped)}`;
    ctx.log(`QA 门 PR #${pr.number}：验收命令 ${smoke.items.join(',')} 固化为 ${smoke.name}（登记 allowlist${smoke.writes ? ' + write-targets' : ''}）`);
    return changed;
  } catch (error) {
    s.smoke_note = `第 ${round} 轮固化回归 smoke 失败：${error?.message || error}`;
    ctx.log(`QA 门 PR #${pr.number}：固化回归 smoke 失败：${error?.message || error}`);
    return [];
  }
}
