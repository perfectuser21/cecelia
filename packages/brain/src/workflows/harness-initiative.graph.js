/**
 * Harness v2 — Initiative Graph（Phase A + B LangGraph 实现）
 *
 * 唯一执行路径：executor.js harness_initiative → compileHarnessFullGraph()
 * Phase A: prep → planner → parsePrd → ganLoop → inferTaskPlan → dbUpsert
 * Phase B: pick_sub_task → run_sub_task（loop）→ report
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import pool from '../db.js';
import { spawn } from '../spawn/index.js';
import { spawnDockerDetached } from '../spawn/detached.js';
import { resolveAccount } from '../spawn/middleware/account-rotation.js';
import { parseDockerOutput, loadSkillContent } from '../harness-shared.js';
import { harnessContractThreadSuffix } from '../harness-utils.js';
import { parseTaskPlan, upsertTaskPlan } from '../harness-dag.js';
import { ensureHarnessWorktree } from '../harness-worktree.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
// B17 + B32: brain 代为 push 用 execFile（B17 加 final_evaluate PR_BRANCH fallback，B32 加 propose_branch fallback）
const execFileDefault = promisify(execFileCb);
const execFile = execFileDefault;
// 走 C3 shim (../harness-gan-graph.js) 而非直连 workflows/harness-gan.graph.js，
// 保持测试 vi.mock('../../harness-gan-graph.js') 路径兼容。
// Phase C7 清 shim 前不改。
import { runGanContractGraph } from '../harness-gan-graph.js';
import { killInitiativeContainers } from '../harness-container-cleanup.js';

const DEFAULT_TIMEOUT_SEC = 21600; // 6h，对齐 initiative_contracts.timeout_sec 默认
const DEFAULT_BUDGET_USD = 10;

/** 生成 goal-based Stop hook settings JSON（与 executor.js buildGoalSettings 相同格式） */
function buildHarnessGoalSettings(goalCondition) {
  if (!goalCondition) return null;
  return JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{
          type: 'prompt',
          prompt: `Has the following goal been achieved based on the conversation? Goal: ${goalCondition}\n\nAnswer YES only if you can confirm from the conversation that the goal is met. Answer NO otherwise.`,
          model: 'claude-haiku-4-5-20251001',
        }],
      }],
    },
  });
}

const HARNESS_PHASE_GOALS = {
  planner:  'The sprint-prd.md has been written to the sprint directory with Golden Path, and a verdict JSON with sprint_dir has been output',
  evaluate: 'The evaluation is complete and .brain-result.json has been written with verdict=PASS or FAIL',
  generator: 'The workstream implementation PR has been created and pushed to GitHub',
};

// ─── Brain v2 C8a — LangGraph 真图实现（阶段 A）────────────────────────
// harness_initiative 任务的唯一执行路径（dispatcher → executor → compileHarnessFullGraph）。
//
// 节点拓扑：START → prep → planner → parsePrd → ganLoop → dbUpsert → END
//                    ↓error  ↓error    ↓error    ↓error
//                    └────────┴──────────┴─────────┴──────→ END (条件 edge)
//
// 每节点首句幂等门防 LangGraph resume 重 spawn（C6 smoke 教训）。
// PRD: docs/superpowers/specs/2026-04-25-c8a-harness-initiative-graph-design.md

import { StateGraph, Annotation, START, END, interrupt } from '@langchain/langgraph';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import { LLM_RETRY, DB_RETRY, NO_RETRY } from './retry-policies.js';
import { writeDriverHeartbeat } from '../harness-heartbeat.js';
// 注：上方 imports 已含 spawn / parseDockerOutput / loadSkillContent / parseTaskPlan /
// upsertTaskPlan / ensureHarnessWorktree / resolveGitHubToken / runGanContractGraph

async function emitLangGraphStep(dbPool, taskId, payload) {
  if (!taskId) return;
  try {
    await dbPool.query(
      `INSERT INTO cecelia_events (event_type, source, task_id, payload)
       VALUES ('langgraph_step', 'harness-initiative', $1::uuid, $2::jsonb)`,
      [taskId, JSON.stringify(payload)]
    );
  } catch (err) {
    console.warn('[harness-initiative] emitLangGraphStep failed:', err.message);
  }
}

export const InitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  sprintDir:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiative_run_id: Annotation({ reducer: (_o, n) => n, default: () => null }),
  planner_session:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluator_session: Annotation({ reducer: (_o, n) => n, default: () => null }),
  planner_container_id: Annotation({ reducer: (_o, n) => n, default: () => null }),
});

// 节点 stub — Task 2-6 逐个填充。
export async function prepInitiativeNode(state, opts = {}) {
  if (state.worktreePath) return { worktreePath: state.worktreePath };
  try {
    // B51: initiativeId = task.id（同一实体，无独立 initiative 表）
    // payload.initiative_id / task.initiative_id 是旧格式兼容字段，权威值始终是 task.id
    const initiativeId = state.task?.id;
    const baseRepo = state.task?.payload?.base_repo || undefined;
    if (!state.task?.payload?.journey_id) {
      console.warn(`[prep] journey_id missing in task.payload — initiative_run.journey_id will be null, Notion Project will be orphaned (task.id=${state.task?.id})`);
    }
    // 默认字面调用 ensureHarnessWorktree({ ...baseRepo })，base-repo-support-smoke 正则守卫；
    // 测试可注入 opts.ensureWorktree 替换（条件分支保留字面调用不被间接层吞掉）
    const resolveToken = opts.resolveToken || resolveGitHubToken;
    const worktreePath = opts.ensureWorktree
      ? await opts.ensureWorktree({ taskId: state.task.id, initiativeId, baseRepo })
      : await ensureHarnessWorktree({ taskId: state.task.id, initiativeId, baseRepo });
    const githubToken = await resolveToken();

    // OPEN-6: worktree 建好后立即 INSERT initiative_runs(A_contract)，确保 GAN abort 时有记录可更新
    const dbPool = opts.pool || pool;
    const journeyType = state.task?.payload?.journey_type || 'autonomous';
    const journeyId = state.task?.payload?.journey_id || null;
    let initiative_run_id = null;
    try {
      const runInsert = await dbPool.query(
        `INSERT INTO initiative_runs (initiative_id, phase, journey_type, journey_id, okr_initiative_id)
         VALUES ($1::uuid, 'A_contract', $2, $3,
           (SELECT okr_initiative_id FROM harness_initiative_migration_map WHERE harness_task_id = $1::uuid))
         RETURNING id`,
        [initiativeId, journeyType, journeyId]
      );
      initiative_run_id = runInsert.rows[0]?.id || null;
    } catch (dbErr) {
      // non-blocking：DB 失败不阻止 worktree 建立，GAN 阶段降级为无 run 记录
      console.warn(`[prep] initiative_runs INSERT failed (non-fatal): ${dbErr.message}`);
    }

    return { worktreePath, githubToken, initiativeId, initiative_run_id };
  } catch (err) {
    return { error: { node: 'prep', message: err.message } };
  }
}
export async function runPlannerNode(state, opts = {}) {
  // 幂等门：已有 plannerOutput 直接 passthrough（resume 后重跑此节点时）
  if (state.plannerOutput) return { plannerOutput: state.plannerOutput };

  // resume 容错（防孤儿 planner 并发 → SIGKILL 误标 OOM）：
  // 本节点 spawn 后直接 interrupt()，而 planner_container_id 只在节点末尾 return —— interrupt
  // 让节点从头重放（LangGraph），resume 时 state.planner_container_id 丢失（未 commit）。
  // 但 spawn 时已把 (container_id, thread_id) 写进 walking_skeleton_thread_lookup（interrupt 丢不掉），
  // 故 state 缺失时按 thread_id 回查：已 spawn 过则复用、走下面等回调分支，绝不重 spawn。
  let plannerContainerId = state.planner_container_id;
  if (!plannerContainerId) {
    const tid = opts.configurable?.thread_id;
    // 格式校验：thread_id 必须是 `harness-initiative:<id>:<attemptN>` 形态，非法值不查（防脏数据/误查）。
    // （查询本身已参数化 $1，无注入风险；此处是额外的输入收窄。）
    if (typeof tid === 'string' && /^harness-initiative:[^:]+:\d+$/.test(tid)) {
      try {
        const lookupPool = opts.pool || opts.poolOverride || pool;
        const { rows } = await lookupPool.query(
          `SELECT container_id FROM walking_skeleton_thread_lookup
           WHERE thread_id = $1 AND graph_name = 'harness-initiative'
           ORDER BY created_at DESC LIMIT 1`,
          [tid]
        );
        if (rows?.[0]?.container_id) plannerContainerId = rows[0].container_id;
      } catch (err) {
        // 回查失败 = 无法确认是否已 spawn。刻意选「当首次处理、继续 spawn」而非中止整条 initiative：
        // 一次 DB 抖动不该让 sprint 整体失败；代价是该 race 窗口内可能多 spawn 一个 planner（极罕见、
        // 且被 90min 全局 deadline + 容器自然退出兜底），远小于「transient 错误直接 fail 整条线」。
        console.warn(`[harness-initiative] planner thread_lookup 回查失败 thread_id=${tid}（当首次处理，继续 spawn）: ${err.message}`);
      }
    }
  }

  // 幂等门：已 spawn 过（有 containerId）说明在等 callback，重新 interrupt
  if (plannerContainerId) {
    const callbackPayload = interrupt({
      type: 'wait_planner_callback',
      containerId: plannerContainerId,
    });
    const { exit_code, stdout, error: cbErr } = callbackPayload || {};
    if (exit_code !== 0) {
      const detail = cbErr || (stdout || '').slice(-300);
      return { error: { node: 'planner', message: `Planner exit=${exit_code}: ${detail}` } };
    }
    const plannerOutput = parseDockerOutput(stdout ?? '');
    return { plannerOutput };
  }

  const spawnFn = opts.spawnDetached || spawnDockerDetached;
  const dbPool = opts.pool || opts.poolOverride || pool;
  const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  const initiativeId = state.initiativeId || state.task?.id;
  const skillContent = loadSkillContent('harness-planner');

  const prompt = `你是 harness-planner agent。按下面 SKILL 指令工作。

${skillContent}

---

## 本次任务参数
**task_id**: ${state.task.id}
**initiative_id**: ${initiativeId}
**sprint_dir**: ${sprintDir}

## 任务描述
${state.task.description || state.task.title || ''}

## PrepPRD（产品语言，用户确认过的需求文档）
${state.task?.payload?.prep_prd_body || '（未提供，Planner 从 sprint-prd.md 推断）'}

## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. sprint-prd.md 写完后，在最后一行输出：{"verdict":"DONE","sprint_dir":"${sprintDir}"}` ;

  const rand = crypto.randomUUID().slice(0, 8);
  const safeTaskId = String(state.task?.id || initiativeId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
  const containerId = `harness-planner-${safeTaskId}-${rand}`;
  // thread_id 优先用 opts.configurable.thread_id（LangGraph 运行时注入），兜底用计算值
  const threadId = opts.configurable?.thread_id || `harness-initiative:${initiativeId}:planner`;

  // 注入 initiative_runs 历史上下文（失败不阻塞）
  let runHistoryText = '';
  try {
    const journeyId = state.task?.payload?.journey_id;
    if (journeyId) {
      const fetchFn = globalThis.fetch;
      const runsRes = await fetchFn('http://localhost:5221/api/brain/harness/runs?limit=10');
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const allRuns = runsData.runs || runsData || [];
        const runs = allRuns
          .filter(r => r.journey_id === journeyId || r.journeyId === journeyId)
          .slice(0, 5);
        if (runs.length > 0) {
          const lines = runs.map((r, i) => {
            const status = r.status || 'unknown';
            const date = r.completed_at || r.created_at || '';
            const dateStr = date ? date.slice(0, 10) : 'N/A';
            const title = r.title || r.sprint_dir || `Run${i + 1}`;
            return `Run${i + 1}=${status}(${dateStr}) [${title}]`;
          });
          runHistoryText = `\n\n## Run历史(最近${runs.length}次)\n${lines.join('\n')}`;
        }
      }
    }
  } catch (err) {
    console.warn(`[harness-initiative] fetchRunHistory failed (non-blocking): ${err.message}`);
  }
  const plannerPromptFinal = runHistoryText ? `${prompt}${runHistoryText}` : prompt;

  const acctOpts = { task: { ...state.task, task_type: 'harness_planner' }, env: {} };
  try {
    await resolveAccount(acctOpts, { taskId: state.task.id });
  } catch (err) {
    console.warn(`[harness-initiative] resolveAccount failed: ${err.message}`);
  }

  try {
    await spawnFn({
      task: { ...state.task, task_type: 'harness_planner' },
      prompt: plannerPromptFinal,
      worktreePath: state.worktreePath,
      containerId,
      env: {
        ...acctOpts.env,
        CECELIA_TASK_TYPE: 'harness_planner',
        HARNESS_NODE: 'planner',
        HARNESS_SPRINT_DIR: sprintDir,
        HARNESS_INITIATIVE_ID: initiativeId,
        CECELIA_JOURNEY_ID: state.task?.payload?.journey_id || '',
        GITHUB_TOKEN: state.githubToken,
        HARNESS_CALLBACK_URL: `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`,
        ...(buildHarnessGoalSettings(HARNESS_PHASE_GOALS.planner)
          ? { CECELIA_GOAL_SETTINGS: buildHarnessGoalSettings(HARNESS_PHASE_GOALS.planner) }
          : {}),
      },
    });
  } catch (err) {
    return { error: { node: 'planner', message: `spawn: ${err.message}` } };
  }

  try {
    await dbPool.query(
      `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
       VALUES ($1, $2, 'harness-initiative', 'spawning')
       ON CONFLICT (container_id) DO NOTHING`,
      [containerId, threadId]
    );
  } catch (err) {
    console.warn(`[harness-initiative] thread_lookup INSERT failed cid=${containerId}: ${err.message}`);
  }

  const callbackPayload = interrupt({
    type: 'wait_planner_callback',
    containerId,
  });

  const { exit_code, stdout, error: callbackError } = callbackPayload || {};
  if (exit_code !== 0) {
    const detail = callbackError || (stdout || '').slice(-300);
    return { error: { node: 'planner', message: `Planner exit=${exit_code}: ${detail}` } };
  }
  const plannerOutput = parseDockerOutput(stdout ?? '');
  return { plannerOutput, planner_container_id: containerId };
}
// 从 git log 新增文件列表识别真正的 sprint 目录。
// 锚定合同标记文件（sprint-prd.md / contract-*.md）所在目录，而非猜任意子目录名 —
// 防止 Planner 把测试放 sprints/tests/ 时，检测把 tests 误当成 sprint 目录
// （验证线实证 bug：sprintDir=sprints/tests → Proposer 找不到合同 → ENOENT 失败）。
// 返回 null 表示无法判定，让调用方走文件系统 fallback。
export function detectSprintDirFromGitLog(logOut) {
  if (!logOut || !logOut.trim()) return null;
  const lines = logOut.split('\n').map((l) => l.trim()).filter(Boolean);
  // 优先：合同标记文件所在目录就是 sprint 目录（最可靠）
  const MARKERS = new Set([
    'sprint-prd.md', 'contract-draft.md', 'contract-dod.md', 'contract.md', 'sprint-contract.md',
  ]);
  for (const line of lines) {
    if (!line.startsWith('sprints/')) continue;
    const base = line.slice(line.lastIndexOf('/') + 1);
    if (MARKERS.has(base)) {
      const dir = line.slice(0, line.length - base.length - 1);
      return dir || 'sprints';
    }
  }
  // 次选：sprints/<子目录>/ （旧 B37 行为），但排除已知非-sprint 子目录
  const EXCLUDE = new Set(['tests', 'test', '__tests__', 'node_modules', 'fixtures']);
  const subdirs = [...logOut.matchAll(/sprints\/([^/\n]+)\//g)]
    .map((m) => m[1])
    .filter((name) => !EXCLUDE.has(name));
  if (subdirs.length > 0) return `sprints/${subdirs.at(-1)}`;
  return null;
}

// sprint_dir 单一真相源：sprint-prd.md 实际所在目录就是 sprint 目录。
// planner 唯一创建一次 sprint-prd.md，文件系统位置确定——不受 git commit 时机 / GAN round /
// sprints/tests 子目录污染（旧 verdict 正则 + git-log + readdir 启发式都会被污染算成 sprints/tests）。
// 多个匹配时取最短路径（最接近 sprints/ 根，排除 tests/fixtures 等嵌套误选）。
// 找不到 / 出错 → null，让调用方走旧启发式 fallback。
export async function resolveSprintDirFromFs(worktreePath, deps = {}, preferredSprintDir = null) {
  const execFn = deps.execFile || execFile;
  try {
    const { stdout } = await execFn('find',
      [path.join(worktreePath, 'sprints'), '-name', 'sprint-prd.md', '-maxdepth', '3'],
      { cwd: worktreePath, timeout: 10_000 }
    );
    const paths = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (paths.length === 0) return null;
    const dirs = paths.map((p) => path.relative(worktreePath, path.dirname(p)));
    // 优先信任显式 payload.sprint_dir：若它确有 sprint-prd.md（命中 find 结果）就用它。
    // 否则才取最短路径——避免 base_repo 被前几次 run 污染（顶层 sprints/sprint-prd.md 残留）时，
    // 最短路径误选陈旧顶层目录、读到旧 task-plan 产出假绿（v6 实证：误报 add5 PR#51 为 completed）。
    if (preferredSprintDir && dirs.includes(preferredSprintDir)) {
      return preferredSprintDir;
    }
    dirs.sort((a, b) => a.length - b.length);
    return dirs[0];
  } catch {
    return null;
  }
}

export async function parsePrdNode(state) {
  if (state.taskPlan && state.prdContent) {
    return { taskPlan: state.taskPlan, prdContent: state.prdContent, sprintDir: state.sprintDir };
  }
  let taskPlan = null;
  try {
    taskPlan = parseTaskPlan(state.plannerOutput);
  } catch (err) {
    // Planner v8 does not output task-plan.json — that is OK, inferTaskPlanNode reads from propose branch
    console.warn(`[harness-initiative-graph] parsePrd: parseTaskPlan returned null/error (${err.message}), will infer from propose branch`);
    taskPlan = null;
  }
  if (taskPlan && (taskPlan.initiative_id === 'pending' || !taskPlan.initiative_id)) {
    taskPlan.initiative_id = state.initiativeId;
  }
  let sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  // B57: sprint_dir 单一真相源 — sprint-prd.md 文件系统位置（权威，跳过下面所有易污染的启发式）。
  // 找到就用它；找不到才退回 verdict JSON + git-log + readdir 旧启发式（向后兼容）。
  const fsResolved = state.worktreePath ? await resolveSprintDirFromFs(state.worktreePath, { execFile }, state.task?.payload?.sprint_dir) : null;
  if (fsResolved) {
    sprintDir = fsResolved;
  } else {
  // B35+B36: 从 planner verdict JSON 提取 sprint_dir，取最后一个（verdict 在输出末尾）
  const sprintDirMatches = [...(state.plannerOutput || '').matchAll(/"sprint_dir"\s*:\s*"([^"]+)"/g)];
  if (sprintDirMatches.length > 0) sprintDir = sprintDirMatches.at(-1)[1];
  // B37+B40: 检测 planner 实际新建的 sprint 目录
  // git log 覆盖 origin/main..HEAD 整条历史（比 git diff HEAD 更可靠，HEAD 可能是 GAN propose 分支）
  if (state.worktreePath) {
    try {
      const { stdout: logOut } = await execFile('git',
        ['log', '--diff-filter=A', '--name-only', '--format=', 'origin/main..HEAD', '--', 'sprints/'],
        { cwd: state.worktreePath }
      );
      const detected = detectSprintDirFromGitLog(logOut);
      if (detected) {
        sprintDir = detected;
      } else if (!logOut.trim()) {
        // B40: git log 无新增文件（未 commit），fallback 到文件系统检测
        try {
          const { stdout: findOut } = await execFile('find',
            [path.join(state.worktreePath, 'sprints'), '-maxdepth', '1', '-mindepth', '1', '-type', 'd'],
            { cwd: state.worktreePath }
          );
          const dirs = findOut.trim().split('\n').filter(Boolean);
          // B40-fix: 排除已知非 sprint 目录（同 detectSprintDirFromGitLog 的 EXCLUDE），
          // 防止 infrastructure 等 repo 的 sprints/tests/ 被误判为 sprint 目录。
          const B40_EXCLUDE = new Set(['tests', 'test', '__tests__', 'node_modules', 'fixtures']);
          const validDirs = dirs.filter(d => !B40_EXCLUDE.has(path.basename(d)));
          if (validDirs.length === 1) {
            sprintDir = path.relative(state.worktreePath, validDirs[0]);
          } else if (validDirs.length > 1) {
            console.warn(`[parsePrdNode] B40: found ${validDirs.length} valid sprint subdirs, cannot auto-detect. Keeping ${sprintDir}`);
          }
        } catch { /* sprints/ 子目录未找到，保持已有 sprintDir */ }
      }
    } catch { /* git log 失败，保持已有 sprintDir */ }
  }
  } // end else（fsResolved 未命中时的旧启发式 fallback）
  let prdContent = state.plannerOutput || '';
  try {
    prdContent = await readFile(
      path.join(state.worktreePath, sprintDir, 'sprint-prd.md'),
      'utf8'
    );
  } catch {
    // B34: defense-in-depth — planner may create sprints/{name}/ subdirectory.
    try {
      const entries = await readdir(path.join(state.worktreePath, sprintDir), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          prdContent = await readFile(
            path.join(state.worktreePath, sprintDir, entry.name, 'sprint-prd.md'),
            'utf8'
          );
          sprintDir = path.join(sprintDir, entry.name);
          break;
        } catch { /* keep scanning */ }
      }
      if (prdContent === state.plannerOutput || prdContent === '') {
        // Still not found in subdir, log error and fallback
        console.error(`[harness-initiative-graph] read sprint-prd.md failed in all subdirs, falling back to planner stdout`);
      }
    } catch (readdirErr) {
      console.error(`[harness-initiative-graph] readdir failed (${readdirErr.message}), falling back to planner stdout`);
    }
  }
  return { taskPlan, prdContent, sprintDir };  // taskPlan may be null — that is OK
}
export async function runGanLoopNode(state, opts = {}) {
  if (state.ganResult) return { ganResult: state.ganResult };
  const dbPool = opts.pool || pool;
  await emitLangGraphStep(dbPool, state.initiativeId, { node: 'proposer', status: 'started' });
  try {
    const executor = opts.executor || spawn;
    const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
    const budgetUsd = state.task?.payload?.budget_usd || DEFAULT_BUDGET_USD;
    // LangGraph runtime 不会把父 graph 的 checkpointer 注入子节点 opts；
    // 当 opts.checkpointer 缺失（生产实际场景）时，自己 getPgCheckpointer 兜底。
    // Stream 2 v1.229.0 起 runGanContractGraph fail-fast if !checkpointer，
    // 必须显式传，否则 ganLoop 直接 throw "checkpointer is required"。
    const checkpointer = opts.checkpointer || await getPgCheckpointer();
    // B51: state.task.id === initiativeId（同一实体，非旧格式 task.initiative_id 字段）
    const heartbeatFn = () => writeDriverHeartbeat(dbPool, state.task.id).catch(() => {});
    const ganResult = await runGanContractGraph({
      taskId: state.task.id,
      initiativeId: state.initiativeId,
      sprintDir,
      prdContent: state.prdContent,
      executor,
      worktreePath: state.worktreePath,
      githubToken: state.githubToken,
      plannerOutput: state.plannerOutput || '',
      budgetCapUsd: budgetUsd,
      checkpointer,
      baseRepo: state.task?.payload?.base_repo || undefined,
      heartbeatFn,
    });
    await emitLangGraphStep(dbPool, state.initiativeId, {
      node: 'reviewer',
      review_round: ganResult.rounds || 1,
      review_verdict: ganResult.verdict || null,
    });
    return { ganResult };
  } catch (err) {
    // OPEN-5: GAN abort 传播到 tasks + initiative_runs
    // B59: 熔断（ganAborted）或显式 terminal → error.terminal=true，进 checkpoint 后
    // B58 resume 钩子第一次中止即 failed；transient（如 proposer_failed exit≠0 裸 throw）→ falsy，靠 cap 兜底重试。
    const isTerminal = err.terminal === true || err.ganAborted === true;
    const taskId = state.task?.id || state.initiativeId;
    const errorPayload = JSON.stringify({ node: 'gan', message: err.message, terminal: isTerminal });
    if (taskId) {
      dbPool.query(
        `UPDATE tasks SET status='failed', result=$1::jsonb, updated_at=NOW() WHERE id=$2::uuid`,
        [errorPayload, taskId]
      ).catch((e) => console.warn(`[ganLoop] tasks UPDATE failed (non-fatal): ${e.message}`));
    }
    if (state.initiative_run_id) {
      dbPool.query(
        `UPDATE initiative_runs SET phase='failed', failure_reason=$1, updated_at=NOW() WHERE id=$2::uuid`,
        [err.message, state.initiative_run_id]
      ).catch((e) => console.warn(`[ganLoop] initiative_runs UPDATE failed (non-fatal): ${e.message}`));
    }
    return { error: { node: 'gan', message: err.message, terminal: isTerminal } };
  }
}
export async function dbUpsertNode(state, opts = {}) {
  if (state.result?.contractId) return { result: state.result };
  const dbPool = opts.pool || pool;
  const timeoutSec = state.task?.payload?.timeout_sec || DEFAULT_TIMEOUT_SEC;
  const budgetUsd = state.task?.payload?.budget_usd || DEFAULT_BUDGET_USD;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    // B51: initiative_id = task.id 约定显式化 — LLM 写 "pending" 或其他错误值时强制覆盖
    let taskPlanForUpsert = state.taskPlan;
    if (taskPlanForUpsert?.initiative_id && taskPlanForUpsert.initiative_id !== state.initiativeId) {
      console.warn(`[dbUpsertNode] taskPlan.initiative_id "${taskPlanForUpsert.initiative_id}" ≠ state.initiativeId "${state.initiativeId}" — 覆盖为权威值`);
      taskPlanForUpsert = { ...taskPlanForUpsert, initiative_id: state.initiativeId };
    }
    const { idMap, insertedTaskIds } = await upsertTaskPlan({
      initiativeId: state.initiativeId,
      initiativeTaskId: state.task.id,
      taskPlan: taskPlanForUpsert,
      client,
      contractBranch: state.ganResult.propose_branch || null,
    });
    // B40: 把运行时检测到的 sprint_dir 写入子任务 payload，确保 Brain 重启后 dispatcher 从 DB dispatch 时路径正确
    const effectiveSprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
    if (insertedTaskIds?.length > 0 && effectiveSprintDir !== 'sprints') {
      await client.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
         WHERE id = ANY($1::uuid[])`,
        [insertedTaskIds, JSON.stringify({ sprint_dir: effectiveSprintDir })]
      );
    }
    // ON CONFLICT (B13): dbUpsertNode 是 graph 节点，restart resume 时 retry 必须幂等。
    const contractInsert = await client.query(
      `INSERT INTO initiative_contracts (
         initiative_id, version, status,
         prd_content, contract_content, review_rounds,
         budget_cap_usd, timeout_sec, branch, approved_at
       )
       VALUES ($1::uuid, 1, 'approved', $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (initiative_id, version) DO UPDATE SET
         status = EXCLUDED.status,
         prd_content = EXCLUDED.prd_content,
         contract_content = EXCLUDED.contract_content,
         review_rounds = EXCLUDED.review_rounds,
         budget_cap_usd = EXCLUDED.budget_cap_usd,
         timeout_sec = EXCLUDED.timeout_sec,
         branch = EXCLUDED.branch,
         approved_at = NOW()
       RETURNING id`,
      [state.initiativeId, state.plannerOutput, state.ganResult.contract_content, state.ganResult.rounds, budgetUsd, timeoutSec, state.ganResult.propose_branch || null]
    );
    const contractId = contractInsert.rows[0].id;
    const journeyType = state.taskPlan?.journey_type || 'autonomous';
    const journeyId = state.task?.payload?.journey_id || null;
    // OPEN-6: 有 initiative_run_id（prep 阶段创建）→ UPDATE phase + contract_id；否则 fallback INSERT
    let runId;
    if (state.initiative_run_id) {
      await client.query(
        `UPDATE initiative_runs
         SET phase='B_task_loop', contract_id=$1::uuid,
             deadline_at=NOW() + ($2 || ' seconds')::interval,
             updated_at=NOW()
         WHERE id=$3::uuid`,
        [contractId, String(timeoutSec), state.initiative_run_id]
      );
      runId = state.initiative_run_id;
    } else {
      const runInsert = await client.query(
        `INSERT INTO initiative_runs (
           initiative_id, contract_id, phase,
           deadline_at, journey_type, journey_id, okr_initiative_id
         )
         VALUES ($1::uuid, $2::uuid, 'B_task_loop',
           NOW() + ($3 || ' seconds')::interval,
           $4, $5,
           (SELECT okr_initiative_id FROM harness_initiative_migration_map WHERE harness_task_id = $1::uuid)
         )
         RETURNING id`,
        [state.initiativeId, contractId, String(timeoutSec), journeyType, journeyId]
      );
      runId = runInsert.rows[0].id;
    }
    await client.query('COMMIT');
    return {
      result: {
        success: true,
        taskId: state.task.id,
        initiativeId: state.initiativeId,
        contractId,
        runId,
        insertedTaskIds,
        idMap,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    return { error: { node: 'dbUpsert', message: `tx: ${err.message}` } };
  } finally {
    client.release();
  }
}

export function stateHasError(state) { return state.error ? 'error' : 'ok'; }

export function buildHarnessInitiativeGraph() {
  return new StateGraph(InitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'dbUpsert' })
    .addEdge('dbUpsert', END);
}

export async function compileHarnessInitiativeGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessInitiativeGraph().compile({ checkpointer, durability: 'sync' });
}

// ─── Sprint 1: 全图（Phase A+B+C 一个 graph 跑到底） ─────────────────────
//
// 在 C8a Phase A graph 之上扩 fanout/run_sub_task/join/final_e2e/report 节点。
// 砍 Phase B/C 的 6 个 procedural module（harness-task-dispatch / harness-watcher /
// harness-phase-advancer / harness-final-e2e.runFinalE2E 编排 / harness-initiative-runner.runPhaseCIfReady /
// shepherd 中 harness 分支）+ 4 task_type（harness_task / harness_ci_watch / harness_fix / harness_final_e2e）。
//
// Spec: docs/superpowers/specs/2026-04-26-harness-langgraph-full-graph-design.md
// Plan: docs/superpowers/plans/2026-04-26-harness-langgraph-full-graph.md

import { buildHarnessTaskGraph as _buildTaskGraph } from './harness-task.graph.js';

/**
 * Full Initiative State：复用 InitiativeState 字段 + sub_tasks (merge by id) +
 * final_e2e_verdict + final_e2e_failed_scenarios + report_path。
 *
 * 注：sub_task (单数) 字段用于 Send fanout 把子状态注入 run_sub_task node。
 * sub_tasks (复数) 是累计聚合，reducer = mergeBy id。
 */
export const FullInitiativeState = Annotation.Root({
  task:           Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  worktreePath:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  githubToken:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  plannerOutput:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  prdContent:     Annotation({ reducer: (_o, n) => n, default: () => null }),
  sprintDir:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult:      Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:         Annotation({ reducer: (_o, n) => n, default: () => null }),
  error:          Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiative_run_id: Annotation({ reducer: (_o, n) => n, default: () => null }),
  contract:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  contractBranch: Annotation({ reducer: (_o, n) => n, default: () => null }),

  // Send fanout 注入子状态
  sub_task:       Annotation({ reducer: (_o, n) => n, default: () => null }),

  // 累计：merge by id
  sub_tasks: Annotation({
    reducer: (curr, upd) => {
      if (!Array.isArray(upd) || upd.length === 0) return curr || [];
      const map = new Map((curr || []).map((s) => [s.id, s]));
      for (const s of upd) map.set(s.id, { ...(map.get(s.id) || {}), ...s });
      return [...map.values()];
    },
    default: () => [],
  }),
  all_sub_tasks_done: Annotation({ reducer: (_o, n) => n, default: () => false }),
  final_e2e_verdict: Annotation({ reducer: (_o, n) => n, default: () => null }),
  final_e2e_failed_scenarios: Annotation({ reducer: (_o, n) => n, default: () => [] }),
  report_path: Annotation({ reducer: (_o, n) => n, default: () => null }),
  // Serial evaluate loop state
  task_loop_index:    Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  task_loop_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  // resume 防护：serial gate 对 status=queued 无终败证据的当前 sub-task 重跑计数（防死循环上限）
  serial_gate_requeue_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  evaluate_verdict:   Annotation({ reducer: (_o, n) => n, default: () => null }),
  evaluate_feedback:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  final_e2e_fix_count: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  planner_container_id: Annotation({ reducer: (_o, n) => n, default: () => null }),
});

/**
 * inferTaskPlanNode: graph node — 在 fanout 前保证 state.taskPlan.tasks 非空。
 *
 * 幂等：state.taskPlan?.tasks?.length >= 1 → passthrough。
 * Fallback: spawn 一个 docker LLM 子任务，喂 PRD + Contract，让其拆 task-plan.json。
 *           失败时 passthrough（不阻断 graph，让下游 join 走自然 FAIL 路径）。
 *
 * 解决：Planner SKILL 没输出合规 task_plan 时，fanout 看不到 tasks 直接跳 join，
 *      Final E2E 找不到 sub_task 报 FAIL（Sprint 1 E2E-v10 真实根因）。
 *
 * @param {object} state  FullInitiativeState
 * @param {object} [opts]
 * @param {Function} [opts.executor]  spawn 替代（测试注入）
 * @returns {Promise<object>}  state delta（{} 或 { taskPlan: {...} }）
 */
export async function inferTaskPlanNode(state, _opts = {}) {
  const existing = state?.taskPlan?.tasks;
  if (Array.isArray(existing) && existing.length >= 1) {
    return {};
  }

  const proposeBranch = state?.ganResult?.propose_branch;
  const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';

  if (!proposeBranch) {
    console.warn('[infer_task_plan] no propose_branch in ganResult, cannot read task-plan.json');
    return { error: { node: 'infer_task_plan', message: 'propose_branch missing from ganResult — GAN did not produce a proposal' } };
  }

  // B32: verify propose_branch 真在 origin。LLM 工艺不稳定（W42 proposer container
  // exit=0 但 git push 没真跑），brain 必须 verify 关键 side effect。
  // 如果 origin 没这个 branch，brain 代为 push（worktree 内 commits 已在）。
  // 通用模式：LLM action + brain verify + brain fallback execute。
  if (state.worktreePath) {
    try {
      const { stdout: lsRemote } = await execFile(
        'git',
        ['ls-remote', '--heads', 'origin', proposeBranch],
        { cwd: state.worktreePath, timeout: 30_000 }
      );
      if (!lsRemote.trim()) {
        console.warn(`[infer_task_plan] B32 propose_branch ${proposeBranch} 不在 origin，brain 代为 push`);
        try {
          await execFile(
            'git',
            ['push', 'origin', proposeBranch],
            { cwd: state.worktreePath, timeout: 60_000 }
          );
          console.log(`[infer_task_plan] B32 brain 代 push 成功: ${proposeBranch}`);
        } catch (pushErr) {
          // push 失败（branch 不存在 / 权限等）→ 让 ContractViolation 走原路径
          console.error(`[infer_task_plan] B32 brain 代 push 失败: ${pushErr.message}`);
        }
      }
    } catch (lsErr) {
      // ls-remote 失败（网络/credentials）→ silent fail，让原 fetchAndShowOriginFile 继续尝试
      console.warn(`[infer_task_plan] B32 ls-remote 失败: ${lsErr.message}（继续尝试 fetch）`);
    }
  }

  try {
    // 防御：proposer 在 task container 内 git push 后，brain 容器本地 origin tracking 不会自动更新。
    // fetchAndShowOriginFile 内部用 refspec `origin/<branch>:refs/remotes/origin/<branch>` 显式更新，
    // 修 PR #2838 的 `git fetch origin <branch>` 只更新 FETCH_HEAD 不更新 remote ref 的 bug。
    const json = await fetchAndShowOriginFile(
      state.worktreePath,
      proposeBranch,
      `${sprintDir}/task-plan.json`
    );
    let plan;
    try {
      plan = parseTaskPlan(json);
    } catch (err) {
      console.warn(`[infer_task_plan] parseTaskPlan failed: ${err.message}`);
      return {};
    }
    if (plan.initiative_id === 'pending' || !plan.initiative_id) {
      plan.initiative_id = state.initiativeId;
    }
    console.log(`[infer_task_plan] read ${plan.tasks?.length || 0} tasks from ${proposeBranch}:${sprintDir}/task-plan.json`);
    return { taskPlan: plan };
  } catch (err) {
    const msg = `[infer_task_plan] git show origin/${proposeBranch}:${sprintDir}/task-plan.json failed: ${err.message}`;
    console.error(msg);
    return { error: msg };  // 走 stateHasError → error → END，触发 alert（不再静默"软坏"）
  }
}


// Layer 3: sub-graph 现在用 interrupt()，必须传 checkpointer。否则 invoke() 抛
// "No checkpointer set"。这里用 PG checkpointer（生产）；测试可以注 opts.compiledTaskGraph。
let _taskGraphCompiledCache = null;
let _taskGraphCompilePromise = null;
async function _getTaskGraphCompiled() {
  if (_taskGraphCompiledCache) return _taskGraphCompiledCache;
  if (_taskGraphCompilePromise) return _taskGraphCompilePromise;
  _taskGraphCompilePromise = (async () => {
    const checkpointer = await getPgCheckpointer();
    _taskGraphCompiledCache = _buildTaskGraph().compile({ checkpointer, durability: 'sync' });
    return _taskGraphCompiledCache;
  })();
  return _taskGraphCompilePromise;
}

// 测试 hook
export function _resetTaskGraphCacheForTests() {
  _taskGraphCompiledCache = null;
  _taskGraphCompilePromise = null;
}

/**
 * Layer 3：sub-graph 现在是 spawn-and-interrupt 模式（spawn 节点 detached docker run -d 后
 * await_callback 节点 interrupt() yield）。compiled.invoke() 返回时 sub-graph 通常停在
 * await_callback（next=['await_callback']），此时 final.status 是 undefined。
 *
 * runSubTaskNode 必须等 callback router 收到容器 POST → Command(resume) 把 sub-graph
 * 推到 END 才能拿到真实 final.status。这里走 polling getState 直到 next=[]。
 *
 * 超时：max 90 min（兼容老 executor 行为；env override CECELIA_SUBGRAPH_WAIT_MS）。
 *
 * 注意：runSubTaskNode 自己仍然是阻塞节点（在父 fanout 内 Send 派一个实例）。把父 graph
 * 也改成 spawn-and-interrupt 是 Layer 4 范畴。Layer 3 只解决子 graph 层面 spawn 不阻塞 +
 * brain restart 持久化（sub-graph 持久化在 PG checkpointer 上，runSubTaskNode 重启后会
 * 重新 poll）。
 */
const SUBGRAPH_WAIT_MS = parseInt(process.env.CECELIA_SUBGRAPH_WAIT_MS || `${90 * 60 * 1000}`, 10);
const SUBGRAPH_POLL_INTERVAL_MS = parseInt(process.env.CECELIA_SUBGRAPH_POLL_MS || '30000', 10);

// 默认每 12 次 poll（12 × 5s = 60s）做一次容器 liveness check
const LIVENESS_CHECK_EVERY_N = parseInt(process.env.CECELIA_LIVENESS_CHECK_N || '12', 10);

// Fix #3: await_callback 独立总超时兜底（不依赖任何 docker inspect / 容器活性）。
// 覆盖"containerId 存在、本地/远程容器看似活着、但 callback 永不来"的场景：
// 西安网络阻塞 POST、容器内 wget callback 失败 3 次放弃。
//
// ⚠️ 默认值必须 > worker-daemon 的 job 预算（WORKER_TIMEOUT_MS=90min），否则会误杀健康 generator：
// callback 只在 generator job「跑完」才 POST（无中间心跳），一个正常 agentic TDD generator
// （写测试→实现→跑CI→push→建PR）合法地跑 11–89min，10min 默认会把它当「callback 永不来」误杀，
// 把「永挂 bug」换成「误杀健康 generator bug」。故默认 = 90min + 10min grace（时钟漂移/网络/回调往返）。
export const CALLBACK_TIMEOUT_MS = parseInt(
  process.env.CECELIA_CALLBACK_TIMEOUT_MS || `${100 * 60 * 1000}`, 10,
);

// 根因 1（2026-06-10）：CALLBACK_TIMEOUT_MS 是 soft timeout——超过它且容器**确认还在
// running** 时不再 fail-fast（之前会误杀跑超 100min 的健康 generator，尤其 brain 重启
// resume 后 spawnedAt 已老）。容器 running 就继续等，直到 hard ceiling 才放弃；
// 放弃时 docker kill 容器，防僵尸容器迟到 callback 污染后续 fix round 状态。
export const CALLBACK_HARD_CEILING_MS = parseInt(
  process.env.CECELIA_CALLBACK_HARD_CEILING_MS || `${3 * 60 * 60 * 1000}`, 10,
);

/**
 * 放弃等待时强杀容器（hard ceiling 路径）。
 * 远程 codex 容器本地 docker 杀不到 → no-op（worker-daemon 自己有 WORKER_TIMEOUT 预算）。
 *
 * @param {string} containerId
 * @param {object} [opts]
 * @param {string} [opts.executor]
 * @param {Function} [opts.execFileImpl] 注入 execFile（测试用）
 */
export async function _killContainer(containerId, opts = {}) {
  if (opts.executor === 'codex') return;
  const execFile = opts.execFileImpl || execFileCb;
  return new Promise((resolve) => {
    execFile('docker', ['kill', containerId], (err) => {
      if (err) {
        console.warn(`[harness-liveness] docker kill ${containerId} failed (non-fatal): ${err.message}`);
      } else {
        console.warn(`[harness-liveness] docker kill ${containerId} — hard ceiling 放弃僵尸容器`);
      }
      resolve();
    });
  });
}

/**
 * Fix #4: 检查远程 worker-daemon（西安 Codex）是否可达 → 粗判容器活性。
 *
 * worker-daemon /health 返回 { status:'ok', running_jobs:<数字> }。running_jobs 是
 * inFlight.size（数字，不是 id 列表），无法按 containerId 精确判断单个 job，所以远程
 * liveness 只做粗判：daemon 不可达（fetch 抛错/非 200）→ 判死；可达 → 保守 null（活着），
 * 真正的失败靠 Fix #3 的 callback_timeout 兜底。
 *
 * @param {string} daemonUrl
 * @param {Function} [fetchImpl]
 * @returns {Promise<string|null>}
 */
async function _checkRemoteDaemonLiveness(daemonUrl, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  try {
    const resp = await doFetch(`${daemonUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp || !resp.ok) {
      return `daemon_unreachable: ${daemonUrl}/health HTTP ${resp ? resp.status : 'no-response'}`;
    }
    return null; // 可达 → 保守当活着
  } catch (err) {
    return `daemon_unreachable: ${daemonUrl} (${err.message})`;
  }
}

/**
 * 检查容器是否仍在 running。
 * - 本地 claude 容器：docker inspect。exited/dead/不存在 → 视为死亡返回非空错误字符串。
 * - 远程 codex 容器（executor==='codex' && daemonUrl）：查 worker-daemon /health（本地
 *   docker inspect 查不到西安远程容器，会误判 No such → 死亡）。
 * 容器仍在 running 返回 null。
 *
 * @param {string} containerId
 * @param {object} [opts]
 * @param {string} [opts.executor]      'codex' 走远程，否则本地 docker inspect
 * @param {string} [opts.daemonUrl]     远程 worker-daemon base url（codex 用）
 * @param {Function} [opts.fetchImpl]   注入 fetch（测试用）
 * @param {Function} [opts.execFileImpl] 注入 execFile（测试用）
 * @returns {Promise<string|null>}  死亡原因描述 or null（还活着）
 */
export async function _checkContainerLiveness(containerId, opts = {}) {
  // Fix #4: 西安 Codex 远程容器 → 查 worker-daemon /health（本地 docker inspect 查不到）。
  if (opts.executor === 'codex' && opts.daemonUrl) {
    return _checkRemoteDaemonLiveness(opts.daemonUrl, opts.fetchImpl);
  }
  const execFile = opts.execFileImpl || execFileCb;
  return new Promise((resolve) => {
    execFile('docker', ['inspect', '--format', '{{.State.Status}}', containerId], (err, stdout) => {
      if (err) {
        // 只有明确"容器不存在"才视为死亡，其他错误保守返回 null 避免误判
        if (err.message && (err.message.includes('No such') || err.message.includes('not found'))) {
          resolve(`container_inspect_failed: ${err.message}`);
        } else {
          resolve(null);
        }
        return;
      }
      const status = (stdout || '').trim();
      resolve((status === 'exited' || status === 'dead') ? `container_${status}_without_callback` : null);
    });
  });
}

/**
 * 检查 GitHub PR 是否已 merged。
 * B1 fix: container 死亡时先验 PR 状态，防止已完成 WS 被误标 failed。
 *
 * @param {string} prUrl
 * @returns {Promise<boolean>}
 */
async function _checkPrMerged(prUrl) {
  return new Promise((resolve) => {
    execFileCb('gh', ['pr', 'view', prUrl, '--json', 'state', '-q', '.state'], (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve((stdout || '').trim().toUpperCase() === 'MERGED');
    });
  });
}

/**
 * 等待 sub-graph 完成（轮询 getState 直到 next=[]）。
 *
 * 增加容器活性检测（B2/B3 修复）：每 livenessCheckEveryN 次 poll 检查一次
 * sub-graph state 里的 containerId 是否仍在 running。如果容器已死亡（exited/dead/不存在），
 * 主动通过 compiled.invoke({resume:{status:'failed',...}}, config) 唤醒 sub-graph，
 * 避免傻等 90min 超时。
 *
 * @param {object} compiled          LangGraph compiled graph
 * @param {object} config            LangGraph config（含 thread_id）
 * @param {number} timeoutMs         最长等待时间（默认 90min）
 * @param {object} [opts]            测试注入选项
 * @param {number} [opts.pollIntervalMs]     轮询间隔（默认 SUBGRAPH_POLL_INTERVAL_MS）
 * @param {number} [opts.livenessCheckEveryN] 每 N 次 poll 做一次 liveness check（默认 12）
 */
export async function _waitForSubGraphCompletion(compiled, config, timeoutMs, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs ?? SUBGRAPH_POLL_INTERVAL_MS;
  const livenessCheckEveryN = opts.livenessCheckEveryN ?? LIVENESS_CHECK_EVERY_N;
  // B42: 允许测试注入，避免在生产代码里 mock 全局函数
  const checkLiveness = opts._checkLiveness ?? _checkContainerLiveness;
  const checkPrMerged = opts._checkPrMerged ?? _checkPrMerged;
  const killContainer = opts._killContainer ?? _killContainer;

  let deadline = Date.now() + timeoutMs;
  let pollCount = 0;
  // OPEN-2：run_sub_task 是父 graph 的阻塞节点，整个 poll 期间父 checkpoint 不变。
  // 每轮 poll 刷父任务心跳，证明「驱动器还活着」，否则看门狗会把这条活跑误判为 parked 重排。
  const hbPool = opts.heartbeatPool || pool;
  const hbInitiativeId = opts.initiativeId || null;

  while (true) {
    // ── 外层 deadline liveness 感知（06-08 b249b808 实证）────────────────────
    // 旧逻辑 deadline 到期直接返回 status channel 默认值 'queued' → Serial gate 报
    // "did not merge (status=queued)"。且 deadline(90min) < soft timeout(100min from
    // spawnedAt)，内层 liveness 感知在首轮驱动中轮不到——活 generator 仍被外层砍头。
    // 新逻辑：到期先验活性，running 且未到 hard ceiling → 延长等待；running 但超
    // hard ceiling → kill + resume failed（与内层 hard ceiling 同语义）；已死/非
    // await_callback → 返回 failed（不再透传 'queued'）。
    if (Date.now() >= deadline) {
      const st = await compiled.getState(config);
      if (!st.next || st.next.length === 0) return st.values;
      const awaitingCb = Array.isArray(st.next) && st.next.includes('await_callback');
      const cid = st.values?.containerId;
      const sp = st.values?.spawnedAt;
      const underHard = sp ? (Date.now() - sp) < CALLBACK_HARD_CEILING_MS : false;
      const aliveReason = (awaitingCb && cid)
        ? await checkLiveness(cid, { executor: st.values?.executor, daemonUrl: st.values?.daemonUrl })
        : 'not_awaiting_callback';
      if (aliveReason === null && underHard) {
        console.log('[harness-liveness] 外层 deadline 到期但容器仍 running 且未到 hard ceiling → 延长等待');
        deadline = Date.now() + Math.max(pollIntervalMs * livenessCheckEveryN, pollIntervalMs);
      } else if (aliveReason === null && !underHard) {
        // 活着但超 hard ceiling：kill 止血（codex guard 在 _killContainer 内）+ resume failed
        await killContainer(cid, { executor: st.values?.executor })
          .catch((e) => console.warn(`[harness-liveness] kill failed (non-fatal): ${e.message}`));
        console.warn(
          `[harness-liveness] 外层 deadline 到期且超 hard ceiling（${CALLBACK_HARD_CEILING_MS}ms）`
          + ` containerId=${cid} → kill + fail`,
        );
        await compiled.invoke(
          { resume: { status: 'failed', error: 'callback_hard_ceiling' } },
          config,
        ).catch((e) => console.warn(`[harness-liveness] resume invoke failed: ${e.message}`));
        const fs = await compiled.getState(config);
        return { ...(fs.values || {}), status: 'failed' };
      } else {
        const finalStatus = (st.values?.status && st.values.status !== 'queued') ? st.values.status : 'failed';
        return { ...(st.values || {}), status: finalStatus };
      }
    }
    await writeDriverHeartbeat(hbPool, hbInitiativeId);
    const state = await compiled.getState(config);
    if (!state.next || state.next.length === 0) {
      return state.values;
    }

    // ── 容器活性检测（B2/B3）──────────────────────────────────────────────
    // 每 livenessCheckEveryN 次 poll 检查一次容器是否还活着
    // B42 guard: 仅在 sub-graph 停在 await_callback 时才触发
    // 容器 exit(0) 后 sub-graph 已离开 await_callback 继续运行时，不误判为死亡
    const isAwaitingCallback = Array.isArray(state.next) && state.next.includes('await_callback');
    if (isAwaitingCallback && pollCount % livenessCheckEveryN === 0) {
      const containerId = state.values?.containerId;

      // Fix #2: await_callback 但 state 无 containerId（spawn 阶段出错未捕获，
      // 或未来新增的任何"await_callback 时无 containerId"路径）→ 不可恢复态，
      // 第一次检测即判失败 fail-fast，不无脑 poll 到 90min。
      // 注：Fix #1 落地后正常路径不会再走到这（spawn error 已在子图内 END），此为双保险。
      if (!containerId) {
        console.warn('[harness-liveness] await_callback 但 state 无 containerId（spawn 阶段出错未捕获）→ resume failed');
        await compiled.invoke(
          { resume: { status: 'failed', error: 'spawn_missing_containerid' } },
          config,
        ).catch((e) => console.warn(`[harness-liveness] resume invoke failed: ${e.message}`));
        const fs = await compiled.getState(config);
        return { ...(fs.values || {}), status: 'failed' };
      }

      // Fix #3 + 根因 1（liveness 感知）: await_callback 独立总超时 —— containerId 存在但
      // callback 迟迟不来。soft timeout（CALLBACK_TIMEOUT_MS）只对「容器已死」fail-fast；
      // 容器确认还在 running → 继续等到 hard ceiling（CALLBACK_HARD_CEILING_MS），
      // 超 hard ceiling 才放弃，且放弃前 docker kill 防僵尸容器迟到 callback。
      const spawnedAt = state.values?.spawnedAt;
      const elapsedSinceSpawn = spawnedAt ? (Date.now() - spawnedAt) : 0;
      if (spawnedAt && elapsedSinceSpawn > CALLBACK_TIMEOUT_MS) {
        // 与死亡路径一致：fail 前先验 PR 是否已 merged。覆盖「generator 成功 push+merge 但
        // callback POST 丢了」——否则会把一个真成功的 generator 误判 failed、白跑一个 fix round。
        const prUrl = state.values?.pr_url;
        if (prUrl) {
          const alreadyMerged = await checkPrMerged(prUrl).catch(() => false);
          if (alreadyMerged) {
            console.log(
              `[harness-liveness] callback_timeout 但 PR 已 merged（${prUrl}），判 success`,
            );
            return { ...(state.values), status: 'merged' };
          }
        }
        const timeoutDeathReason = await checkLiveness(containerId, {
          executor: state.values?.executor,
          daemonUrl: state.values?.daemonUrl,
        });
        if (!timeoutDeathReason && elapsedSinceSpawn <= CALLBACK_HARD_CEILING_MS) {
          // 容器确认还在 running → 不误杀，继续等（liveness 本轮已查过，直接进下一轮 poll）
          console.warn(
            `[harness-liveness] await_callback 超 soft timeout（${CALLBACK_TIMEOUT_MS}ms）`
            + ` 但容器 ${containerId} 仍 running → 继续等到 hard ceiling（${CALLBACK_HARD_CEILING_MS}ms）`,
          );
          pollCount++;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          continue;
        }
        let giveUpReason;
        if (timeoutDeathReason) {
          giveUpReason = `callback_timeout: ${timeoutDeathReason}`;
        } else {
          // 超 hard ceiling 容器还在跑 → 僵尸，放弃前 kill 防迟到 callback 污染后续状态
          giveUpReason = 'callback_hard_ceiling';
          await killContainer(containerId, { executor: state.values?.executor })
            .catch((e) => console.warn(`[harness-liveness] kill failed (non-fatal): ${e.message}`));
        }
        console.warn(
          `[harness-liveness] await_callback 放弃等待（elapsed=${elapsedSinceSpawn}ms）`
          + ` containerId=${containerId} → ${giveUpReason}`,
        );
        await compiled.invoke(
          { resume: { status: 'failed', error: giveUpReason } },
          config,
        ).catch((e) => console.warn(`[harness-liveness] resume invoke failed: ${e.message}`));
        const fs = await compiled.getState(config);
        return { ...(fs.values || {}), status: 'failed' };
      }

      {
        // Fix #4: 远程 codex 容器走 worker-daemon /health，本地 claude 容器走 docker inspect。
        const deathReason = await checkLiveness(containerId, {
          executor: state.values?.executor,
          daemonUrl: state.values?.daemonUrl,
        });
        if (deathReason) {
          // B1 fix: 先验 PR 是否已 merged，已 merged → success，不走 failure
          const prUrl = state.values?.pr_url;
          if (prUrl) {
            const alreadyMerged = await checkPrMerged(prUrl);
            if (alreadyMerged) {
              console.log(
                `[harness-liveness] Container ${containerId} exited after PR merged (${prUrl}), treating as success`
              );
              return { ...(state.values), status: 'merged' };
            }
          }
          // 容器已死，主动 resume sub-graph 走 failure 路径
          console.warn(
            `[harness-liveness] Container ${containerId} died (${deathReason}), resuming sub-graph with failure`
          );
          try {
            await compiled.invoke(
              { resume: { status: 'failed', error: deathReason } },
              config
            );
          } catch (resumeErr) {
            // resume 失败时记录警告（sub-graph 可能已经在 END 了）
            console.warn(`[harness-liveness] resume invoke failed: ${resumeErr.message}`);
          }
          // resume 后 getState 拿最新状态
          const finalState = await compiled.getState(config);
          // 'queued' 是 status channel 默认值，resume 失败时透传它会让 Serial gate 误读
          // 为 "did not merge (status=queued)" —— 与外层 deadline 同根因，一并钉死为 failed
          const deathStatus = finalState.values?.status && finalState.values.status !== 'queued'
            ? finalState.values.status : 'failed';
          return { ...(finalState.values || {}), status: deathStatus };
        }
      }
    }

    pollCount++;
    // 还在中间节点（通常 await_callback interrupt） — 等下一轮 poll
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  // 不可达：deadline 处置在循环头完成（延长 / kill+fail / 返回 failed），无自然出口
}

export async function runSubTaskNode(state, opts = {}) {
  const subTask = state.sub_task;
  if (!subTask) return {};
  const _runDbPool = opts.pool || pool;
  await emitLangGraphStep(_runDbPool, state.initiativeId, {
    node: 'generator',
    sub_task_id: subTask.id,
    task_index: state.task_loop_index ?? 0,
  });
  const fixCount = state.task_loop_fix_count ?? 0;
  const feedback = state.evaluate_feedback;
  const taskForGraph = {
    id: subTask.id,
    title: subTask.title,
    description: subTask.description,
    payload: {
      ...subTask.payload,
      // 注入 logical_task_id（如 "ws1"）让 spawnNode extractWorkstreamIndex 解出 WORKSTREAM_INDEX。
      // generator skill 检测到 WORKSTREAM_INDEX 空就 ABORT（dispatch 协议 fail）。
      logical_task_id: subTask.id,
      // B38: 用 parsePrdNode/B37 修正后的 sprintDir 覆盖 subTask.payload.sprint_dir。
      // subTask.payload.sprint_dir = 原始 payload 顶级值（如 "sprints"），未经 git diff 修正。
      // generator spawnNode 读 task.payload.sprint_dir → SPRINT_DIR env，
      // 不覆盖导致 generator 写到顶级 sprints/ 而非正确子目录（W49 实证 B38 根因）。
      ...(state.sprintDir ? { sprint_dir: state.sprintDir } : {}),
      final_e2e_fix_count: state.final_e2e_fix_count ?? 0,
      ...(fixCount > 0 && feedback ? { fix_round: fixCount, evaluator_feedback: feedback } : {}),
      // 透传 initiative 级别执行器路由（西安 Codex 对比用）。spawnNode → resolveExecutor
      // 读 task.payload.{machine,executor} 决定 Generator 跑美国 Claude 还是西安 Codex。
      ...(state.task?.payload?.machine ? { machine: state.task.payload.machine } : {}),
      ...(state.task?.payload?.executor ? { executor: state.task.payload.executor } : {}),
    },
  };
  const compiled = opts.compiledTaskGraph || await _getTaskGraphCompiled();
  // contractBranch 是子图线程身份的语义版本维度。此处解析一次，既喂 thread_id 也喂 invoke
  // 输入，保证父子两侧 thread_id 完全一致（子图 spawn/evaluate 用 state.contractBranch 折同一后缀）。
  const contractBranchForThread = state.contractBranch || state.ganResult?.propose_branch || null;
  // final_e2e_fix_count 追加到 thread_id：final_evaluate FAIL 重跑时用 fresh checkpoint，避免旧状态污染
  // thread_id 含 fix_count 保证 evaluate_contract FAIL 重试时用 fresh checkpoint
  // 合同绑定（run da418741 死线程修复）：thread_id 追加 contractBranch 折出的稳定短 token。
  // 合同经 GAN 重新收敛 → propose 分支变 → token 变 → 新线程，绝不复用旧合同留下的终局
  // checkpoint（旧 fix0 线程 contract_invalid 已 END，再 invoke 会秒回死状态、无节点执行）。
  const threadId = `harness-task:${state.initiativeId}:${subTask.id}:fix${state.final_e2e_fix_count ?? 0}${harnessContractThreadSuffix(contractBranchForThread)}`;
  const config = { configurable: { thread_id: threadId }, recursionLimit: 200 };
  const waitMs = opts.waitMs !== undefined ? opts.waitMs : SUBGRAPH_WAIT_MS;
  // 诊断：进 generator 子图前记录关键上下文，便于 generator 那层失败时定位。
  console.log(
    `[runSubTaskNode] invoke generator sub-graph thread=${config.configurable.thread_id}`
    + ` sub_task=${subTask.id} baseRepo=${state.task?.payload?.base_repo || '(none)'}`
    + ` contractBranch=${contractBranchForThread || '(none)'}`
    + ` machine=${state.task?.payload?.machine || '-'} executor=${state.task?.payload?.executor || '-'}`
  );
  // 防御诊断（Fix 3）：合同绑定后目标线程正常应是 fresh（无 checkpoint）。若探到该线程已存在
  // 终局 checkpoint（next=[] 且 values 非空），说明 thread_id 仍复用了旧终局态——invoke 必然
  // 秒回死状态、无任何节点执行。留明确告警钩子，便于本类 bug 复发时一眼定位（不阻断流程）。
  try {
    const _getState = opts._getStateForDiag || (() => compiled.getState(config));
    const pre = await _getState();
    const preVals = pre && pre.values ? pre.values : {};
    const hasCheckpoint = preVals && Object.keys(preVals).length > 0;
    const isTerminal = pre && (!pre.next || pre.next.length === 0);
    if (hasCheckpoint && isTerminal) {
      console.warn(
        `[runSubTaskNode] ⚠️ 死线程探测：thread=${config.configurable.thread_id} 已存在终局 checkpoint`
        + ` (next=[], status=${preVals.status}, failure_class=${preVals.failure_class || '-'})`
        + ` — invoke 将秒回死状态、无节点执行。若本轮是合同重新收敛，说明 thread_id 合同绑定未生效，`
        + ` 请检查 contractBranch 传递（当前 contractBranch=${contractBranchForThread || '(none)'}）。`
      );
    }
  } catch (diagErr) {
    // fresh thread getState 在部分 checkpointer 实现下可能抛错/返回空 — 诊断钩子吞掉不影响主流程。
    if (process.env.HARNESS_DEBUG) console.warn(`[runSubTaskNode] 死线程探测 getState 失败（忽略）：${diagErr.message}`);
  }
  let final;
  try {
    const firstResult = await compiled.invoke(
      {
        task: taskForGraph,
        initiativeId: state.initiativeId,
        // 不传 state.worktreePath — initiative worktree HEAD 在 contract branch（GAN proposer push）。
        // sub_task generator 期待 fresh worktree off main，让 sub-graph spawnNode 自己
        // ensureHarnessWorktree 建独立 worktree（用 sub_task.id 作 key）。
        // worktreePath: state.worktreePath,
        githubToken: state.githubToken,
        contractBranch: contractBranchForThread,
        baseRepo: state.task?.payload?.base_repo || undefined,
        prdContent: state.prdContent || null,
      },
      config
    );
    // Layer 3：sub-graph 可能停在 await_callback interrupt — poll 直到 END
    if (firstResult && firstResult.status && firstResult.status !== 'queued') {
      // Sub-graph 直接走完（无 interrupt 路径，比如 mock spawn 立即返回 generator_output 时）
      final = firstResult;
    } else {
      // sub-graph 大概率停在 await_callback interrupt — poll getState 等到 END
      // opts.waitOpts 供测试注入 pollIntervalMs / livenessCheckEveryN
      // OPEN-2：注入 initiativeId + pool，让 poll 期间持续刷父任务驱动器心跳。
      final = await _waitForSubGraphCompletion(compiled, config, waitMs, {
        initiativeId: state.initiativeId,
        heartbeatPool: _runDbPool,
        ...(opts.waitOpts || {}),
      });
    }
  } catch (err) {
    // 诊断（B：旧代码吞掉 sub-graph invoke 报错 → generator 失败零日志，实证 de4b2668 查不到原因）。
    // 必须 console.error 出 message+stack，并把 error 透到 sub_task.evaluator_feedback 让 reportNode
    // ws_issues 可见。
    console.error(
      `[runSubTaskNode] sub-graph invoke 抛错 sub_task=${subTask.id}`
      + ` thread=${config.configurable.thread_id}: ${err.message}\n${err.stack || ''}`
    );
    final = { status: 'failed', error: { node: 'sub_graph', message: err.message } };
  }
  // Fix 2：contract_invalid 终局必须作为「带原因的明确状态」上浮，而非被 "Serial gate: did not
  // merge (status=queued)" 通用文案掩盖（run da418741 排障要靠日志拼时间线的根因之一）。
  // 子图 contract_invalid 路径 evaluate→END 时不写 status（停在默认 'queued'），但 final 带
  // failure_class='contract_invalid' + evaluate_error。这里把它升成显式 ci_fail_type + feedback。
  const isContractInvalid = final.failure_class === 'contract_invalid';
  // 诊断：记录子图最终结果（status + error + failure_class），便于复盘 generator 那层。
  if (final.status !== 'merged' && final.status !== 'completed') {
    console.warn(
      `[runSubTaskNode] sub_task=${subTask.id} 非成功终态 status=${final.status}`
      + ` failure_class=${final.failure_class || '-'}`
      + ` error=${final.error ? JSON.stringify(final.error) : '(none)'} pr_url=${final.pr_url || '(none)'}`
      + (isContractInvalid ? ' [合同质量缺陷·责任在 GAN proposer，需重发让 proposer 修合同]' : '')
    );
  }
  return {
    sub_tasks: [{
      id: subTask.id,
      title: subTask.title,
      status: final.status,
      pr_url: final.pr_url,
      fix_round: final.fix_round,
      cost_usd: final.cost_usd,
      // Fix 2：contract_invalid 单独打型，让 reportNode ws_issues 显示明确原因而非通用失败。
      ci_fail_type: final.ci_fail_type || (isContractInvalid ? 'contract_invalid' : undefined),
      // 透传失败信息（error / 子图 evaluator_feedback / contract_invalid 的 evaluate_error）→
      // reportNode ws_issues 可见。evaluate_error 兜底覆盖 contract_invalid 终局原因。
      evaluator_feedback: final.evaluator_feedback
        || final.evaluate_error
        || (final.error ? (typeof final.error === 'string' ? final.error : JSON.stringify(final.error)) : undefined),
    }],
  };
}
export async function reportNode(state, opts = {}) {
  // 幂等门：节点重放时 short circuit（state.report_path 已写过 → 已 UPDATE initiative_runs，
  // 重入会重复 UPDATE，虽语义等幂但增加 DB 负载且 completed_at 会刷新）。
  if (state.report_path) return { report_path: state.report_path };
  const dbPool = opts.pool || pool;
  await emitLangGraphStep(dbPool, state.initiativeId, {
    node: 'report',
    evaluator_verdict: state.final_e2e_verdict || null,
    workstreams: (state.sub_tasks || []).map(s => s.id),
    pr_urls: (state.sub_tasks || []).filter(s => s.pr_url).map(s => s.pr_url),
    ws_verdicts: (state.sub_tasks || []).map(s => s.status),
  });

  // Compute step_timing from task_events graph_node_update events (same logic as /detail endpoint)
  let step_timing = [];
  try {
    const { rows: evtRows } = await dbPool.query(
      `SELECT payload, created_at
       FROM task_events
       WHERE task_id = $1::uuid AND event_type = 'graph_node_update'
       ORDER BY created_at ASC`,
      [state.initiativeId]
    );
    for (let i = 0; i < evtRows.length; i++) {
      const p = evtRows[i].payload || {};
      const started_at = new Date(evtRows[i].created_at).toISOString();
      const nextTs = evtRows[i + 1]?.created_at;
      const duration_ms = nextTs
        ? new Date(nextTs).getTime() - new Date(evtRows[i].created_at).getTime()
        : null;
      step_timing.push({ node: p.nodeName || 'unknown', started_at, duration_ms });
    }
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode step_timing query failed: ${err.message}`);
  }

  // Compute ws_issues from sub_tasks (evaluator_feedback + ci_fail_type)
  const ws_issues = (state.sub_tasks || [])
    .filter(s => s.ci_fail_type || s.evaluator_feedback)
    .map(s => ({
      ws_id: s.id,
      feedback: s.evaluator_feedback || null,
      ci_fail_type: s.ci_fail_type || null,
    }));

  // Compute ws_costs from sub_tasks (ws_id + cost_usd)
  const ws_costs = (state.sub_tasks || []).map(s => ({
    ws_id: s.id,
    cost_usd: s.cost_usd || 0,
  }));

  // merge-race 修复：reportNode 可能在 sub_task PR 的 auto-merge 完成前抢跑（实测 PR 创建到
  // merge 约 10 分钟：CI + squash）。对有 pr_url 但 status≠merged 的 sub_task 回查 GitHub 真实
  // merge 状态，已 merge 则纠正为 merged——否则会把"PR 已合并但 graph state 未刷新"误判成
  // Final E2E FAIL（failed_scenarios 为空的空 reason FAIL，实证 PR#50 已 merged 仍判 FAIL）。
  const checkPrMerged = opts._checkPrMerged ?? _checkPrMerged;
  const reconciledSubTasks = await Promise.all((state.sub_tasks || []).map(async (s) => {
    if (s && s.status !== 'merged' && s.pr_url) {
      const merged = await checkPrMerged(s.pr_url).catch(() => false);
      if (merged) {
        console.log(`[reportNode] merge-race 纠正：${s.id} PR ${s.pr_url} 实际已 merged，status→merged`);
        return { ...s, status: 'merged' };
      }
    }
    return s;
  }));

  // B45 Fix1: final_e2e_verdict 没有节点主动写时，从 sub_tasks 状态推导
  // 单一 evaluator pre-merge gate 设计：每个 ws evaluate_contract PASS 才能 merge
  // 所以全部 merged = 等价于 Final E2E PASS
  const computedVerdict = state.final_e2e_verdict ||
    ((reconciledSubTasks.length > 0 && reconciledSubTasks.every(s => s.status === 'merged'))
      ? 'PASS' : 'FAIL');

  const reportContent = JSON.stringify({
    initiativeId: state.initiativeId,
    sub_tasks: reconciledSubTasks,
    final_e2e_verdict: computedVerdict,
    failed_scenarios: state.final_e2e_failed_scenarios || [],
    step_timing,
    ws_issues,
    ws_costs,
    cost_usd: (state.sub_tasks || []).reduce((a, s) => a + (s.cost_usd || 0), 0),
    completed_at: new Date().toISOString(),
  }, null, 2);
  // 写 initiative_runs phase=done/failed
  try {
    const phase = computedVerdict === 'PASS' ? 'done' : 'failed';
    if (computedVerdict === 'FAIL') {
      // B45: 使用 computedVerdict（可从 sub_tasks 推导）
      console.error(`[reportNode] computedVerdict=FAIL initiative=${state.initiativeId} → 标 phase='failed'，executor 会标 task.status='failed'`);
    }
    const reason = `Final E2E ${computedVerdict}: ${(state.final_e2e_failed_scenarios || []).map(s => s.name).join('; ').slice(0, 500)}`;
    // B45: 使用 pool.connect() → client.query 确保测试 mock 可验证、支持连接复用
    const client = await dbPool.connect();
    try {
      await client.query(
        `UPDATE initiative_runs SET phase=$2, completed_at=NOW(), updated_at=NOW(),
          failure_reason=CASE WHEN $2='failed' THEN $3 ELSE failure_reason END
         WHERE initiative_id=$1::uuid`,
        [state.initiativeId, phase, reason]
      );
      // B1: 同时回写 tasks.status — 否则 task 永卡 in_progress（graph 不经 executor.js
      // 这条 happy path，注释 line 1107 "executor 会标 task.status='failed'" 仅 FAIL 路径
      // 的 ws-level fallback，PASS 路径无人回写）。W28 实证：13 个 checkpoint 全跑过
      // prep→...→report 但 tasks.status 仓 in_progress。Walking Skeleton P1 修补点。
      const taskStatus = computedVerdict === 'PASS' ? 'completed' : 'failed';
      await client.query(
        `UPDATE tasks SET status=$2::text, completed_at=NOW(), updated_at=NOW(),
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('report_content', $4::jsonb),
          error_message=CASE WHEN $2::text='failed' THEN $3::text ELSE error_message END
         WHERE id=$1::uuid`,
        [state.initiativeId, taskStatus, reason, reportContent]
      );
      // 2b-2b: 镜像同步对应 okr_initiative → done/failed（non-fatal，best-effort）
      try {
        const { syncOkrInitiativeStatus } = await import('../okr-initiative-sync.js');
        await syncOkrInitiativeStatus(client, state.initiativeId, phase === 'done' ? 'done' : 'failed');
      } catch (syncErr) {
        console.warn(`[reportNode] okr-initiative sync non-fatal: ${syncErr.message}`);
      }
    } finally {
      client.release();
    }
    // B2 fix: initiative 终态 → 主动 kill 关联容器（zombie 防治）
    killInitiativeContainers(state.initiativeId).catch(err2 =>
      console.warn(`[reportNode] container cleanup failed: ${err2.message}`)
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
  // 派 harness_report 子任务（6 步交付：Notion / 飞书 / harness-report.md）
  try {
    await dbPool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       VALUES ($1, $2, 'harness_report', 'queued', 'P2', $3::jsonb)`,
      [
        `[Harness Report] ${state.task?.title || state.initiativeId}`,
        `Auto-spawned by reportNode for initiative ${state.initiativeId}`,
        JSON.stringify({
          initiative_id: state.initiativeId,
          final_e2e_verdict: computedVerdict,
          sprint_dir: state.sprintDir,
          journey_id: state.task?.payload?.journey_id,
          feature_id: state.task?.payload?.feature_id,
          feature_name: state.task?.payload?.feature_name || state.task?.title || '',
          pr_url: (state.sub_tasks || [])[0]?.pr_url || '',
          pr_urls: (state.sub_tasks || []).map((t) => t.pr_url).filter(Boolean),
          sub_tasks: state.sub_tasks || [],
          gan_rounds: state.ganResult?.rounds || 0,
          gan_cost_usd: state.ganResult?.cost_usd || 0,
        }),
      ]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode spawn harness_report failed: ${err.message}`);
  }
  return { report_path: reportContent };
}

// ──────────────────────────────────────────────────────────────────────────
// Serial evaluate loop nodes (Change 4)

export async function pickSubTaskNode(state) {
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index ?? 0;
  if (idx >= tasks.length) {
    return { sub_task: null };
  }
  const t = tasks[idx];
  return {
    sub_task: {
      id: t.id || t.task_id,
      title: t.title,
      description: t.scope || t.description,
      payload: { dod: t.dod, files: t.files, depends_on: t.depends_on },
    },
    task_loop_fix_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}

// Serial gate resume 防护：status=queued 无终败证据时最多重跑当前 sub-task 的次数。
// 超过则视为真未收敛 → terminal FAIL（杜绝本修复自身在病态 status 下死循环）。
const SERIAL_GATE_REQUEUE_CAP = 2;

export async function advanceTaskIndexNode(state, opts = {}) {
  // Serial merge gate: 刚完成的 sub-task (tasks[idx]) 必须 merged 才能推进
  const subTasks = state.sub_tasks || [];
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index ?? 0;
  if (subTasks.length > 0 && idx < tasks.length) {
    const currentTask = tasks[idx];
    const currentId = currentTask?.id || currentTask?.task_id;
    const record = subTasks.find((s) => s.id === currentId);
    if (record && record.status !== 'merged') {
      // ── Resume 终局误判防护（根因：serial gate 在 resume 路径用陈旧 checkpoint 状态做终局
      //    判断）。在飞 run 期间另一 PR merge 触发部署重启 → startup-sync re-queue + dispatcher
      //    resume → 恢复图走到本 gate，sub_task 状态仍是 checkpoint 旧值（queued/未 merged），
      //    在飞工作其实可恢复，却被直接判终败误杀兄弟 run（实证 d8acba51 / c0e2546b）。
      //    教训：终局判断必须基于持久事实源，不能信 resume 时的陈旧 checkpoint。
      const checkPrMerged = opts._checkPrMerged ?? _checkPrMerged;

      // 1) 持久事实源 = GitHub PR 状态。已 merged → 与 reportNode/liveness 既有 merge-race
      //    纠正（#3341 短路）同语义：纠正 sub_tasks 状态并放行推进，绝不误判 FAIL。
      if (record.pr_url) {
        const merged = await checkPrMerged(record.pr_url).catch(() => false);
        if (merged) {
          console.log(
            `[advance] resume merge-race 纠正：${currentId} PR ${record.pr_url} 实际已 merged，serial gate 放行推进`
          );
          return {
            sub_tasks: [{ ...record, status: 'merged' }],  // reducer merge-by-id
            task_loop_index: idx + 1,
            task_loop_fix_count: 0,
            serial_gate_requeue_count: 0,
            evaluate_verdict: null,
            evaluate_feedback: null,
          };
        }
      }

      // 2) 无终败证据：status=queued（status channel 默认值，resume 时透传）或缺失，且 PR 未
      //    merged —— 说明是「在飞工作被重启截断」而非真失败。不判 FAIL，重新进入 run_sub_task
      //    复用既有幂等链路继续推进当前 sub-task（不递增 task_loop_index → pick_sub_task 重选同一个）。
      const noTerminalEvidence = !record.status || record.status === 'queued';
      const requeueCount = state.serial_gate_requeue_count ?? 0;
      if (noTerminalEvidence && requeueCount < SERIAL_GATE_REQUEUE_CAP) {
        console.warn(
          `[advance] resume 防护：${currentId} status=${record.status ?? 'undefined'} 无终败证据`
          + `（PR 未 merged 或合同/分支仍在飞）→ 重跑当前 sub-task（第 ${requeueCount + 1}/${SERIAL_GATE_REQUEUE_CAP} 次），不判 FAIL`
        );
        return {
          // 不递增 task_loop_index → 重选同一 sub-task → run_sub_task 幂等重跑
          serial_gate_requeue_count: requeueCount + 1,
          task_loop_fix_count: 0,
          evaluate_verdict: null,
          evaluate_feedback: null,
        };
      }

      // 3) genuine 终败（status=failed 等）或 requeue 超上限仍未收敛 → terminal FAIL（保持原语义）。
      return {
        error: {
          node: 'advance',
          message: `Serial gate: sub-task ${currentId} did not merge (status=${record.status ?? 'undefined'}). Next workstream blocked.`,
          terminal: true,  // serial gate 本就是 terminal，标上保持一致
        },
      };
    }
  }
  return {
    task_loop_index: idx + 1,
    task_loop_fix_count: 0,
    serial_gate_requeue_count: 0,
    evaluate_verdict: null,
    evaluate_feedback: null,
  };
}

export async function retryTaskNode(state) {
  return {
    task_loop_fix_count: (state.task_loop_fix_count ?? 0) + 1,
    evaluate_verdict: null,
    // Keep evaluate_feedback — run_sub_task will use it as fix context
  };
}

export async function terminalFailNode(state, opts = {}) {
  // 幂等门：节点重放时 short circuit（已写过 initiative_runs phase='failed'，
  // 重入会再次刷 completed_at，不必要的 DB 负载）。
  if (state.error?.node === 'terminal_fail') return { error: state.error };
  const dbPool = opts.pool || pool;
  const reason = `Evaluator FAIL on task index ${state.task_loop_index ?? 0}: ${(state.evaluate_feedback || '').slice(0, 300)}`;
  try {
    await dbPool.query(
      `UPDATE initiative_runs SET phase='failed', failure_reason=$1, completed_at=NOW(), updated_at=NOW() WHERE initiative_id=$2::uuid`,
      [reason.slice(0, 500), state.initiativeId]
    );
    // B2 fix: terminal fail → 主动 kill 关联容器
    killInitiativeContainers(state.initiativeId).catch(err2 =>
      console.warn(`[terminalFailNode] container cleanup failed: ${err2.message}`)
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] terminalFailNode db update failed: ${err.message}`);
  }
  return { error: { node: 'terminal_fail', message: reason, terminal: true } };
}

// Change 5: New routing functions

export function routeFromPickSubTask(state) {
  if (state.error) return 'end';
  const tasks = state.taskPlan?.tasks || [];
  const idx = state.task_loop_index ?? 0;
  if (idx >= tasks.length) return 'report';
  return 'run_sub_task';
}
// ──────────────────────────────────────────────────────────────────────────
// 完整 graph：Phase A + B + C 全程 LangGraph

export function _routeAfterFinalE2E(state) {
  if (state.error) return 'report';
  if (state.final_e2e_verdict === 'PASS' || state.final_e2e_verdict === 'PASS_WITH_OVERRIDE') return 'report';
  return 'pick_sub_task'; // FAIL → 重跑所有 sub-tasks
}

export function buildHarnessFullGraph(nodeOverrides = {}) {
  const {
    runSubTaskFn = runSubTaskNode,
  } = nodeOverrides;
  // 节点级 RetryPolicy（W2）—— 见 packages/brain/src/workflows/retry-policies.js
  // LLM_RETRY: planner / ganLoop / run_sub_task
  // DB_RETRY:  dbUpsert / report
  // NO_RETRY:  prep / parsePrd / inferTaskPlan / pick_sub_task / advance
  // 单一 evaluator 设计：per-task evaluate_contract 节点（IS_FINAL_E2E=true）在 harness-task.graph.js
  // 子图内完成 pre-merge 全量 E2E 验收，initiative graph 不再有独立 final_evaluate 节点。
  // 对齐 Anthropic 官方 Harness 设计（单 evaluator pre-merge 迭代循环）。
  return new StateGraph(FullInitiativeState)
    .addNode('prep', prepInitiativeNode, { retryPolicy: NO_RETRY })
    .addNode('planner', runPlannerNode, { retryPolicy: LLM_RETRY })
    .addNode('parsePrd', parsePrdNode, { retryPolicy: NO_RETRY })
    .addNode('ganLoop', runGanLoopNode, { retryPolicy: LLM_RETRY })
    .addNode('inferTaskPlan', inferTaskPlanNode, { retryPolicy: NO_RETRY })
    .addNode('dbUpsert', dbUpsertNode, { retryPolicy: DB_RETRY })
    .addNode('pick_sub_task', pickSubTaskNode, { retryPolicy: NO_RETRY })
    .addNode('run_sub_task', runSubTaskFn, { retryPolicy: LLM_RETRY })
    .addNode('advance', advanceTaskIndexNode, { retryPolicy: NO_RETRY })
    .addNode('report', reportNode, { retryPolicy: DB_RETRY })
    .addEdge(START, 'prep')
    .addConditionalEdges('prep', stateHasError, { error: END, ok: 'planner' })
    .addConditionalEdges('planner', stateHasError, { error: END, ok: 'parsePrd' })
    .addConditionalEdges('parsePrd', stateHasError, { error: END, ok: 'ganLoop' })
    .addConditionalEdges('ganLoop', stateHasError, { error: END, ok: 'inferTaskPlan' })
    .addConditionalEdges('inferTaskPlan', stateHasError, { error: END, ok: 'dbUpsert' })
    .addConditionalEdges('dbUpsert', stateHasError, { error: END, ok: 'pick_sub_task' })
    .addConditionalEdges('pick_sub_task', routeFromPickSubTask, { run_sub_task: 'run_sub_task', report: 'report', end: END })
    .addEdge('run_sub_task', 'advance')
    .addConditionalEdges('advance', stateHasError, { error: 'report', ok: 'pick_sub_task' })
    .addEdge('report', END);
}

export async function compileHarnessFullGraph() {
  const checkpointer = await getPgCheckpointer();
  return buildHarnessFullGraph().compile({ checkpointer, durability: 'sync' });
}
