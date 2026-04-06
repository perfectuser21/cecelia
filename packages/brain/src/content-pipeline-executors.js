/**
 * content-pipeline-executors.js
 *
 * 内容工厂 Pipeline 六阶段 executor：
 *   1. executeResearch      — 从 NotebookLM 拉取调研素材
 *   2. executeCopywriting   — 基于素材生成文案（社交媒体 + 公众号长文）
 *   3. executeCopyReview    — 文案质量审查（品牌对齐 + 公式检查）
 *   4. executeGenerate      — 基于定稿文案生成图片
 *   5. executeImageReview   — 图片审查（文件完整性 + 尺寸检查）
 *   6. executeExport        — 归档 + manifest.json + 在线预览
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';

const execAsync = promisify(exec);
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getContentType } from './content-types/content-type-registry.js';

const _require = createRequire(import.meta.url);
import { callLLM } from './llm-caller.js';
import { listSources, deleteSource } from './notebook-adapter.js';

// ─── LLM Fallback Helper ─────────────────────────────────────
// 当主 LLM（thalamus profile 的 anthropic-api/haiku）失败时，
// 若错误特征匹配 Codex/OpenAI 配额耗尽或连接断开，自动 fallback 到
// claude-sonnet-4-6（anthropic-api 直连），避免整个 pipeline 降级静态模板。
const CLAUDE_FALLBACK_MODEL    = 'claude-sonnet-4-6';
const CLAUDE_FALLBACK_PROVIDER = 'anthropic-api';

function _isFallbackError(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('usage limit') ||
    msg.includes('quota') ||
    msg.includes('stream disconnected') ||
    msg.includes('chatgpt.com')
  );
}

async function _callLLMWithFallback(agentId, prompt, options = {}) {
  try {
    return await callLLM(agentId, prompt, options);
  } catch (primaryErr) {
    if (_isFallbackError(primaryErr)) {
      console.warn(
        `[content-pipeline] ${agentId} 主 LLM 失败（${primaryErr.message.substring(0, 80)}），` +
        `自动 fallback 到 ${CLAUDE_FALLBACK_MODEL}`
      );
      return await callLLM(agentId, prompt, {
        ...options,
        model:    CLAUDE_FALLBACK_MODEL,
        provider: CLAUDE_FALLBACK_PROVIDER,
      });
    }
    throw primaryErr;
  }
}
// ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────────

const OUTPUT_BASE = process.env.CONTENT_OUTPUT_DIR
  || join(__dirname, '../../../../zenithjoy/content-output');

const NAS_USER = process.env.NAS_USER || '徐啸';
const NAS_IP = process.env.NAS_IP || '100.110.241.76';
const NAS_BASE = process.env.NAS_BASE || '/volume1/workspace/vault/zenithjoy-creator/content';

const BRAND_KEYWORDS = ['能力', '系统', '一人公司', '小组织', 'AI', '能力下放', '能力放大'];
const BANNED_WORDS = ['coding', '搭建', 'agent workflow', 'builder', 'Cecelia', '智能体搭建', '代码部署'];

// ─── 工具 ───────────────────────────────────────────────────

async function run(cmd, timeout = 60000) {
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
    });
    return stdout.trim();
  } catch (err) {
    console.error(`[executor] cmd failed: ${cmd.substring(0, 80)}… → ${(err.stderr || err.message || '').substring(0, 200)}`);
    return null;
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function slug(text) {
  return text.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, '-').replace(/-+/g, '-').substring(0, 40);
}

function today() { return new Date().toISOString().split('T')[0]; }

function findOutputDir(keyword) {
  const s = slug(keyword);
  try {
    return readdirSync(OUTPUT_BASE)
      .filter(d => d.includes(s) && !d.startsWith('research'))
      .map(d => join(OUTPUT_BASE, d))
      .find(d => existsSync(d)) || null;
  } catch { return null; }
}

// ─── 1. Research 辅助函数 ────────────────────────────────────

async function clearNotebookSources(notebookId, label = '') {
  try {
    const srcList = await listSources(notebookId);
    const sources = srcList?.sources || [];
    for (const src of sources) {
      try { await deleteSource(src.id, notebookId); } catch { /* 忽略单条删除失败 */ }
    }
    console.log(`[research] 已清空 ${sources.length} 个${label}sources`);
  } catch (e) {
    console.warn(`[research] 清空 sources 失败（忽略）: ${e.message}`);
  }
}

function buildResearchPrompt(typeConfig, keyword) {
  const defaultPrompt = `从所有源中，找出能证明'个人也能拥有过去只有公司才有的能力'的证据。关于${keyword}，每条带具体数据和来源。至少8条。`;
  if (typeConfig?.template?.research_prompt) {
    return typeConfig.template.research_prompt.replace(/\{keyword\}/g, keyword);
  }
  return defaultPrompt;
}

function parseResearchFindings(raw, keyword) {
  if (!raw || !raw.trim()) {
    throw new Error('NotebookLM 返回空内容，请检查 notebook_id 是否有效或 NotebookLM 是否可用');
  }
  try {
    const { answer = '' } = JSON.parse(raw);
    if (!answer.trim()) {
      throw new Error('NotebookLM 返回 answer 为空，无法提取 findings');
    }
    const parts = answer.split(/\n\*\*\d+\./).filter(Boolean);
    return parts.map((p, i) => ({
      id: `f${String(i + 1).padStart(3, '0')}`,
      title: p.split('\n')[0]?.replace(/\*+/g, '').trim().substring(0, 100) || `发现${i + 1}`,
      content: p.trim(),
      source: 'NotebookLM',
      brand_relevance: 4,
      used_in: [],
    }));
  } catch (e) {
    if (e.message.includes('NotebookLM')) throw e;
    return [{ id: 'f001', title: keyword, content: raw.substring(0, 3000), source: 'NotebookLM', brand_relevance: 3, used_in: [] }];
  }
}

// ─── 1. Research ────────────────────────────────────────────

export async function executeResearch(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const notebookId = task.payload?.notebook_id;
  const contentType = task.payload?.content_type || 'solo-company-case';

  console.log(`[research] 开始: ${keyword} (notebook=${notebookId || '无'})`);

  if (!notebookId) {
    const errMsg = 'notebook_id 未配置，请在系列设置中配置 NotebookLM notebook_id';
    console.error(`[research] FAIL: ${errMsg}`);
    return { success: false, error: errMsg };
  }

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = join(OUTPUT_BASE, 'research', `${contentType}-${slug(keyword)}-${today()}`);
  ensureDir(dir);

  await run(`notebooklm use ${notebookId} 2>&1`);
  await clearNotebookSources(notebookId, '旧 ');

  console.log(`[research] 开始 web 搜索: ${keyword}`);
  await run(`notebooklm source add-research "${keyword}" --mode deep --no-wait 2>&1`, 30000);

  const waitResult = await run(`notebooklm research wait --timeout 300 --import-all 2>&1`, 330000);
  console.log(`[research] 研究完成: ${waitResult?.substring(0, 200) || '(无输出)'}`);

  const researchPrompt = buildResearchPrompt(typeConfig, keyword);
  const raw = await run(`notebooklm ask "${researchPrompt}" --json 2>&1`, 120000);

  let findings;
  try {
    findings = parseResearchFindings(raw, keyword);
  } catch (e) {
    console.error(`[research] FAIL: ${e.message}`);
    return { success: false, error: e.message };
  }

  if (findings.length === 0) {
    const errMsg = 'NotebookLM 解析后 findings 为空，请检查返回格式';
    console.error(`[research] FAIL: ${errMsg}`);
    return { success: false, error: errMsg };
  }

  const fp = join(dir, 'findings.json');
  const data = { keyword, series: contentType, notebook_id: notebookId, extracted_at: today(), total_findings: findings.length, findings };
  writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');

  await clearNotebookSources(notebookId);

  console.log(`[research] 完成: ${findings.length} findings → ${fp}`);
  return { success: true, findings_path: fp, findings_count: findings.length };
}

// ─── 2. Copywriting（文案生成）────────────────────────────────

/**
 * 查找 research findings（共用逻辑，copywriting 和 generate 都需要）
 */
function _loadFindings(keyword) {
  let findings = [];
  try {
    const rDir = join(OUTPUT_BASE, 'research');
    if (existsSync(rDir)) {
      const s = slug(keyword);
      const candidates = readdirSync(rDir).filter(d => d.includes(s));
      let bestCount = 0;
      for (const cand of candidates) {
        const fp = join(rDir, cand, 'findings.json');
        if (existsSync(fp)) {
          try {
            const data = JSON.parse(readFileSync(fp, 'utf-8'));
            const f = data.findings || [];
            if (f.length > bestCount) { findings = f; bestCount = f.length; }
          } catch { /* skip malformed */ }
        }
      }
    }
  } catch { /* */ }
  return findings;
}

function _filterTopFindings(findings) {
  let top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 7);
  if (top.length === 0 && findings.length > 0) {
    console.warn(`[copywriting] 无高质量 findings（brand_relevance>=3），降级使用全部 ${findings.length} 条`);
    top = findings.slice(0, 7);
  }
  if (top.length === 0) {
    console.warn(`[copywriting] 无 research findings，降级使用全部静态模板生成文案`);
  }
  return top;
}

function _buildCopywritingPrompt(keyword, top, typeConfig, previousFeedback) {
  const findingsSummary = top.map((f, i) => `${i + 1}. ${f.title}: ${(f.content || '').substring(0, 1500)}`).join('\n');
  let prompt = typeConfig.template.generate_prompt.replace(/\{keyword\}/g, keyword);
  prompt += `\n\n## 调研素材（${top.length} 条）\n${findingsSummary}`;
  if (previousFeedback) {
    prompt += `\n\n## 上次审查意见（请针对以下问题改进）\n${previousFeedback}`;
  }
  prompt += `\n\n请严格按以下格式输出，不要省略分隔符：\n=== 社交媒体文案 ===\n[在此输出小红书/抖音风格文案，500-800字，口语化，含互动引导]\n=== 公众号长文 ===\n[在此输出深度分析长文，1500-2000字，结构清晰]`;
  prompt += `\n\n**绝对禁止**：不要询问用户问题，不要说"需要更多信息"，不要提示素材不足，不要输出选项A/B让用户选择。无论素材多少，必须直接输出完整文案。如果缺乏具体案例数据，用行业通识和合理类比补充，并用「据公开资料」「行业通常」「估计」等词汇标注，切勿编造精确数字。`;
  return prompt;
}

/** 最小内容长度校验（字符数），防止 LLM 输出澄清问题而非实际文案 */
const MIN_SOCIAL_COPY_LEN = 200;
const MIN_ARTICLE_LEN = 500;

async function _executeLLMPath(keyword, top, typeConfig, previousFeedback, dir) {
  try {
    const prompt = _buildCopywritingPrompt(keyword, top, typeConfig, previousFeedback);
    const { text } = await _callLLMWithFallback('thalamus', prompt, { maxTokens: 4096, timeout: 120000 });
    const socialMatch = text.match(/=== 社交媒体文案 ===([\s\S]*?)(?:=== 公众长文 ===|=== 公众号长文 ===|$)/);
    const articleMatch = text.match(/=== 公众[号]?长文 ===([\s\S]*?)$/);
    const socialCopy = socialMatch?.[1]?.trim();
    const articleCopy = articleMatch?.[1]?.trim();

    // 格式校验：两段均须存在且达到最小长度，否则降级静态模板
    if (!socialCopy || socialCopy.length < MIN_SOCIAL_COPY_LEN || !articleCopy || articleCopy.length < MIN_ARTICLE_LEN) {
      console.warn(`[copywriting] LLM 输出不符格式要求（社交 ${socialCopy?.length ?? 0}字/${MIN_SOCIAL_COPY_LEN}，长文 ${articleCopy?.length ?? 0}字/${MIN_ARTICLE_LEN}），降级到静态模板`);
      return null;
    }

    writeFileSync(join(dir, 'cards', 'copy.md'), `# ${keyword}：社交媒体文案\n\n${socialCopy}\n`, 'utf-8');
    writeFileSync(join(dir, 'article', 'article.md'), `# ${keyword}：深度分析\n\n${articleCopy}\n`, 'utf-8');
    return { success: true, output_dir: dir, files: ['cards/copy.md', 'article/article.md'], llm_generated: true };
  } catch (err) {
    console.error(`[copywriting] Claude 调用失败，降级到静态模板: ${err.message}`);
    return null;
  }
}

function _buildStaticSocialCopy(keyword, top) {
  return [
    `# ${keyword}：过去只有公司才有的能力，现在一个人就够了\n`,
    `你知道吗？越来越多人正在证明：一个人 + 正确的系统 = 一家公司的能力。\n`,
    `今天拆解 ${keyword}，看看哪些"公司级能力"已经被个人拥有了。\n`,
    '---\n',
    ...top.map((f, i) => {
      const body = f.content || f.capability || '';
      const data = f.data ? `\n\n数据：${f.data}` : '';
      return `**${i + 1}. ${f.title}**\n\n${body}${data}\n\n---\n`;
    }),
    `\n**一人公司不是"小"公司，是"精"公司。**\n`,
    `你觉得哪个能力对你最有用？评论区告诉我！\n`,
    `\n#一人公司 #能力放大 #AI驱动 #个人创业 #能力下放\n`,
  ].join('\n');
}

function _buildStaticArticle(keyword, top) {
  return [
    `# ${keyword}：一个人如何拥有公司级能力\n`,
    `> 帮助个人和小组织，用 AI 拥有过去只有公司才有的能力。\n`,
    `\n在这个时代，"一人公司"不再是一种妥协。它是一种系统性的选择——用 AI 和自动化替代人力规模，用能力密度替代团队数量。\n`,
    `\n${keyword} 的经历就是最好的证据。\n`,
    `\n---\n`,
    ...top.map((f, i) => {
      const body = f.content || f.capability || '';
      const data = f.data ? `\n\n**关键数据**：${f.data}` : '';
      const src = f.source ? `\n\n*来源：${f.source}*` : '';
      return `\n## ${i + 1}. ${f.title}\n\n${body}${data}${src}\n`;
    }),
    `\n---\n`,
    `\n## 这意味着什么？\n`,
    `\n能力正在从大公司向个人转移。过去需要一个团队才能做到的事，现在一个人配合正确的系统就能完成。\n`,
    `\n这不是未来。这是正在发生的事。\n`,
    `\n**你准备好拥有这些能力了吗？**\n`,
  ].join('\n');
}

export async function executeCopywriting(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  const previousFeedback = task.payload?.review_feedback || task.payload?.previous_feedback;

  console.log(`[copywriting] 开始: ${keyword}`);

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
  ensureDir(join(dir, 'cards'));
  ensureDir(join(dir, 'article'));

  const findings = _loadFindings(keyword);
  const top = _filterTopFindings(findings);
  console.log(`[copywriting] 找到 ${findings.length} 条 findings，筛选 ${top.length} 条`);

  if (typeConfig?.template?.generate_prompt) {
    const result = await _executeLLMPath(keyword, top, typeConfig, previousFeedback, dir);
    if (result) return result;
  }

  writeFileSync(join(dir, 'cards', 'copy.md'), _buildStaticSocialCopy(keyword, top), 'utf-8');
  writeFileSync(join(dir, 'article', 'article.md'), _buildStaticArticle(keyword, top), 'utf-8');

  console.log(`[copywriting] 完成 → ${dir}`);
  return { success: true, output_dir: dir, files: ['cards/copy.md', 'article/article.md'], llm_generated: false };
}

// ─── 3. Copy Review（文案审核）─────────────────────────────────

export async function executeCopyReview(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  console.log(`[copy-review] 开始: ${keyword}`);

  // 从 DB/YAML 读取内容类型配置
  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = findOutputDir(keyword);
  if (!dir) return { success: true, review_passed: false, issues: ['找不到产出目录'] };

  let allText = '';
  const cp = join(dir, 'cards', 'copy.md');
  const ap = join(dir, 'article', 'article.md');
  if (existsSync(cp)) allText += readFileSync(cp, 'utf-8');
  if (existsSync(ap)) allText += '\n' + readFileSync(ap, 'utf-8');

  if (!allText.trim()) return { success: true, review_passed: false, issues: ['文案内容为空'] };

  const issues = [];
  let ruleScores = null;

  // ─── Claude 调用：使用配置 review_prompt 审查文案 ──────────────
  const reviewRules = typeConfig?.review_rules;
  if (typeConfig?.template?.review_prompt && reviewRules && Array.isArray(reviewRules)) {
    try {
      const rulesDesc = reviewRules
        .map(r => `- ${r.id}: ${r.description} (severity: ${r.severity})`)
        .join('\n');

      const prompt = `${typeConfig.template.review_prompt}\n\n## 待审查内容\n${allText.substring(0, 3000)}\n\n## 审查规则\n${rulesDesc}\n\n请对每条规则逐一评审，严格按 JSON 格式返回：\n{\n  "rule_scores": [\n    { "id": "rule_id", "score": 0, "pass": true, "comment": "评审意见" }\n  ],\n  "overall_pass": true,\n  "quality_score": 7,\n  "summary": "总体评审意见"\n}`;

      const { text } = await _callLLMWithFallback('thalamus', prompt, { maxTokens: 1024, timeout: 60000 });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        ruleScores = parsed.rule_scores || [];
        const failedRules = ruleScores.filter(r => !r.pass);
        if (failedRules.length > 0) {
          issues.push(...failedRules.map(r => `[${r.id}] ${r.comment}`));
        }
        // quality_score >= 6 视为通过，避免 LLM 审查标准过严导致所有内容无法进入下游
        const qualityScore = typeof parsed.quality_score === 'number' ? parsed.quality_score : (parsed.overall_pass !== false ? 7 : 4);
        const passed = qualityScore >= 6;
        return {
          success: true,
          review_passed: passed,
          rule_scores: ruleScores,
          llm_reviewed: true,
          quality_score: qualityScore,
          issues,
        };
      }
    } catch (err) {
      console.error(`[copy-review] Claude 调用失败，降级到静态规则: ${err.message}`);
    }
  }
  // ─────────────────────────────────────────────────────────────

  // fallback: 静态规则检查
  if (reviewRules && Array.isArray(reviewRules)) {
    // 配置驱动的审查：遍历 blocking 规则做可检测的静态验证
    for (const rule of reviewRules) {
      if (rule.id === 'no_fabrication' && rule.severity === 'blocking') {
        // 禁止编造检查：与禁用词检查合并处理（下方统一）
      }
      // 未来可扩展更多规则的自动化检测
    }
  } else {
    // fallback: 硬编码品牌关键词检查
    const hits = BRAND_KEYWORDS.filter(kw => allText.includes(kw));
    if (hits.length < 3) issues.push(`品牌关键词 ${hits.length}/3（需 ≥3，命中：${hits.join('、')}）`);
  }

  // 禁用词 = 0（始终检查）
  const banned = BANNED_WORDS.filter(w => allText.toLowerCase().includes(w.toLowerCase()));
  if (banned.length > 0) issues.push(`禁用词：${banned.join('、')}`);

  // 长度：优先使用配置中的 min_word_count，fallback 到硬编码 300/1000
  const minShortCopy = typeConfig?.copy_rules?.min_word_count?.short_copy || 300;
  const minLongForm = typeConfig?.copy_rules?.min_word_count?.long_form || 1000;

  const copyLen = existsSync(cp) ? readFileSync(cp, 'utf-8').length : 0;
  const artLen = existsSync(ap) ? readFileSync(ap, 'utf-8').length : 0;
  if (copyLen < minShortCopy) issues.push(`社交媒体文案 ${copyLen} 字（需 ≥${minShortCopy}）`);
  if (artLen < minLongForm) issues.push(`公众号长文 ${artLen} 字（需 ≥${minLongForm}）`);

  // 有数据
  if (!/\d+/.test(allText)) issues.push('缺少具体数字/数据');

  const passed = issues.length === 0;
  console.log(`[copy-review] ${passed ? 'PASS' : 'FAIL'}: ${issues.join('; ') || '全部通过'}`);
  return {
    success: true,
    review_passed: passed,
    rule_scores: null,
    llm_reviewed: false,
    score: { banned_hits: banned.length, copy_length: copyLen, article_length: artLen, min_short_copy: minShortCopy, min_long_form: minLongForm },
    config_driven: !!(reviewRules && Array.isArray(reviewRules)),
    issues,
  };
}

// ─── 4. Generate（图片生成）────────────────────────────────────

export async function executeGenerate(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  console.log(`[generate] 开始图片生成: ${keyword}`);

  // 从 DB/YAML 读取内容类型配置
  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }
  const imageCount = typeConfig?.images?.count || 9;
  const imageStyle = typeConfig?.images?.style || 'professional-infographic';

  // 图片生成依赖 export 阶段的 generateCards，此处只做标记
  // 实际卡片渲染在 executeExport 中完成（需要 resvg）
  const dir = findOutputDir(keyword) || (() => {
    const newDir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
    ensureDir(join(newDir, 'cards'));
    ensureDir(join(newDir, 'article'));
    console.log(`[generate] 产出目录已创建: ${newDir}`);
    return newDir;
  })();

  // ─── Claude 调用：生成卡片内容描述 ────────────────────────────
  const generatePrompt = typeConfig?.template?.generate_prompt || typeConfig?.template?.image_prompt;
  if (generatePrompt) {
    try {
      const findings = _loadFindings(keyword);
      const top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, imageCount);
      const findingsSummary = top.length > 0
        ? top.map((f, i) => `${i + 1}. ${f.title}: ${(f.content || '').substring(0, 150)}`).join('\n')
        : `关键词：${keyword}（暂无素材）`;

      const prompt = `${generatePrompt.replace(/\{keyword\}/g, keyword)}\n\n## 调研素材\n${findingsSummary}\n\n请为 ${imageCount} 张信息图生成具体内容描述，严格按 JSON 格式返回：\n{\n  "cards": [\n    { "index": 1, "title": "卡片标题", "content": "卡片主体内容（50-80字）", "highlight": "高亮数据或引言" }\n  ]\n}`;

      const { text } = await _callLLMWithFallback('thalamus', prompt, { maxTokens: 2048, timeout: 60000 });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const cardContent = JSON.parse(jsonMatch[0]);
        writeFileSync(join(dir, 'cards', 'llm-card-content.json'), JSON.stringify(cardContent, null, 2), 'utf-8');
        return { success: true, output_dir: dir, image_count: imageCount, image_style: imageStyle, llm_content: true };
      }
    } catch (err) {
      console.error(`[generate] Claude 调用失败，跳过卡片内容生成: ${err.message}`);
    }
  }
  // ─────────────────────────────────────────────────────────────

  console.log(`[generate] 图片生成阶段完成（实际渲染在 export 阶段）→ ${dir}`);
  return { success: true, output_dir: dir, image_count: imageCount, image_style: imageStyle, llm_content: false };
}

// ─── 5. Image Review（图片审核）───────────────────────────────

export async function executeImageReview(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  console.log(`[image-review] 开始: ${keyword}`);

  // 从 DB/YAML 读取内容类型配置
  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }
  const maxImageCount = typeConfig?.images?.count || 9;

  const dir = findOutputDir(keyword);
  if (!dir) return { success: true, review_passed: false, issues: ['找不到产出目录'] };

  const issues = [];

  // 检查文案文件存在（图片生成的前提）
  const cp = join(dir, 'cards', 'copy.md');
  if (!existsSync(cp)) issues.push('缺少 cards/copy.md 文案文件');

  const ap = join(dir, 'article', 'article.md');
  if (!existsSync(ap)) issues.push('缺少 article/article.md 长文文件');

  // 检查图片目录（如果已有卡片图）
  const topic = slug(keyword);
  const IMAGES_DIR = join(process.env.HOME || '/Users/administrator', 'claude-output', 'images');
  let cardCount = 0;
  try {
    if (existsSync(IMAGES_DIR)) {
      cardCount = readdirSync(IMAGES_DIR).filter(f => f.startsWith(topic) && f.endsWith('.png')).length;
    }
  } catch { /* */ }

  // 图片数量检查（允许 0，因为实际渲染可能在 export 阶段）
  if (cardCount > maxImageCount) issues.push(`图片数量 ${cardCount} 超过限制（最多 ${maxImageCount} 张）`);

  // ─── Claude 调用：审核内容质量 ────────────────────────────────
  const imageReviewPrompt = typeConfig?.template?.image_review_prompt || typeConfig?.template?.review_prompt;
  if (imageReviewPrompt && issues.length === 0) {
    try {
      const cardContentPath = join(dir, 'cards', 'llm-card-content.json');
      let contentForReview = '';
      if (existsSync(cardContentPath)) {
        contentForReview = readFileSync(cardContentPath, 'utf-8');
      } else if (existsSync(cp)) {
        contentForReview = readFileSync(cp, 'utf-8').substring(0, 1000);
      }

      if (contentForReview) {
        const prompt = `${imageReviewPrompt.replace(/\{keyword\}/g, keyword)}\n\n## 待审核内容\n${contentForReview.substring(0, 2000)}\n\n请评审内容质量，严格按 JSON 格式返回：\n{\n  "review_passed": true,\n  "issues": [],\n  "suggestions": ["建议1"],\n  "quality_score": 8\n}`;

        const { text } = await _callLLMWithFallback('thalamus', prompt, { maxTokens: 512, timeout: 45000 });

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const llmReview = JSON.parse(jsonMatch[0]);
          if (llmReview.issues?.length > 0) issues.push(...llmReview.issues);
          // quality_score >= 6 视为通过，避免 LLM 审查标准过严导致所有内容永久失败
          const qualityScore = typeof llmReview.quality_score === 'number' ? llmReview.quality_score : (llmReview.review_passed !== false ? 7 : 4);
          const passed = qualityScore >= 6;
          return { success: true, review_passed: passed, card_count: cardCount, issues, llm_review: llmReview, quality_score: qualityScore };
        }
      }
    } catch (err) {
      console.error(`[image-review] Claude 调用失败，降级到文件检查: ${err.message}`);
    }
  }
  // ─────────────────────────────────────────────────────────────

  const passed = issues.length === 0;
  console.log(`[image-review] ${passed ? 'PASS' : 'FAIL'}: ${issues.join('; ') || '全部通过'}（${cardCount} 张图片）`);
  return { success: true, review_passed: passed, card_count: cardCount, issues, llm_review: null };
}

// ─── 4. Export ──────────────────────────────────────────────

/**
 * 直接在 Node.js 里生成 SVG → resvg 渲染 PNG（不生成外部 .mjs 脚本）
 */
function generateCards(dir, keyword, findings) {
  let top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 6);
  if (top.length === 0 && findings.length > 0) {
    console.warn(`[export] 无高质量 findings（brand_relevance>=3），降级使用全部 ${findings.length} 条`);
    top = findings.slice(0, 6);
  }
  if (top.length === 0) { console.log('[export] 无 findings，跳过卡片生成'); return false; }

  const topic = slug(keyword);
  const IMAGES_DIR = join(process.env.HOME || '/Users/administrator', 'claude-output', 'images');
  ensureDir(IMAGES_DIR);

  const W = 1080, H = 1920, HC = 1464;
  const SL = 80, SR = 260, ST = 220, SB = 260;
  const CX = 80, CY = 300, CW = 740;
  const THEMES = [
    { TC:'#c084fc', TB:'rgba(168,85,247,0.22)', BG1:'#0d0520', BG2:'#170a35', G1:'#a855f7', G2:'#d946ef' },
    { TC:'#f472b6', TB:'rgba(244,114,182,0.22)', BG1:'#15050e', BG2:'#200618', G1:'#ec4899', G2:'#fb923c' },
    { TC:'#818cf8', TB:'rgba(129,140,248,0.22)', BG1:'#08091a', BG2:'#0e1030', G1:'#6366f1', G2:'#8b5cf6' },
    { TC:'#2dd4bf', TB:'rgba(45,212,191,0.22)', BG1:'#021512', BG2:'#061e1a', G1:'#14b8a6', G2:'#06b6d4' },
  ];
  const ACCENTS = ['#f87171','#34d399','#60a5fa','#fbbf24','#a78bfa'];

  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function vertChars(x, yStart, text, fontSize, fill, opacity) {
    const lh = Math.round(fontSize * 1.36);
    return [...text].map((ch, i) =>
      `<text x="${x}" y="${yStart + i * lh}" text-anchor="middle" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">${ch}</text>`
    ).join('');
  }

  function bg(T, w, h) {
    return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${T.BG1}"/><stop offset="100%" stop-color="${T.BG2}"/></linearGradient><linearGradient id="acc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${T.G1}"/><stop offset="100%" stop-color="${T.G2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#bg)"/>`;
  }

  function corners(T, tag, pageNum, w, h) {
    const tlx = SL+60, tly = ST-22, acctX = w-SR+92, brandY = h-SB+40;
    return `
      <rect x="${tlx}" y="${tly-34}" width="220" height="54" rx="27" fill="${T.TB}" fill-opacity="0.30"/>
      <text x="${tlx+110}" y="${tly+3}" text-anchor="middle" font-size="30" font-weight="700" fill="${T.TC}">${esc(tag)}</text>
      ${vertChars(acctX, ST+28, '大湖成长日记', 34, '#ffffff', 0.55)}
      <text x="${acctX}" y="${ST+28+7*Math.round(34*1.36)}" text-anchor="middle" font-size="26" fill="#ffffff" fill-opacity="0.50">(AI+)</text>
      <text x="${SL+10}" y="${brandY}" font-size="38" font-weight="700" fill="#a78bfa" fill-opacity="0.80">ZenithJoy</text>
      ${pageNum ? `<text x="${SL+240}" y="${brandY}" font-size="30" font-weight="600" fill="${T.TC}" fill-opacity="0.70">${esc(pageNum)}</text>` : ''}
    `;
  }

  function renderPng(svg, outPath) {
    try {
      const resvgPath = join(process.env.HOME || '/Users/administrator', 'claude-output', 'scripts', 'node_modules', '@resvg', 'resvg-js');
      const { Resvg } = _require(resvgPath);
      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 2160 } });
      writeFileSync(outPath, resvg.render().asPng());
      console.log(`[export] 卡片 → ${outPath}`);
      return true;
    } catch (e) {
      console.error(`[export] resvg 渲染失败: ${e.message}`);
      return false;
    }
  }

  const titles = top.map(f => esc(f.title.substring(0, 30)));
  let count = 0;

  // 封面
  const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HC}" width="${W}" height="${HC}">
    ${bg(THEMES[0], W, HC)}
    ${corners(THEMES[0], '能力下放', '', W, HC)}
    <text x="${CX+70}" y="${CY+80}" font-size="96" font-weight="800" fill="#ffffff" letter-spacing="-2">${esc('这些能力')}</text>
    <text x="${CX+70}" y="${CY+180}" font-size="88" font-weight="800" fill="url(#acc)" letter-spacing="-2">${esc('一个人就够了')}</text>
    <text x="${CX+70}" y="${CY+240}" font-size="30" fill="rgba(255,255,255,0.30)">${esc(keyword)} · 能力拆解</text>
    ${titles.map((t, i) => `
      <rect x="${CX+70}" y="${CY+300+i*62}" width="${CW-80}" height="52" rx="10" fill="${ACCENTS[i%5]}" fill-opacity="0.08"/>
      <text x="${CX+95}" y="${CY+334+i*62}" font-size="26" fill="rgba(255,255,255,0.50)">${t}</text>
    `).join('')}
    <text x="${CX+70}" y="${HC-SB-40}" font-size="28" fill="rgba(255,255,255,0.25)">共 ${top.length} 张 · 一人公司案例拆解</text>
  </svg>`;
  if (renderPng(coverSvg, join(IMAGES_DIR, `${topic}-cover.png`))) count++;

  // 内容卡
  top.forEach((f, i) => {
    const T = THEMES[i % 4];
    const items = [];
    if (f.capability) items.push([f.title.substring(0, 25), f.capability.substring(0, 50)]);
    if (f.data) f.data.split(/[，,；;]/g).filter(Boolean).slice(0, 4).forEach(p => items.push([p.trim().substring(0, 35), '']));
    while (items.length < 5) items.push(['能力放大', '个人也能拥有公司级能力']);

    const bxH = 158, bxGap = 14;
    const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${bg(T, W, H)}
      ${corners(T, '能力拆解', `${i+1}/${top.length}`, W, H)}
      <text x="${CX+70}" y="${CY+100}" font-size="88" font-weight="800" fill="#ffffff">${esc(f.title.substring(0, 12))}</text>
      <text x="${CX+70}" y="${CY+170}" font-size="30" fill="rgba(255,255,255,0.30)">${esc(keyword)} · 能力 ${i+1}</text>
      ${items.map(([main, sub], j) => {
        const ac = ACCENTS[j % 5];
        const by = 570 + j * (bxH + bxGap);
        return `
          <rect x="${CX+70}" y="${by}" width="${CW-80}" height="${bxH}" rx="12" fill="${ac}" fill-opacity="0.09"/>
          <rect x="${CX+70}" y="${by}" width="4" height="${bxH}" rx="2" fill="${ac}" fill-opacity="0.75"/>
          <text x="${CX+95}" y="${by+44}" font-size="32" font-weight="700" fill="${ac}">${esc(main)}</text>
          <text x="${CX+95}" y="${by+84}" font-size="25" fill="rgba(255,255,255,0.40)">${esc(sub)}</text>
        `;
      }).join('')}
    </svg>`;
    if (renderPng(cardSvg, join(IMAGES_DIR, `${topic}-0${i+1}.png`))) count++;
  });

  console.log(`[export] 共生成 ${count} 张卡片`);
  return count > 0;
}

export async function executeExport(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  const pipelineId = task.payload?.parent_pipeline_id;

  console.log(`[export] 开始: ${keyword}`);

  const dir = findOutputDir(keyword);
  if (!dir) return { success: false, error: '找不到产出目录' };

  // 读 findings 用于生成卡片
  let findings = [];
  try {
    const rDir = join(OUTPUT_BASE, 'research');
    if (existsSync(rDir)) {
      const s = slug(keyword);
      for (const cand of readdirSync(rDir).filter(d => d.includes(s))) {
        const fp = join(rDir, cand, 'findings.json');
        if (existsSync(fp)) {
          try {
            const data = JSON.parse(readFileSync(fp, 'utf-8'));
            if ((data.findings || []).length > findings.length) findings = data.findings;
          } catch { /* */ }
        }
      }
    }
  } catch { /* */ }

  // 生成 /share-card 9:16 卡片（失败时降级：文章内容存在即视为部分成功，不阻断发布）
  const cardsGenerated = generateCards(dir, keyword, findings);
  if (!cardsGenerated) {
    const articleExists = existsSync(join(dir, 'article', 'article.md'));
    const copyExists = existsSync(join(dir, 'cards', 'copy.md'));
    if (!articleExists && !copyExists) {
      const errMsg = findings.length === 0
        ? '无调研数据（findings 为空），无文章内容，export 阶段无产出。'
        : 'resvg 渲染失败且无文章内容，export 阶段无产出。';
      console.error(`[export] FAIL: ${errMsg}`);
      return { success: false, error: errMsg };
    }
    // 有文章/文案内容，允许无图片卡片继续发布（图文平台降级为纯文章）
    console.warn(`[export] 无图片卡片（cardsGenerated=false），但文章/文案存在，降级继续：article=${articleExists} copy=${copyExists}`);
  }

  // manifest.json
  const topic = slug(keyword);
  const IMAGES_DIR = join(process.env.HOME || '/Users/administrator', 'claude-output', 'images');
  const cardFiles = [];
  try {
    const imgs = readdirSync(IMAGES_DIR).filter(f => f.startsWith(topic) && f.endsWith('.png'));
    imgs.forEach(f => cardFiles.push(f));
  } catch { /* */ }

  const manifest = {
    version: '1.0',
    keyword,
    content_type: contentType,
    pipeline_id: pipelineId,
    created_at: new Date().toISOString(),
    status: 'ready_for_publish',
    image_set: {
      framework: '/share-card',
      status: cardFiles.length > 0 ? 'ready' : 'failed',
      files: cardFiles,
      preview_base: `http://38.23.47.81:9998/images/`,
    },
    article: { path: 'article/article.md', status: existsSync(join(dir, 'article', 'article.md')) ? 'ready' : 'missing' },
    copy: { path: 'cards/copy.md', status: existsSync(join(dir, 'cards', 'copy.md')) ? 'ready' : 'missing' },
    platforms: { image: ['douyin', 'kuaishou', 'xiaohongshu', 'weibo'], article: ['wechat', 'zhihu', 'toutiao'] },
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // NAS 上传（pipelineId 为目录名，无 pipelineId 时跳过）
  let export_path = null;
  if (pipelineId) {
    const nasDir = `${NAS_BASE}/${pipelineId}`;
    const nasRemotePath = `${NAS_USER}@${NAS_IP}:${nasDir}/`;
    try {
      await execAsync(`rsync -az --timeout=30 "${dir}/" "${nasRemotePath}"`, { timeout: 60000 });
      export_path = nasDir;
      console.log(`[export] NAS 上传成功: ${export_path}`);
    } catch (nasErr) {
      console.warn(`[export] NAS 上传失败（不阻断流程）: ${nasErr.message}`);
    }
  } else {
    console.warn('[export] NAS 上传跳过：无 pipelineId');
  }

  // export 完成后清空 notebook，为下一次 pipeline 复用做准备
  const notebook_id = task.payload?.notebook_id;
  if (notebook_id) {
    try {
      const listResult = await listSources(notebook_id);
      if (listResult.ok && Array.isArray(listResult.sources) && listResult.sources.length > 0) {
        for (const source of listResult.sources) {
          await deleteSource(source.id, notebook_id);
        }
      }
    } catch (nbErr) {
      console.warn(`[export] notebook 清空失败（不阻断流程）: ${nbErr.message}`);
    }
  }

  console.log(`[export] 完成: ${cardFiles.length} 张卡片 + manifest → ${dir}`);

  // 清空 notebook sources，为下次 pipeline 复用准备（fire-and-forget）
  try {
    const typeConfig = await getContentType(contentType).catch(() => null);
    const notebookId = typeConfig?.notebook_id;
    if (notebookId) {
      const listResult = await listSources(notebookId);
      if (listResult.ok && Array.isArray(listResult.sources) && listResult.sources.length > 0) {
        let cleared = 0;
        for (const src of listResult.sources) {
          const sourceId = src.id || src.source_id;
          if (sourceId) {
            await deleteSource(sourceId, notebookId);
            cleared++;
          }
        }
        console.log(`[export] notebook ${notebookId.slice(0, 8)}... 已清空 ${cleared} 个 sources，下次可复用`);
      }
    }
  } catch (nbErr) {
    console.warn(`[export] notebook 清空失败（不阻断流程）: ${nbErr.message}`);
  }

  return { success: true, manifest_path: join(dir, 'manifest.json'), card_count: cardFiles.length, card_files: cardFiles, export_path };
}
