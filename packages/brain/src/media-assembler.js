/**
 * media-assembler.js
 *
 * 多媒体素材组装器 — 从文案 findings 生成平台规格图片。
 *
 * 职责：
 *   assembleMedia({ keyword, findings, outputDir, topic })
 *     → 生成封面 (1080×1464)、内容卡 (1080×1920)、微信封面 (900×383)
 *     → 返回 { cover, cards, coverWechat, count, errors }
 *
 * ESM 兼容：使用 dynamic import() + pathToFileURL 加载 @resvg/resvg-js，
 * 彻底避免 CommonJS require() 在 ESM 模块中的运行时崩溃。
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

// ─── 尺寸常量 ────────────────────────────────────────────────────────────────
const W = 1080, H = 1920, HC = 1464;
const SL = 80, SR = 260, ST = 220, SB = 260;
const CX = 80, CY = 300, CW = 740;
const WX = 900, HX = 383;

// ─── 主题与强调色 ─────────────────────────────────────────────────────────────
const THEMES = [
  { TC: '#c084fc', TB: 'rgba(168,85,247,0.22)', BG1: '#0d0520', BG2: '#170a35', G1: '#a855f7', G2: '#d946ef' },
  { TC: '#f472b6', TB: 'rgba(244,114,182,0.22)', BG1: '#15050e', BG2: '#200618', G1: '#ec4899', G2: '#fb923c' },
  { TC: '#818cf8', TB: 'rgba(129,140,248,0.22)', BG1: '#08091a', BG2: '#0e1030', G1: '#6366f1', G2: '#8b5cf6' },
  { TC: '#2dd4bf', TB: 'rgba(45,212,191,0.22)', BG1: '#021512', BG2: '#061e1a', G1: '#14b8a6', G2: '#06b6d4' },
];
const ACCENTS = ['#f87171', '#34d399', '#60a5fa', '#fbbf24', '#a78bfa'];

// ─── SVG 辅助函数 ────────────────────────────────────────────────────────────

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function vertChars(x, yStart, text, fontSize, fill, opacity) {
  const lh = Math.round(fontSize * 1.36);
  return [...text].map((ch, i) =>
    `<text x="${x}" y="${yStart + i * lh}" text-anchor="middle" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">${ch}</text>`
  ).join('');
}

function svgBg(T, w, h) {
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${T.BG1}"/>
      <stop offset="100%" stop-color="${T.BG2}"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${T.G1}"/>
      <stop offset="100%" stop-color="${T.G2}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>`;
}

function corners(T, tag, pageNum, w, h) {
  const tlx = SL + 60, tly = ST - 22, acctX = w - SR + 92, brandY = h - SB + 40;
  return `
    <rect x="${tlx}" y="${tly - 34}" width="220" height="54" rx="27" fill="${T.TB}" fill-opacity="0.30"/>
    <text x="${tlx + 110}" y="${tly + 3}" text-anchor="middle" font-size="30" font-weight="700" fill="${T.TC}">${esc(tag)}</text>
    ${vertChars(acctX, ST + 28, '大湖成长日记', 34, '#ffffff', 0.55)}
    <text x="${acctX}" y="${ST + 28 + 7 * Math.round(34 * 1.36)}" text-anchor="middle" font-size="26" fill="#ffffff" fill-opacity="0.50">(AI+)</text>
    <text x="${SL + 10}" y="${brandY}" font-size="38" font-weight="700" fill="#a78bfa" fill-opacity="0.80">ZenithJoy</text>
    ${pageNum ? `<text x="${SL + 240}" y="${brandY}" font-size="30" font-weight="600" fill="${T.TC}" fill-opacity="0.70">${esc(pageNum)}</text>` : ''}
  `;
}

// ─── resvg 渲染（dynamic import — ESM 兼容）────────────────────────────────
async function renderPng(svg, outPath) {
  try {
    const HOME = process.env.HOME || '/Users/administrator';
    const resvgDir = join(HOME, 'claude-output', 'scripts', 'node_modules', '@resvg', 'resvg-js');
    const { Resvg } = await import(pathToFileURL(resvgDir).href);
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 2160 } });
    const pngBuffer = resvg.render().asPng();
    writeFileSync(outPath, pngBuffer);
    console.log(`[media-assembler] 卡片 → ${outPath}`);
    return pngBuffer;
  } catch (e) {
    console.error(`[media-assembler] resvg 渲染失败: ${e.message}`);
    return null;
  }
}

// ─── SVG 生成：封面 (1080×1464) ──────────────────────────────────────────────
function buildCoverSvg(keyword, titles, top) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${HC}" width="${W}" height="${HC}">
    ${svgBg(THEMES[0], W, HC)}
    ${corners(THEMES[0], '能力下放', '', W, HC)}
    <text x="${CX + 70}" y="${CY + 80}" font-size="96" font-weight="800" fill="#ffffff" letter-spacing="-2">${esc('这些能力')}</text>
    <text x="${CX + 70}" y="${CY + 180}" font-size="88" font-weight="800" fill="url(#acc)" letter-spacing="-2">${esc('一个人就够了')}</text>
    <text x="${CX + 70}" y="${CY + 240}" font-size="30" fill="rgba(255,255,255,0.30)">${esc(keyword)} · 能力拆解</text>
    ${titles.map((t, i) => `
      <rect x="${CX + 70}" y="${CY + 300 + i * 62}" width="${CW - 80}" height="52" rx="10" fill="${ACCENTS[i % 5]}" fill-opacity="0.08"/>
      <text x="${CX + 95}" y="${CY + 334 + i * 62}" font-size="26" fill="rgba(255,255,255,0.50)">${t}</text>
    `).join('')}
    <text x="${CX + 70}" y="${HC - SB - 40}" font-size="28" fill="rgba(255,255,255,0.25)">共 ${top.length} 张 · 一人公司案例拆解</text>
  </svg>`;
}

// ─── SVG 生成：微信封面 (900×383) ─────────────────────────────────────────────
function buildWechatSvg(keyword) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WX} ${HX}" width="${WX}" height="${HX}">
    ${svgBg(THEMES[0], WX, HX)}
    <text x="60" y="100" font-size="56" font-weight="800" fill="#ffffff" letter-spacing="-1">${esc('这些能力，一个人就够了')}</text>
    <text x="60" y="160" font-size="28" fill="rgba(255,255,255,0.50)">${esc(keyword)} · 能力拆解</text>
    <text x="${WX - 120}" y="${HX - 30}" text-anchor="end" font-size="26" font-weight="700" fill="#a78bfa" fill-opacity="0.80">ZenithJoy</text>
  </svg>`;
}

// ─── SVG 生成：内容卡 (1080×1920) ────────────────────────────────────────────
function buildCardSvg(f, keyword, index, total) {
  const T = THEMES[index % 4];
  const items = [];
  if (f.capability) items.push([f.title.substring(0, 25), f.capability.substring(0, 50)]);
  if (f.data) {
    f.data.split(/[，,；;]/g).filter(Boolean).slice(0, 4).forEach(p => items.push([p.trim().substring(0, 35), '']));
  }
  while (items.length < 5) items.push(['能力放大', '个人也能拥有公司级能力']);

  const bxH = 158, bxGap = 14;
  const itemsSvg = items.map(([main, sub], j) => {
    const ac = ACCENTS[j % 5];
    const by = 570 + j * (bxH + bxGap);
    return `
      <rect x="${CX + 70}" y="${by}" width="${CW - 80}" height="${bxH}" rx="12" fill="${ac}" fill-opacity="0.09"/>
      <rect x="${CX + 70}" y="${by}" width="4" height="${bxH}" rx="2" fill="${ac}" fill-opacity="0.75"/>
      <text x="${CX + 95}" y="${by + 44}" font-size="32" font-weight="700" fill="${ac}">${esc(main)}</text>
      <text x="${CX + 95}" y="${by + 84}" font-size="25" fill="rgba(255,255,255,0.40)">${esc(sub)}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    ${svgBg(T, W, H)}
    ${corners(T, '能力拆解', `${index + 1}/${total}`, W, H)}
    <text x="${CX + 70}" y="${CY + 100}" font-size="88" font-weight="800" fill="#ffffff">${esc((f.title || '').substring(0, 12))}</text>
    <text x="${CX + 70}" y="${CY + 170}" font-size="30" fill="rgba(255,255,255,0.30)">${esc(keyword)} · 能力 ${index + 1}</text>
    ${itemsSvg}
  </svg>`;
}

// ─── 主接口 ──────────────────────────────────────────────────────────────────

/**
 * 组装多媒体素材：生成封面 + 微信封面 + 内容卡。
 *
 * @param {{ keyword: string, findings: Array, outputDir: string, topic: string }} params
 * @returns {Promise<{ cover: string|null, cards: string[], coverWechat: string|null, count: number, errors: string[] }>}
 */
export async function assembleMedia({ keyword, findings, outputDir, topic }) {
  const errors = [];
  const cards = [];
  let cover = null;
  let coverWechat = null;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const top = (findings || []).filter(f => (f.brand_relevance || 0) >= 3).slice(0, 6);
  if (top.length === 0) {
    console.log('[media-assembler] 无有效 findings，跳过卡片生成');
    return { cover: null, cards: [], coverWechat: null, count: 0, errors: ['无有效 findings'] };
  }

  const titles = top.map(f => esc((f.title || '').substring(0, 30)));

  // 1. 封面 (1080×1464)
  const coverPath = join(outputDir, `${topic}-cover.png`);
  const coverBuffer = await renderPng(buildCoverSvg(keyword, titles, top), coverPath);
  if (coverBuffer) {
    cover = coverPath;
  } else {
    errors.push(`封面生成失败: ${topic}-cover.png`);
  }

  // 2. 微信封面 (900×383)
  const wechatPath = join(outputDir, `${topic}-cover-wechat.png`);
  const wechatBuffer = await renderPng(buildWechatSvg(keyword), wechatPath);
  if (wechatBuffer) {
    coverWechat = wechatPath;
  } else {
    errors.push(`微信封面生成失败: ${topic}-cover-wechat.png`);
  }

  // 3. 内容卡 (1080×1920，最多 9 张)
  for (let i = 0; i < top.length; i++) {
    const idx = String(i + 1).padStart(2, '0');
    const cardPath = join(outputDir, `${topic}-${idx}.png`);
    const cardBuffer = await renderPng(buildCardSvg(top[i], keyword, i, top.length), cardPath);
    if (cardBuffer) {
      cards.push(cardPath);
    } else {
      errors.push(`内容卡 ${idx} 生成失败: ${topic}-${idx}.png`);
    }
  }

  const count = (cover ? 1 : 0) + (coverWechat ? 1 : 0) + cards.length;
  console.log(`[media-assembler] 完成: ${count} 张（封面1 + 微信1 + 内容卡${cards.length}张），${errors.length} 个错误`);

  return { cover, cards, coverWechat, count, errors };
}
