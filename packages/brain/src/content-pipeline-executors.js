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
    return { success: false, error: 'notebook_id 未配置，请在内容类型配置中设置 notebook_id' };
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
    top = findings.slice(0, 7);
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
  const prompt = _buildCopywritingPrompt(keyword, top, typeConfig, previousFeedback);
  const { text } = await callLLM('thalamus', prompt, { maxTokens: 4096, timeout: 120000 });
  const socialMatch = text.match(/=== 社交媒体文案 ===([\s\S]*?)(?:=== 公众长文 ===|=== 公众号长文 ===|$)/);
  const articleMatch = text.match(/=== 公众[号]?长文 ===([\s\S]*?)$/);
  const socialCopy = socialMatch?.[1]?.trim();
  const articleCopy = articleMatch?.[1]?.trim();

  if (!socialCopy || socialCopy.length < MIN_SOCIAL_COPY_LEN || !articleCopy || articleCopy.length < MIN_ARTICLE_LEN) {
    return { success: false, error: `LLM 输出不符格式要求（社交 ${socialCopy?.length ?? 0}字/${MIN_SOCIAL_COPY_LEN}，长文 ${articleCopy?.length ?? 0}字/${MIN_ARTICLE_LEN}）` };
  }

  writeFileSync(join(dir, 'cards', 'copy.md'), `# ${keyword}：社交媒体文案\n\n${socialCopy}\n`, 'utf-8');
  writeFileSync(join(dir, 'article', 'article.md'), `# ${keyword}：深度分析\n\n${articleCopy}\n`, 'utf-8');
  return { success: true, output_dir: dir, files: ['cards/copy.md', 'article/article.md'], llm_generated: true };
}

export async function executeCopywriting(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  const previousFeedback = task.payload?.review_feedback || task.payload?.previous_feedback;

  console.log(`[copywriting] 开始: ${keyword}`);

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用 */ }

  if (!typeConfig?.template?.generate_prompt) {
    return { success: false, error: `内容类型 ${contentType} 缺少 generate_prompt 配置` };
  }

  const findings = _loadFindings(keyword);
  const top = _filterTopFindings(findings);
  console.log(`[copywriting] 找到 ${findings.length} 条 findings，筛选 ${top.length} 条`);

  if (top.length === 0) {
    return { success: false, error: 'research findings 为空，无法生成文案，请先完成 research 阶段' };
  }

  const dir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
  ensureDir(join(dir, 'cards'));
  ensureDir(join(dir, 'article'));

  return await _executeLLMPath(keyword, top, typeConfig, previousFeedback, dir);
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

  // ─── Claude 调用：使用配置 review_prompt 审查文案 ──────────────
  const reviewRules = typeConfig?.review_rules;
  if (!typeConfig?.template?.review_prompt || !reviewRules || !Array.isArray(reviewRules)) {
    return { success: false, error: `内容类型 ${contentType} 缺少 review_prompt 或 review_rules 配置` };
  }

  const rulesDesc = reviewRules
    .map(r => `- ${r.id}: ${r.description} (severity: ${r.severity})`)
    .join('\n');

  const prompt = `${typeConfig.template.review_prompt}\n\n## 待审查内容\n${allText.substring(0, 3000)}\n\n## 审查规则\n${rulesDesc}\n\n请对每条规则逐一评审，严格按 JSON 格式返回：\n{\n  "rule_scores": [\n    { "id": "rule_id", "score": 0, "pass": true, "comment": "评审意见" }\n  ],\n  "overall_pass": true,\n  "quality_score": 7,\n  "summary": "总体评审意见"\n}`;

  let text;
  try {
    ({ text } = await callLLM('thalamus', prompt, { maxTokens: 1024, timeout: 60000 }));
  } catch (err) {
    return { success: false, error: `Claude 文案审核调用失败: ${err.message}` };
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { success: false, error: 'Claude 文案审核返回格式无效（无 JSON）' };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const ruleScores = parsed.rule_scores || [];
  const failedRules = ruleScores.filter(r => !r.pass);
  if (failedRules.length > 0) {
    issues.push(...failedRules.map(r => `[${r.id}] ${r.comment}`));
  }
  const qualityScore = typeof parsed.quality_score === 'number' ? parsed.quality_score : (parsed.overall_pass !== false ? 7 : 4);
  const passed = qualityScore >= 6;
  console.log(`[copy-review] ${passed ? 'PASS' : 'FAIL'}: quality=${qualityScore}`);
  return {
    success: true,
    review_passed: passed,
    rule_scores: ruleScores,
    llm_reviewed: true,
    quality_score: qualityScore,
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

      const { text } = await callLLM('thalamus', prompt, { maxTokens: 2048, timeout: 60000 });

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

  if (issues.length > 0) {
    console.log(`[image-review] FAIL（文件检查）: ${issues.join('; ')}`);
    return { success: true, review_passed: false, card_count: cardCount, issues };
  }

  // ─── Claude 调用：审核内容质量 ────────────────────────────────
  const imageReviewPrompt = typeConfig?.template?.image_review_prompt || typeConfig?.template?.review_prompt;
  if (!imageReviewPrompt) {
    return { success: false, error: `内容类型 ${contentType} 缺少 image_review_prompt 配置` };
  }

  const cardContentPath = join(dir, 'cards', 'llm-card-content.json');
  let contentForReview = '';
  if (existsSync(cardContentPath)) {
    contentForReview = readFileSync(cardContentPath, 'utf-8');
  } else if (existsSync(cp)) {
    contentForReview = readFileSync(cp, 'utf-8').substring(0, 1000);
  }

  if (!contentForReview) {
    return { success: false, error: '无可审核内容（llm-card-content.json 和 copy.md 均不存在）' };
  }

  const prompt = `${imageReviewPrompt.replace(/\{keyword\}/g, keyword)}\n\n## 待审核内容\n${contentForReview.substring(0, 2000)}\n\n请评审内容质量，严格按 JSON 格式返回：\n{\n  "review_passed": true,\n  "issues": [],\n  "suggestions": ["建议1"],\n  "quality_score": 8\n}`;

  let reviewText;
  try {
    ({ text: reviewText } = await callLLM('thalamus', prompt, { maxTokens: 512, timeout: 45000 }));
  } catch (err) {
    return { success: false, error: `Claude 图片审核调用失败: ${err.message}` };
  }

  const jsonMatch = reviewText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { success: false, error: 'Claude 图片审核返回格式无效（无 JSON）' };
  }

  const llmReview = JSON.parse(jsonMatch[0]);
  if (llmReview.issues?.length > 0) issues.push(...llmReview.issues);
  const qualityScore = typeof llmReview.quality_score === 'number' ? llmReview.quality_score : (llmReview.review_passed !== false ? 7 : 4);
  const passed = qualityScore >= 6;
  console.log(`[image-review] ${passed ? 'PASS' : 'FAIL'}: quality=${qualityScore}`);
  return { success: true, review_passed: passed, card_count: cardCount, issues, llm_review: llmReview, quality_score: qualityScore };
}

// ─── 4. Export ──────────────────────────────────────────────

/**
 * generateCards — 已废弃，改用 ~/claude-output/scripts/gen-v6-person.mjs
 * 原内联 SVG/resvg 渲染器，只能输出 2-6 张低质量卡片，无结构化数据。
 * 保留此函数仅供历史参考，不再调用。
 * @deprecated 使用 gen-v6-person.mjs 替代
 */
// function generateCards(dir, keyword, findings) {// ─── 4. Export ──────────────────────────────────────────────

// /**
//  * 直接在 Node.js 里生成 SVG → resvg 渲染 PNG（不生成外部 .mjs 脚本）
//  */
// function generateCards(dir, keyword, findings) {
//   let top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 6);
//   if (top.length === 0 && findings.length > 0) {
//     console.warn(`[export] 无高质量 findings（brand_relevance>=3），降级使用全部 ${findings.length} 条`);
//     top = findings.slice(0, 6);
//   }
//   if (top.length === 0) { console.log('[export] 无 findings，跳过卡片生成'); return false; }

//   const topic = slug(keyword);
//   const IMAGES_DIR = join(process.env.HOME || '/Users/administrator', 'claude-output', 'images');
//   ensureDir(IMAGES_DIR);

//   const W = 1080, H = 1920, HC = 1464;
//   const SL = 80, SR = 260, ST = 220, SB = 260;
//   const CX = 80, CY = 300, CW = 740;
//   const THEMES = [
//     { TC:'#c084fc', TB:'rgba(168,85,247,0.22)', BG1:'#0d0520', BG2:'#170a35', G1:'#a855f7', G2:'#d946ef' },
//     { TC:'#f472b6', TB:'rgba(244,114,182,0.22)', BG1:'#15050e', BG2:'#200618', G1:'#ec4899', G2:'#fb923c' },
//     { TC:'#818cf8', TB:'rgba(129,140,248,0.22)', BG1:'#08091a', BG2:'#0e1030', G1:'#6366f1', G2:'#8b5cf6' },
//     { TC:'#2dd4bf', TB:'rgba(45,212,191,0.22)', BG1:'#021512', BG2:'#061e1a', G1:'#14b8a6', G2:'#06b6d4' },
//   ];
//   const ACCENTS = ['#f87171','#34d399','#60a5fa','#fbbf24','#a78bfa'];

//   const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

//   function vertChars(x, yStart, text, fontSize, fill, opacity) {
//     const lh = Math.round(fontSize * 1.36);
//     return [...text].map((ch, i) =>
//       `<text x="${x}" y="${yStart + i * lh}" text-anchor="middle" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">${ch}</text>`
//     ).join('');
//   }

//   function bg(T, w, h) {
//     return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${T.BG1}"/><stop offset="100%" stop-color="${T.BG2}"/></linearGradient><linearGradient id="acc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${T.G1}"/><stop offset="100%" stop-color="${T.G2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#bg)"/>`;
//   }

//   function corners(T, tag, pageNum, w, h) {
//     const tlx = SL+60, tly = ST-22, acctX = w-SR+92, brandY = h-SB+40;
//     return `
//       <rect x="${tlx}" y="${tly-34}" width="220" height="54" rx="27" fill="${T.TB}" fill-opacity="0.30"/>
//       <text x="${tlx+110}" y="${tly+3}" text-anchor="middle" font-size="30" font-weight="700" fill="${T.TC}">${esc(tag)}</text>
//       ${vertChars(acctX, ST+28, '大湖成长日记', 34, '#ffffff', 0.55)}
//       <text x="${acctX}" y="${ST+28+7*Math.round(34*1.36)}" text-anchor="middle" font-size="26" fill="#ffffff" fill-opacity="0.50">(AI+)</text>
//       <text x="${SL+10}" y="${brandY}" font-size="38" font-weight="700" fill="#a78bfa" fill-opacity="0.80">ZenithJoy</text>
//       ${pageNum ? `<text x="${SL+240}" y="${brandY}" font-size="30" font-weight="600" fill="${T.TC}" fill-opacity="0.70">${esc(pageNum)}</text>` : ''}
//     `;
//   }

//   function renderPng(svg, outPath) {
//     try {
//       const resvgPath = join(process.env.HOME || '/Users/administrator', 'claude-output', 'scripts', 'node_modules', '@resvg', 'resvg-js');
//       const { Resvg } = _require(resvgPath);
//       const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 2160 } });
//       writeFileSync(outPath, resvg.render().asPng());
//       console.log(`[export] 卡片 → ${outPath}`);
//       return true;
//     } catch (e) {
//       console.error(`[export] resvg 渲染失败: ${e.message}`);
//       return false;
//     }
//   }

//   const titles = top.map(f => esc(f.title.substring(0, 30)));
//   let count = 0;

//   // 封面
//   const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HC}" width="${W}" height="${HC}">
//     ${bg(THEMES[0], W, HC)}
//     ${corners(THEMES[0], '能力下放', '', W, HC)}
//     <text x="${CX+70}" y="${CY+80}" font-size="96" font-weight="800" fill="#ffffff" letter-spacing="-2">${esc('这些能力')}</text>
//     <text x="${CX+70}" y="${CY+180}" font-size="88" font-weight="800" fill="url(#acc)" letter-spacing="-2">${esc('一个人就够了')}</text>
//     <text x="${CX+70}" y="${CY+240}" font-size="30" fill="rgba(255,255,255,0.30)">${esc(keyword)} · 能力拆解</text>
//     ${titles.map((t, i) => `
//       <rect x="${CX+70}" y="${CY+300+i*62}" width="${CW-80}" height="52" rx="10" fill="${ACCENTS[i%5]}" fill-opacity="0.08"/>
//       <text x="${CX+95}" y="${CY+334+i*62}" font-size="26" fill="rgba(255,255,255,0.50)">${t}</text>
//     `).join('')}
//     <text x="${CX+70}" y="${HC-SB-40}" font-size="28" fill="rgba(255,255,255,0.25)">共 ${top.length} 张 · 一人公司案例拆解</text>
//   </svg>`;
//   if (renderPng(coverSvg, join(IMAGES_DIR, `${topic}-cover.png`))) count++;

//   // 内容卡
//   top.forEach((f, i) => {
//     const T = THEMES[i % 4];
//     const items = [];
//     if (f.capability) items.push([f.title.substring(0, 25), f.capability.substring(0, 50)]);
//     if (f.data) f.data.split(/[，,；;]/g).filter(Boolean).slice(0, 4).forEach(p => items.push([p.trim().substring(0, 35), '']));
//     while (items.length < 5) items.push(['能力放大', '个人也能拥有公司级能力']);

//     const bxH = 158, bxGap = 14;
//     const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
//       ${bg(T, W, H)}
//       ${corners(T, '能力拆解', `${i+1}/${top.length}`, W, H)}
//       <text x="${CX+70}" y="${CY+100}" font-size="88" font-weight="800" fill="#ffffff">${esc(f.title.substring(0, 12))}</text>
//       <text x="${CX+70}" y="${CY+170}" font-size="30" fill="rgba(255,255,255,0.30)">${esc(keyword)} · 能力 ${i+1}</text>
//       ${items.map(([main, sub], j) => {
//         const ac = ACCENTS[j % 5];
//         const by = 570 + j * (bxH + bxGap);
//         return `
//           <rect x="${CX+70}" y="${by}" width="${CW-80}" height="${bxH}" rx="12" fill="${ac}" fill-opacity="0.09"/>
//           <rect x="${CX+70}" y="${by}" width="4" height="${bxH}" rx="2" fill="${ac}" fill-opacity="0.75"/>
//           <text x="${CX+95}" y="${by+44}" font-size="32" font-weight="700" fill="${ac}">${esc(main)}</text>
//           <text x="${CX+95}" y="${by+84}" font-size="25" fill="rgba(255,255,255,0.40)">${esc(sub)}</text>
//         `;
//       }).join('')}
//     </svg>`;
//     if (renderPng(cardSvg, join(IMAGES_DIR, `${topic}-0${i+1}.png`))) count++;
//   });

//   console.log(`[export] 共生成 ${count} 张卡片`);
//   return count > 0;
// }

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

  // ─── V6 图片生成 ────────────────────────────────────────────────
  // generateCards() 已废弃（只能生成 2-6 张低质量卡片），改用 gen-v6-person.mjs（9张高质量图）
  const personDataPath = join(dir, 'person-data.json');
  const keywordSlug = slug(keyword);
  const GEN_V6_SCRIPT = join(process.env.HOME || '/Users/administrator', 'claude-output', 'scripts', 'gen-v6-person.mjs');

  if (findings.length === 0) {
    return { success: false, error: 'findings 为空，无法提取 person-data.json，请先完成 research 阶段' };
  }

  // 从 findings 提取结构化数据
  try {
    const findingsSummary = findings.slice(0, 10).map((f, i) => `${i + 1}. ${f.title}\n${(f.content || '').substring(0, 800)}`).join('\n\n');
    const extractPrompt = `你是数据提取专家。根据以下关于"${keyword}"的调研素材，提取结构化的人物/公司数据，用于生成高质量信息图。

## 调研素材
${findingsSummary}

请严格按以下 JSON 格式返回（所有字段必填，无数据时用合理估计值）：
{
  "name": "${keyword}",
  "handle": "@handle_or_company",
  "headline": "一句话描述此人/公司的核心成就（≤30字）",
  "key_stats": [
    {"val": "数值", "label": "指标名", "sub": "补充说明"},
    {"val": "数值", "label": "指标名", "sub": "补充说明"},
    {"val": "数值", "label": "指标名", "sub": "补充说明"}
  ],
  "timeline": [
    {"year": "年份", "title": "里程碑标题", "desc": "简短描述（≤40字）"},
    {"year": "年份", "title": "里程碑标题", "desc": "简短描述（≤40字）"},
    {"year": "年份", "title": "里程碑标题", "desc": "简短描述（≤40字）"},
    {"year": "年份", "title": "里程碑标题", "desc": "简短描述（≤40字）"},
    {"year": "年份", "title": "里程碑标题", "desc": "简短描述（≤40字）"}
  ],
  "flywheel": ["飞轮节点1", "飞轮节点2", "飞轮节点3", "飞轮节点4"],
  "flywheel_insight": "关于此人/公司核心方法论的洞察（≤60字）",
  "day_schedule": [
    {"time": "时间段", "title": "活动标题", "desc": "活动描述（≤40字）"},
    {"time": "时间段", "title": "活动标题", "desc": "活动描述（≤40字）"},
    {"time": "时间段", "title": "活动标题", "desc": "活动描述（≤40字）"},
    {"time": "时间段", "title": "活动标题", "desc": "活动描述（≤40字）"}
  ],
  "qa": [
    {"q": "读者常问的问题", "a": "简洁有力的回答（≤40字）"},
    {"q": "读者常问的问题", "a": "简洁有力的回答（≤40字）"},
    {"q": "读者常问的问题", "a": "简洁有力的回答（≤40字）"},
    {"q": "读者常问的问题", "a": "简洁有力的回答（≤40字）"}
  ],
  "quote": "此人/公司最有代表性的一句话（≤50字）",
  "avatar_b64_file": null
}

只返回 JSON，不要解释。`;

    const { text: extractText } = await callLLM('thalamus', extractPrompt, { maxTokens: 2048, timeout: 90000 });
    const jsonMatch = extractText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'Claude 提取结构化数据失败：返回无有效 JSON' };
    }
    writeFileSync(personDataPath, jsonMatch[0], 'utf-8');
    console.log(`[export] person-data.json 已生成: ${personDataPath}`);
  } catch (err) {
    return { success: false, error: `Claude 提取结构化数据失败: ${err.message}` };
  }

  // 执行 V6 生成器
  console.log(`[export] 执行 V6 生成器: ${GEN_V6_SCRIPT}`);
  const genResult = await run(
    `node "${GEN_V6_SCRIPT}" --data "${personDataPath}" --slug "${keywordSlug}" 2>&1`,
    180000
  );
  if (genResult === null) {
    return { success: false, error: '图片生成失败: gen-v6-person.mjs 执行出错，请检查脚本和依赖' };
  }
  console.log(`[export] V6 生成器输出: ${genResult.substring(0, 300)}`);
  // ────────────────────────────────────────────────────────────

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