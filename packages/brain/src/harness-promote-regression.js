/**
 * harness-promote-regression.js — A3 冻结登记（harness 验证模型重构）。
 *
 * evaluator PASS 后把判官的一次性判断固化成常驻卡片：
 *   ① golden_path 表覆盖写（结构化事实：这条路径已被验收）
 *   ② regression-contract.yaml 追加 golden_paths 条目（读卡机卡片，B1 无条件复跑）
 *   ③ commit 校验拒假卡（引用物必须已被 git 跟踪）
 *
 * yaml schema 对齐 B1 消费方 scripts/ci/run-core-regression.sh（yq 读
 * golden_paths[].id/.trigger[]/.test_command）——不是 A3 方案文档里的 checks[] 数组。
 * yaml 上 main 走本模块自开的 auto-merge PR（reportNode 时 sub-task PR 已全 merge，
 * 没有别的顺风车）。
 *
 * Spec: docs/superpowers/specs/2026-07-02-a3-promote-regression-design.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import yaml from 'js-yaml';
import pool from './db.js';

const defaultExecFile = promisify(nodeExecFile);

// yaml dump 会丢注释头 → 抽成常量重贴（保持与现存文件头一致）
export const CONTRACT_HEADER = `# ============================================================================
# Regression Contract - cecelia-core
# ============================================================================
# 全量回归的唯一合法定义来源
#
# Trigger 规则：
#   - PR:      跑 trigger 包含 PR 的条目
#   - Release: 跑 trigger 包含 Release 的条目
# ============================================================================

`;

/**
 * 解析 contract-dod.md 的 [BEHAVIOR] 条目。
 * 格式：`- [ ] [BEHAVIOR] <desc>` 下一行（允许隔缩进）`Test: manual:<cmd>`。
 * 没有 manual: 命令的条目跳过（不产半卡）。
 * @returns {Array<{desc: string, cmd: string}>}
 */
export function parseBehaviorEntries(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*\[[ x]\]\s*\[BEHAVIOR\]\s*(.+)$/);
    if (!m) continue;
    const desc = m[1].trim();
    // 向下找最近的 Test: manual: 行（下一个 BEHAVIOR 条目前）
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s*\[[ x]\]\s*\[BEHAVIOR\]/.test(lines[j])) break;
      const t = lines[j].match(/^\s*Test:\s*manual:(.+)$/);
      if (t) {
        out.push({ desc, cmd: t[1].trim() });
        break;
      }
    }
  }
  return out;
}

/**
 * 解析 sprint-prd.md 的 ## Golden Path 段编号列表。
 * 格式（harness-planner SKILL 模板，已验证 3 个现存样本一致）：
 *   ## Golden Path（核心场景）
 *   ...
 *   1. <步骤>
 * @returns {Array<{order_no: number, note: string}>}
 */
export function parseGoldenPathSteps(text) {
  const src = String(text || '');
  const sec = src.match(/^##\s*Golden Path[^\n]*\n([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/m);
  if (!sec) return [];
  const out = [];
  for (const line of sec[1].split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (m) out.push({ order_no: parseInt(m[1], 10), note: m[2].trim() });
  }
  return out;
}

/**
 * 把 [BEHAVIOR] 条目构建成 regression-contract.yaml golden_paths 条目。
 * schema 对齐 run-core-regression.sh：id/trigger/test_command 是消费字段，
 * owner_task_id/journey_id/source 是溯源附加（yq 按需取，多余无害）。
 */
export function buildGoldenPathEntries({ taskId, journeyId, behaviors, prUrl, sprintDir, now }) {
  const prefix = `GP-${String(taskId).slice(0, 8)}-`;
  return (behaviors || []).map((b, i) => ({
    id: `${prefix}${String(i + 1).padStart(3, '0')}`,
    name: b.desc,
    priority: 'P0',
    trigger: ['PR', 'Release'],
    method: 'auto',
    test_command: b.cmd,
    owner_task_id: taskId,
    journey_id: journeyId || null,
    source: { pr_url: prUrl || null, sprint_dir: sprintDir, frozen_at: now },
  }));
}

/**
 * 幂等合并：滤掉同 task 前缀的旧条目再追加 fresh（同 ability 二次 PASS 覆盖不叠加）。
 */
export function mergeGoldenPaths(existing, fresh, taskPrefix) {
  const kept = (existing || []).filter((g) => !String(g?.id || '').startsWith(taskPrefix));
  return [...kept, ...fresh];
}

/**
 * promoteToRegression — PASS 后冻结登记主函数（best-effort，绝不 throw）。
 *
 * @param {{pool?: object, execFile?: Function, fsImpl?: object, now?: string}} deps
 * @param {{task: object, sprintDir: string, subTasks: Array, worktreePath: string, dbOnly?: boolean}} params
 *   dbOnly=true 时只执行 ① golden_path DB 写入，跳过 commit 校验与 yaml PR（九要素 T2 首版）
 * @returns {Promise<{ok: boolean, dbWritten: boolean, yamlPrUrl?: string|null, skipped?: boolean, reason?: string}>}
 */
export async function promoteToRegression(deps = {}, params = {}) {
  const dbPool = deps.pool || pool;
  const execFile = deps.execFile || defaultExecFile;
  const fsImpl = deps.fsImpl || fs;
  const now = deps.now || new Date().toISOString();
  const { task, sprintDir, subTasks, worktreePath, dbOnly = false } = params;

  const taskId = task?.id;

  // canary 任务禁入回归池（INV-16）
  if (task?.payload?.canary === 'true' || task?.payload?.canary === true) {
    console.log(`[promote-regression] skipped: canary 任务不入回归池 (task=${taskId})`);
    return { ok: true, dbWritten: false, skipped: true, reason: 'canary task excluded from regression pool' };
  }

  if (!taskId || !sprintDir || !worktreePath) {
    console.warn(`[promote-regression] skipped: 缺 taskId/sprintDir/worktreePath (task=${taskId} sprintDir=${sprintDir} wt=${worktreePath})`);
    await _alert(`A3 冻结跳过：task=${taskId} 缺 sprintDir/worktreePath`);
    return { ok: false, dbWritten: false, skipped: true, reason: 'missing_inputs' };
  }

  // ── 解析原料 ──
  const readOrNull = (p) => { try { return fsImpl.readFileSync(p, 'utf8'); } catch { return null; } };
  const prdText = readOrNull(path.join(worktreePath, sprintDir, 'sprint-prd.md'));
  const dodText = readOrNull(path.join(worktreePath, sprintDir, 'contract-dod.md'));
  const behaviors = parseBehaviorEntries(dodText || '');
  let steps = parseGoldenPathSteps(prdText || '');
  if (steps.length === 0 && behaviors.length > 0) {
    // 降级：BEHAVIOR 条目序号当步骤（note=描述），不依赖 sprint-prd 解析
    steps = behaviors.map((b, i) => ({ order_no: i + 1, note: b.desc }));
  }
  if (steps.length === 0 && behaviors.length === 0) {
    console.warn(`[promote-regression] skipped: ${sprintDir} 无 Golden Path 也无 [BEHAVIOR] 可冻结`);
    await _alert(`A3 冻结跳过：task=${taskId} 无可冻结内容（${sprintDir}）`);
    return { ok: false, dbWritten: false, skipped: true, reason: 'nothing_to_freeze' };
  }

  // ── ① golden_path 表覆盖写（事务）──
  let dbWritten = false;
  try {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      // feature_id 验证存在，失败留 NULL（schema ON DELETE SET NULL 语义一致）。
      // payload.feature_id 缺失时回退 tasks.ability_id——读端 join gp.feature_id 直连，
      // NULL 行会被滤掉，写端必须尽力落真 FK（九要素 T2）。
      let featureId = null;
      for (const cand of [task?.payload?.feature_id, task?.ability_id]) {
        if (!cand) continue;
        try {
          const fe = await client.query('SELECT id FROM journey_features WHERE id=$1', [cand]);
          if (fe.rows[0]?.id) { featureId = fe.rows[0].id; break; }
        } catch { /* try next candidate */ }
      }
      await client.query('DELETE FROM golden_path WHERE owner_task_id=$1', [taskId]);
      for (const s of steps) {
        await client.query(
          'INSERT INTO golden_path (owner_task_id, order_no, feature_id, note) VALUES ($1,$2,$3,$4)',
          [taskId, s.order_no, featureId, s.note],
        );
      }
      await client.query('COMMIT');
      dbWritten = true;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`[promote-regression] golden_path DB 写失败 task=${taskId}: ${err.message}`);
    await _alert(`A3 冻结 DB 写失败：task=${taskId} ${err.message}`);
    return { ok: false, dbWritten: false, reason: 'db_write_failed' };
  }

  if (dbOnly) {
    console.log(`[promote-regression] dbOnly 完成 task=${taskId}（yaml PR 跳过）`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'db_only' };
  }

  // ── ② commit 校验（防假卡）── behaviors 为空则没有 yaml 可冻，直接返回
  if (behaviors.length === 0) {
    console.warn(`[promote-regression] DB 已写但无 [BEHAVIOR] 命令，yaml 冻结跳过 task=${taskId}`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'no_behavior_commands' };
  }
  try {
    // 注意：此检查必须在切分支之前跑（当前还在 contract 分支上）——
    // contract-dod.md 存在于 contract 分支，不一定在 main 上。
    await execFile('git', ['ls-files', '--error-unmatch', path.join(sprintDir, 'contract-dod.md')], { cwd: worktreePath });
  } catch {
    console.error(`[promote-regression] contract-dod.md 未被 git 跟踪，拒绝冻结假卡 task=${taskId}`);
    await _alert(`A3 冻结拒绝（假卡防护）：task=${taskId} contract-dod.md 未入库`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'dod_not_committed' };
  }

  // ── ③ yaml 冻结 + 专属 draft PR ──
  try {
    // 专属 draft PR（reportNode 时 sub-task PR 已 merge，yaml 没有别的顺风车上 main）。
    // 分支必须基于 origin/main 而非当前 contract 分支——否则 PR 会把 contract 分支上
    // 尚未进 main 的差异悄悄带上 main；先切分支再读 yaml，保证读到的是 main 最新版本
    // （并发 promotion 不会互相覆盖）。
    const branch = `cp-${now.slice(5, 16).replace(/[-T:]/g, '')}-promote-regression-${String(taskId).slice(0, 8)}`;
    const run = (args) => execFile('git', args, { cwd: worktreePath });
    await run(['fetch', 'origin', 'main']);
    await run(['checkout', '-b', branch, 'origin/main']);

    const contractPath = path.join(worktreePath, 'regression-contract.yaml');
    const raw = readOrNull(contractPath) || 'version: "1.0.0"\ncore: []\ngolden_paths: []\n';
    const doc = yaml.load(raw) || {};
    const prUrl = (subTasks || []).map((t) => t?.pr_url).filter(Boolean)[0] || null;
    const fresh = buildGoldenPathEntries({
      taskId, journeyId: task?.payload?.journey_id, behaviors, prUrl, sprintDir, now,
    });
    const prefix = `GP-${String(taskId).slice(0, 8)}-`;
    doc.golden_paths = mergeGoldenPaths(doc.golden_paths, fresh, prefix);
    doc.updated = now.slice(0, 10);
    fsImpl.writeFileSync(contractPath, CONTRACT_HEADER + yaml.dump(doc, { lineWidth: 200 }), 'utf8');

    await run(['add', 'regression-contract.yaml']);
    // pathspec 限定提交范围，防止 worktree index 里残留的其他暂存文件搭车
    await run(['commit', '-m', `feat(regression): freeze golden path GP-${String(taskId).slice(0, 8)} (A3 promotion)`, '--', 'regression-contract.yaml']);
    await run(['push', '-u', 'origin', branch]);
    const pr = await execFile('gh', [
      'pr',
      'create',
      '--draft',
      '--fill',
      '--title',
      `feat(regression): A3 冻结 ${String(taskId).slice(0, 8)} 验收卡片`,
    ], { cwd: worktreePath });
    const yamlPrUrl = String(pr.stdout || '').trim().split('\n').pop() || null;
    console.log(`[promote-regression] draft 冻结完成，等待 Kernel merge gate task=${taskId} → ${yamlPrUrl}`);
    return { ok: true, dbWritten, yamlPrUrl };
  } catch (err) {
    console.error(`[promote-regression] yaml 冻结/draft PR 失败（DB 已写）task=${taskId}: ${err.message}`);
    await _alert(`A3 yaml 冻结失败（DB 已登记）：task=${taskId} ${err.message}`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'yaml_freeze_failed' };
  }
}

/** best-effort 飞书告警（缺 token/失败静默，与 reportNode non-fatal 风格一致） */
async function _alert(text) {
  try {
    const { sendFeishu } = await import('./notifier.js');
    await sendFeishu(`⚠️ [A3 promote-regression] ${text}`);
  } catch { /* non-fatal */ }
}

export default { parseBehaviorEntries, parseGoldenPathSteps, buildGoldenPathEntries, mergeGoldenPaths, promoteToRegression };
