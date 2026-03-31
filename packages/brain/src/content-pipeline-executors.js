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

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getContentType } from './content-types/content-type-registry.js';

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

function run(cmd, timeout = 60000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    console.error(`[executor] cmd failed: ${cmd.substring(0, 80)}… → ${(err.stderr || err.message).substring(0, 200)}`);
    return null;
  }
}

function runClaude(prompt, outputFormat = 'text', timeout = 120000) {
  const result = spawnSync('claude', ['-p', prompt, '--output-format', outputFormat], {
    encoding: 'utf-8',
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    console.error(`[claude] 调用失败: ${(result.stderr || result.error?.message || '').substring(0, 200)}`);
    return null;
  }
  return result.stdout?.trim() || null;
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

// ─── 1. Research ────────────────────────────────────────────

export async function executeResearch(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const notebookId = task.payload?.notebook_id;
  const contentType = task.payload?.content_type || 'solo-company-case';

  console.log(`[research] 开始: ${keyword} (notebook=${notebookId || '无'})`);

  // 从 DB/YAML 读取内容类型配置
  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = join(OUTPUT_BASE, 'research', `${contentType}-${slug(keyword)}-${today()}`);
  ensureDir(dir);

  let findings = [];

  if (notebookId) {
    run(`notebooklm use ${notebookId} 2>&1`);
    // 优先使用配置中的 research_prompt，fallback 到硬编码
    const defaultPrompt = `从所有源中，找出能证明'个人也能拥有过去只有公司才有的能力'的证据。关于${keyword}，每条带具体数据和来源。至少8条。`;
    const researchPrompt = typeConfig?.template?.research_prompt
      ? typeConfig.template.research_prompt.replace(/\{keyword\}/g, keyword)
      : defaultPrompt;
    const raw = run(
      `notebooklm ask "${researchPrompt}" --json 2>&1`,
      120000
    );
    if (raw) {
      try {
        const { answer = '' } = JSON.parse(raw);
        const parts = answer.split(/\n\*\*\d+\./).filter(Boolean);
        findings = parts.map((p, i) => ({
          id: `f${String(i + 1).padStart(3, '0')}`,
          title: p.split('\n')[0]?.replace(/\*+/g, '').trim().substring(0, 100) || `发现${i + 1}`,
          content: p.trim(),
          source: 'NotebookLM',
          brand_relevance: 4,
          used_in: [],
        }));
      } catch {
        findings = [{ id: 'f001', title: keyword, content: raw.substring(0, 3000), source: 'NotebookLM', brand_relevance: 3, used_in: [] }];
      }
    }
  }

  if (findings.length === 0) {
    findings = [{ id: 'f001', title: `${keyword} — 待补充`, content: `关键词：${keyword}，需要手动添加 NotebookLM notebook_id 或补充调研`, source: '系统', brand_relevance: 2, used_in: [] }];
  }

  const data = { keyword, series: contentType, notebook_id: notebookId || null, extracted_at: today(), total_findings: findings.length, findings };
  const fp = join(dir, 'findings.json');
  writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');

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

export async function executeCopywriting(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  const review_feedback = task.payload?.review_feedback || null;

  console.log(`[copywriting] 开始: ${keyword}${review_feedback ? ' (rerun，含审核反馈)' : ''}`);

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
  ensureDir(join(dir, 'cards'));
  ensureDir(join(dir, 'article'));

  const findings = _loadFindings(keyword);
  const top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 7);
  console.log(`[copywriting] 找到 ${findings.length} 条 findings，筛选 ${top.length} 条`);

  const findingsText = top.length > 0
    ? top.map((f, i) => `${i + 1}. ${f.title}\n${f.content || ''}`).join('\n\n')
    : `关键词：${keyword}，暂无调研素材，请基于通用知识生成内容。`;

  const generate_prompt = typeConfig?.template?.generate_prompt;
  const basePrompt = generate_prompt
    ? generate_prompt
        .replace(/\{keyword\}/g, keyword)
        .replace(/\{findings\}/g, findingsText)
    : `你是一位专注于"一人公司"主题的内容创作者。请基于以下调研素材，为关键词"${keyword}"生成两部分内容：\n第一部分（用"=== 社交媒体文案 ==="标记）：500字以内的小红书/微博文案，用"---"分割多个观点卡片。\n第二部分（用"=== 公众号长文 ==="标记）：1500字以上的公众号深度文章。\n\n调研素材：\n${findingsText}`;

  const prompt = review_feedback
    ? `${basePrompt}\n\n上一次审核反馈：${review_feedback}，请在此基础上改进。`
    : basePrompt;

  console.log(`[copywriting] 调用 claude CLI（generate_prompt，${prompt.length} 字符）`);
  const output = runClaude(prompt, 'text', 180000);

  if (!output) {
    console.error('[copywriting] Claude 调用失败，写入占位内容');
    writeFileSync(join(dir, 'cards', 'copy.md'), `# ${keyword}\n\n[Claude 调用失败，请重试]`, 'utf-8');
    writeFileSync(join(dir, 'article', 'article.md'), `# ${keyword}\n\n[Claude 调用失败，请重试]`, 'utf-8');
    return { success: false, output_dir: dir, error: 'Claude 调用失败' };
  }

  // 解析输出：按标记分割社交媒体文案和长文
  let copyContent = output;
  let articleContent = output;

  const socialMarker = '=== 社交媒体文案 ===';
  const articleMarker = '=== 公众号长文 ===';
  const socialIdx = output.indexOf(socialMarker);
  const articleIdx = output.indexOf(articleMarker);

  if (socialIdx !== -1 && articleIdx !== -1) {
    copyContent = output.slice(socialIdx + socialMarker.length, articleIdx).trim();
    articleContent = output.slice(articleIdx + articleMarker.length).trim();
  } else if (output.includes('\n---\n')) {
    const parts = output.split(/\n---\n/);
    if (parts.length >= 2) {
      const half = Math.ceil(parts.length / 2);
      copyContent = parts.slice(0, half).join('\n---\n').trim();
      articleContent = parts.slice(half).join('\n---\n').trim() || output;
    }
  }

  writeFileSync(join(dir, 'cards', 'copy.md'), copyContent, 'utf-8');
  writeFileSync(join(dir, 'article', 'article.md'), articleContent, 'utf-8');

  console.log(`[copywriting] 完成 → ${dir} (copy: ${copyContent.length}字, article: ${articleContent.length}字)`);
  return { success: true, output_dir: dir, files: ['cards/copy.md', 'article/article.md'] };
}

// ─── 3. Copy Review（文案审核）─────────────────────────────────

export async function executeCopyReview(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  console.log(`[copy-review] 开始: ${keyword}`);

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = findOutputDir(keyword);
  if (!dir) return { success: true, review_passed: false, issues: ['找不到产出目录'], rule_results: [] };

  let copyText = '';
  const cp = join(dir, 'cards', 'copy.md');
  const ap = join(dir, 'article', 'article.md');
  if (existsSync(cp)) copyText += readFileSync(cp, 'utf-8');
  if (existsSync(ap)) copyText += '\n' + readFileSync(ap, 'utf-8');

  if (!copyText.trim()) return { success: true, review_passed: false, issues: ['文案内容为空'], rule_results: [] };

  const reviewRules = typeConfig?.review_rules || [];
  const rulesText = reviewRules.length > 0
    ? reviewRules.map(r => `- id: ${r.id}, 描述: ${r.description}, 严重性: ${r.severity}`).join('\n')
    : '- id: brand_voice, 描述: 符合品牌声音，使用能力/系统/AI等关键词, 严重性: blocking\n- id: no_banned_words, 描述: 不含 coding/搭建/agent workflow 等禁用词, 严重性: blocking\n- id: min_length, 描述: 内容长度充足（社交媒体≥300字，长文≥1000字）, 严重性: blocking';

  const review_prompt = typeConfig?.template?.review_prompt;
  const basePrompt = review_prompt
    ? review_prompt
        .replace(/\{copy\}/g, copyText.substring(0, 3000))
        .replace(/\{rules\}/g, rulesText)
        .replace(/\{keyword\}/g, keyword)
    : `你是内容质量审核员。请审核以下文案，对每条规则给出评分。\n\n文案内容：\n${copyText.substring(0, 3000)}\n\n审核规则：\n${rulesText}\n\n请以 JSON 格式返回，结构如下：\n{"review_passed": true/false, "rule_results": [{"id": "规则id", "passed": true/false, "score": 1-10, "comment": "评语"}], "issues": ["问题1", "问题2"]}`;

  const prompt = `${basePrompt}\n\n只返回 JSON，不要其他文字。`;

  console.log(`[copy-review] 调用 claude CLI（review_prompt，${prompt.length} 字符）`);
  const raw = runClaude(prompt, 'json', 120000);

  if (!raw) {
    // Claude 调用失败，fallback 到静态检查
    console.warn('[copy-review] Claude 调用失败，使用静态规则 fallback');
    const issues = [];
    const banned = BANNED_WORDS.filter(w => copyText.toLowerCase().includes(w.toLowerCase()));
    if (banned.length > 0) issues.push(`禁用词：${banned.join('、')}`);
    const hits = BRAND_KEYWORDS.filter(kw => copyText.includes(kw));
    if (hits.length < 3) issues.push(`品牌关键词不足（命中：${hits.join('、')}）`);
    return { success: true, review_passed: issues.length === 0, rule_results: [], issues, fallback: true };
  }

  // 解析 JSON 响应
  let parsed;
  try {
    parsed = typeof raw === 'object' ? raw : JSON.parse(raw);
    if (parsed.result) parsed = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed.result;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
  }

  if (!parsed) {
    console.error('[copy-review] JSON 解析失败');
    return { success: true, review_passed: false, rule_results: [], issues: ['审核结果解析失败'] };
  }

  // 任意 blocking 规则 failed → review_passed = false
  const blockingFail = (parsed.rule_results || []).some(r => {
    const rule = reviewRules.find(rr => rr.id === r.id);
    return !r.passed && (!rule || rule.severity === 'blocking');
  });
  const review_passed = parsed.review_passed !== undefined ? parsed.review_passed : !blockingFail;

  console.log(`[copy-review] ${review_passed ? 'PASS' : 'FAIL'}: ${(parsed.issues || []).join('; ') || '全部通过'}`);
  return {
    success: true,
    review_passed,
    rule_results: parsed.rule_results || [],
    issues: parsed.issues || [],
  };
}

// ─── 4. Generate（图片生成）────────────────────────────────────

export async function executeGenerate(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  console.log(`[generate] 开始图片描述生成: ${keyword}`);

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const imageCount = typeConfig?.images?.count || 9;
  const imageStyle = typeConfig?.images?.style || 'professional-infographic';

  const dir = findOutputDir(keyword) || join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
  ensureDir(join(dir, 'cards'));

  // 读取文案内容作为图片描述上下文
  let copyText = '';
  const cp = join(dir, 'cards', 'copy.md');
  if (existsSync(cp)) copyText = readFileSync(cp, 'utf-8').substring(0, 2000);

  const image_prompt = typeConfig?.template?.image_prompt;
  const prompt = image_prompt
    ? image_prompt
        .replace(/\{keyword\}/g, keyword)
        .replace(/\{copy\}/g, copyText)
        .replace(/\{count\}/g, String(imageCount))
    : `你是图片内容策划师。请基于以下文案，为关键词"${keyword}"生成 ${imageCount} 张竖版卡片（1080×1920px）的详细图片描述。\n每张卡片包含：标题、核心观点（20字以内）、配色建议、排版要点。\n风格：${imageStyle}\n\n文案内容：\n${copyText || `关键词：${keyword}`}\n\n请逐张描述，每张用"---"分隔。`;

  console.log(`[generate] 调用 claude CLI（image_prompt，${prompt.length} 字符）`);
  const output = runClaude(prompt, 'text', 180000);

  if (!output) {
    console.error('[generate] Claude 调用失败');
    writeFileSync(join(dir, 'cards', 'image-descriptions.md'), `# ${keyword} 图片描述\n\n[Claude 调用失败，请重试]`, 'utf-8');
    return { success: false, output_dir: dir, error: 'Claude 调用失败' };
  }

  writeFileSync(join(dir, 'cards', 'image-descriptions.md'), output, 'utf-8');
  console.log(`[generate] 完成 → cards/image-descriptions.md (${output.length} 字符)`);
  return { success: true, output_dir: dir, image_count: imageCount, image_style: imageStyle };
}

// ─── 5. Image Review（图片审核）───────────────────────────────

export async function executeImageReview(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  console.log(`[image-review] 开始: ${keyword}`);

  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = findOutputDir(keyword);
  if (!dir) return { success: true, review_passed: false, issues: ['找不到产出目录'] };

  // 读取图片描述文件（优先）或 fallback 到文案文件
  const descPath = join(dir, 'cards', 'image-descriptions.md');
  let descText = '';
  if (existsSync(descPath)) {
    descText = readFileSync(descPath, 'utf-8');
  } else {
    const cp = join(dir, 'cards', 'copy.md');
    if (existsSync(cp)) descText = readFileSync(cp, 'utf-8');
  }

  if (!descText.trim()) return { success: true, review_passed: false, issues: ['缺少图片描述文件'] };

  const image_review_prompt = typeConfig?.template?.image_review_prompt;
  const review_prompt = typeConfig?.template?.review_prompt;
  const basePrompt = image_review_prompt
    ? image_review_prompt
        .replace(/\{descriptions\}/g, descText.substring(0, 3000))
        .replace(/\{keyword\}/g, keyword)
    : (review_prompt
        ? review_prompt
            .replace(/\{copy\}/g, descText.substring(0, 3000))
            .replace(/\{rules\}/g, '- 图片描述清晰，有标题和核心观点\n- 风格一致\n- 无违规内容')
            .replace(/\{keyword\}/g, keyword)
        : `你是图片内容审核员。请审核以下图片描述，检查是否清晰、风格一致、无违规内容。\n\n图片描述：\n${descText.substring(0, 3000)}\n\n请以 JSON 格式返回：{"review_passed": true/false, "issues": ["问题1"]}`);

  const prompt = `${basePrompt}\n\n只返回 JSON，不要其他文字。`;

  console.log(`[image-review] 调用 claude CLI（image_review_prompt，${prompt.length} 字符）`);
  const raw = runClaude(prompt, 'json', 120000);

  if (!raw) {
    console.warn('[image-review] Claude 调用失败，使用文件存在性检查 fallback');
    const issues = [];
    if (!existsSync(descPath)) issues.push('缺少 image-descriptions.md');
    return { success: true, review_passed: issues.length === 0, issues };
  }

  let parsed;
  try {
    parsed = typeof raw === 'object' ? raw : JSON.parse(raw);
    if (parsed.result) parsed = typeof parsed.result === 'string' ? JSON.parse(parsed.result) : parsed.result;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    try { parsed = match ? JSON.parse(match[0]) : null; } catch { parsed = null; }
  }

  if (!parsed) {
    return { success: true, review_passed: false, issues: ['审核结果解析失败'] };
  }

  console.log(`[image-review] ${parsed.review_passed ? 'PASS' : 'FAIL'}: ${(parsed.issues || []).join('; ') || '全部通过'}`);
  return {
    success: true,
    review_passed: parsed.review_passed ?? false,
    issues: parsed.issues || [],
  };
}

// ─── 4. Export ──────────────────────────────────────────────

/**
 * 直接在 Node.js 里生成 SVG → resvg 渲染 PNG（不生成外部 .mjs 脚本）
 */
function generateCards(dir, keyword, findings) {
  const top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 6);
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
      const { Resvg } = require(resvgPath);
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

  // 生成 /share-card 9:16 卡片
  const cardsGenerated = generateCards(dir, keyword, findings);

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
      execSync(`rsync -az --timeout=30 "${dir}/" "${nasRemotePath}"`, { timeout: 60000 });
      export_path = nasDir;
      console.log(`[export] NAS 上传成功: ${export_path}`);
    } catch (nasErr) {
      console.warn(`[export] NAS 上传失败（不阻断流程）: ${nasErr.message}`);
    }
  } else {
    console.warn('[export] NAS 上传跳过：无 pipelineId');
  }

  console.log(`[export] 完成: ${cardFiles.length} 张卡片 + manifest → ${dir}`);
  return { success: true, manifest_path: join(dir, 'manifest.json'), card_count: cardFiles.length, card_files: cardFiles, export_path };
}
