/**
 * project-locate.js — 一句话归位打分引擎（链 2afa6d69 棒3，任务 8a40825a）
 *
 * 有头会话里主理人随口说"去做 X"，POST /api/brain/projects/locate 要能自己判断
 * X 属于哪个现存 project（attach），还是该新开一个（create）。
 *
 * 打分优先用语义 embedding（复用 openai-client.js 的 generateEmbedding，与
 * similarity.js 同一底座），800ms 内拿不到结果（无 OPENAI_API_KEY / 超时 / API 失败）
 * 整体回退到中文 bigram 关键词覆盖率——不允许部分候选走 embedding、部分走
 * 关键词混排（同一响应内量纲必须统一，否则排序无意义）。
 *
 * 任务 912c1143（2026-10-01 生产实测永远判 create）三处修正：
 *   ① 关键词分从 Jaccard（交集/并集）改为 query 覆盖率（交集/query 词数）：短句对长项目
 *      文本时 Jaccard 被候选长度稀释，真项目也只有 0.1 出头；
 *   ② 关键词与语义各用各的阈值（量纲不同），keyword 默认 0.5；
 *   ③ embedding 只对关键词预筛前 EMBEDDING_PREFILTER_TOP 名调用，否则 200+ 候选逐个
 *      调用必然撞 800ms 超时、永远回退关键词。
 */
import { generateEmbedding } from './openai-client.js';

export const DEFAULT_PROJECT_LOCATE_THRESHOLD = 0.55;
export const DEFAULT_PROJECT_LOCATE_KEYWORD_THRESHOLD = 0.5;
const EMBEDDING_TIMEOUT_MS = 800;
const EMBEDDING_PREFILTER_TOP = 20;

function readThreshold(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 解析 attach/create 分界阈值（按打分方式区分量纲）。
 * embedding：默认 0.55，env PROJECT_LOCATE_THRESHOLD；keyword：默认 0.5，env PROJECT_LOCATE_KEYWORD_THRESHOLD。
 * 非法值（非数字/空）回退默认，不让脏配置把接口打挂。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {'embedding'|'keyword'} [method='embedding']
 * @returns {number}
 */
export function resolveProjectLocateThreshold(env = process.env, method = 'embedding') {
  if (method === 'keyword') {
    return readThreshold(env?.PROJECT_LOCATE_KEYWORD_THRESHOLD, DEFAULT_PROJECT_LOCATE_KEYWORD_THRESHOLD);
  }
  return readThreshold(env?.PROJECT_LOCATE_THRESHOLD, DEFAULT_PROJECT_LOCATE_THRESHOLD);
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

// 口语虚词：含这些字的中文 bigram（和单字 token）不承载"属于哪个项目"的信息，只会稀释覆盖率。
const STOP_CHARS = new Set('的了在是和与及或把被给让加一个这那要去做改小大些点吧呢吗啊也都就还又再'.split(''));

function isInformativeToken(token) {
  if (!CJK_RE.test(token)) return true;
  if (token.length < 2) return false;
  for (const ch of token) if (STOP_CHARS.has(ch)) return false;
  return true;
}

/**
 * 关键词相似度 = query 有效 token 被候选文本覆盖的比例（交集 / query 有效 token 数）。
 * 不用 Jaccard：候选文本（name+description+brief）远长于一句话，并集被候选撑大，真项目也得不到高分。
 * 任一侧为空返回 0。
 */
export function keywordOverlapScore(queryText, candidateText) {
  const q = new Set(tokenizeBigram(queryText).filter(isInformativeToken));
  const c = new Set(tokenizeBigram(candidateText));
  if (q.size === 0 || c.size === 0) return 0;
  let intersection = 0;
  for (const t of q) if (c.has(t)) intersection += 1;
  return intersection / q.size;
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

  const keywordScored = keywordScoreAll(text, candidates);

  if (typeof embedFn === 'function') {
    // 只对关键词预筛前 N 名做 embedding：全量逐个调用（生产 200+ 候选）必撞超时，
    // 语义路径形同虚设。只返回预筛集合的分数（全部同一量纲，不混排）。
    const shortlist = [...keywordScored]
      .sort((a, b) => b.score - a.score)
      .slice(0, EMBEDDING_PREFILTER_TOP)
      .map(({ score: _ignored, ...p }) => p);
    try {
      const scored = await withTimeout(embeddingScoreAll(text, shortlist, embedFn), timeoutMs);
      return { method: 'embedding', scored };
    } catch {
      // 无 key / 超时 / API 失败 —— 整体回退关键词打分，不让部分候选走 embedding
    }
  }

  return { method: 'keyword', scored: keywordScored };
}
