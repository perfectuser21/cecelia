/**
 * content-quality-validator.js
 *
 * 程序化内容质量验证器。
 *
 * 职责：对已生成的内容字符串进行规则检查，补充 LLM review_rules（元数据层）之外的
 * 运行时验证层。
 *
 * 验证维度：
 *   1. 字数检查  — 实际字数 ≥ 内容类型配置的 min_word_count
 *   2. 关键词检查 — 内容必须包含 keywords_required 中至少 2 个关键词
 *   3. 语气检查  — 内容不得含有过于正式/企业化的表述（违背"一人公司"亲切风格）
 *
 * 使用方式：
 *   import { validateContentQuality } from './content-quality-validator.js';
 *   const { passed, issues } = validateContentQuality(text, typeConfig, 'short_copy');
 */

// ─── 语气违规词表 ────────────────────────────────────────────────────────────
// 这些词汇会让内容显得过于正式/企业化，不符合"一人公司"亲切风格定位
const TONE_VIOLATION_PATTERNS = [
  '您好',
  '尊敬的',
  '贵公司',
  '贵司',
  '敬请',
  '特此通知',
  '兹证明',
  '谨启',
  '诚挚',
  '鉴于上述',
];

// ─── 默认关键词要求 ──────────────────────────────────────────────────────────
// 未在 content_type 配置中指定 keywords_required 时使用的兜底列表（AI一人公司主题）
const DEFAULT_REQUIRED_KEYWORDS = ['AI', '一人公司'];

// ─── 默认最小字数 ────────────────────────────────────────────────────────────
const DEFAULT_MIN_WORD_COUNT = {
  short_copy: 200,
  long_form: 800,
};

/**
 * 统计文本字数（中英文混合）。
 * - 中文：每个汉字算1字
 * - 英文：以空格分隔的词算1词
 *
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  // 提取中文字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  // 提取英文单词（去掉标点后按空格分割）
  const stripped = text.replace(/[\u4e00-\u9fa5]/g, ' ').replace(/[^\w\s]/g, ' ');
  const englishWords = stripped.trim().split(/\s+/).filter((w) => w.length > 0).length;
  return chineseChars + englishWords;
}

/**
 * 检查内容是否包含指定关键词（大小写不敏感）。
 *
 * @param {string} text
 * @param {string[]} keywords
 * @returns {{ found: string[], missing: string[] }}
 */
export function checkKeywords(text, keywords) {
  if (!text || !Array.isArray(keywords)) return { found: [], missing: [] };
  const lower = text.toLowerCase();
  const found = [];
  const missing = [];
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      found.push(kw);
    } else {
      missing.push(kw);
    }
  }
  return { found, missing };
}

/**
 * 检查语气违规词。
 *
 * @param {string} text
 * @returns {string[]} 命中的违规词列表
 */
export function checkToneViolations(text) {
  if (!text || typeof text !== 'string') return [];
  return TONE_VIOLATION_PATTERNS.filter((pattern) => text.includes(pattern));
}

/**
 * 对内容执行完整质量验证。
 *
 * @param {string} content - 待验证的内容文本
 * @param {object} typeConfig - 内容类型配置（YAML 解析后的对象）
 * @param {'short_copy'|'long_form'} [copyVariant='short_copy'] - 验证的内容变体
 * @returns {{ passed: boolean, issues: Array<{rule: string, severity: 'blocking'|'warning', message: string}> }}
 */
export function validateContentQuality(content, typeConfig = {}, copyVariant = 'short_copy') {
  const issues = [];

  // ── 1. 字数检查 ──────────────────────────────────────────────────────────
  const minWordCount =
    typeConfig?.copy_rules?.min_word_count?.[copyVariant] ??
    DEFAULT_MIN_WORD_COUNT[copyVariant] ??
    200;

  const wordCount = countWords(content);
  if (wordCount < minWordCount) {
    issues.push({
      rule: 'min_word_count',
      severity: 'blocking',
      message: `字数不足：实际 ${wordCount} 字，要求 ≥ ${minWordCount} 字`,
    });
  }

  // ── 2. 关键词检查 ────────────────────────────────────────────────────────
  const requiredKeywords =
    typeConfig?.copy_rules?.keywords_required ?? DEFAULT_REQUIRED_KEYWORDS;
  // 至少命中 2 个，但不超过总关键词数量（避免关键词少于2个时永远失败）
  const minKeywordsHit = Math.min(2, requiredKeywords.length);

  if (requiredKeywords.length > 0) {
    const { found, missing } = checkKeywords(content, requiredKeywords);
    if (found.length < minKeywordsHit) {
      issues.push({
        rule: 'required_keywords',
        severity: 'blocking',
        message: `关键词覆盖不足：命中 ${found.length}/${requiredKeywords.length} 个（要求 ≥ ${minKeywordsHit}），缺失：${missing.join('、')}`,
      });
    }
  }

  // ── 3. 语气检查 ──────────────────────────────────────────────────────────
  const toneViolations = checkToneViolations(content);
  if (toneViolations.length > 0) {
    issues.push({
      rule: 'tone_check',
      severity: 'warning',
      message: `语气违规：含有过于正式的表述「${toneViolations.join('、')}」，建议改为亲切口语化风格`,
    });
  }

  // ── 判断是否通过 ─────────────────────────────────────────────────────────
  const blockingIssues = issues.filter((i) => i.severity === 'blocking');
  const passed = blockingIssues.length === 0;

  return { passed, word_count: wordCount, issues };
}

/**
 * 批量验证 pipeline 产出的所有内容变体。
 *
 * @param {object} contentMap - { short_copy: string, long_form: string }
 * @param {object} typeConfig - 内容类型配置
 * @returns {{ passed: boolean, results: object }}
 */
export function validateAllVariants(contentMap, typeConfig = {}) {
  const results = {};
  let allPassed = true;

  for (const [variant, content] of Object.entries(contentMap)) {
    if (!content) continue;
    const result = validateContentQuality(content, typeConfig, variant);
    results[variant] = result;
    if (!result.passed) allPassed = false;
  }

  return { passed: allPassed, results };
}
