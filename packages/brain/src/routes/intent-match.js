/**
 * Intent Match Route - 根据用户自然语言查询匹配的 Goals/Projects
 * POST /api/brain/intent/match
 * 迁移：goals → objectives + key_results，projects → okr_projects
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * 将 query 拆词（按空格/标点分割），每词最小长度 2
 */
function splitKeywords(query) {
  return query
    .split(/[\s,，。？！、；：\.\?\!;:]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2);
}

/**
 * POST /match
 * Body: { query: string, layer_hint?: string, limit?: number }
 * Response: { query, layer_guess, matched_goals, matched_projects, total }
 */
router.post('/match', async (req, res) => {
  try {
    const { query, layer_hint, limit = 5 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'query is required' });
    }

    const trimmed = query.trim();
    const parsedLimit = parseInt(limit, 10);
    const safeLimit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 5 : parsedLimit, 1), 20);
    const pattern = `%${trimmed}%`;

    // --- Objectives 搜索 ---
    const objResult = await pool.query(`
      SELECT id, title, 'area_okr'::text AS type, status, NULL::text AS priority, metadata, NULL::uuid AS parent_id,
             CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END AS title_rank
      FROM objectives
      WHERE title ILIKE $1
        AND status NOT IN ('completed', 'cancelled', 'archived')
      ORDER BY title_rank ASC, updated_at DESC
      LIMIT $3
    `, [pattern, `${trimmed}%`, safeLimit]);

    // --- Key Results 搜索 ---
    const krResult = await pool.query(`
      SELECT id, title, 'area_kr'::text AS type, status, NULL::text AS priority, metadata, objective_id AS parent_id,
             CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END AS title_rank
      FROM key_results
      WHERE title ILIKE $1
        AND status NOT IN ('completed', 'cancelled', 'archived')
      ORDER BY title_rank ASC, updated_at DESC
      LIMIT $3
    `, [pattern, `${trimmed}%`, safeLimit]);

    // --- 合并 goals 结果 ---
    const combinedGoals = [...objResult.rows, ...krResult.rows];
    const goalsById = new Map(combinedGoals.map(r => [r.id, r]));

    // --- 多关键词补充搜索（objectives + key_results）---
    const keywords = splitKeywords(trimmed);
    const extraGoals = [];

    for (const kw of keywords) {
      if (kw === trimmed) continue;
      const kwPattern = `%${kw}%`;
      const kwObjResult = await pool.query(`
        SELECT id, title, 'area_okr'::text AS type, status, NULL::text AS priority, metadata, NULL::uuid AS parent_id, 0 AS title_rank
        FROM objectives
        WHERE title ILIKE $1
          AND status NOT IN ('completed', 'cancelled', 'archived')
        LIMIT $2
      `, [kwPattern, 3]);
      const kwKrResult = await pool.query(`
        SELECT id, title, 'area_kr'::text AS type, status, NULL::text AS priority, metadata, objective_id AS parent_id, 0 AS title_rank
        FROM key_results
        WHERE title ILIKE $1
          AND status NOT IN ('completed', 'cancelled', 'archived')
        LIMIT $2
      `, [kwPattern, 3]);
      for (const row of [...kwObjResult.rows, ...kwKrResult.rows]) {
        if (!goalsById.has(row.id)) {
          goalsById.set(row.id, row);
          extraGoals.push(row);
        }
      }
    }

    const allGoals = [...combinedGoals, ...extraGoals].slice(0, safeLimit);

    // --- okr_projects 搜索 ---
    const projectsResult = await pool.query(`
      SELECT id, title AS name, 'project'::text AS type, status, NULL::text AS description, kr_id AS parent_id,
             CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END AS name_rank
      FROM okr_projects
      WHERE title ILIKE $1
        AND status NOT IN ('completed', 'cancelled', 'archived')
      ORDER BY name_rank ASC, updated_at DESC
      LIMIT $3
    `, [pattern, `${trimmed}%`, safeLimit]);

    // --- layer_guess：从匹配结果推断 ---
    let layerGuess = layer_hint || 'unknown';
    if (!layer_hint) {
      const types = allGoals.map(g => g.type).filter(Boolean);
      if (types.includes('area_okr')) layerGuess = 'objective';
      else if (types.includes('area_kr')) layerGuess = 'kr';
      else if (projectsResult.rows.length > 0) layerGuess = 'project';
    }

    const matchedGoals = allGoals.map(g => ({
      id: g.id,
      title: g.title,
      type: g.type || 'goal',
      status: g.status,
      priority: g.priority,
      score: g.title_rank === 0 ? 0.9 : 0.6,
    }));

    const matchedProjects = projectsResult.rows.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type || 'project',
      status: p.status,
      score: p.name_rank === 0 ? 0.9 : 0.6,
    }));

    return res.json({
      query: trimmed,
      layer_guess: layerGuess,
      matched_goals: matchedGoals,
      matched_projects: matchedProjects,
      total: matchedGoals.length + matchedProjects.length,
    });
  } catch (err) {
    console.error('[intent-match] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
