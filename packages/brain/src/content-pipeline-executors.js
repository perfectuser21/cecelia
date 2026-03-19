/**
 * content-pipeline-executors.js
 *
 * 内容工厂 Pipeline 四阶段 executor：
 *   1. executeResearch    — 从 NotebookLM 拉取调研素材
 *   2. executeGenerate    — 基于素材生成图文文案 + 长文
 *   3. executeReview      — AI 自动审查品牌对齐
 *   4. executeExport      — 归档 + manifest.json + 在线预览
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

  const dir = join(OUTPUT_BASE, 'research', `${contentType}-${slug(keyword)}-${today()}`);
  ensureDir(dir);

  let findings = [];

  if (notebookId) {
    run(`notebooklm use ${notebookId} 2>&1`);
    const raw = run(
      `notebooklm ask "从所有源中，找出能证明'个人也能拥有过去只有公司才有的能力'的证据。关于${keyword}，每条带具体数据和来源。至少8条。" --json 2>&1`,
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

// ─── 2. Generate ────────────────────────────────────────────

export async function executeGenerate(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';

  console.log(`[generate] 开始: ${keyword}`);

  const dir = join(OUTPUT_BASE, `${today()}-${slug(keyword)}`);
  ensureDir(join(dir, 'cards'));
  ensureDir(join(dir, 'article'));

  // 找 findings — 遍历所有匹配目录，取 findings 数量最多的
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
      console.log(`[generate] 找到 ${bestCount} 条 findings（${candidates.length} 个候选目录）`);
    }
  } catch (e) { console.error(`[generate] findings 搜索失败: ${e.message}`); }

  const top = findings.filter(f => (f.brand_relevance || 0) >= 3).slice(0, 7);

  // NAS 标准目录
  ensureDir(join(dir, 'exports'));
  ensureDir(join(dir, 'images'));

  // ─── 图文（~100字，8平台共用：抖音/快手/小红书/微博/公众号/知乎/头条/视频号）───
  const imageTextTitle = `${keyword}：这些能力，过去只有公司才有`;
  const points = top.slice(0, 5).map(f => f.title.substring(0, 20));
  const imageTextCopy = `${points.join('、')}——${keyword}证明了，一个人+AI就能拥有这些能力。你准备好了吗？\n\n#一人公司 #能力放大 #AI驱动 #能力下放`;

  writeFileSync(join(dir, 'exports', 'title.txt'), imageTextTitle, 'utf-8');
  writeFileSync(join(dir, 'exports', 'image-text-copy.txt'), imageTextCopy, 'utf-8');

  // 卡片结构化数据（/share-card 渲染用）
  const cardData = {
    title: imageTextTitle,
    cards: top.map(f => ({
      title: f.title.substring(0, 25),
      items: [
        [f.title.substring(0, 25), (f.capability || '').substring(0, 50)],
        ...((f.data || '').split(/[，,；;]/g).filter(Boolean).slice(0, 3).map(d => [d.trim().substring(0, 35), ''])),
        ['能力放大', '个人也能拥有公司级能力'],
      ].slice(0, 5),
    })),
  };
  writeFileSync(join(dir, 'exports', 'card-data.json'), JSON.stringify(cardData, null, 2), 'utf-8');
  writeFileSync(join(dir, 'cards', 'copy.md'), `${imageTextTitle}\n\n${imageTextCopy}`, 'utf-8');

  // ─── 长文（~1000字，6平台：抖音/小红书/微博/公众号/知乎/头条）───
  const longTitle = `${keyword}：一个人如何拥有公司级能力`;
  const parts = [];
  parts.push(`${keyword}的经历证明了一件事：过去只有公司才有的能力，现在个人和小组织也能拥有。`);
  top.slice(0, 5).forEach((f, i) => {
    const body = f.content || f.capability || '';
    const data = f.data || '';
    parts.push(`${i + 1}. ${f.title}\n${body}${data ? '（' + data.substring(0, 80) + '）' : ''}`);
  });
  parts.push(`能力正在从大公司向个人转移。AI让一个人配合正确的系统就能完成过去需要团队才能做到的事。这不是未来，这是正在发生的现实。`);

  let longText = parts.join('\n\n');
  if (longText.length > 1200) longText = longText.substring(0, 1100);

  writeFileSync(join(dir, 'exports', 'long-form-title.txt'), longTitle, 'utf-8');
  writeFileSync(join(dir, 'exports', 'content.html'), `<p>${longText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`, 'utf-8');
  writeFileSync(join(dir, 'article', 'article.md'), `# ${longTitle}\n\n${longText}`, 'utf-8');

  console.log(`[generate] 完成 → ${dir}`);
  return { success: true, output_dir: dir, files: ['exports/title.txt', 'exports/image-text-copy.txt', 'exports/card-data.json', 'exports/long-form-title.txt', 'exports/content.html'] };
}

// ─── 3. Review ──────────────────────────────────────────────

export async function executeReview(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  console.log(`[review] 开始: ${keyword}`);

  const dir = findOutputDir(keyword);
  if (!dir) return { success: true, review_passed: false, issues: ['找不到产出目录'] };

  let allText = '';
  const cp = join(dir, 'cards', 'copy.md');
  const ap = join(dir, 'article', 'article.md');
  if (existsSync(cp)) allText += readFileSync(cp, 'utf-8');
  if (existsSync(ap)) allText += '\n' + readFileSync(ap, 'utf-8');

  if (!allText.trim()) return { success: true, review_passed: false, issues: ['内容为空'] };

  const issues = [];
  const warnings = [];

  // 读图文和长文分别检查
  const copyText = existsSync(cp) ? readFileSync(cp, 'utf-8') : '';
  const artText = existsSync(ap) ? readFileSync(ap, 'utf-8') : '';
  const copyLen = copyText.length;
  const artLen = artText.length;

  // ─── 品牌对齐（blocking）───
  const hits = BRAND_KEYWORDS.filter(kw => allText.includes(kw));
  if (hits.length < 3) issues.push(`品牌关键词 ${hits.length}/3（命中：${hits.join('、')}）`);

  const banned = BANNED_WORDS.filter(w => allText.toLowerCase().includes(w.toLowerCase()));
  if (banned.length > 0) issues.push(`禁用词：${banned.join('、')}`);

  // ─── 字数检查（按新规格）───
  if (copyLen > 200) warnings.push(`图文文案 ${copyLen} 字（建议 ≤100）`);
  if (artLen > 0 && artLen < 500) issues.push(`长文太短 ${artLen} 字（需 ≥500）`);
  if (artLen > 1500) warnings.push(`长文偏长 ${artLen} 字（建议 ~1000）`);

  // ─── 有数据 ───
  if (!/\d+/.test(allText)) issues.push('缺少具体数字/数据');

  // ─── 语气/姿态检查（blocking）───
  const LECTURING = ['你应该', '你必须', '你需要明白', '显而易见', '毋庸置疑'];
  const SELF_CENTERED = ['我最近', '说实话我', '我一直在想', '我不确定'];
  const lectureHits = LECTURING.filter(w => allText.includes(w));
  if (lectureHits.length > 0) issues.push(`说教语气：${lectureHits.join('、')}`);
  const selfHits = SELF_CENTERED.filter(w => allText.includes(w));
  if (selfHits.length > 0) issues.push(`创作者自嗨：${selfHits.join('、')}`);

  // ─── 一人公司关联（blocking）───
  const SOLO_KEYWORDS = ['一人公司', '个人', '小组织', '一个人', '能力'];
  const soloHits = SOLO_KEYWORDS.filter(kw => allText.includes(kw));
  if (soloHits.length < 2) issues.push(`一人公司关联不足（命中 ${soloHits.length}/2）`);

  // ─── 分享感（warning）───
  const hasQuestion = /？/.test(allText);
  const hasYou = /你/.test(allText);
  if (!hasQuestion && !hasYou) warnings.push('缺少互动感（没有"你"或问号）');

  const passed = issues.length === 0;
  console.log(`[review] ${passed ? 'PASS' : 'FAIL'}: ${issues.join('; ') || '全部通过'}${warnings.length ? ' | warnings: ' + warnings.join('; ') : ''}`);
  return { success: true, review_passed: passed, score: { keyword_hits: hits.length, banned_hits: banned.length, solo_hits: soloHits.length, copy_length: copyLen, article_length: artLen }, issues, warnings };
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
