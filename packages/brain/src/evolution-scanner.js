/**
 * evolution-scanner.js — Cecelia 进化日志自动扫描器
 *
 * 两个入口（均由 tick.js fire-and-forget 调用）：
 *   scanEvolutionIfNeeded(pool)       — 每日扫描新 PR，写入 component_evolutions
 *   synthesizeEvolutionIfNeeded(pool) — 每周触发叙事合成
 *
 * 设计原则：
 *   - 只追踪 perfectuser21/cecelia（Cecelia 自己的成长记录）
 *   - 幂等：source_repo + pr_number 联合去重
 *   - 时间门控：daily/weekly 各自通过 working_memory 防重
 *   - GITHUB_TOKEN 可选：无 token 也能用（公开仓库，60 req/h 限额）
 */

/* global console, process, fetch */

import { runEvolutionSynthesis } from './evolution-synthesizer.js';

const OWNER = 'perfectuser21';
const REPO = 'cecelia';
const SOURCE_REPO = 'cecelia';

// 非代码文件（不计入组件检测）
const SKIP = [
  /^\.brain-versions$/,
  /^\.dod/,
  /^\.prd/,
  /^\.dev/,
  /package\.json$/,
  /package-lock\.json$/,
  /^DEFINITION\.md$/,
  /^VERSION$/,
  /\.md$/,
  /^\.gitignore$/,
  /^\.eslint/,
  /^\.prettier/,
];

// 组件识别规则（优先级从高到低排列）
const RULES = [
  { p: /^packages\/brain\/src\/desire/,             c: 'desire' },
  { p: /^packages\/brain\/src\/emotion/,            c: 'emotion' },
  { p: /^packages\/brain\/src\/notion/,             c: 'notion' },
  { p: /^packages\/brain\/src\/orchestrator-chat/,  c: 'mouth' },
  { p: /^packages\/brain\/src\/routes\/orchestrat/, c: 'mouth' },
  { p: /^packages\/brain\/src\/proactive-mouth/,    c: 'mouth' },
  { p: /^packages\/brain\/src\/memory/,             c: 'memory' },
  { p: /^packages\/brain\/src\/rumination/,         c: 'memory' },
  { p: /^packages\/brain\/src\/learning/,           c: 'memory' },
  { p: /^packages\/brain\/src\/self-model/,         c: 'memory' },
  { p: /^packages\/brain\/src\//,                   c: 'brain' },
  { p: /^packages\/brain\/migrations\//,            c: 'brain' },
  { p: /^packages\/brain\/scripts\//,               c: 'brain' },
  { p: /^apps\/api\/features\//,                    c: 'dashboard' },
  { p: /^apps\/dashboard\//,                        c: 'dashboard' },
  { p: /^packages\/engine\//,                       c: 'engine' },
  { p: /^packages\/workflows\//,                    c: 'engine' },
  { p: /^packages\/quality\//,                      c: 'engine' },
  { p: /^\.github\/workflows\//,                    c: 'engine' },
];

// 专项组件优先（出现即胜出，不看数量）
const PRIORITY = ['desire', 'emotion', 'notion', 'mouth', 'memory', 'dashboard', 'engine', 'brain'];

function detectComponent(filePaths) {
  const codeFiles = filePaths.filter(f => !SKIP.some(r => r.test(f)));
  if (codeFiles.length === 0) return null;
  const found = new Set();
  for (const f of codeFiles) {
    for (const rule of RULES) {
      if (rule.p.test(f)) { found.add(rule.c); break; }
    }
  }
  for (const c of PRIORITY) {
    if (found.has(c)) return c;
  }
  return 'brain';
}

function sigScore(title, codeFileCount) {
  const t = title.toLowerCase();
  if (t.includes('feat!') || t.includes('breaking')) return 5;
  if (t.startsWith('feat') && codeFileCount > 15) return 4;
  if (t.startsWith('feat')) return 3;
  if (t.startsWith('fix') && codeFileCount > 8) return 3;
  if (t.startsWith('fix')) return 2;
  return 1;
}

async function ghFetch(path) {
  const token = process.env.GITHUB_TOKEN;
  const url = `https://api.github.com${path}`;
  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'cecelia-brain' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}: ${path}`);
  return res.json();
}

/**
 * 每日门控：扫描 cecelia repo 最近 2 天合并的 PR，写入 component_evolutions
 */
export async function scanEvolutionIfNeeded(pool) {
  const today = new Date().toISOString().slice(0, 10);

  // 门控：今日已扫则跳过
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'evolution_last_scan_date' LIMIT 1`
    );
    if (rows[0]?.value_json?.date === today) {
      return { ok: true, skipped: 'already_scanned_today' };
    }
  } catch (e) {
    console.warn('[evolution-scanner] 读取 working_memory 失败:', e.message);
  }

  // 获取最近 2 天合并的 PR（多取一天防遗漏）
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const prs = await ghFetch(
    `/repos/${OWNER}/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=50`
  );
  const mergedPRs = prs.filter(pr => pr.merged_at && pr.merged_at >= since);

  let inserted = 0;
  let skipped = 0;

  for (const pr of mergedPRs) {
    // 去重检查
    const { rowCount } = await pool.query(
      'SELECT 1 FROM component_evolutions WHERE source_repo=$1 AND pr_number=$2',
      [SOURCE_REPO, pr.number]
    );
    if (rowCount > 0) { skipped++; continue; }

    // 获取变更文件
    let filePaths = [];
    try {
      const files = await ghFetch(
        `/repos/${OWNER}/${REPO}/pulls/${pr.number}/files?per_page=100`
      );
      filePaths = files.map(f => f.filename);
    } catch (e) {
      console.warn(`[evolution-scanner] PR #${pr.number} 文件获取失败:`, e.message);
    }

    const comp = detectComponent(filePaths);
    if (!comp) { skipped++; continue; }

    const codeFiles = filePaths.filter(f => !SKIP.some(r => r.test(f)));
    const ver = (pr.title.match(/v(\d+\.\d+\.\d+)/) || [])[1] || null;
    const date = pr.merged_at.split('T')[0];

    await pool.query(
      `INSERT INTO component_evolutions
         (date, component, pr_number, title, significance, changed_files, version, source_repo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [date, comp, pr.number, pr.title, sigScore(pr.title, codeFiles.length), codeFiles, ver, SOURCE_REPO]
    );
    inserted++;
    console.log(`[evolution-scanner] 写入 #${pr.number} [${comp}] ${pr.title.slice(0, 50)}`);
  }

  // 更新门控时间
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (key) DO UPDATE SET value_json=$2, updated_at=NOW()`,
      ['evolution_last_scan_date', JSON.stringify({ date: today, inserted, skipped, checked: mergedPRs.length })]
    );
  } catch (e) {
    console.warn('[evolution-scanner] 更新 working_memory 失败:', e.message);
  }

  console.log(`[evolution-scanner] 扫描完成: 检查 ${mergedPRs.length} 个 PR，写入 ${inserted}，跳过 ${skipped}`);
  return { ok: true, checked: mergedPRs.length, inserted, skipped };
}

/**
 * 每周门控：每 7 天重新合成一次叙事摘要
 */
export async function synthesizeEvolutionIfNeeded(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'evolution_last_synthesis_date' LIMIT 1`
    );
    const lastDate = rows[0]?.value_json?.date;
    if (lastDate) {
      const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
      if (daysSince < 7) {
        return { ok: true, skipped: 'synthesized_within_7_days', days_since: daysSince };
      }
    }
  } catch (e) {
    console.warn('[evolution-scanner] 读取合成门控失败:', e.message);
  }

  const result = await runEvolutionSynthesis(pool);

  if ((result.synthesized ?? 0) > 0) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await pool.query(
        `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (key) DO UPDATE SET value_json=$2, updated_at=NOW()`,
        ['evolution_last_synthesis_date', JSON.stringify({ date: today, synthesized: result.synthesized })]
      );
    } catch (e) {
      console.warn('[evolution-scanner] 更新合成门控失败:', e.message);
    }
  }

  return result;
}
