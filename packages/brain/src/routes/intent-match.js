/**
 * Intent Match Route - 根据用户自然语言查询匹配的 Goals/Projects
 * POST /api/brain/intent/match
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

    // --- Goals 搜索 ---
    const goalsResult = await pool.query(`
      SELECT id, title, type, status, priority, metadata, parent_id,
             CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END AS title_rank
      FROM goals
      WHERE (title ILIKE $1 OR description ILIKE $1)
        AND status NOT IN ('completed', 'cancelled')
      ORDER BY title_rank ASC, updated_at DESC
      LIMIT $3
    `, [pattern, `${trimmed}%`, safeLimit]);

    // --- 多关键词补充搜索 ---
    const keywords = splitKeywords(trimmed);
    const extraGoalIds = new Set(goalsResult.rows.map(r => r.id));
    const extraGoals = [];

    for (const kw of keywords) {
      if (kw === trimmed) continue;
      const kwPattern = `%${kw}%`;
      const kwResult = await pool.query(`
        SELECT id, title, type, status, priority, metadata, parent_id, 0 AS title_rank
        FROM goals
        WHERE (title ILIKE $1 OR description ILIKE $1)
          AND status NOT IN ('completed', 'cancelled')
        LIMIT $2
      `, [kwPattern, 3]);
      for (const row of kwResult.rows) {
        if (!extraGoalIds.has(row.id)) {
          extraGoalIds.add(row.id);
          extraGoals.push(row);
        }
      }
    }

    const allGoals = [...goalsResult.rows, ...extraGoals].slice(0, safeLimit);

    // --- Projects 搜索 ---
    const projectsResult = await pool.query(`
      SELECT id, name, type, status, description, parent_id,
             CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END AS name_rank
      FROM projects
      WHERE (name ILIKE $1 OR description ILIKE $1)
        AND status NOT IN ('completed', 'cancelled', 'archived')
      ORDER BY name_rank ASC, updated_at DESC
      LIMIT $3
    `, [pattern, `${trimmed}%`, safeLimit]);

    // --- layer_guess：从匹配结果推断 ---
    let layerGuess = layer_hint || 'unknown';
    if (!layer_hint) {
      const types = allGoals.map(g => g.type).filter(Boolean);
      if (types.includes('kr')) layerGuess = 'kr';
      else if (types.includes('okr') || types.includes('global_okr')) layerGuess = 'okr';
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
