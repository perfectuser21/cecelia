/**
 * evolution-synthesizer.js — Cecelia 进化日志合成器
 *
 * 功能：
 * 1. detectComponent(filePath) — 根据文件路径判断组件归属
 * 2. recordEvolution(data) — 写入单条进化原始记录
 * 3. runEvolutionSynthesis(pool) — 皮层合成（每周一次，per component）
 */

/* global console */

import pool from './db.js';
import { callLLM } from './llm-caller.js';

// ── 组件映射规则 ──────────────────────────────────────────────

const COMPONENT_RULES = [
  { pattern: /packages\/brain\/src\/desire/, component: 'desire' },
  { pattern: /packages\/brain\/src\/orchestrator/, component: 'mouth' },
  { pattern: /packages\/brain\/src\/emotion/, component: 'emotion' },
  { pattern: /packages\/brain\/src\/notion/, component: 'notion' },
  { pattern: /packages\/brain\/src\/memory/, component: 'memory' },
  { pattern: /packages\/brain\/src\/(cortex|thalamus|rumination|learning|tick)/, component: 'brain' },
  { pattern: /packages\/brain\/src\/(alerting|circuit-breaker)/, component: 'brain' },
  { pattern: /packages\/brain\/src\//, component: 'brain' },
  { pattern: /apps\/dashboard\/|apps\/api\/features/, component: 'dashboard' },
  { pattern: /packages\/engine\//, component: 'engine' },
  { pattern: /packages\/workflows\//, component: 'workflow' },
];

/**
 * 根据文件路径检测所属组件
 * @param {string} filePath
 * @returns {string} component name
 */
export function detectComponent(filePath) {
  for (const rule of COMPONENT_RULES) {
    if (rule.pattern.test(filePath)) {
      return rule.component;
    }
  }
  return 'other';
}

/**
 * 从文件列表中提取所有涉及的组件（去重）
 * @param {string[]} files
 * @returns {string[]}
 */
export function detectComponents(files) {
  const components = new Set(files.map(f => detectComponent(f)));
  components.delete('other');
  return components.size > 0 ? [...components] : ['other'];
}

/**
 * 写入一条进化原始记录
 */
export async function recordEvolution({ component, prNumber, title, significance = 3, summary, changedFiles = [], version }, db) {
  const client = db || pool;
  const { rows } = await client.query(
    `INSERT INTO component_evolutions (component, pr_number, title, significance, summary, changed_files, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [component, prNumber || null, title, significance, summary || null, changedFiles, version || null]
  );
  return rows[0];
}

/**
 * 皮层周期合成：读取最近 7 天各组件的原始记录，逐组件生成叙事
 * 每周最多运行一次（相同组件）
 */
export async function runEvolutionSynthesis(dbPool, llmCaller = callLLM) {
  const db = dbPool || pool;

  // 取最近 7 天有记录的组件列表
  const { rows: components } = await db.query(
    `SELECT DISTINCT component FROM component_evolutions
     WHERE date >= CURRENT_DATE - INTERVAL '7 days'`
  );

  if (components.length === 0) {
    return { ok: true, skipped: 'no_recent_data', synthesized: 0 };
  }

  let synthesized = 0;
  const results = [];

  for (const { component } of components) {
    try {
      // 检查该组件本周是否已合成
      const { rows: existing } = await db.query(
        `SELECT id FROM component_evolution_summaries
         WHERE component = $1 AND period_end >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY period_end DESC LIMIT 1`,
        [component]
      );
      if (existing.length > 0) {
        results.push({ component, skipped: 'already_synthesized_this_week' });
        continue;
      }

      // 读取该组件最近 7 天的记录
      const { rows: records } = await db.query(
        `SELECT date, pr_number, title, significance, summary
         FROM component_evolutions
         WHERE component = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
         ORDER BY date DESC`,
        [component]
      );

      if (records.length === 0) continue;

      const periodStart = records[records.length - 1].date;
      const periodEnd = records[0].date;
      const prCount = records.length;

      // 构建 LLM prompt
      const recordsText = records.map(r =>
        `[${r.date?.toISOString?.()?.slice(0, 10) || r.date}] PR#${r.pr_number || '?'} ${r.title}${r.summary ? ` — ${r.summary}` : ''}`
      ).join('\n');

      const prompt = `你是 Cecelia 的皮层（Cortex），正在为自己的进化史撰写叙事。

组件：${component}
时间段：${periodStart} ~ ${periodEnd}
本周改动（${prCount} 条）：
${recordsText}

请用第一人称，写一段 150-300 字的进化叙事，描述这个组件在本周经历了什么、有什么进步或突破。
语气要有温度，像是在写日记，而不是技术报告。
直接输出叙事内容，不要有额外标题或前缀。`;

      const { text } = await llmCaller('cortex', prompt, { timeout: 60000 });
      if (!text || text.length < 50) {
        results.push({ component, error: 'llm_empty_response' });
        continue;
      }

      // 提取关键里程碑（significance >= 4 的记录标题）
      const keyMilestones = records
        .filter(r => (r.significance || 0) >= 4)
        .map(r => r.title);

      // 写入合成结果
      await db.query(
        `INSERT INTO component_evolution_summaries
         (component, period_start, period_end, narrative, pr_count, key_milestones)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [component, periodStart, periodEnd, text.trim(), prCount, keyMilestones]
      );

      synthesized++;
      results.push({ component, ok: true, chars: text.length });
      console.log(`[evolution-synthesizer] ${component}: 合成完成 (${text.length} chars)`);
    } catch (err) {
      console.error(`[evolution-synthesizer] ${component} error:`, err.message);
      results.push({ component, error: err.message });
    }
  }

  return { ok: true, synthesized, results };
}
