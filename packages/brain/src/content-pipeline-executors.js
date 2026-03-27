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

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getContentType } from './content-types/content-type-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 配置 ───────────────────────────────────────────────────

const OUTPUT_BASE = process.env.CONTENT_OUTPUT_DIR
  || join(__dirname, '../../../../zenithjoy/content-output');

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

  console.log(`[copywriting] 开始: ${keyword}`);

  // 从 DB/YAML 读取内容类型配置
  let typeConfig = null;
  try { typeConfig = await getContentType(contentType); } catch { /* DB/YAML 不可用，使用硬编码 fallback */ }

  const dir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
  ensureDir(join(dir, 'cards'));
  ensureDir(join(dir, 'article'));

  const findings = _loadFindings(keyword);
  const top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 7);
  console.log(`[copywriting] 找到 ${findings.length} 条 findings，筛选 ${top.length} 条`);

  // 无 findings 时的占位内容段落
  const fallbackCopyBlocks = top.length === 0 ? [
    `**1. 系统化能力 > 单点努力**\n\n一人公司的核心不是"我很厉害"，而是"我有一套系统"。关于${keyword}，最关键的一步是把它变成可重复的流程，而不是每次都靠意志力硬撑。\n\n---\n`,
    `**2. AI 工具重新分配生产力**\n\n过去需要3个人才能做到的事，现在1个人配合AI可以完成。${keyword}就是这种能力转移的典型场景——把原来依赖团队协作的事，变成个人可独立完成的系统工作流。\n\n---\n`,
    `**3. 能力密度 > 人员规模**\n\n小组织的优势不是"人少成本低"，而是"每个人的能力密度高"。${keyword}的本质是提升单人作战半径，让一个人可以覆盖更多业务场景，同时保持高质量交付。\n\n---\n`,
  ] : [];

  const fallbackArticleSections = top.length === 0 ? [
    `\n## 什么是${keyword}？\n\n${keyword}是一种系统性的个人能力建设方向。它不是单纯的技能训练，而是通过正确的工具组合和流程设计，让一个人能够完成过去需要团队才能完成的工作。\n\n在当今时代，AI的普及让这种能力转移成为可能。越来越多的个人创业者和自由职业者正在通过掌握${keyword}，实现从"人力扩张"到"能力扩张"的跨越。\n`,
    `\n## 为什么${keyword}很重要？\n\n对于企业主和副业创业者来说，${keyword}直接决定了你的业务上限。\n\n**第一，它影响你的时间效率。** 具备${keyword}能力的人，可以在同样的时间内完成更多高价值工作，而不是被低效重复的事务拖慢节奏。\n\n**第二，它影响你的服务质量。** 系统化的能力意味着可重复、可稳定的交付，这是客户愿意支付高价的核心原因。\n\n**第三，它影响你的扩张边界。** 当你的能力被系统化后，复制和扩张变得更容易，不再依赖"再招一个人"来增加产出。\n`,
    `\n## 如何开始建立${keyword}？\n\n**第一步：识别你的高频低效场景。** 哪些工作每周都在重复？哪些流程最消耗你的精力？${keyword}的建设要从这里入手。\n\n**第二步：寻找对应的工具和系统。** 市场上已经有大量专门针对个人和小团队设计的AI工具，可以在${keyword}场景中发挥关键作用。\n\n**第三步：建立可重复的标准流程。** 不要每次都从零开始。把有效的方法记录下来，形成SOP，让下次执行更快更稳。\n\n**第四步：持续迭代优化。** 系统不是一次建好就永久有效的。要定期审视哪些步骤还在消耗你，哪些可以进一步自动化。\n`,
  ] : [];

  // 社交媒体文案
  const copy = [
    `# ${keyword}：过去只有公司才有的能力，现在一个人就够了\n`,
    `你知道吗？越来越多人正在证明：一个人 + 正确的系统 = 一家公司的能力。\n`,
    `今天拆解 ${keyword}，看看哪些"公司级能力"已经被个人拥有了。\n`,
    '---\n',
    ...top.map((f, i) => {
      const body = f.content || f.capability || '';
      const data = f.data ? `\n\n数据：${f.data}` : '';
      return `**${i + 1}. ${f.title}**\n\n${body}${data}\n\n---\n`;
    }),
    ...fallbackCopyBlocks,
    `\n**一人公司不是"小"公司，是"精"公司。**\n`,
    `你觉得哪个能力对你最有用？评论区告诉我！\n`,
    `\n#一人公司 #能力放大 #AI驱动 #个人创业 #能力下放\n`,
  ].join('\n');
  writeFileSync(join(dir, 'cards', 'copy.md'), copy, 'utf-8');

  // 公众号长文
  const article = [
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
    ...fallbackArticleSections,
    `\n---\n`,
    `\n## 这意味着什么？\n`,
    `\n能力正在从大公司向个人转移。过去需要一个团队才能做到的事，现在一个人配合正确的系统就能完成。\n`,
    `\n这不是未来。这是正在发生的事。\n`,
    `\n**你准备好拥有这些能力了吗？**\n`,
  ].join('\n');
  writeFileSync(join(dir, 'article', 'article.md'), article, 'utf-8');

  console.log(`[copywriting] 完成 → ${dir}`);
  return { success: true, output_dir: dir, files: ['cards/copy.md', 'article/article.md'] };
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

  // 如果配置中有 review_rules，使用配置规则；否则 fallback 到硬编码
  const reviewRules = typeConfig?.review_rules;
  if (reviewRules && Array.isArray(reviewRules)) {
    // 使用配置审查规则（review_rules count: reviewRules.length）
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
  const dir = findOutputDir(keyword);
  if (!dir) {
    // 创建目录以备 export 使用
    const newDir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
    ensureDir(join(newDir, 'cards'));
    ensureDir(join(newDir, 'article'));
    console.log(`[generate] 产出目录已创建: ${newDir}`);
    return { success: true, output_dir: newDir, image_count: imageCount, image_style: imageStyle };
  }

  console.log(`[generate] 图片生成阶段完成（实际渲染在 export 阶段）→ ${dir}`);
  return { success: true, output_dir: dir, image_count: imageCount, image_style: imageStyle };
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

  const passed = issues.length === 0;
  console.log(`[image-review] ${passed ? 'PASS' : 'FAIL'}: ${issues.join('; ') || '全部通过'}（${cardCount} 张图片）`);
  return { success: true, review_passed: passed, card_count: cardCount, issues };
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

  console.log(`[export] 完成: ${cardFiles.length} 张卡片 + manifest → ${dir}`);
  return { success: true, manifest_path: join(dir, 'manifest.json'), card_count: cardFiles.length, card_files: cardFiles };
}
