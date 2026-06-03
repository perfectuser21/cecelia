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
import { buildFeed, computeStats, shanghaiDay } from '../warroom-classify.js';

const router = Router();

// harness initiative_run_events 节点 → 进度百分比（与 harness.js progress 端点对齐）
const NODE_PCT = {
  prep: 5, planner: 15, parsePrd: 25, ganLoop: 40, dbUpsert: 50,
  generator: 65, evaluator: 80, merge: 90, report: 100,
};

// 纳入 feed 的任务类型（有实质执行的；排除 harness_report 等子任务噪音）
const FEED_TYPES = ['harness_initiative', 'dev', 'content-pipeline', 'platform_scraper'];

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
        // 同一 sprint 多份 report 时保留最新（查询按默认顺序，后写覆盖即可接受）
        reportByInitiativeId[r.initiative_id] = {
          verdict: r.verdict || null,
          pr_url: r.pr_url || null,
          findings_count: fc,
        };
      }
    } catch { /* harness_report 缺失不阻塞 feed */ }

    // 4. 装配
    const nowMs = Date.now();
    const todayStr = shanghaiDay(new Date().toISOString());
    const areas = buildFeed(tasks, journeyNameById, progressById, nowMs, reportByInitiativeId);
    const stats = computeStats(tasks, todayStr);

    res.json({ stats, areas, total: tasks.length, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[GET /warroom/feed]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
