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

  // 图文文案
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
    `\n**一人公司不是"小"公司，是"精"公司。**\n`,
    `你觉得哪个能力对你最有用？评论区告诉我！\n`,
    `\n#一人公司 #能力放大 #AI驱动 #个人创业 #能力下放\n`,
  ].join('\n');
  writeFileSync(join(dir, 'cards', 'copy.md'), copy, 'utf-8');

  // 长文
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
    `\n---\n`,
    `\n## 这意味着什么？\n`,
    `\n能力正在从大公司向个人转移。过去需要一个团队才能做到的事，现在一个人配合正确的系统就能完成。\n`,
    `\n这不是未来。这是正在发生的事。\n`,
    `\n**你准备好拥有这些能力了吗？**\n`,
  ].join('\n');
  writeFileSync(join(dir, 'article', 'article.md'), article, 'utf-8');

  console.log(`[generate] 完成 → ${dir}`);
  return { success: true, output_dir: dir, files: ['cards/copy.md', 'article/article.md'] };
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

  // 品牌关键词 ≥ 3
  const hits = BRAND_KEYWORDS.filter(kw => allText.includes(kw));
  if (hits.length < 3) issues.push(`品牌关键词 ${hits.length}/3（需 ≥3，命中：${hits.join('、')}）`);

  // 禁用词 = 0
  const banned = BANNED_WORDS.filter(w => allText.toLowerCase().includes(w.toLowerCase()));
  if (banned.length > 0) issues.push(`禁用词：${banned.join('、')}`);

  // 长度
  const copyLen = existsSync(cp) ? readFileSync(cp, 'utf-8').length : 0;
  const artLen = existsSync(ap) ? readFileSync(ap, 'utf-8').length : 0;
  if (copyLen < 300) issues.push(`图文文案 ${copyLen} 字（需 ≥300）`);
  if (artLen < 1000) issues.push(`长文 ${artLen} 字（需 ≥1000）`);

  // 有数据
  if (!/\d+/.test(allText)) issues.push('缺少具体数字/数据');

  const passed = issues.length === 0;
  console.log(`[review] ${passed ? 'PASS' : 'FAIL'}: ${issues.join('; ') || '全部通过'}`);
  return { success: true, review_passed: passed, score: { keyword_hits: hits.length, banned_hits: banned.length, copy_length: copyLen, article_length: artLen }, issues };
}

// ─── 4. Export ──────────────────────────────────────────────

export async function executeExport(task) {
  const keyword = task.payload?.pipeline_keyword || task.title;
  const contentType = task.payload?.content_type || 'solo-company-case';
  const pipelineId = task.payload?.parent_pipeline_id;

  console.log(`[export] 开始: ${keyword}`);

  const dir = findOutputDir(keyword);
  if (!dir) return { success: false, error: '找不到产出目录' };

  // manifest.json
  const manifest = {
    version: '1.0',
    keyword,
    content_type: contentType,
    pipeline_id: pipelineId,
    created_at: new Date().toISOString(),
    status: 'ready_for_publish',
    image_set: { framework: '/share-card', status: 'pending' },
    article: { path: 'article/article.md', status: existsSync(join(dir, 'article', 'article.md')) ? 'ready' : 'missing' },
    copy: { path: 'cards/copy.md', status: existsSync(join(dir, 'cards', 'copy.md')) ? 'ready' : 'missing' },
    platforms: { image: ['douyin', 'kuaishou', 'xiaohongshu', 'weibo'], article: ['wechat', 'zhihu', 'toutiao'] },
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 预览 HTML
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${keyword} 预览</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,'PingFang SC',sans-serif;background:#0a0a0a;color:#e2e8f0;padding:40px 20px;line-height:1.8}.c{max-width:800px;margin:0 auto}h1{font-size:24px;margin-bottom:8px}.m{color:#64748b;font-size:13px;margin-bottom:32px}.b{display:inline-block;background:#22c55e20;color:#22c55e;border:1px solid #22c55e40;padding:2px 12px;border-radius:20px;font-size:12px;margin-left:8px}.s{background:#111827;border:1px solid #1e293b;border-radius:16px;padding:24px;margin-bottom:16px}.s h2{font-size:16px;margin-bottom:12px;color:#3b82f6}.ct{font-size:14px;color:#cbd5e1;white-space:pre-wrap}</style></head><body><div class="c"><h1>${keyword}</h1><div class="m">${contentType}<span class="b">Ready</span></div><div class="s"><h2>图文文案</h2><div class="ct" id="cp">加载中...</div></div><div class="s"><h2>长文</h2><div class="ct" id="ar">加载中...</div></div></div><script>fetch('cards/copy.md').then(r=>r.text()).then(t=>{document.getElementById('cp').textContent=t}).catch(()=>{});fetch('article/article.md').then(r=>r.text()).then(t=>{document.getElementById('ar').textContent=t}).catch(()=>{})</script></body></html>`;
  writeFileSync(join(dir, 'index.html'), html, 'utf-8');

  console.log(`[export] 完成 → ${dir}/manifest.json`);
  return { success: true, manifest_path: join(dir, 'manifest.json'), preview_path: join(dir, 'index.html') };
}
