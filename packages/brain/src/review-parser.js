/**
 * Structured Review Block Parser — Phase 8.3
 *
 * 把 proxy 生成的 markdown review block（B-4/B-5/B-6/SDD-2/SDD-3）解析为 JSON。
 * 契约见 docs/superpowers/specs/2026-04-20-phase83-dev-reviews-design.md。
 *
 * 缺字段 → null（不抛）；格式严重损坏 → ParseError。
 */

export class ParseError extends Error {
  constructor(message, snippet) {
    super(message);
    this.name = 'ParseError';
    this.snippet = snippet;
  }
}

const POINT_CODE_RE = /^##\s*Review（autonomous，([A-Z]+-\d+)/m;
const FIELD_RES = {
  decision: /\*\*判断\*\*[：:]\s*([A-Z_]+)/,
  confidence: /\*\*confidence\*\*[：:]\s*(HIGH|MEDIUM|LOW)/,
  quality_score: /\*\*质量分\*\*[：:]\s*(\d+)\s*\/\s*10/,
  next_step: /\*\*下一步\*\*[：:]\s*(.+?)(?:\n|$)/,
};

function extractBlock(text, header) {
  const re = new RegExp(`\\*\\*${header}\\*\\*[：:]\\s*\\n?([\\s\\S]*?)(?=\\n\\*\\*|\\n##|$)`);
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function parseAnchors(anchorsBlock) {
  if (!anchorsBlock) return { user_words: null, code: null, okr: null };
  const pick = (label) => {
    const re = new RegExp(`-\\s*${label}[：:]\\s*(.+?)(?:\\n|$)`);
    const m = anchorsBlock.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    user_words: pick('用户的话'),
    code: pick('代码'),
    okr: pick('OKR'),
  };
}

function parseRisks(risksBlock) {
  if (!risksBlock) return [];
  const lines = risksBlock.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('-'));
  return lines.map((l) => {
    const body = l.replace(/^-\s*/, '').trim();
    const colonIdx = body.indexOf('：');
    const altColon = body.indexOf(':');
    const splitAt = colonIdx > 0 ? colonIdx : altColon;
    if (splitAt > 0) {
      return { risk: body.slice(0, splitAt).trim(), impact: body.slice(splitAt + 1).trim() };
    }
    return { risk: body, impact: null };
  });
}

export function parseReviewBlock(markdown) {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    throw new ParseError('empty or non-string input', markdown);
  }
  const codeMatch = markdown.match(POINT_CODE_RE);
  if (!codeMatch) {
    throw new ParseError('missing Review header with point_code', markdown.slice(0, 200));
  }
  const point_code = codeMatch[1];

  const decision = (markdown.match(FIELD_RES.decision) || [])[1] || null;
  const confidence = (markdown.match(FIELD_RES.confidence) || [])[1] || null;
  const qsMatch = markdown.match(FIELD_RES.quality_score);
  const quality_score = qsMatch ? parseInt(qsMatch[1], 10) : null;
  const next_step = (markdown.match(FIELD_RES.next_step) || [])[1]?.trim() || null;

  const anchors = parseAnchors(extractBlock(markdown, '依据'));
  const risks = parseRisks(extractBlock(markdown, '风险'));

  return {
    point_code,
    decision,
    confidence,
    quality_score,
    risks,
    anchors_user_words: anchors.user_words,
    anchors_code: anchors.code,
    anchors_okr: anchors.okr,
    next_step,
    raw_markdown: markdown,
  };
}
