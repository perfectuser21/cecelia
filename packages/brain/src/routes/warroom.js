/**
 * routes/warroom.js — 战情室统一 feed API
 *
 * GET /api/brain/warroom/feed?days=7
 *   聚合所有"跑起来的任务"（harness_initiative / dev / content-pipeline / platform_scraper），
 *   按 Area → Group 两级分组，附 active harness 的进度，返回全局统计。
 *
 * 分组/聚合逻辑全在 warroom-classify.js（纯函数，已单测）；本 route 只做 SQL + 装配。
 */

import { Router } from 'express';
import pool from '../db.js';
import {
  buildFeed, computeStats, shanghaiDay, normalizeLg, toFeedItem,
  classifyJourneyArea, computeStepProgress, journeyIdKeys, taskMatchesJourney,
  normStatus,
} from '../warroom-classify.js';
import { buildPipelineRecord } from './status.js';
import { fetchLineContext, formatLineContextForPrompt } from '../harness-line-context.js';
import { buildLineDreamData } from '../line-dreaming.js';

const router = Router();

// harness initiative_run_events 节点 → 进度百分比（与 harness.js progress 端点对齐）
const NODE_PCT = {
  prep: 5, planner: 15, parsePrd: 25, ganLoop: 40, dbUpsert: 50,
  generator: 65, evaluator: 80, merge: 90, report: 100,
};

// 纳入 feed 的任务类型（有实质执行的；排除 harness_report 等子任务噪音）
const FEED_TYPES = ['harness_initiative', 'dev', 'content-pipeline', 'platform_scraper'];

const AREA_NAMES = { cecelia: 'Cecelia', zenithjoy: 'ZenithJoy' };

/**
 * 拉一批 sprint（harness_initiative）任务的 harness_report 摘要（verdict / pr / findings）。
 * 与 /feed 同源逻辑，抽成可复用函数供 /line/:id 复用。
 * @param {number} days  时间窗（天）
 * @returns {Promise<Record<string,{verdict,pr_url,findings_count}>>}  key = initiative_id
 */
async function fetchReportByInitiativeId(days) {
  const reportByInitiativeId = {};
  try {
    const { rows: reps } = await pool.query(
      `SELECT payload->>'initiative_id' AS initiative_id,
              payload->>'final_e2e_verdict' AS verdict,
              payload->>'pr_url' AS pr_url,
              payload->'findings' AS findings
       FROM tasks
       WHERE task_type = 'harness_report'
         AND created_at > NOW() - ($1 || ' days')::interval
         AND payload->>'initiative_id' IS NOT NULL`,
      [String(days)]
    );
    for (const r of reps) {
      const fc = Array.isArray(r.findings) ? r.findings.length : null;
      reportByInitiativeId[r.initiative_id] = {
        verdict: r.verdict || null,
        pr_url: r.pr_url || null,
        findings_count: fc,
      };
    }
  } catch { /* harness_report 缺失不阻塞 */ }
  return reportByInitiativeId;
}

/**
 * 为一批 sprint 任务构造 LangGraph 富数据（join cecelia_events langgraph_step → buildPipelineRecord → normalizeLg）。
 * 与 /feed 同源逻辑，抽成可复用函数供 /line/:id 复用。
 * @param {object[]} tasks  含 harness_initiative 的任务列表
 * @returns {Promise<Record<string,object>>}  key = planner_task_id（=== harness_initiative.id）
 */
async function fetchLgByPlannerTaskId(tasks) {
  const lgByPlannerTaskId = {};
  try {
    const sprintIds = tasks
      .filter((t) => t.task_type === 'harness_initiative')
      .map((t) => t.id);
    if (sprintIds.length === 0) return lgByPlannerTaskId;

    const eventsByTask = new Map();
    const { rows: evRows } = await pool.query(
      `SELECT task_id, payload, created_at
       FROM cecelia_events
       WHERE task_id = ANY($1::uuid[])
         AND event_type = 'langgraph_step'
       ORDER BY created_at ASC`,
      [sprintIds]
    );
    for (const row of evRows) {
      const tid = String(row.task_id);
      if (!eventsByTask.has(tid)) eventsByTask.set(tid, []);
      eventsByTask.get(tid).push(row);
    }
    for (const t of tasks) {
      if (t.task_type !== 'harness_initiative') continue;
      const evs = eventsByTask.get(String(t.id)) || [];
      const rec = buildPipelineRecord(t, evs, null);
      lgByPlannerTaskId[t.id] = normalizeLg(rec);
    }
  } catch (e) {
    console.error('[warroom] langgraph join failed:', e.message);
  }
  return lgByPlannerTaskId;
}

router.get('/feed', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 90);

    // 1. 拉任务
    const { rows: tasks } = await pool.query(
      `SELECT id, title, description, task_type, status, priority, payload,
              created_at, started_at, completed_at, updated_at, error_message, pr_url, result
       FROM tasks
       WHERE task_type = ANY($1)
         AND created_at > NOW() - ($2 || ' days')::interval
       ORDER BY created_at DESC
       LIMIT 300`,
      [FEED_TYPES, String(days)]
    );

    // 2. journey 名映射（id + notion_id 双键，因 payload.journey_id 两种格式都有）
    const journeyNameById = {};
    try {
      const { rows: js } = await pool.query('SELECT id, notion_id, name FROM journeys');
      for (const j of js) {
        if (j.id) journeyNameById[j.id] = j.name;
        if (j.notion_id) journeyNameById[j.notion_id] = j.name;
      }
    } catch { /* journeys 表缺失不阻塞 feed */ }

    // 3. active harness 的进度（仅进行中的查 events，省开销）
    const activeHarness = tasks
      .filter((t) => t.task_type === 'harness_initiative' && t.status === 'in_progress')
      .map((t) => t.id);
    const progressById = {};
    if (activeHarness.length > 0) {
      try {
        const { rows: evs } = await pool.query(
          `SELECT initiative_id, node FROM initiative_run_events
           WHERE initiative_id = ANY($1::uuid[]) AND status = 'completed'`,
          [activeHarness]
        );
        for (const e of evs) {
          const pct = NODE_PCT[e.node];
          if (pct == null) continue;
          const cur = progressById[e.initiative_id];
          if (!cur || pct > cur.pct) progressById[e.initiative_id] = { pct, node: e.node };
        }
      } catch { /* events 表缺失不阻塞 */ }
    }

    // 3b. harness_report 摘要 → 按 initiative_id 合并进所属 sprint（不单独成行）
    //     report.payload.initiative_id === harness_initiative.id（1:1 关联，已验证）
    const reportByInitiativeId = await fetchReportByInitiativeId(days);

    // 3c. LangGraph 富数据：join harness-pipelines（同源逻辑，复用 status.js 的 buildPipelineRecord）。
    //     join key：harness_initiative.id === harness-pipelines.planner_task_id。
    const lgByPlannerTaskId = await fetchLgByPlannerTaskId(tasks);

    // 4. 装配
    const nowMs = Date.now();
    const todayStr = shanghaiDay(new Date().toISOString());
    const areas = buildFeed(tasks, journeyNameById, progressById, nowMs, reportByInitiativeId, lgByPlannerTaskId);
    const stats = computeStats(tasks, todayStr);

    res.json({ stats, areas, total: tasks.length, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[GET /warroom/feed]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/warroom/lines
 *   Area → Line 树（只含 status='active' 的 journey，按名字归 Area）。
 *   每条线：roadmap 进度（step_total/step_done）+ 近30天关联任务（running/task_total/last_activity）。
 */
router.get('/lines', async (req, res) => {
  try {
    // 1. active journeys
    const { rows: journeys } = await pool.query(
      `SELECT id, notion_id, name, status, maturity
       FROM journeys WHERE status = 'active'`
    );

    // 2. 所有 active journey 的 steps（一次拉，内存按 journey_id 分组）
    const journeyDbIds = journeys.map((j) => j.id);
    const stepsByJourney = new Map();
    if (journeyDbIds.length > 0) {
      const { rows: steps } = await pool.query(
        `SELECT journey_id, status FROM journey_steps WHERE journey_id = ANY($1::uuid[])`,
        [journeyDbIds]
      );
      for (const s of steps) {
        const k = String(s.journey_id);
        if (!stepsByJourney.has(k)) stepsByJourney.set(k, []);
        stepsByJourney.get(k).push(s);
      }
    }

    // 3. 近30天有 journey_id 的任务（一次拉，按 journey 匹配 id|notion_id 双格式聚合）
    const { rows: tasks } = await pool.query(
      `SELECT id, status, payload, created_at, updated_at
       FROM tasks
       WHERE payload->>'journey_id' IS NOT NULL
         AND created_at > NOW() - INTERVAL '30 days'`
    );

    // 4. 按 Area 归类，逐条线统计
    const areaMap = new Map(); // areaKey → lines[]
    for (const j of journeys) {
      const areaKey = classifyJourneyArea(j.name);
      const { step_total, step_done } = computeStepProgress(stepsByJourney.get(String(j.id)) || []);

      let running = 0, task_total = 0, last_activity = null;
      for (const t of tasks) {
        if (!taskMatchesJourney(t, j)) continue;
        task_total++;
        if (normStatus(t.status) === 'active') running++;
        const act = t.updated_at || t.created_at;
        if (act && (!last_activity || new Date(act) > new Date(last_activity))) {
          last_activity = act instanceof Date ? act.toISOString() : act;
        }
      }

      if (!areaMap.has(areaKey)) areaMap.set(areaKey, []);
      areaMap.get(areaKey).push({
        id: j.id, name: j.name, status: j.status, maturity: j.maturity,
        step_total, step_done, running, task_total, last_activity,
      });
    }

    // 5. 装配 areas（cecelia 在前，zenithjoy 在后；每个 Area 内 running 多的线排前）
    const order = { cecelia: 0, zenithjoy: 1 };
    const areas = [...areaMap.entries()]
      .sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9))
      .map(([areaKey, lines]) => ({
        areaKey,
        areaName: AREA_NAMES[areaKey] || areaKey,
        lines: lines.sort((x, y) => (y.running - x.running)
          || (new Date(y.last_activity || 0) - new Date(x.last_activity || 0))),
      }));

    res.json({ areas, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[GET /warroom/lines]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/warroom/line/:id
 *   单条 Line 详情：{ line, steps(按 step_number 升序), tasks(toFeedItem 装配，含 lg+verdict) }。
 *   tasks 复用 /feed 的 reportByInitiativeId(verdict) + lgByPlannerTaskId(LangGraph) 富数据逻辑。
 */
router.get('/line/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. journey 本体
    const { rows: jrows } = await pool.query(
      `SELECT id, notion_id, name, description, status, maturity FROM journeys WHERE id = $1`,
      [id]
    );
    if (jrows.length === 0) return res.status(404).json({ error: 'journey not found' });
    const journey = jrows[0];
    const areaKey = classifyJourneyArea(journey.name);

    // 2. steps（按 step_number 升序 = roadmap）
    const { rows: stepRows } = await pool.query(
      `SELECT step_number, name, status, description
       FROM journey_steps WHERE journey_id = $1 ORDER BY step_number ASC`,
      [journey.id]
    );
    const steps = stepRows.map((s) => ({
      step_number: s.step_number,
      name: s.name,
      status: s.status || 'planned',
      description: s.description || null,
    }));

    // 3. 近30天该 journey 关联任务（id|notion_id 双格式），仅纳入 FEED_TYPES
    const keys = journeyIdKeys(journey);
    const { rows: tasks } = await pool.query(
      `SELECT id, title, description, task_type, status, priority, payload,
              created_at, started_at, completed_at, updated_at, error_message, pr_url, result
       FROM tasks
       WHERE task_type = ANY($1)
         AND payload->>'journey_id' = ANY($2)
         AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 300`,
      [FEED_TYPES, keys]
    );

    // 4. 富数据：verdict（harness_report）+ LangGraph（复用 /feed 同源 helper）
    const reportByInitiativeId = await fetchReportByInitiativeId(30);
    const lgByPlannerTaskId = await fetchLgByPlannerTaskId(tasks);

    // 5. active harness 进度（与 /feed 一致）
    const activeHarness = tasks
      .filter((t) => t.task_type === 'harness_initiative' && t.status === 'in_progress')
      .map((t) => t.id);
    const progressById = {};
    if (activeHarness.length > 0) {
      try {
        const { rows: evs } = await pool.query(
          `SELECT initiative_id, node FROM initiative_run_events
           WHERE initiative_id = ANY($1::uuid[]) AND status = 'completed'`,
          [activeHarness]
        );
        for (const e of evs) {
          const pct = NODE_PCT[e.node];
          if (pct == null) continue;
          const cur = progressById[e.initiative_id];
          if (!cur || pct > cur.pct) progressById[e.initiative_id] = { pct, node: e.node };
        }
      } catch { /* events 缺失不阻塞 */ }
    }

    // 6. toFeedItem 装配（journeyName 固定为本线名）；剥离内部 _area/_group 字段
    const nowMs = Date.now();
    const statusRank = { active: 0, failed: 1, done: 2, canceled: 3 };
    const feedTasks = tasks
      .map((t) => {
        const item = toFeedItem(
          t, journey.name, progressById[t.id] || null, nowMs,
          reportByInitiativeId[t.id] || null, lgByPlannerTaskId[t.id] || null
        );
        delete item._area; delete item._group;
        return item;
      })
      .sort((p, q) => {
        const r = (statusRank[p.status] ?? 9) - (statusRank[q.status] ?? 9);
        if (r !== 0) return r;
        return new Date(q.created_at).getTime() - new Date(p.created_at).getTime();
      });

    res.json({
      line: {
        id: journey.id,
        name: journey.name,
        description: journey.description || null,
        status: journey.status,
        maturity: journey.maturity,
        areaName: AREA_NAMES[areaKey] || areaKey,
      },
      steps,
      tasks: feedTasks,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /warroom/line/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/warroom/line/:id/advancements
 *   该 Line（journey_id=:id）下所有 kind='ability' 的 journey_features 名下 advancement_items 扁平列表，
 *   带 ability_id + ability_name，供前端按 ability 分组渲染进度条。
 *   返回 { line_id, items }；无推进项返回空数组（200）。
 */
router.get('/line/:id/advancements', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT ai.id, ai.ability_id, jf.name AS ability_name,
              ai.title, ai.status, ai.priority, ai.pr_url, ai.created_at
       FROM advancement_items ai
       JOIN journey_features jf ON jf.id = ai.ability_id
       WHERE jf.journey_id = $1 AND jf.kind = 'ability'
       ORDER BY jf.name,
                CASE ai.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                ai.created_at`,
      [id]
    );
    res.json({ line_id: id, items: rows });
  } catch (err) {
    console.error('[GET /warroom/line/:id/advancements]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/warroom/line/:id/command
 *   Line 指挥页聚合数据，返回三块：
 *   - decisions: notes 表中 title LIKE '军师决策[<line名>]%' 的记录，时间倒序
 *   - connections: journey_features(abilities/features) + advancements + in_progress tasks + open issues + recent harness runs
 *   - health: 近30天 run 成功率、PR 频率、是否停线
 */
router.get('/line/:id/command', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. journey 本体
    const { rows: jrows } = await pool.query(
      `SELECT id, notion_id, name, description, status, maturity FROM journeys WHERE id = $1`,
      [id]
    );
    if (jrows.length === 0) return res.status(404).json({ error: 'journey not found' });
    const journey = jrows[0];
    const keys = journeyIdKeys(journey);

    // 2. 军师决策流水（notes 表，title 前缀 '军师决策[<line名>]'，时间倒序）
    let decisions = [];
    try {
      const prefix = `军师决策[${journey.name}]`;
      const { rows: noteRows } = await pool.query(
        `SELECT id, title, content, type, created_at
         FROM notes
         WHERE title LIKE $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [`${prefix}%`]
      );
      decisions = noteRows.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content || null,
        type: n.type || null,
        created_at: n.created_at,
      }));
    } catch { /* notes 表缺失优雅降级 */ }

    // 3. 连接全景 — abilities/features
    let abilities = [], features = [];
    try {
      const { rows: jfRows } = await pool.query(
        `SELECT id, name, kind, status, "group" AS group_name, created_at
         FROM journey_features
         WHERE journey_id = $1
         ORDER BY kind, name`,
        [journey.id]
      );
      abilities = jfRows.filter((r) => r.kind === 'ability');
      features = jfRows.filter((r) => r.kind === 'feature');
    } catch { /* journey_features 缺失优雅降级 */ }

    // 4. 推进项（advancement_items）按 ability 聚合
    let advancements = [];
    try {
      const { rows: aiRows } = await pool.query(
        `SELECT ai.id, ai.ability_id, jf.name AS ability_name,
                ai.title, ai.status, ai.priority, ai.pr_url, ai.created_at
         FROM advancement_items ai
         JOIN journey_features jf ON jf.id = ai.ability_id
         WHERE jf.journey_id = $1 AND jf.kind = 'ability'
         ORDER BY jf.name, CASE ai.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, ai.created_at`,
        [journey.id]
      );
      advancements = aiRows;
    } catch { /* advancement_items 缺失优雅降级 */ }

    // 5. 进行中任务（该 journey 关联，status=in_progress）
    let activeTasks = [];
    try {
      const { rows: atRows } = await pool.query(
        `SELECT id, title, task_type, status, priority, created_at, updated_at, pr_url
         FROM tasks
         WHERE task_type = ANY($1)
           AND payload->>'journey_id' = ANY($2)
           AND status = 'in_progress'
         ORDER BY updated_at DESC
         LIMIT 20`,
        [FEED_TYPES, keys]
      );
      activeTasks = atRows;
    } catch { /* tasks 查询失败优雅降级 */ }

    // 6. open issues（该 journey 关联）
    let openIssues = [];
    try {
      const { rows: issueRows } = await pool.query(
        `SELECT id, title, priority, status, created_at
         FROM issues
         WHERE journey_id = $1
           AND status NOT IN ('closed', 'resolved')
         ORDER BY created_at DESC
         LIMIT 20`,
        [journey.id]
      );
      openIssues = issueRows;
    } catch { /* issues 表缺失优雅降级 */ }

    // 7. 最近 harness runs（initiative_runs，该 journey，时间倒序）
    //    真列名是 phase（值域 done/failed/evaluate/planning/gan…），无 status/result 列；
    //    映射为前端 RecentRun 契约的 status（done→completed / failed→failed / 其余→in_progress）
    let recentRuns = [];
    try {
      const { rows: runRows } = await pool.query(
        `SELECT id, phase, started_at, completed_at, created_at
         FROM initiative_runs
         WHERE journey_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [journey.id]
      );
      recentRuns = runRows.map((r) => ({
        id: r.id,
        status: r.phase === 'done' ? 'completed' : r.phase === 'failed' ? 'failed' : 'in_progress',
        started_at: r.started_at,
        completed_at: r.completed_at,
        created_at: r.created_at,
      }));
    } catch { /* initiative_runs 缺失优雅降级 */ }

    // 8. 健康度计算（近30天）
    let health = { run_total: 0, run_success: 0, success_rate: null, pr_count: 0, is_stopped: false };
    try {
      const { rows: healthRows } = await pool.query(
        `SELECT id, phase, created_at
         FROM initiative_runs
         WHERE journey_id = $1
           AND created_at > NOW() - INTERVAL '30 days'`,
        [journey.id]
      );
      const runTotal = healthRows.length;
      const runSuccess = healthRows.filter((r) => r.phase === 'done').length;

      // PR 频率：近30天该 journey 相关任务有 pr_url
      const { rows: prRows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM tasks
         WHERE payload->>'journey_id' = ANY($1)
           AND pr_url IS NOT NULL
           AND created_at > NOW() - INTERVAL '30 days'`,
        [keys]
      );
      const prCount = parseInt(prRows[0]?.cnt || '0', 10);

      health = {
        run_total: runTotal,
        run_success: runSuccess,
        success_rate: runTotal > 0 ? Math.round((runSuccess / runTotal) * 100) : null,
        pr_count: prCount,
        is_stopped: journey.status === 'paused' || journey.status === 'stopped',
      };
    } catch { /* health 计算失败优雅降级 */ }

    res.json({
      line: {
        id: journey.id,
        name: journey.name,
        description: journey.description || null,
        status: journey.status,
        maturity: journey.maturity,
      },
      decisions,
      connections: {
        abilities,
        features,
        advancements,
        active_tasks: activeTasks,
        open_issues: openIssues,
        recent_runs: recentRuns,
      },
      health,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /warroom/line/:id/command]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/warroom/line/:id/context-manifest
 *   planner Step 0.4 一次拉全（九要素 T3）：
 *   - ledger: 最新 line_ledger 蒸馏摘要（design_docs，dreaming L1 每晚产出）
 *   - delta: 自 ledger 时刻起的六段增量事实（无 ledger 回落 24h 窗口）
 *   - invariants / cumulative_fr: 与三角色注入同源（fetchLineContext）
 *   - prompt_block: formatLineContextForPrompt 直出，skill 可整段注入
 */
router.get('/line/:id/context-manifest', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: jrows } = await pool.query(
      `SELECT id, name, status, maturity FROM journeys WHERE id = $1`,
      [id]
    );
    if (jrows.length === 0) return res.status(404).json({ error: 'journey not found' });
    const journey = jrows[0];

    const ctx = await fetchLineContext({ pool }, { journeyId: journey.id });

    let delta;
    try {
      delta = await buildLineDreamData(pool, journey.id, journey.name, {
        since: ctx.ledger?.created_at ?? null,
      });
    } catch (e) {
      console.warn('[warroom] context-manifest delta failed (non-fatal):', e.message);
      delta = { decisions: [], advancementItems: [], issues: [], runs: [], learnings: [], strategistNotes: [] };
    }

    res.json({
      line: {
        id: journey.id,
        name: journey.name,
        status: journey.status,
        maturity: journey.maturity,
      },
      ledger: ctx.ledger ?? null,
      delta: {
        decisions: delta.decisions,
        advancement_items: delta.advancementItems,
        issues: delta.issues,
        runs: delta.runs,
        learnings: delta.learnings,
        strategist_notes: delta.strategistNotes,
      },
      invariants: ctx.invariants,
      cumulative_fr: ctx.cumulativeFR,
      prompt_block: formatLineContextForPrompt(ctx),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[GET /warroom/line/:id/context-manifest]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
