/**
 * decisions.js — Decision-Driven Autonomous Layer
 *
 * 将 Brain decisions 表转为 autonomous_mode 的约束源。
 * AI 不能自创设计决策；必须查询 Alex 的历史决策作为硬约束。
 */

/**
 * Match PRD text against historical decisions.
 * Returns matched (topic + decision + confidence) and missing (topics with classification).
 *
 * @param {string} prdText - raw or enriched PRD
 * @param {string[]} [topics] - optional explicit topics to search
 * @param {Array|object|null} [db] - DB connection/pool or fixture array (injected for testing)
 * @returns {Promise<{matched: Array, missing: Array}>}
 */
export async function matchDecisions(prdText, topics = [], db = null) {
  if (!prdText || typeof prdText !== 'string') {
    return { matched: [], missing: [] };
  }

  // Extract candidate topics from PRD if not provided
  const candidateTopics = topics.length > 0 ? topics : extractTopicsFromPRD(prdText);

  if (candidateTopics.length === 0) {
    return { matched: [], missing: [] };
  }

  // Query decisions table - keyword match on topic column
  const allDecisions = await fetchAllDecisions(db);

  const matched = [];
  const missing = [];

  for (const topic of candidateTopics) {
    const hit = findBestDecisionMatch(topic, allDecisions, prdText);
    if (hit) {
      matched.push({
        topic,
        decision: hit.decision,
        decision_topic: hit.topic,
        confidence: hit.score,
        source_id: hit.id,
      });
    } else {
      missing.push({
        topic,
        classification: classifyTopicCriticality(topic),
      });
    }
  }

  return { matched, missing };
}

/**
 * Extract topics from PRD heuristic.
 * Looks for ## section headers and "用什么 X / 选什么 X / 使用 X 框架" patterns.
 */
export function extractTopicsFromPRD(prdText) {
  const topics = new Set();
  const lines = prdText.split('\n');
  for (const line of lines) {
    // ## section headers
    const headerMatch = line.match(/^##+\s+(.+?)$/);
    if (headerMatch) {
      const header = headerMatch[1].trim();
      if (header.length < 50) topics.add(header);
    }
    // "用什么 X" patterns
    const patterns = [
      /用什么(\S+?)[?？\s]/g,
      /选(哪个|什么)(\S+?)[?？\s]/g,
      /使用\s*(\S+?)\s*(数据库|API|库|框架)/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(line)) !== null) {
        topics.add(m[0].replace(/[?？]/g, '').trim());
      }
    }
  }
  return Array.from(topics);
}

/**
 * Simple keyword overlap match between a topic and decisions list.
 * Returns the best-matched decision with a score, or null if no match >= 0.4.
 */
export function findBestDecisionMatch(topic, decisions, _prdText) {
  const topicLower = topic.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const d of decisions) {
    if (!d.topic) continue;
    const dTopicLower = d.topic.toLowerCase();
    // Score: exact substring match or bidirectional containment
    let score = 0;
    if (dTopicLower === topicLower) score = 1.0;
    else if (topicLower.includes(dTopicLower) || dTopicLower.includes(topicLower)) score = 0.7;
    else {
      // word overlap
      const words1 = new Set(topicLower.split(/\s+/).filter((w) => w.length > 2));
      const words2 = new Set(dTopicLower.split(/\s+/).filter((w) => w.length > 2));
      const common = [...words1].filter((w) => words2.has(w)).length;
      if (common > 0 && words1.size > 0) score = 0.4 * (common / words1.size);
    }
    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      best = { ...d, score };
    }
  }
  return best;
}

/**
 * Classify topic as critical (architecture/data) or routine (naming/paths).
 */
export function classifyTopicCriticality(topic) {
  const lower = topic.toLowerCase();
  const criticalKeywords = [
    '架构', 'architecture', '数据库', 'database', '表结构', 'schema',
    '协议', 'protocol', 'api 设计', 'api design', '认证', 'auth',
    'security', '安全', '部署', 'deploy', 'rollback',
  ];
  for (const kw of criticalKeywords) {
    if (lower.includes(kw)) return 'critical';
  }
  return 'routine';
}

/**
 * Fetch all active decisions from Brain DB (with fallback).
 * Supports:
 *  - Array fixture (for tests)
 *  - DB pool with .query() method (test injection)
 *  - Production: creates a temporary pg.Pool
 */
async function fetchAllDecisions(db) {
  if (db) {
    // Array fixture for tests
    if (Array.isArray(db)) return db;
    // Test injection: DB pool with query method
    if (typeof db.query === 'function') {
      const res = await db.query('SELECT id, topic, decision FROM decisions WHERE status = $1', ['active']);
      return res.rows || [];
    }
  }
  // Production path - use pg Pool with env defaults
  try {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const res = await pool.query("SELECT id, topic, decision FROM decisions WHERE status = 'active' LIMIT 500");
    await pool.end();
    return res.rows || [];
  } catch (_e) {
    // DB unavailable - return empty (graceful degradation)
    return [];
  }
}

/**
 * Express handler factory.
 * POST /api/brain/decisions/match
 * Body: { prd: string, topics?: string[] }
 */
export default function createDecisionsMatchRouter() {
  return async function handleDecisionsMatch(req, res) {
    try {
      const { prd, topics } = req.body || {};
      if (!prd) return res.status(400).json({ error: 'prd field required' });
      const result = await matchDecisions(prd, topics || []);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}
