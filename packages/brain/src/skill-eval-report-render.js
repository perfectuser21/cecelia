// skill-eval 报告渲染器：把 report-data 渲染成「skill 解剖图」验收报告页。
// 纯函数（禁用 Date.now / Math.random / new Date），与端点共用 schema。
import { validateReportData } from './skill-eval-report-schema.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEALTH_COLOR = { ok: 'var(--pass)', warn: 'var(--warn)', bad: 'var(--fail)', neutral: 'var(--line)' };
const VERDICT_LABEL = { pass: '通过', partial: '部分通过', fail: '不通过' };

export function buildAnatomySvg(anatomy) {
  const { inputs = [], kernel = { rules: [] }, outputs = [] } = anatomy || {};

  // 左列 inputs（纵向排布）：red→红盒 / green→绿盒；connected===false → 红断线 + ✕ 断口
  const inputEls = inputs.map((inp, i) => {
    const y = 46 + i * 250;
    const hasFields = inp.fields && inp.fields.length;
    const boxH = hasFields ? 210 : 64;
    const cls = inp.status === 'green' ? 's-box-green' : 's-box-red';
    const wire = inp.connected === false
      ? `<path d="M310,${y + 90} C360,${y + 90} 360,190 420,190" class="s-wire-broken" stroke-dasharray="9 6"/><circle cx="360" cy="${y + 72}" r="15" class="s-brk"/><text x="360" y="${y + 78}" class="s-brkt">✕</text>`
      : `<path d="M310,${y + 30} C380,${y + 30} 370,232 428,224" class="s-wire-green"/>`;
    const fields = (inp.fields || []).map((f, k) =>
      `<rect x="${54 + (k % 2) * 128}" y="${y + 46 + Math.floor(k / 2) * 38}" width="118" height="32" rx="6"/><text x="${113 + (k % 2) * 128}" y="${y + 66 + Math.floor(k / 2) * 38}">${esc(f)}</text>`
    ).join('');
    const note = inp.note
      ? `<text x="175" y="${y + (hasFields ? boxH + 20 : -8)}" class="s-note">${esc(inp.note)}</text>`
      : '';
    return `${wire}<rect x="40" y="${y}" width="270" height="${boxH}" rx="12" class="s-box ${cls}"/><text x="58" y="${y + 28}" class="s-boxh">${esc(inp.name)}</text><g class="s-fld">${fields}</g>${note}`;
  }).join('');

  // 中央圆 rules（2 列）：hardGate → 🔒 前缀 + 红色类
  const ruleEls = (kernel.rules || []).map((r, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 458 + col * 128, y = 132 + row * 32;
    const hard = r.hardGate ? ' s-rule-hard' : '';
    const label = r.hardGate ? `🔒 ${r.name}` : r.name;
    return `<g class="s-rule${hard}"><rect x="${x}" y="${y}" width="116" height="26" rx="6"/><text x="${x + 58}" y="${y + 17}">${esc(label)}</text></g>`;
  }).join('');

  const gate = kernel.redlineGate
    ? `<rect x="770" y="170" width="70" height="26" rx="6" class="s-gate"/><text x="805" y="187" class="s-gatet">红线闸</text>`
    : '';

  // 右列 outputs 盒 + 字段格
  const outEls = outputs.map((o, i) => {
    const y = 70 + i * 94;
    const hasFields = o.fields && o.fields.length;
    const h = hasFields ? 176 : 70;
    const fields = (o.fields || []).map((f, k) =>
      `<rect x="${874 + (k % 2) * 126}" y="${y + (hasFields ? 34 : 0) + Math.floor(k / 2) * 40}" width="118" height="32" rx="6"/><text x="${933 + (k % 2) * 126}" y="${y + (hasFields ? 54 : 0) + Math.floor(k / 2) * 40}">${esc(f)}</text>`
    ).join('');
    const sub = o.sub ? `<text x="878" y="${y + 52}" class="s-boxsub">${esc(o.sub)}</text>` : '';
    return `<rect x="858" y="${y}" width="262" height="${h}" rx="12" class="s-box"/><text x="878" y="${y + 30}" class="s-boxh">${esc(o.name)}</text>${sub}<g class="s-fld s-fld-mono">${fields}</g>`;
  }).join('');

  return `<svg viewBox="0 0 1160 380" role="img" aria-label="skill 解剖图"><text x="165" y="30" class="s-hd">输入</text><text x="580" y="30" class="s-hd">内核 · 核心逻辑</text><text x="990" y="30" class="s-hd">输出</text>${gate}<circle cx="580" cy="196" r="158" class="s-hub"/><rect x="512" y="66" width="136" height="30" rx="15" class="s-modelpill"/><text x="580" y="86" class="s-modelt">${esc(kernel.model || '')}</text><text x="580" y="116" class="s-hubsub">${esc(kernel.promptNote || '')}</text>${ruleEls}${inputEls}${outEls}</svg>`;
}

export function renderReportHtml(reportData) {
  const v = validateReportData(reportData);
  const head = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body><div class="wrap">`;
  const tail = `</div></body></html>`;
  if (!v.valid) return `${head}<div class="fallback">报告数据不完整：${esc(v.errors.join('；'))}</div>${tail}`;

  const d = reportData;
  const stats = Object.entries(d.stats || {}).map(([k, val]) =>
    `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(val)}</div></div>`).join('');
  const health = (d.health || []).map((h) =>
    `<span class="hd" style="background:${HEALTH_COLOR[h.state] || 'var(--line)'}" title="${esc(h.dim)}"></span>`).join('');
  const findings = (d.findings || []).map((f) =>
    `<span class="chip">${esc(f.name)}<span class="tag t-${esc(f.severity)}">${esc(f.tag)}</span></span>`).join('');
  const redlines = (d.redlines || []).map((r) =>
    `<span class="chip">${esc(r.name)}${r.tag ? `<span class="tag t-hard">${esc(r.tag)}</span>` : ''}</span>`).join('');
  const maturity = Object.entries(d.maturity || {}).map(([k, val]) =>
    `<div class="cell"><div class="kk">${esc(k)}</div><div class="vv">${esc(val)}</div></div>`).join('');

  return `${head}
    <div class="crumb">${esc(d.skill.area || '')} › ${esc(d.skill.line || '')} › ${esc(d.skill.ability || '')}</div>
    <div class="rname">${esc(d.skill.name)} · 验收报告</div>
    <div class="rmeta">${esc(d.skill.submitter || '')} · ${esc(d.skill.source || '')} · ${esc(d.skill.version || '')} · ${esc(d.skill.evaluatedAt || '')}</div>
    <div class="verdict v-${esc(d.verdict.level)}"><span class="vbadge">${esc(VERDICT_LABEL[d.verdict.level] || d.verdict.level)}</span><span class="vtext">${esc(d.verdict.text)}</span></div>
    <div class="fingerprint">健康指纹：${health}</div>
    <div class="statrow">${stats}</div>
    <div class="diagram">${buildAnatomySvg(d.anatomy)}</div>
    <div class="deep"><h3>逻辑发现</h3><div class="chips">${findings}</div></div>
    <div class="deep"><h3>红线</h3><div class="chips">${redlines}</div></div>
    <div class="deep"><h3>成熟度</h3><div class="kv">${maturity}</div></div>
  ${tail}`;
}

const STYLE = `
:root{
  --bg:#F6F8F7;--surface:#FFFFFF;--surface2:#EFF3F1;--ink:#18211F;--muted:#5E6D68;--line:#DEE6E2;
  --accent:#0E7A6E;--accent-soft:#E2F0ED;--accent-ink:#0A5A51;
  --pass:#1B7F3B;--pass-soft:#E4F2E8;--warn:#96590A;--warn-soft:#FAF0DA;--fail:#B0271F;--fail-soft:#F8E6E4;
  --mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#0E1412;--surface:#151D1A;--surface2:#1C2622;--ink:#E6ECE9;--muted:#93A39D;--line:#28332E;
  --accent:#3CB9A8;--accent-soft:#123A35;--accent-ink:#7FD8CB;
  --pass:#5CC97F;--pass-soft:#12301B;--warn:#E4A94E;--warn-soft:#332710;--fail:#F0867A;--fail-soft:#3A1512;}}
:root[data-theme="light"]{--bg:#F6F8F7;--surface:#FFFFFF;--surface2:#EFF3F1;--ink:#18211F;--muted:#5E6D68;--line:#DEE6E2;--accent:#0E7A6E;--accent-soft:#E2F0ED;--accent-ink:#0A5A51;--pass:#1B7F3B;--pass-soft:#E4F2E8;--warn:#96590A;--warn-soft:#FAF0DA;--fail:#B0271F;--fail-soft:#F8E6E4;}
:root[data-theme="dark"]{--bg:#0E1412;--surface:#151D1A;--surface2:#1C2622;--ink:#E6ECE9;--muted:#93A39D;--line:#28332E;--accent:#3CB9A8;--accent-soft:#123A35;--accent-ink:#7FD8CB;--pass:#5CC97F;--pass-soft:#12301B;--warn:#E4A94E;--warn-soft:#332710;--fail:#F0867A;--fail-soft:#3A1512;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:1000px;margin:0 auto;padding:24px 20px 80px}
/* report head */
.crumb{font-size:12.5px;color:var(--muted);margin-bottom:4px}.crumb b{color:var(--accent-ink)}
.rname{font-size:21px;font-weight:800;letter-spacing:-.01em}
.rmeta{font-size:12px;color:var(--muted);font-family:var(--mono);margin-top:3px}
.verdict{display:flex;gap:12px;align-items:center;border-radius:9px;padding:12px 16px;margin:8px 0 16px;flex-wrap:wrap}
.v-warn,.v-partial{background:var(--warn-soft)}
.v-pass{background:var(--pass-soft)}
.v-fail{background:var(--fail-soft)}
.vbadge{font:700 13px var(--mono);color:var(--warn);border:1.5px solid var(--warn);border-radius:6px;padding:4px 10px;white-space:nowrap}
.v-pass .vbadge{color:var(--pass);border-color:var(--pass)}
.v-fail .vbadge{color:var(--fail);border-color:var(--fail)}
.vtext{font-size:14px;font-weight:600;color:var(--ink)}
.fingerprint{font-size:12.5px;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.statrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:9px;margin-bottom:18px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:9px 12px;text-align:center}
.stat .k{font-size:10.5px;color:var(--muted);letter-spacing:.03em}.stat .v{font-size:16px;font-weight:700;margin-top:1px;font-variant-numeric:tabular-nums}
.stat.bad .v{color:var(--fail)}.stat.ok .v{color:var(--pass)}
.diagram{margin:6px 0 22px;overflow-x:auto}
.diagram svg{width:100%;height:auto;min-width:820px}
.deep{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:14px 18px;margin-bottom:11px}
.deep h3{font-size:14px;margin:0 0 10px}
.fallback{background:var(--fail-soft);border:1px solid var(--fail);color:var(--fail);border-radius:10px;padding:20px;font-size:14px;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12.5px;color:var(--muted);background:var(--surface2)}
.chip.sel{border-color:var(--accent);color:var(--accent-ink);background:var(--accent-soft);font-weight:600}
.tag{font:600 10.5px var(--mono);border-radius:4px;padding:2px 6px;margin-left:5px;white-space:nowrap}
.t-hard{background:var(--fail-soft);color:var(--fail)}.t-flag{background:var(--warn-soft);color:var(--warn)}.t-ok{background:var(--pass-soft);color:var(--pass)}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.kv .cell{background:var(--surface2);border-radius:8px;padding:8px 11px}
.kv .kk{font-size:10.5px;color:var(--muted);letter-spacing:.03em}.kv .vv{font-size:14px;font-weight:700;margin-top:1px}
.kv .vv.r{color:var(--fail)}.kv .vv.g{color:var(--pass)}
.hd{display:inline-block;width:14px;height:14px;border-radius:4px}
/* SVG 解剖图 */
.s-hd{fill:var(--muted);font-size:13px;font-weight:600;text-anchor:middle;letter-spacing:.04em}
.s-box{fill:var(--surface);stroke:var(--line);stroke-width:1.5}
.s-box-red{fill:var(--fail-soft);stroke:var(--fail)}
.s-box-green{fill:var(--pass-soft);stroke:var(--pass)}
.s-boxh{fill:var(--ink);font-size:15px;font-weight:700}
.s-boxsub{fill:var(--muted);font-size:12px}
.s-fld rect{fill:var(--surface);stroke:var(--line);stroke-width:1}
.s-fld text{fill:var(--ink);font-size:11.5px;text-anchor:middle}
.s-fld-mono text{font-family:var(--mono);font-size:11px;fill:var(--muted)}
.s-note{fill:var(--muted);font-size:11.5px;font-weight:600;text-anchor:middle}
.s-note-red{fill:var(--fail);font-size:11.5px;font-weight:600;text-anchor:middle}
.s-hub{fill:var(--accent-soft);stroke:var(--accent);stroke-width:2}
.s-modelpill{fill:var(--accent);}
.s-modelt{fill:#fff;font-size:13px;font-weight:700;text-anchor:middle;font-family:var(--mono)}
.s-hubsub{fill:var(--muted);font-size:11.5px;text-anchor:middle}
.s-hubmain{fill:var(--ink);font-size:17px;font-weight:800;text-anchor:middle}
.s-gate{fill:var(--warn-soft);stroke:var(--warn);stroke-width:1}
.s-gatet{fill:var(--warn);font-size:11.5px;font-weight:700;text-anchor:middle}
.s-wire{stroke:var(--accent);stroke-width:2;fill:none}
.s-wire-gate{stroke:var(--warn)}
.s-wire-green{stroke:var(--pass);stroke-width:3;fill:none}
.s-wire-broken{stroke:var(--fail);stroke-width:3;fill:none;stroke-dasharray:9 6}
.s-brk{fill:var(--surface);stroke:var(--fail);stroke-width:2}.s-brkt{fill:var(--fail);font-size:15px;font-weight:800;text-anchor:middle}
.s-rule rect{fill:var(--surface);stroke:var(--line);stroke-width:1}.s-rule text{fill:var(--ink);font-size:13px;text-anchor:middle;font-weight:600}
.s-rule-hard rect{fill:var(--fail-soft);stroke:var(--fail);stroke-width:1.3}.s-rule-hard text{fill:var(--fail);font-weight:700}
@media(max-width:640px){.rname{font-size:18px}}
`;
