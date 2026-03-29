/**
 * KR-Project Map route
 *
 * GET /  — 返回 KR-Project 依赖图（用于 SelfDrive 诊断 KR 进度落后根因）
 *
 * 响应结构：
 * {
 *   krs: [{ id, title, progress_pct, projects: [{ id, title, status, tier }] }],
 *   orphaned_projects: [{ id, title, status }],
 *   summary: { total_krs, total_projects, orphaned_count, now: [], next: [], later: [] }
 * }
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// 项目梯队（now/next/later）
const PRIORITY_MAP = {
  'cbc1038e-f946-4456-8467-fe290ba4e397': 'now',  // Brain 资源防护
  '501ca7b9-5186-45c2-993f-c109c9a3df97': 'now',  // 错误黑洞修复
  '7422bc5e-84f2-4f33-8b42-2f905d9af857': 'now',  // 算力监控与自愈闭环
  'e1c703b9-87a8-4bb3-b63e-60ff5f6fadaa': 'now',  // 管家日报系统 v1
  'bd635f27-a4dc-4d2a-a3fe-492b7f956589': 'next', // 三机算力底座上线
  '4aa421a7-15d9-4a6d-a536-750958be4981': 'next', // 每日自动发布调度
  'cf5a9d53-47d7-4689-ab67-7c9c9677186c': 'next', // Codex自动扫描进化引擎
  '2a273a2d-7b72-4ac7-abb7-f57b83071d57': 'next', // 部门经理会议引擎 v1
};

router.get('/', async (_req, res) => {
  try {
    const krResult = await pool.query(`
      SELECT id, title, current_value, target_value, unit,
             CASE
               WHEN target_value::numeric > 0
               THEN ROUND((current_value::numeric / target_value::numeric) * 100)
               ELSE 0
             END AS progress_pct
      FROM goals
      WHERE type = 'area_kr' AND status = 'active' AND parent_id IS NOT NULL
      ORDER BY created_at ASC
    `);

    const projectResult = await pool.query(`
      SELECT id, title, status, kr_id, progress
      FROM okr_projects
      WHERE status IN ('planning', 'active')
      ORDER BY created_at ASC
    `);

    const projectsByKr = {};
    const orphaned = [];

    for (const p of projectResult.rows) {
      if (!p.kr_id) {
        orphaned.push({ id: p.id, title: p.title, status: p.status });
      } else {
        if (!projectsByKr[p.kr_id]) projectsByKr[p.kr_id] = [];
        projectsByKr[p.kr_id].push({
          id: p.id,
          title: p.title,
          status: p.status,
          progress: p.progress || 0,
          tier: PRIORITY_MAP[p.id] || 'later',
        });
      }
    }

    const krs = krResult.rows.map(kr => ({
      id: kr.id,
      title: kr.title,
      progress_pct: Number(kr.progress_pct),
      current_value: kr.current_value,
      target_value: kr.target_value,
      unit: kr.unit,
      projects: projectsByKr[kr.id] || [],
    }));

    const allMapped = krs.flatMap(kr => kr.projects);
    const now = allMapped.filter(p => p.tier === 'now').map(p => p.title);
    const next = allMapped.filter(p => p.tier === 'next').map(p => p.title);
    const later = allMapped.filter(p => p.tier === 'later').map(p => p.title);

    res.json({
      krs,
      orphaned_projects: orphaned,
      summary: {
        total_krs: krs.length,
        total_projects: projectResult.rows.length,
        orphaned_count: orphaned.length,
        now,
        next,
        later,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to build KR-Project map', details: err.message });
  }
});

export default router;
