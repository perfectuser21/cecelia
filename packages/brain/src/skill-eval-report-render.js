// 渲染 v6：回到原形图（输入盒→圆核→输出盒），盒子只放 名字+类型，去字段；圆核一句话。
// 折自 skill-eval-formb-assets/render.mjs（Track 2 折回，2026-07-08）。validateReportData 移至 ./skill-eval-report-schema.js（同批折入），此处只 import 复用。
import { validateReportData } from './skill-eval-report-schema.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trunc = (s, n) => { const str = String(s == null ? '' : s); return str.length > n ? str.slice(0, n - 1) + '…' : str; };
// 取第一段（遇到分隔符就断），再兜底截断——名字尽量短、少出现「…」
const shortName = (s) => { const seg = String(s == null ? '' : s).split(/[／/（(【、,，·|｜:：\s]/)[0].trim() || String(s == null ? '' : s); return trunc(seg, 6); };
const VERDICT_LABEL = { pass: '可以用', partial: '改了能用', fail: '还不能用' };

// 类型元数据：图标 + 颜色（左右同类型同色）。图标用 currentColor 描边。
const ICON = {
  数据库: '<ellipse cx="8" cy="4.2" rx="5.2" ry="2.2"/><path d="M2.8 4.2 V11.8 c0 1.2 2.3 2.2 5.2 2.2 s5.2-1 5.2-2.2 V4.2" fill="none"/><path d="M2.8 8 c0 1.2 2.3 2.2 5.2 2.2 s5.2-1 5.2-2.2" fill="none"/>',
  文档: '<rect x="3.2" y="2" width="9.6" height="12" rx="1.2" fill="none"/><line x1="5.4" y1="5.2" x2="10.6" y2="5.2"/><line x1="5.4" y1="8" x2="10.6" y2="8"/><line x1="5.4" y1="10.8" x2="8.8" y2="10.8"/>',
  上下文: '<path d="M2.6 3.4 h10.8 v7 h-6.4 l-2.8 2.6 v-2.6 h-1.6 z" fill="none"/>',
  文件: '<path d="M4 2 h5 l3.2 3.2 V14 h-8.2 z" fill="none"/><path d="M9 2 v3.2 h3.2" fill="none"/>',
  提示词: '<path d="M4 4 h8 M4 7 h8 M4 10 h5" /><path d="M2 2.5 v11" stroke-width="2"/>',
  API: '<path d="M5.5 4 L2.5 8 L5.5 12 M10.5 4 L13.5 8 L10.5 12" fill="none"/>',
  数据: '<path d="M6 3 c-2 0 -2 2 -2 3 c0 1 -1 2 -2 2 c1 0 2 1 2 2 c0 1 0 3 2 3 M10 3 c2 0 2 2 2 3 c0 1 1 2 2 2 c-1 0 -2 1 -2 2 c0 1 0 3 -2 3" fill="none"/>',
  文本: '<line x1="3.5" y1="4.5" x2="12.5" y2="4.5"/><line x1="3.5" y1="8" x2="12.5" y2="8"/><line x1="3.5" y1="11.5" x2="9" y2="11.5"/>',
  修改动作: '<path d="M10.5 2.5 l3 3 l-8 8 h-3 v-3 z" fill="none"/><line x1="9" y1="4" x2="12" y2="7"/>',
  输入: '<circle cx="8" cy="8" r="5.5" fill="none"/>',
};
// 解析 pipeline：兼容新老 schema，产出统一的 steps（load/judge/gate）
function parsePipeline(anatomy) {
  const { inputs = [], kernel = {} } = anatomy || {};
  if (anatomy.pipeline && anatomy.pipeline.length) {
    return anatomy.pipeline.map((s) => {
      const p = String(s).split('|').map((x) => x.trim());
      const t = p[0];
      // 新格式 load|数据名|来源方式|来源名|接通 ；老格式 load|数据名|类型|接通
      if (t === 'load') {
        if (p.length >= 5) return { type: 'load', name: p[1], mech: p[2], source: p[3], bad: /未接|false|no/i.test(p[4] || '') };
        return { type: 'load', name: p[1], mech: p[2], source: '', bad: /未接|false|no/i.test(p[3] || '') };
      }
      if (t === 'gate') return { type: 'gate', text: p[1], action: p[2] || '闸' };
      return { type: 'judge', text: p.slice(1).join(' ') || p[0] };
    });
  }
  // 老 schema 回退：reads 全放前面（全部前置），再接 kernel.steps
  const reads = (anatomy.reads && anatomy.reads.length) ? anatomy.reads : inputs;
  const loads = reads.map((r) => ({ type: 'load', name: r.name, kind: r.kind, bad: r.connected === false }));
  const judges = (kernel.steps || []).map((s) => {
    const str = String(s).trim();
    const gate = /^闸|转人工|禁止|一票|拦截|不足禁/.test(str);
    const text = str.replace(/^闸[·、-]?\s*/, '');
    if (gate) return { type: 'gate', text, action: /转人工/.test(str) ? '转人工' : /禁|拦|一票|不足/.test(str) ? '拦截' : /标注/.test(str) ? '标注' : '闸' };
    return { type: 'judge', text };
  });
  return [...loads, ...judges];
}

let _graphId = 0;
// n8n/React-Flow 风格：横向连线节点图，顺着线看懂整个逻辑
function buildAnatomy(anatomy) {
  const { outputs = [] } = anatomy || {};
  const input = anatomy.input || (anatomy.inputs && anatomy.inputs[0] && anatomy.inputs[0].name) || '客户名称';
  const steps = parsePipeline(anatomy);
  const loadCount = steps.filter((s) => s.type === 'load').length;
  const judgeCount = steps.filter((s) => s.type === 'judge').length;
  const gateCount = steps.filter((s) => s.type === 'gate').length;
  const badLoad = steps.filter((s) => s.type === 'load' && s.bad).length;
  const firstJudge = steps.findIndex((s) => s.type !== 'load');
  const lastLoad = steps.map((s) => s.type).lastIndexOf('load');
  const interleaved = anatomy.loadMode ? /穿插/.test(anatomy.loadMode) : (firstJudge >= 0 && lastLoad > firstJudge);
  const uid = ++_graphId;

  const NODEW = 156, NODEH = 48, GAPX = 54, ROWH = 78, PADX = 34, PADTOP = 56, BAND = 60, PADBOT = 36;

  // 来源方式 → 图标（库/文档/API/上下文/文件；兼容老的 数据库 写法）
  const MECH_ICON = { 库: '数据库', 数据库: '数据库', 文档: '文档', API: 'API', 上下文: '上下文', 文件: '文件' };
  // 扁平节点：输入(顶) → skill 内部步骤(中间蛇形折行) → 输出(底)。load 副标=具体来源名
  const stepNodes = steps.map((s, idx) => {
    const seq = idx + 1;
    if (s.type === 'load') return { id: 's' + idx, seq, label: shortName(s.name), sub: s.source || s.mech || '', glyph: MECH_ICON[s.mech] || '数据库', cls: 'gload' + (s.bad ? ' gbad' : ''), bad: s.bad };
    if (s.type === 'gate') return { id: 's' + idx, seq, label: s.text, sub: s.action, shape: 'gate', cls: 'ggate' };
    return { id: 's' + idx, seq, label: s.text, shape: 'judge', cls: 'gjudge' };
  });
  const N = stepNodes.length;
  const perRow = Math.max(4, Math.round(Math.sqrt(N * 1.4)));
  const rows = Math.max(1, Math.ceil(N / perRow));
  const gridW = perRow * NODEW + (perRow - 1) * GAPX;

  const inNode = { id: 'in', label: shortName(input), glyph: '上下文', cls: 'gin' };
  const outNodes = (outputs.length ? outputs : [{ name: '输出' }]).map((o, j) => ({ id: 'o' + j, label: shortName(o.name), sub: o.kind, glyph: o.kind || '文档', cls: 'gout' }));

  const midY0 = PADTOP + NODEH + BAND;
  inNode.px = PADX + gridW / 2 - NODEW / 2; inNode.py = PADTOP + NODEH / 2;
  stepNodes.forEach((n, idx) => {
    const row = Math.floor(idx / perRow); let col = idx % perRow; if (row % 2 === 1) col = perRow - 1 - col;
    n.px = PADX + col * (NODEW + GAPX); n.py = midY0 + row * ROWH + NODEH / 2;
  });
  const outY = midY0 + rows * ROWH + BAND;
  const outTotalW = outNodes.length * NODEW + (outNodes.length - 1) * GAPX;
  const outStartX = PADX + gridW / 2 - outTotalW / 2;
  outNodes.forEach((n, j) => { n.px = outStartX + j * (NODEW + GAPX); n.py = outY + NODEH / 2; });

  const allNodes = [inNode, ...stepNodes, ...outNodes];
  const byId = {}; allNodes.forEach((n) => { byId[n.id] = n; });
  const W = PADX * 2 + Math.max(gridW, outTotalW);
  const H = outY + NODEH + PADBOT;

  // 连线：input→step0 → 逐步 → 末步→各输出（顺着序列）
  const edgeList = [];
  if (N) {
    edgeList.push({ from: 'in', to: stepNodes[0].id, bad: false });
    for (let k = 0; k < N - 1; k++) edgeList.push({ from: stepNodes[k].id, to: stepNodes[k + 1].id, bad: stepNodes[k].bad || stepNodes[k + 1].bad });
    outNodes.forEach((o) => edgeList.push({ from: stepNodes[N - 1].id, to: o.id, bad: false }));
  } else outNodes.forEach((o) => edgeList.push({ from: 'in', to: o.id, bad: false }));

  // 连线路径：有明显上下落差(跨带/跨行)走竖向(下边→上边)，同一行才走横向。与前端 JS 一致
  const edgeD = (a, b) => {
    const dy = b.py - a.py;
    if (Math.abs(dy) > NODEH) {
      const sy = dy >= 0 ? a.py + NODEH / 2 : a.py - NODEH / 2, ey = dy >= 0 ? b.py - NODEH / 2 : b.py + NODEH / 2;
      const sx = a.px + NODEW / 2, ex = b.px + NODEW / 2, my = (sy + ey) / 2;
      return `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey}`;
    }
    const dx = (b.px + NODEW / 2) - (a.px + NODEW / 2);
    const sx = dx >= 0 ? a.px + NODEW : a.px, ex = dx >= 0 ? b.px : b.px + NODEW, mx = (sx + ex) / 2;
    return `M${sx},${a.py} C${mx},${a.py} ${mx},${b.py} ${ex},${b.py}`;
  };
  const edges = edgeList.map((e) => `<path class="ge${e.bad ? ' ge-bad' : ''}" data-from="${e.from}" data-to="${e.to}" marker-end="url(#${e.bad ? 'arwb' : 'arw'}-${uid})" d="${edgeD(byId[e.from], byId[e.to])}"/>`).join('');

  // 三段横带：输入 / SKILL 内部 / 输出
  const bandRect = (y1, y2, label, cls) => `<rect x="${PADX - 18}" y="${y1}" width="${W - 2 * PADX + 36}" height="${y2 - y1}" rx="16" class="gzone ${cls}"/><text x="${PADX - 12}" y="${y1 + 17}" class="gzt">${label}</text>`;
  const zones = bandRect(PADTOP - 24, PADTOP + NODEH + 16, '输入', 'z-in')
    + bandRect(midY0 - 26, midY0 + rows * ROWH - ROWH + NODEH + 20, 'SKILL 内部', 'z-mid')
    + bandRect(outY - 24, outY + NODEH + 16, '输出', 'z-out');

  const glyphSvg = (n) => (n.glyph ? `<g class="gicon" transform="translate(13,-8)" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[n.glyph] || ICON['输入']}</g>` : n.shape === 'gate' ? '<rect x="13" y="-7" width="14" height="14" rx="3" class="gmk-gate"/>' : '<circle cx="20" cy="0" r="6" class="gmk-judge"/>');
  const nodes = allNodes.map((n) => `<g class="gnode ${n.cls}" data-id="${n.id}" transform="translate(${n.px},${n.py})"><rect x="0" y="${-NODEH / 2}" width="${NODEW}" height="${NODEH}" rx="11"/>${glyphSvg(n)}<text x="36" y="${n.sub ? -2 : 5}" class="gt">${esc(trunc(n.label, 7))}</text>${n.sub ? `<text x="36" y="13" class="gsub">${esc(n.sub)}</text>` : ''}</g>`).join('');

  // 类型图例：按来源方式命名（本图用到哪些就列出：图标 + 友好名）
  const LEGEND_LABEL = { 数据库: '结构化库', 文档: '文件文档', API: '外部API', 上下文: '对话/输入', 文件: '文件', 文本: '文本', 数据: '数据', 修改动作: '修改动作' };
  const kindsUsed = []; const seenK = {};
  allNodes.forEach((n) => { const k = n.glyph; if (k && !seenK[k]) { seenK[k] = 1; kindsUsed.push(k); } });
  const typeLegend = kindsUsed.map((k) => `<span class="tlg"><svg class="tlgi" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ''}</svg>${esc(LEGEND_LABEL[k] || k)}</span>`).join('');

  const defs = `<defs><marker id="arw-${uid}" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7.5,3 L0,6 Z" class="arwh"/></marker><marker id="arwb-${uid}" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L7.5,3 L0,6 Z" class="arwh-bad"/></marker></defs>`;
  const svg = (cls) => `<svg class="${cls}" data-nw="${NODEW}" viewBox="0 0 ${W} ${H}" role="img" aria-label="skill 逻辑连线图">${defs}<g class="gpan">${zones}${edges}${nodes}</g></svg>`;
  return `<div class="pwrap">
    <div class="pmode"><b>${interleaved ? '穿插判定 · 边判边读' : '全部前置 · 先读完再判'}</b> <span class="pcount">主流程 ${loadCount + judgeCount + gateCount} 步 · ${loadCount}读 ${judgeCount}判 ${gateCount}闸</span>${badLoad ? ` <span class="pbadn">${badLoad} 未接</span>` : ''}<span class="plegend"><span class="lg lg-load">读取</span><span class="lg lg-judge">判定</span><span class="lg lg-gate">闸</span></span><button class="fsbtn" type="button" data-open="fs-${uid}">⛶ 全图</button></div>
    <div class="ptypes"><span class="ptl">类型</span>${typeLegend}<span class="ptsep"></span><span class="pll solid">实线 数据流转</span><span class="pll dash">虚线 未接通</span></div>
    <div class="graphscroll">${svg('gsmall')}</div>
    <dialog class="fsdlg" id="fs-${uid}">
      <div class="fsbar"><span class="fstitle">逻辑全图</span><span class="fshint">拖节点摆放 · 拖空白平移 · 滚轮缩放</span><span class="fsctrl"><button type="button" data-z="out">－</button><button type="button" data-z="reset">复位</button><button type="button" data-z="in">＋</button></span><button class="fsclose" type="button" onclick="this.closest('dialog').close()">关闭 ✕</button></div>
      <div class="fsbody">${svg('gfull')}</div>
    </dialog>
  </div>`;
}

// 下钻式详解：pipeline 主视图已展示 输入/读取/判定，下钻只补输出的「作用」
function buildDetail(anatomy) {
  const { outputs = [] } = anatomy || {};
  if (!outputs.length) return '';
  const outTable = `<table class="dt"><thead><tr><th>名称</th><th>类型</th><th>作用</th></tr></thead><tbody>${outputs.map((o) => `<tr><td class="dtn">${esc(o.name || '')}</td><td class="dtk">${esc(o.kind || '')}</td><td class="dtr">${esc(o.role || '')}</td></tr>`).join('')}</tbody></table>`;
  const chev = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 6 l3 3 l3 -3"/></svg>';
  return `<div class="drills">
    <details class="drill"><summary>输出详情${chev}<span class="dcount">${outputs.length} 份</span></summary>${outTable}</details>
  </div>`;
}

// 报告正文（不含 html 骨架），供单页/多页复用
export function renderReportBody(reportData) {
  const v = validateReportData(reportData);
  if (!v.valid) return `<div class="fallback">报告数据不完整：${esc(v.errors.join('；'))}</div>`;
  const d = reportData;
  const steps = (d.nextSteps && d.nextSteps.length) ? d.nextSteps
    : (d.findings || []).map((f) => ({ issue: f.name, fix: f.tag, severity: f.severity === 'hard' ? 'high' : 'mid' }));
  const rows = steps.length
    ? steps.map((s, i) => `<div class="step sev-${esc(s.severity || 'mid')}"><div class="sn">${String(i + 1).padStart(2, '0')}</div><div class="sc"><div class="si">${esc(s.issue || '')}</div><div class="sf">${esc(s.fix || '')}</div></div></div>`).join('')
    : '<div class="allgood">没有需要改的，可以直接用。</div>';
  return `
    <div class="crumb">${esc(d.skill.area || '')} · ${esc(d.skill.line || '')}</div>
    <div class="head">
      <h1>${esc(d.skill.name)}</h1>
      <div class="vchip v-${esc(d.verdict.level)}"><span class="vdot"></span>${esc(VERDICT_LABEL[d.verdict.level] || d.verdict.level)}</div>
    </div>
    <p class="lead">${esc(d.summary || d.verdict.text)}</p>
    ${buildAnatomy(d.anatomy)}
    ${buildDetail(d.anatomy)}
    <div class="sectitle">要改这几件事</div>
    <div class="steps">${rows}</div>
    <div class="foot">${esc(d.skill.submitter || '')} · ${esc(d.skill.evaluatedAt || '')}</div>`;
}

const PANZOOM_JS = `
(function(){
  function wire(body){
    var svg=body.querySelector('svg.gfull'); if(!svg) return;
    var g=svg.querySelector('.gpan'); if(!g) return;
    var NW=+svg.getAttribute('data-nw')||156, NH=48;
    var s=1,tx=0,ty=0;
    var nodes={};
    g.querySelectorAll('.gnode').forEach(function(n){
      var m=/translate\\(([-0-9.]+),([-0-9.]+)\\)/.exec(n.getAttribute('transform'))||['','0','0'];
      nodes[n.getAttribute('data-id')]={el:n,x:+m[1],y:+m[2]};
    });
    var edges=[];
    g.querySelectorAll('path.ge').forEach(function(p){ edges.push({el:p,from:p.getAttribute('data-from'),to:p.getAttribute('data-to')}); });
    function edgeD(a,b){ var dy=b.y-a.y; if(Math.abs(dy)>NH){ var sy=dy>=0?a.y+NH/2:a.y-NH/2, ey=dy>=0?b.y-NH/2:b.y+NH/2, sx=a.x+NW/2, ex=b.x+NW/2, my=(sy+ey)/2; return 'M'+sx+','+sy+' C'+sx+','+my+' '+ex+','+my+' '+ex+','+ey; } var dx=(b.x+NW/2)-(a.x+NW/2), sx2=dx>=0?a.x+NW:a.x, ex2=dx>=0?b.x:b.x+NW, mx=(sx2+ex2)/2; return 'M'+sx2+','+a.y+' C'+mx+','+a.y+' '+mx+','+b.y+' '+ex2+','+b.y; }
    function redrawEdges(id){ for(var i=0;i<edges.length;i++){ var e=edges[i]; if(id&&e.from!==id&&e.to!==id)continue; var a=nodes[e.from],b=nodes[e.to]; if(a&&b)e.el.setAttribute('d',edgeD(a,b)); } }
    function apply(){ g.setAttribute('transform','translate('+tx+','+ty+') scale('+s+')'); }
    function k(){ var r=svg.getBoundingClientRect(); return r.width?svg.viewBox.baseVal.width/r.width:1; }
    function fit(){ var xs=[],ys=[]; for(var id in nodes){var n=nodes[id];xs.push(n.x,n.x+NW);ys.push(n.y-NH,n.y+NH);} if(!xs.length)return; var minx=Math.min.apply(0,xs),maxx=Math.max.apply(0,xs),miny=Math.min.apply(0,ys),maxy=Math.max.apply(0,ys); var vb=svg.viewBox.baseVal,pad=50; var gw=maxx-minx+pad*2,gh=maxy-miny+pad*2; s=Math.min(vb.width/gw, vb.height/gh, 2.2); tx=(vb.width-(minx+maxx)*s)/2; ty=(vb.height-(miny+maxy)*s)/2; apply(); }
    function zoomAt(f,cx,cy){ var r=svg.getBoundingClientRect(),kk=k(); var mx=(cx-r.left)*kk,my=(cy-r.top)*kk; var ns=Math.max(.2,Math.min(4,s*f)); f=ns/s; tx=mx-(mx-tx)*f; ty=my-(my-ty)*f; s=ns; apply(); }
    var mode=null,px=0,py=0,cur=null;
    svg.addEventListener('mousedown',function(e){ var nd=e.target.closest('.gnode'); px=e.clientX;py=e.clientY; if(nd){mode='node';cur=nodes[nd.getAttribute('data-id')];nd.parentNode.appendChild(nd);} else mode='pan'; body.style.cursor='grabbing'; e.preventDefault(); });
    window.addEventListener('mousemove',function(e){ if(!mode)return; var kk=k(),dx=(e.clientX-px)*kk,dy=(e.clientY-py)*kk; px=e.clientX;py=e.clientY; if(mode==='pan'){tx+=dx;ty+=dy;apply();} else if(cur){ cur.x+=dx/s; cur.y+=dy/s; cur.el.setAttribute('transform','translate('+cur.x+','+cur.y+')'); redrawEdges(cur.el.getAttribute('data-id')); } });
    window.addEventListener('mouseup',function(){mode=null;cur=null;body.style.cursor='grab';});
    svg.addEventListener('wheel',function(e){e.preventDefault();zoomAt(e.deltaY<0?1.12:0.89,e.clientX,e.clientY);},{passive:false});
    body.style.cursor='grab';
    var bar=body.parentNode.querySelector('.fsctrl');
    if(bar)bar.addEventListener('click',function(e){var z=e.target.getAttribute('data-z');if(!z)return;var r=svg.getBoundingClientRect();if(z==='in')zoomAt(1.2,r.left+r.width/2,r.top+r.height/2);else if(z==='out')zoomAt(1/1.2,r.left+r.width/2,r.top+r.height/2);else fit();});
    body._fit=fit;
  }
  document.querySelectorAll('.fsbody').forEach(wire);
  document.querySelectorAll('.fsbtn[data-open]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var dlg=document.getElementById(btn.getAttribute('data-open')); if(!dlg)return;
      dlg.showModal();
      var body=dlg.querySelector('.fsbody');
      requestAnimationFrame(function(){ if(body&&body._fit)body._fit(); });
    });
  });
})();
`;

function pageShell(inner) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>${inner}<script>${PANZOOM_JS}</script></body></html>`;
}

export function renderReportHtml(reportData) {
  return pageShell(`<div class="wrap">${renderReportBody(reportData)}</div>`);
}

// 对比页：一页放多份报告，各带标题
export function renderComparePage(items) {
  const secs = items.map((it) => `<div class="cmpsec"><div class="cmphd">${esc(it.label)}</div><div class="wrap">${renderReportBody(it.data)}</div></div>`).join('');
  return pageShell(secs);
}

const STYLE = `
:root{--bg:#F6F8FB;--surface:#FFFFFF;--surface2:#EFF2F7;--ink:#181C24;--muted:#5B6575;--line:#E2E6ED;--accent:#2A5DA6;--accent-soft:#E8EFF8;--accent-ink:#204A86;--pass:#1E7D46;--pass-soft:#E5F1EA;--warn:#9A6510;--warn-soft:#FAF0DC;--fail:#BE3A34;--fail-soft:#F9E7E5;--mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;}
@media(prefers-color-scheme:dark){:root{--bg:#0E1219;--surface:#161B24;--surface2:#1E2530;--ink:#E6EAF1;--muted:#8B95A6;--line:#28313E;--accent:#6B9BE0;--accent-soft:#152238;--accent-ink:#A6C6EE;--pass:#5BC97E;--pass-soft:#123020;--warn:#E3A94E;--warn-soft:#33270F;--fail:#EE8177;--fail-soft:#3A1512;}}
:root[data-theme="dark"]{--bg:#0E1219;--surface:#161B24;--surface2:#1E2530;--ink:#E6EAF1;--muted:#8B95A6;--line:#28313E;--accent:#6B9BE0;--accent-soft:#152238;--accent-ink:#A6C6EE;--pass:#5BC97E;--pass-soft:#123020;--warn:#E3A94E;--warn-soft:#33270F;--fail:#EE8177;--fail-soft:#3A1512;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:980px;margin:0 auto;padding:46px 26px 96px}
.crumb{font:600 11px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.head h1{font-size:31px;font-weight:800;letter-spacing:-.022em;margin:0;line-height:1.18}
.vchip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;border-radius:999px;padding:5px 14px}
.vchip .vdot{width:7px;height:7px;border-radius:50%}
.v-partial{background:var(--warn-soft);color:var(--warn)}.v-partial .vdot{background:var(--warn)}
.v-pass{background:var(--pass-soft);color:var(--pass)}.v-pass .vdot{background:var(--pass)}
.v-fail{background:var(--fail-soft);color:var(--fail)}.v-fail .vdot{background:var(--fail)}
.lead{font-size:17.5px;line-height:1.75;color:var(--ink);opacity:.82;margin:18px 0 36px;max-width:60ch}
/* 统一执行序列 */
.pwrap{padding:28px 26px;margin:0 0 44px;background:var(--surface);border-radius:22px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 10px 34px rgba(0,0,0,.045)}
.pends{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.pend{font:600 12px var(--mono);color:var(--muted);white-space:nowrap;display:flex;flex-direction:column;gap:3px}
.pend b{font-size:15px;color:var(--ink);font-family:-apple-system,"PingFang SC",sans-serif}
.pend.in b{color:var(--accent-ink)}
.pflowline{flex:1;text-align:center;font-size:12.5px;color:var(--muted);border-top:1.5px dashed var(--line);padding-top:8px;margin-top:14px}
.pmode{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:16px}
.pmode b{color:var(--ink);font-size:13.5px}
.pcount{font:500 12px var(--mono)}
.pbadn{color:var(--fail);font-weight:700;font-size:12px}
.plegend{margin-left:auto;display:flex;gap:14px}
.lg{font:600 11px var(--mono);color:var(--muted);display:inline-flex;align-items:center;gap:5px}
.lg::before{content:"";width:9px;height:9px;border-radius:50%}
.lg-load::before{background:var(--accent)}
.lg-judge::before{background:var(--muted)}
.lg-gate::before{background:var(--fail)}
.ptypes{display:flex;flex-wrap:wrap;align-items:center;gap:16px;font:600 12px var(--mono);margin:0 0 16px;padding:10px 14px;background:var(--surface2);border-radius:9px}
.ptl{color:var(--muted);letter-spacing:.06em}
.tlg{display:inline-flex;align-items:center;gap:6px;color:var(--ink)}
.tlgi{width:16px;height:16px;color:var(--accent-ink)}
.ptsep{width:1px;height:15px;background:var(--line)}
.pll{display:inline-flex;align-items:center;gap:7px;color:var(--ink)}
.pll::before{content:"";width:24px;border-top:2px solid var(--muted)}
.pll.dash::before{border-top:2px dashed var(--fail)}
.graphscroll{overflow-x:auto;margin:0 -6px;padding:4px 6px}
.graphscroll svg{height:auto;min-width:100%}
.fsbtn{margin-left:14px;cursor:pointer;font:600 12px -apple-system,"PingFang SC",sans-serif;color:var(--accent-ink);background:var(--accent-soft);border:1px solid var(--accent);border-radius:8px;padding:5px 12px}
.fsbtn:hover{background:var(--accent);color:#fff}
.fsdlg{border:none;border-radius:16px;padding:0;width:min(94vw,1500px);max-width:94vw;height:88vh;background:var(--surface);color:var(--ink);box-shadow:0 20px 70px rgba(0,0,0,.4)}
.fsdlg::backdrop{background:rgba(0,0,0,.55)}
.fsbar{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line)}
.fstitle{font:700 14px -apple-system,"PingFang SC",sans-serif}
.fshint{font:500 11.5px var(--mono);color:var(--muted)}
.fsctrl{margin-left:auto;display:flex;gap:6px}
.fsctrl button{cursor:pointer;font:600 13px var(--mono);color:var(--ink);background:var(--surface2);border:1px solid var(--line);border-radius:7px;padding:5px 12px;min-width:36px}
.fsctrl button:hover{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-ink)}
.fsclose{cursor:pointer;font:600 13px -apple-system,"PingFang SC",sans-serif;color:var(--muted);background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:6px 14px}
.fsclose:hover{color:var(--fail);border-color:var(--fail)}
.fsbody{overflow:hidden;height:calc(88vh - 56px);touch-action:none;background:var(--bg)}
.fsbody svg.gfull{width:100%;height:100%;display:block}
.gpan{transition:none}
.ge{stroke:var(--muted);stroke-width:1.7;fill:none;opacity:.75}
.ge-bad{stroke:var(--fail);stroke-width:1.7;fill:none;stroke-dasharray:6 5;opacity:.8}
.arwh{fill:var(--muted)}
.arwh-bad{fill:var(--fail)}
.gnum circle{fill:var(--accent);stroke:var(--surface);stroke-width:2}
.gload.gbad .gnum circle,.ggate .gnum circle{fill:var(--fail)}
.gnum text{text-anchor:middle;font:700 11px var(--mono);fill:#fff}
.gfull .gnode{cursor:move}
.gzone{fill:var(--surface2);opacity:.5;stroke:none}
.z-mid{fill:var(--accent-soft);opacity:.35}
.gzt{font:700 11px var(--mono);letter-spacing:.08em;fill:var(--muted);text-transform:uppercase}
.gnode rect{fill:var(--surface);stroke:var(--line);stroke-width:1.5}
.gin rect{fill:var(--accent-soft);stroke:var(--accent);stroke-width:2}
.gload rect{fill:var(--surface);stroke:var(--accent);stroke-width:1.5}
.gload.gbad rect{fill:var(--fail-soft);stroke:var(--fail)}
.gjudge rect{fill:var(--surface);stroke:var(--line)}
.ggate rect{fill:var(--fail-soft);stroke:var(--fail);stroke-width:1.5}
.gout rect{fill:var(--surface);stroke:var(--line)}
.gicon{stroke:var(--accent);fill:none}
.gin .gicon{stroke:var(--accent-ink)}
.gload.gbad .gicon{stroke:var(--fail)}
.gout .gicon{stroke:var(--muted)}
.gmk-judge{fill:var(--muted)}
.gmk-gate{fill:var(--fail)}
.gt{text-anchor:start;font:600 13px -apple-system,"PingFang SC",sans-serif;fill:var(--ink)}
.gin .gt{fill:var(--accent-ink)}
.gload.gbad .gt,.ggate .gt{fill:var(--fail)}
.gsub{text-anchor:start;font:500 9.5px var(--mono);fill:var(--muted)}
.gload.gbad .gsub{fill:var(--fail)}
.cmpsec{border-bottom:8px solid var(--surface2)}
.cmpsec:last-child{border-bottom:0}
.cmphd{max-width:980px;margin:0 auto;padding:32px 26px 0;font:700 12px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}
.cmpsec .wrap{padding-top:16px}
/* 下钻式详解：默认收起，点击展开 table */
.drills{margin:0 0 40px;border-top:1px solid var(--line)}
.drill{border-bottom:1px solid var(--line)}
.drill summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:16px 2px;font-size:15px;font-weight:700}
.drill summary::-webkit-details-marker{display:none}
.drill .chev{width:15px;height:15px;color:var(--muted);transition:transform .2s}
.drill[open] .chev{transform:rotate(180deg)}
.dcount{margin-left:auto;font:500 12px var(--mono);color:var(--muted)}
.dt{width:100%;border-collapse:collapse;font-size:13.5px;margin:2px 0 18px}
.dt th{text-align:left;font:600 11px var(--mono);color:var(--muted);letter-spacing:.04em;text-transform:uppercase;padding:6px 12px 8px 0;border-bottom:1px solid var(--line)}
.dt td{padding:11px 12px 11px 0;border-bottom:1px solid var(--line);vertical-align:top}
.dt tr:last-child td{border-bottom:0}
.dtn{font-weight:700;white-space:nowrap}
.dtk{color:var(--muted);font:500 12px var(--mono);white-space:nowrap}
.dtr{color:var(--muted);font-size:13px;line-height:1.5}
.dtg{text-align:right;width:40px}
.dt tr.bad .dtn{color:var(--fail)}
.no{font:700 10.5px var(--mono);color:var(--fail);background:var(--fail-soft);border-radius:5px;padding:2px 7px;white-space:nowrap}
.yes{font:700 10.5px var(--mono);color:var(--muted);white-space:nowrap}
.dess{font-size:14px;font-weight:700;color:var(--accent-ink);margin:6px 0 12px;line-height:1.5}
/* 内核逻辑流程：带编号的顺序管线，一条线连下来，闸标红 */
.kflownote{font-size:12.5px;color:var(--muted);margin:0 0 14px;padding:9px 13px;background:var(--surface2);border-radius:8px;line-height:1.55}
.kflow{position:relative;margin-bottom:6px}
.kstep{display:flex;gap:14px;align-items:flex-start;padding:8px 0;position:relative}
.kstepn{flex:none;width:26px;height:26px;border-radius:50%;background:var(--surface);border:1.5px solid var(--line);color:var(--muted);font:700 12px var(--mono);display:flex;align-items:center;justify-content:center;position:relative;z-index:1}
.kstep.gate .kstepn{background:var(--fail-soft);border-color:var(--fail);color:var(--fail)}
.kstep:not(:last-child)::before{content:"";position:absolute;left:12.5px;top:30px;height:calc(100% - 20px);width:1.5px;background:var(--line)}
.ksteptext{flex:1;font-size:14px;padding-top:4px;line-height:1.5}
.kstep.gate .ksteptext{font-weight:600}
.kgatetag{flex:none;font:700 10px var(--mono);color:var(--fail);background:var(--fail-soft);border:1px solid var(--fail);border-radius:5px;padding:2px 8px;margin-top:5px;white-space:nowrap}
/* 要改这几件事：编号列表 + 细分隔线，编辑感 */
.sectitle{font-size:13px;font-weight:800;letter-spacing:.02em;margin:0 0 4px;display:flex;align-items:center;gap:12px}
.sectitle::after{content:"";flex:1;height:1px;background:var(--line)}
.steps{margin-top:6px}
.step{display:flex;gap:20px;align-items:flex-start;padding:20px 2px;border-bottom:1px solid var(--line)}
.step:last-child{border-bottom:0}
.sn{flex:none;font:800 22px var(--mono);color:var(--line);line-height:1;margin-top:2px;width:32px}
.step.sev-high .sn{color:var(--fail)}.step.sev-mid .sn{color:var(--warn)}.step.sev-low .sn{color:var(--pass)}
.sc{flex:1;min-width:0}
.si{font-size:16.5px;font-weight:700;line-height:1.5}
.sf{font-size:14.5px;color:var(--muted);margin-top:8px;line-height:1.65}
.sf::before{content:"→ ";color:var(--accent-ink);font-weight:700}
.allgood{font-size:15px;color:var(--pass);font-weight:600;padding:18px 2px}
.foot{font:500 11.5px var(--mono);color:var(--muted);letter-spacing:.04em;margin-top:44px}
.fallback{background:var(--fail-soft);border:1px solid var(--fail);color:var(--fail);border-radius:12px;padding:22px;font-weight:600}
@media(max-width:640px){.head h1{font-size:25px}.lead{font-size:15.5px}}
`;
