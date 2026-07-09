// skill-eval-report-render.js — 验收报告渲染器 v7（6维度完整设计）
// Sprint: skill-eval-full-4page
// 支持新 schema（6维度 dimensions 字段）和旧 schema（anatomy 圆核图）双路兼容
import { validateReportData } from './skill-eval-report-schema.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const VERDICT_LABEL = { pass: '可以用', partial: '改了能用', fail: '还不能用' };

function buildStats(stats) {
  if (!stats) return '';
  const items = [
    stats.function_count != null ? `<div class="sitem"><span class="sv">${esc(stats.function_count)}</span><span class="sk">功能线</span></div>` : '',
    stats.dep_gaps != null ? `<div class="sitem"><span class="sv ${stats.dep_gaps > 0 ? 'sw' : ''}">${esc(stats.dep_gaps)}</span><span class="sk">依赖缺口</span></div>` : '',
    stats.defects_high != null ? `<div class="sitem"><span class="sv ${stats.defects_high > 0 ? 'sr' : ''}">${esc(stats.defects_high)}</span><span class="sk">高危缺陷</span></div>` : '',
    stats.defects_mid_low != null ? `<div class="sitem"><span class="sv">${esc(stats.defects_mid_low)}</span><span class="sk">中低危缺陷</span></div>` : '',
    stats.cost_estimate_usd != null ? `<div class="sitem"><span class="sv">$${esc(stats.cost_estimate_usd)}</span><span class="sk">预估成本</span></div>` : '',
    stats.eval_minutes != null ? `<div class="sitem"><span class="sv">${esc(stats.eval_minutes)}min</span><span class="sk">评估耗时</span></div>` : '',
  ].filter(Boolean).join('');
  return items ? `<div class="statsbar">${items}</div>` : '';
}

function buildFunctionalMap(dim) {
  if (!dim || !dim.rows || !dim.rows.length) return '';
  const HEALTH_CLS = { ok: 'hok', warning: 'hwarn', missing: 'hmiss' };
  const HEALTH_LABEL = { ok: '接通', warning: '存疑', missing: '未接' };
  const rows = dim.rows.map((r) => `<tr>
    <td class="dno">${esc(r.no)}</td><td class="dname">${esc(r.name)}</td>
    <td>${esc(r.trigger)}</td><td>${esc(r.inputs)}</td><td>${esc(r.outputs)}</td>
    <td><span class="htag ${HEALTH_CLS[r.dep_health] || 'hok'}">${HEALTH_LABEL[r.dep_health] || esc(r.dep_health)}</span>${r.dep_health_note ? `<div class="hnote">${esc(r.dep_health_note)}</div>` : ''}</td>
  </tr>`).join('');
  return `<div class="dimcard"><div class="dimhd"><span class="dimno">1</span>功能地图</div>
  <div class="tscroll"><table class="dtable">
    <thead><tr><th>#</th><th>功能线</th><th>触发入口</th><th>输入依赖</th><th>输出</th><th>依赖健康</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function buildDependencyAudit(dim) {
  if (!dim || !dim.items || !dim.items.length) return '';
  const rows = dim.items.map((it) => `<tr class="${it.status === 'questionable' ? 'roq' : ''}">
    <td class="dname">${esc(it.dep)}</td><td><span class="stag">${esc(it.source_type)}</span></td>
    <td>${esc(it.source_desc)}</td>
    <td><span class="statustag ${it.status === 'confirmed' ? 'sok' : 'swarn'}">${it.status === 'confirmed' ? '来源明确' : '存疑'}</span></td>
    <td class="note">${esc(it.note)}</td></tr>`).join('');
  return `<div class="dimcard"><div class="dimhd"><span class="dimno">2</span>依赖审计</div>
  <div class="tscroll"><table class="dtable">
    <thead><tr><th>依赖</th><th>来源方式</th><th>来源说明</th><th>状态</th><th>备注</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function buildLogicSoundness(dim) {
  if (!dim) return '';
  const scoreLabel = { sound: '✅ 规则健全', minor_issues: '⚠️ 轻微问题', major_issues: '❌ 重大问题' };
  const rules = (dim.rules || []).map((r) => `<li>${esc(r)}</li>`).join('');
  const contradictions = (dim.contradictions || []).map((c) => `<li class="issue-item">${esc(c)}</li>`).join('');
  const undefinedFields = (dim.undefined_fields || []).map((f) => `<code class="ufield">${esc(f)}</code>`).join(' ');
  const hardStops = (dim.hard_stops || []).map((h) => `<li>${esc(h)}</li>`).join('');
  return `<div class="dimcard"><div class="dimhd"><span class="dimno">3</span>判定逻辑健全性 <span class="dscore">${scoreLabel[dim.score] || esc(dim.score)}</span></div>
  ${rules ? `<div class="subsec"><div class="subt">编码规则</div><ul class="rlist">${rules}</ul></div>` : ''}
  ${hardStops ? `<div class="subsec"><div class="subt">硬闸/拦截</div><ul class="hlist">${hardStops}</ul></div>` : ''}
  ${contradictions ? `<div class="subsec warn"><div class="subt">矛盾/冲突</div><ul class="ilist">${contradictions}</ul></div>` : ''}
  ${undefinedFields ? `<div class="subsec warn"><div class="subt">未定义字段</div><div class="ufields">${undefinedFields}</div></div>` : ''}</div>`;
}

function buildOutputVerifiability(dim) {
  if (!dim || !dim.items || !dim.items.length) return '';
  const rows = dim.items.map((it) => `<tr>
    <td class="dname">${esc(it.output_name)}</td><td><span class="stag">${esc(it.format)}</span></td>
    <td>${it.machine_verifiable ? '<span class="mok">✓ 可机械校验</span>' : '<span class="mno">人工判断</span>'}</td>
    <td class="note">${esc(it.verification_method)}</td></tr>`).join('');
  return `<div class="dimcard"><div class="dimhd"><span class="dimno">4</span>输出可验证性</div>
  <div class="tscroll"><table class="dtable">
    <thead><tr><th>输出</th><th>格式</th><th>可验证性</th><th>验证方法</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function buildRedline(dim) {
  if (!dim) return '';
  const riskLabel = { low: '🟢 低风险', medium: '🟡 中风险', high: '🔴 高风险' };
  const riskCls = { low: 'rlow', medium: 'rmed', high: 'rhigh' };
  const gaps = (dim.gaps || []).map((g) => `<li class="issue-item">${esc(g)}</li>`).join('');
  const stops = (dim.hard_stops || []).map((h) => `<li>${esc(h)}</li>`).join('');
  return `<div class="dimcard ${riskCls[dim.hallucination_risk] || ''}">
  <div class="dimhd"><span class="dimno">5</span>红线 · 编造与一票否决 <span class="rtag rtag-${esc(dim.hallucination_risk)}">${riskLabel[dim.hallucination_risk] || esc(dim.hallucination_risk)}</span></div>
  <p class="rreason">${esc(dim.risk_reason)}</p>
  ${stops ? `<div class="subsec"><div class="subt">已有防护</div><ul class="rlist">${stops}</ul></div>` : '<div class="subsec warn"><div class="subt">防护缺失</div><p class="nogap">暂无硬性拦截机制</p></div>'}
  ${gaps ? `<div class="subsec warn"><div class="subt">防护缺口</div><ul class="ilist">${gaps}</ul></div>` : ''}</div>`;
}

function buildMaturity(dim) {
  if (!dim) return '';
  const scoreLabel = { prototype: '原型', mvp: 'MVP', production_ready: '生产就绪' };
  const check = (v) => v ? '<span class="mok">✓</span>' : '<span class="mno">✗</span>';
  const assumptions = (dim.undocumented_assumptions || []).map((a) => `<li class="issue-item">${esc(a)}</li>`).join('');
  return `<div class="dimcard"><div class="dimhd"><span class="dimno">6</span>成熟度 · 诚实度 <span class="dscore">${scoreLabel[dim.score] || esc(dim.score)}</span></div>
  <div class="mchecks">
    <div class="mcheck">${check(dim.production_connected)} 接入生产${dim.production_details ? `<span class="mdetail">（${esc(dim.production_details)}）</span>` : ''}</div>
    <div class="mcheck">${check(dim.real_db_connected)} 真实数据库${dim.real_db_details ? `<span class="mdetail">（${esc(dim.real_db_details)}）</span>` : ''}</div>
    <div class="mcheck">${check(dim.real_sample_validated)} 真实样本验证</div>
    <div class="mcheck">${check(dim.honest_about_gaps)} 诚实交代缺口</div>
    ${dim.tested_rounds != null ? `<div class="mcheck"><span class="mv">${esc(dim.tested_rounds)}</span> 测试轮次</div>` : ''}
  </div>
  ${assumptions ? `<div class="subsec warn"><div class="subt">隐含前提</div><ul class="ilist">${assumptions}</ul></div>` : ''}</div>`;
}

function buildDefects(defects) {
  if (!defects || !defects.length) return `<div class="allgood">没有发现需要修的缺陷，可以直接用。</div>`;
  const rows = defects.map((d, i) => `<div class="ditem sev-${esc(d.severity || 'mid')}">
    <div class="did">${esc(d.id || String(i + 1).padStart(2, '0'))}</div>
    <div class="dc">
      <div class="dtitle">${esc(d.title || d.issue || '')}</div>
      ${d.section_ref ? `<div class="dref">${esc(d.section_ref)}</div>` : ''}
      <div class="ddesc">${esc(d.description || d.issue || '')}</div>
      <div class="dfix">${esc(d.fix || '')}</div>
    </div></div>`).join('');
  return `<div class="defects">${rows}</div>`;
}

function buildLegacySteps(steps) {
  if (!steps || !steps.length) return `<div class="allgood">没有需要改的，可以直接用。</div>`;
  return buildDefects(steps.map((s) => ({ title: s.issue || '', fix: s.fix || '', severity: s.severity || 'mid' })));
}

const DIM_LABELS = {
  functional_map: '功能地图',
  dependency_audit: '依赖审计',
  logic_soundness: '逻辑健全性',
  output_verifiability: '输出可验证性',
  redline: '红线',
  maturity: '成熟度',
};
const MC_SCORE_CLS = { ok: 'mcs-ok', partial: 'mcs-warn', fail: 'mcs-fail', low: 'mcs-ok', medium: 'mcs-warn', high: 'mcs-fail' };
const MC_SCORE_LABEL = { ok: '✅', partial: '⚠️', fail: '❌', low: '🟢低', medium: '🟡中', high: '🔴高' };

function buildModelComparisonTable(comparisons) {
  if (!comparisons || !comparisons.length) return '';
  const dims = Object.keys(DIM_LABELS);
  const colHeaders = comparisons.map((m) => `<th class="mc-mhd${m.is_primary ? ' mc-primary' : ''}">${esc(m.label)}</th>`).join('');
  const dimRows = dims.map((dim) => {
    const cells = comparisons.map((m) => {
      const score = m.dimension_scores && m.dimension_scores[dim];
      const cls = MC_SCORE_CLS[score] || '';
      const lbl = MC_SCORE_LABEL[score] || esc(score || '—');
      return `<td class="mc-cell ${cls}">${lbl}</td>`;
    }).join('');
    return `<tr><td class="mc-dim">${esc(DIM_LABELS[dim])}</td>${cells}</tr>`;
  }).join('');
  const verdictCells = comparisons.map((m) => {
    const cls = m.verdict_level === 'pass' ? 'mcs-ok' : m.verdict_level === 'fail' ? 'mcs-fail' : 'mcs-warn';
    return `<td class="mc-cell mc-verdict ${cls}">${esc(VERDICT_LABEL[m.verdict_level] || m.verdict_level)}</td>`;
  }).join('');
  const defectCells = comparisons.map((m) => {
    const hi = m.defects_high || 0;
    return `<td class="mc-cell">${hi > 0 ? `<span class="mcs-fail">${hi}高危</span>` : '—'} / ${esc(m.defects_total || 0)}条</td>`;
  }).join('');

  return `<div class="dimcard mc-wrap">
    <div class="dimhd"><span class="dimno">⊞</span>多模型逐线对比</div>
    <div class="tscroll"><table class="mc-table dtable">
      <thead><tr><th class="mc-dim">维度</th>${colHeaders}</tr></thead>
      <tbody>${dimRows}
        <tr class="mc-verdict-row"><td class="mc-dim">总裁决</td>${verdictCells}</tr>
        <tr><td class="mc-dim">缺陷数</td>${defectCells}</tr>
      </tbody>
    </table></div>
  </div>`;
}

export function renderReportBody(reportData) {
  const v = validateReportData(reportData);
  if (!v.valid) return `<div class="fallback">报告数据不完整：${esc(v.errors.join('；'))}</div>`;
  const d = reportData;
  const hasNewFormat = d.dimensions && typeof d.dimensions === 'object';
  const breadcrumb = [d.skill.area, d.skill.line, d.skill.ability].filter(Boolean).join(' › ');

  const reportContent = hasNewFormat
    ? `${buildFunctionalMap(d.dimensions.functional_map)}
       ${buildDependencyAudit(d.dimensions.dependency_audit)}
       ${buildLogicSoundness(d.dimensions.logic_soundness)}
       ${buildOutputVerifiability(d.dimensions.output_verifiability)}
       ${buildRedline(d.dimensions.redline)}
       ${buildMaturity(d.dimensions.maturity)}`
    : '';

  const defectSection = hasNewFormat
    ? buildDefects(d.defects)
    : buildLegacySteps(d.nextSteps || []);

  return `<div class="crumb">${esc(breadcrumb)}</div>
    <div class="head"><h1>${esc(d.skill.name)}</h1>
      <div class="vchip v-${esc(d.verdict.level)}"><span class="vdot"></span>${esc(VERDICT_LABEL[d.verdict.level] || d.verdict.level)}</div></div>
    ${buildStats(d.stats)}
    <p class="lead">${esc(d.summary || d.verdict.text)}</p>
    ${reportContent}
    <div class="sectitle">缺陷清单</div>
    ${defectSection}
    ${buildModelComparisonTable(d.model_comparisons)}
    ${d.model_recommendation ? `<div class="mrec"><div class="mrec-t">生产选型建议</div><p>${esc(d.model_recommendation)}</p></div>` : ''}
    <div class="foot">${esc(d.skill.submitter || '')} · ${esc(d.skill.evaluatedAt || '')}</div>`;
}

export function renderReportHtml(reportData) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body><div class="wrap">${renderReportBody(reportData)}</div></body></html>`;
}

export function renderComparePage(items) {
  const secs = items.map((it) => `<div class="cmpsec"><div class="cmphd">${esc(it.label)}</div><div class="wrap">${renderReportBody(it.data)}</div></div>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>${secs}</body></html>`;
}

const STYLE = `
:root{--bg:#F6F8FB;--surface:#FFFFFF;--surface2:#EFF2F7;--ink:#181C24;--muted:#5B6575;--line:#E2E6ED;--accent:#2A5DA6;--accent-soft:#E8EFF8;--accent-ink:#204A86;--pass:#1E7D46;--pass-soft:#E5F1EA;--warn:#9A6510;--warn-soft:#FAF0DC;--fail:#BE3A34;--fail-soft:#F9E7E5;--mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;}
@media(prefers-color-scheme:dark){:root{--bg:#0E1219;--surface:#161B24;--surface2:#1E2530;--ink:#E6EAF1;--muted:#8B95A6;--line:#28313E;--accent:#6B9BE0;--accent-soft:#152238;--accent-ink:#A6C6EE;--pass:#5BC97E;--pass-soft:#123020;--warn:#E3A94E;--warn-soft:#33270F;--fail:#EE8177;--fail-soft:#3A1512;}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
.wrap{max-width:1060px;margin:0 auto;padding:40px 24px 96px}
.crumb{font:600 11px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.head h1{font-size:28px;font-weight:800;letter-spacing:-.022em;margin:0;line-height:1.2}
.vchip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;border-radius:999px;padding:5px 14px}
.vchip .vdot{width:7px;height:7px;border-radius:50%}
.v-partial{background:var(--warn-soft);color:var(--warn)}.v-partial .vdot{background:var(--warn)}
.v-pass{background:var(--pass-soft);color:var(--pass)}.v-pass .vdot{background:var(--pass)}
.v-fail{background:var(--fail-soft);color:var(--fail)}.v-fail .vdot{background:var(--fail)}
.lead{font-size:16px;line-height:1.75;color:var(--ink);opacity:.82;margin:0 0 28px;max-width:66ch}
.statsbar{display:flex;flex-wrap:wrap;gap:2px;margin:0 0 24px;background:var(--surface);border-radius:14px;padding:14px 20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.sitem{flex:1;min-width:80px;text-align:center}
.sv{display:block;font:800 22px var(--mono);color:var(--ink)}.sv.sw{color:var(--warn)}.sv.sr{color:var(--fail)}
.sk{display:block;font-size:11px;color:var(--muted);margin-top:3px}
.dimcard{background:var(--surface);border-radius:16px;padding:22px 24px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.04)}
.dimcard.rhigh{border-left:4px solid var(--fail)}.dimcard.rmed{border-left:4px solid var(--warn)}.dimcard.rlow{border-left:4px solid var(--pass)}
.dimhd{font-size:15px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dimno{width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font:700 11px var(--mono);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.dscore{font:700 11px var(--mono);color:var(--muted);margin-left:auto}
.rtag{font:700 11px var(--mono);border-radius:6px;padding:3px 10px}
.rtag-low{background:var(--pass-soft);color:var(--pass)}.rtag-medium{background:var(--warn-soft);color:var(--warn)}.rtag-high{background:var(--fail-soft);color:var(--fail)}
.rreason{font-size:14px;color:var(--muted);margin:0 0 14px;line-height:1.6}
.tscroll{overflow-x:auto;margin:0 -6px;padding:0 6px}
.dtable{width:100%;border-collapse:collapse;font-size:13.5px}
.dtable th{text-align:left;font:600 11px var(--mono);color:var(--muted);letter-spacing:.04em;text-transform:uppercase;padding:6px 14px 8px 0;border-bottom:1.5px solid var(--line)}
.dtable td{padding:11px 14px 11px 0;border-bottom:1px solid var(--line);vertical-align:top}
.dtable tr:last-child td{border-bottom:0}.dtable tr.roq td{background:rgba(154,101,16,.04)}
.dno{font:700 12px var(--mono);color:var(--muted);width:28px}.dname{font-weight:700}
.note{color:var(--muted);font-size:13px;max-width:220px}
.htag{font:700 10px var(--mono);border-radius:5px;padding:2px 8px;display:inline-block}
.hok{background:var(--pass-soft);color:var(--pass)}.hwarn{background:var(--warn-soft);color:var(--warn)}.hmiss{background:var(--fail-soft);color:var(--fail)}
.hnote{font-size:11px;color:var(--fail);margin-top:3px}
.stag{font:500 11px var(--mono);color:var(--muted);background:var(--surface2);border-radius:5px;padding:2px 8px}
.statustag{font:700 10px var(--mono);border-radius:5px;padding:2px 8px}
.sok{color:var(--pass)}.swarn{color:var(--warn)}.mok{color:var(--pass);font-weight:800}.mno{color:var(--fail);font-weight:800}
.subsec{margin-top:14px}.subsec.warn .subt{color:var(--fail)}
.subt{font:700 11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px}
.rlist{margin:0;padding-left:20px;font-size:14px;line-height:1.7}
.hlist{margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:var(--pass)}
.ilist{margin:0;padding-left:20px;font-size:14px;line-height:1.7}.issue-item{color:var(--fail)}
.ufields{display:flex;flex-wrap:wrap;gap:6px}
.ufield{font:600 12px var(--mono);background:var(--fail-soft);color:var(--fail);border-radius:5px;padding:3px 9px}
.nogap{font-size:13px;color:var(--fail);margin:0}
.mchecks{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.mcheck{font-size:14px;display:flex;align-items:center;gap:7px}
.mv{font:800 16px var(--mono);color:var(--ink)}.mdetail{font-size:12px;color:var(--muted);margin-left:4px}
.sectitle{font-size:13px;font-weight:800;letter-spacing:.02em;margin:32px 0 8px;display:flex;align-items:center;gap:12px}
.sectitle::after{content:"";flex:1;height:1px;background:var(--line)}
.defects{margin-top:4px}
.ditem{display:flex;gap:18px;align-items:flex-start;padding:18px 2px;border-bottom:1px solid var(--line)}
.ditem:last-child{border-bottom:0}
.did{flex:none;font:800 18px var(--mono);color:var(--line);line-height:1;margin-top:2px;min-width:36px}
.ditem.sev-high .did{color:var(--fail)}.ditem.sev-mid .did{color:var(--warn)}.ditem.sev-low .did{color:var(--pass)}
.dc{flex:1;min-width:0}.dtitle{font-size:16px;font-weight:700;line-height:1.4}
.dref{font:500 11px var(--mono);color:var(--muted);margin-top:4px}
.ddesc{font-size:14px;color:var(--muted);margin-top:6px;line-height:1.6}
.dfix{font-size:14px;color:var(--accent-ink);margin-top:6px;line-height:1.5}
.dfix::before{content:"→ ";font-weight:700}
.allgood{font-size:15px;color:var(--pass);font-weight:600;padding:16px 2px}
.mrec{background:var(--accent-soft);border-radius:12px;padding:16px 20px;margin-top:24px}
.mrec-t{font:700 11px var(--mono);color:var(--accent-ink);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
.mrec p{margin:0;font-size:14px;line-height:1.6;color:var(--ink)}
.foot{font:500 11.5px var(--mono);color:var(--muted);letter-spacing:.04em;margin-top:40px}
.fallback{background:var(--fail-soft);border:1px solid var(--fail);color:var(--fail);border-radius:12px;padding:22px;font-weight:600}
.cmpsec{border-bottom:8px solid var(--surface2)}.cmpsec:last-child{border-bottom:0}
.cmphd{max-width:1060px;margin:0 auto;padding:28px 24px 0;font:700 12px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}
.cmpsec .wrap{padding-top:16px}
.mc-wrap .dimno{background:var(--muted)}
.mc-dim{font:700 12px var(--mono);color:var(--muted);white-space:nowrap;padding-right:16px}
.mc-mhd{font:700 12px -apple-system,"PingFang SC",sans-serif;color:var(--ink);text-align:center;padding:8px 14px}
.mc-mhd.mc-primary{color:var(--accent-ink);background:var(--accent-soft)}
.mc-cell{text-align:center;font-size:13px;padding:8px 12px}
.mc-verdict{font-weight:700;font-size:13.5px}
.mc-verdict-row td{border-top:2px solid var(--line)}
.mcs-ok{color:var(--pass)}.mcs-warn{color:var(--warn)}.mcs-fail{color:var(--fail)}
@media(max-width:640px){.head h1{font-size:22px}.statsbar{gap:8px}.mchecks{grid-template-columns:1fr 1fr}}
`;
