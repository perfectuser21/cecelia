/**
 * project-locate.js — 一句话归位打分引擎（链 2afa6d69 棒3，任务 8a40825a）
 *
 * 有头会话里主理人随口说"去做 X"，POST /api/brain/projects/locate 要能自己判断
 * X 属于哪个现存 project（attach），还是该新开一个（create）。
 *
 * 打分优先用语义 embedding（复用 openai-client.js 的 generateEmbedding，与
 * similarity.js 同一底座），800ms 内拿不到结果（无 OPENAI_API_KEY / 超时 / API 失败）
 * 整体回退到中文 bigram 关键词重叠（Jaccard）——不允许部分候选走 embedding、部分走
 * 关键词混排（同一响应内量纲必须统一，否则排序无意义）。
 */
import { generateEmbedding } from './openai-client.js';

export const DEFAULT_PROJECT_LOCATE_THRESHOLD = 0.55;
const EMBEDDING_TIMEOUT_MS = 800;

/**
 * 解析 attach/create 分界阈值。默认 0.55，env PROJECT_LOCATE_THRESHOLD 可调，
 * 非法值（非数字/空）回退默认，不让脏配置把接口打挂。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function resolveProjectLocateThreshold(env = process.env) {
  const raw = env?.PROJECT_LOCATE_THRESHOLD;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PROJECT_LOCATE_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_PROJECT_LOCATE_THRESHOLD;
}

const CJK_RE = /[一-龥]/;

/**
 * 中文按相邻 2 字切 bigram，英文/数字按词保留（长度>1），过滤标点空白。
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeBigram(text) {
  if (!text) return [];
  const cleaned = String(text).toLowerCase().replace(/[^\w一-龥]+/g, ' ').trim();
  if (!cleaned) return [];
  const tokens = [];
  for (const word of cleaned.split(/\s+/)) {
    if (!word) continue;
    if (CJK_RE.test(word)) {
      if (word.length === 1) {
        tokens.push(word);
        continue;
      }
      for (let i = 0; i < word.length - 1; i++) tokens.push(word.slice(i, i + 2));
    } else if (word.length > 1) {
      tokens.push(word);
    }
  }
  return tokens;
}

/** bigram token 集合的 Jaccard 相似度（交集/并集），任一侧为空返回 0。 */
export function keywordOverlapScore(queryText, candidateText) {
  const q = new Set(tokenizeBigram(queryText));
  const c = new Set(tokenizeBigram(candidateText));
  if (q.size === 0 || c.size === 0) return 0;
  let intersection = 0;
  for (const t of q) if (c.has(t)) intersection += 1;
  const union = q.size + c.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** project 行 → 参与打分的拼接文本（name + description + brief.goal + brief.status）。 */
export function projectCandidateText(project) {
  const brief = project?.brief && typeof project.brief === 'object' ? project.brief : {};
  return [project?.name, project?.description, brief.goal, brief.status]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .join(' ');
}

function cosineSimilarity(a, b) {
  const len = Math.min(a?.length ?? 0, b?.length ?? 0);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('project_locate_embedding_timeout')), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function keywordScoreAll(text, candidates) {
  return candidates.map((p) => ({ ...p, score: keywordOverlapScore(text, projectCandidateText(p)) }));
}

async function embeddingScoreAll(text, candidates, embedFn) {
  const texts = [text, ...candidates.map((p) => projectCandidateText(p) || p.name || '')];
  const embeddings = await Promise.all(texts.map((t) => embedFn(t, { retries: 0 })));
  const [queryEmbedding, ...candidateEmbeddings] = embeddings;
  return candidates.map((p, i) => ({ ...p, score: cosineSimilarity(queryEmbedding, candidateEmbeddings[i]) }));
}

/**
 * 给候选 project 打分。优先 embedding（query + 每个候选各一次调用，整体套 800ms 超时），
 * 失败/超时整体回退关键词重叠（不混排）。
 * @param {string} text 用户描述
 * @param {Array<object>} candidates project 行（至少含 name/description/brief）
 * @param {object} [options]
 * @param {Function} [options.embedFn] 依赖注入，测试用；显式传 undefined/null 表示跳过 embedding；
 *   不传该键时默认走真实 generateEmbedding（无 OPENAI_API_KEY 时其自身会 throw，自然触发回退）。
 * @param {number} [options.timeoutMs=800]
 * @returns {Promise<{method: 'embedding'|'keyword', scored: Array<object & {score: number}>}>}
 */
export async function scoreProjectCandidates(text, candidates, options = {}) {
  const timeoutMs = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  const embedFn = Object.prototype.hasOwnProperty.call(options, 'embedFn')
    ? options.embedFn
    : generateEmbedding;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { method: 'keyword', scored: [] };
  }

  if (typeof embedFn === 'function') {
    try {
      const scored = await withTimeout(embeddingScoreAll(text, candidates, embedFn), timeoutMs);
      return { method: 'embedding', scored };
    } catch {
      // 无 key / 超时 / API 失败 —— 整体回退关键词打分，不让部分候选走 embedding
    }
  }

  return { method: 'keyword', scored: keywordScoreAll(text, candidates) };
}
