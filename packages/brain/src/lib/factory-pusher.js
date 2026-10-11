/**
 * 技能工厂推进器（任务 a5f42455；决策 cc008b7e / 2bb08a99 / 7c6f7ae2）。
 *
 * Brain tick 节流调用（默认 5 分钟一次），逐行看台账按规则决定下一步，所有决策落 factory_stage_events 或 next_action：
 *   - 1/2/3 跑验类：人工关口/安全红线不动；有在途单不动；滑窗满且全过 → rule 推进；滑窗出现 fail → 清零重来，
 *     stage 3 连续失败（不含 safe_stop）达阈值 → 退回 2；否则发布时段内建下一张 factory_dispatch 执行单（同行最多 1 张在途）
 *   - 4 沉淀 / 6 蒸馏：建 /dev 类工单（只建单不自动写码），工单完成后推进
 *   - 5 上线跑：建 Commander 工单；对外流程首次上生产标 human_gate；滑窗满且全过 → 推进
 *   - 7 守护：滑窗尾部连续 fail 达阈值 → 退回 6 并告警
 * 配置取不到设备/agent/技能 → blocked_kind=resource 写原因，不猜。
 */
import { STAGE_NAMES } from './factory-ledger.js';

export const PUSHER_TAG = '[推进器]';
const HUMAN_BLOCKS = new Set(['human_gate', 'safety']);

export function shanghaiHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

/** 上海时间 [start, end) 内为发布时段。 */
export function withinPublishHours(date, hours = [9, 23]) {
  const [start, end] = Array.isArray(hours) && hours.length === 2 ? hours : [9, 23];
  const h = shanghaiHour(date);
  return h >= start && h < end;
}

/** 该阶段要跑的技能：1/2 取 stage_skills，3/5 取候选版本（按候选版本正常跑）。 */
export function stageSkill(stage, ledger, cfg) {
  if (stage === 1 || stage === 2) return cfg?.stage_skills?.[String(stage)] || null;
  return ledger.candidate_version || null;
}

/** 建执行单缺什么配置；齐全返回 null。 */
export function missingDispatchConfig(ledger, cfg) {
  if (!cfg) return `workflow ${ledger.workflow_key} 未在 config/factory-workflows.json 登记，取不到设备/agent`;
  const d = cfg.device || {};
  const lack = ['node', 'profile', 'serial'].filter((k) => typeof d[k] !== 'string' || !d[k]);
  if (lack.length) return `workflow ${ledger.workflow_key} 设备配置缺 ${lack.join('/')}`;
  if (!cfg.agent) return `workflow ${ledger.workflow_key} 未配置 agent`;
  if (!stageSkill(ledger.stage, ledger, cfg)) {
    return ledger.stage === 3 || ledger.stage === 5 ? '台账没有候选版本 candidate_version，不知道跑哪个版本' : `stage ${ledger.stage} 未配置技能`;
  }
  return null;
}

/** 滑窗尾部连续 fail 次数（safe_stop 不计、遇到 pass 截止）。 */
export function tailConsecutiveFails(runs = []) {
  let n = 0;
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const r = runs[i];
    if (r.pass === true) break;
    if (!r.safe_stop) n += 1;
  }
  return n;
}

const windowAllPass = (l) => l.recent_total >= l.window_k && l.recent_pass >= l.window_k;
const runIds = (l) => (l.recent_runs || []).map((r) => r.run_id);
const advance = (l, why) => ({ type: 'transition', to_stage: l.stage + 1, reason: `${why}：滑窗 ${l.recent_pass}/${l.window_k} 全过 → 推进到 ${l.stage + 1} ${STAGE_NAMES[l.stage + 1]}`, evidence_run_ids: runIds(l) });

/** 资源卡点：只在原因变化时重写，避免每轮刷 updated_at。 */
function blockResource(l, why) {
  const reason = `${PUSHER_TAG} ${why}`;
  if (l.blocked_kind === 'resource' && l.blocked_reason === reason) return { actions: [], reason: why };
  return { actions: [{ type: 'block', kind: 'resource', reason }], reason: why };
}

/**
 * 纯规则：一行台账这一轮该做什么。
 * @param {object} p
 * @param {object} p.ledger 台账行（含 workflow_key）
 * @param {object|null} p.cfg resolveWorkflowConfig 结果
 * @param {object|null} p.inFlight 在途单 {id,status}
 * @param {number} p.consecutiveFails 本阶段已裁判执行单连续 fail 数（不含 safe_stop）
 * @param {number} p.ticketsDone 本阶段（stage_changed_at 之后）已完成工单数（4/6 dev，5 commander）
 * @param {number} p.ticketsTotal 本阶段建过的工单数
 * @param {Date} p.now
 * @returns {{actions: object[], reason: string}}
 */
export function decideLedger({ ledger: l, cfg, inFlight = null, consecutiveFails = 0, ticketsDone = 0, ticketsTotal = 0, now = new Date() }) {
  if (HUMAN_BLOCKS.has(l.blocked_kind)) return { actions: [], reason: `卡点 ${l.blocked_kind}（${l.blocked_reason || '未写原因'}），只有人工能动` };
  if (inFlight) return { actions: [], reason: `在途 ${inFlight.id}（${inFlight.status}），等它结束并裁判完`, keep: inFlight.id };
  const ownBlock = l.blocked_kind === 'resource' && String(l.blocked_reason || '').startsWith(PUSHER_TAG);
  const foreignBlock = l.blocked_kind === 'resource' && !ownBlock;
  const s = l.stage;
  const hours = cfg?.publish_hours;

  if (s <= 3) {
    if (windowAllPass(l)) return { actions: [advance(l, '规则推进')], reason: '滑窗全过，推进' };
    const actions = [];
    const runs = l.recent_runs || [];
    const fails = runs.filter((r) => r.pass === false);
    if (fails.length) {
      const threshold = cfg?.retreat_fail_threshold ?? 3;
      if (s === 3 && consecutiveFails >= threshold) {
        return { actions: [{ type: 'transition', to_stage: 2, reason: `规则退回：③验证连续失败 ${consecutiveFails} 次（阈值 ${threshold}，safe_stop 不计）→ 回 2 摸边界`, evidence_run_ids: runIds(l) }], reason: '连续失败达阈值，退回' };
      }
      actions.push({ type: 'reset_window', reason: `规则清零：滑窗内出现 fail（${fails.map((r) => r.run_id).join(', ')}${fails.some((r) => r.safe_stop) ? '，含 safe_stop' : ''}），清零重来（连续失败 ${consecutiveFails}/${threshold}）`, evidence_run_ids: fails.map((r) => r.run_id) });
    }
    const miss = missingDispatchConfig(l, cfg);
    if (miss) { const b = blockResource(l, miss); return { actions: [...actions, ...b.actions], reason: b.reason }; }
    if (foreignBlock) return { actions, reason: `资源卡点（人工标注：${l.blocked_reason || ''}），不建单` };
    if (!withinPublishHours(now, hours)) return { actions, reason: `发布时段外（${(hours || [9, 23]).join(':00–')}:00），不建执行单` };
    if (ownBlock) actions.push({ type: 'unblock' });
    actions.push({ type: 'dispatch', stage: s, skill: stageSkill(s, l, cfg) });
    return { actions, reason: '建执行单' };
  }

  if (s === 4 || s === 6) {
    if (ticketsDone > 0) return { actions: [{ type: 'transition', to_stage: s + 1, reason: `规则推进：${STAGE_NAMES[s]}工单已完成 → ${s + 1} ${STAGE_NAMES[s + 1]}`, evidence_run_ids: [] }], reason: '工单完成，推进' };
    if (!cfg?.dev?.repo_hint) return blockResource(l, `workflow ${l.workflow_key} 未配置 dev.repo_hint，建不了${STAGE_NAMES[s]}工单`);
    return { actions: [...(ownBlock ? [{ type: 'unblock' }] : []), { type: 'dev_ticket', stage: s }], reason: `建${STAGE_NAMES[s]}工单` };
  }

  if (s === 5) {
    if (windowAllPass(l)) return { actions: [advance(l, '规则推进')], reason: '上线跑滑窗全过，推进' };
    if (!cfg) return blockResource(l, `workflow ${l.workflow_key} 未在 config/factory-workflows.json 登记`);
    if (foreignBlock) return { actions: [], reason: `资源卡点（人工标注：${l.blocked_reason || ''}），不建单` };
    if (!withinPublishHours(now, hours)) return { actions: [], reason: '发布时段外，不建上线跑工单' };
    const firstExternal = cfg.outward_external === true && !l.production_version && ticketsTotal === 0;
    return {
      actions: [
        ...(ownBlock ? [{ type: 'unblock' }] : []),
        { type: 'commander_ticket', stage: 5 },
        ...(firstExternal ? [{ type: 'block', kind: 'human_gate', reason: `${PUSHER_TAG} 对外流程首次上生产，Commander 工单已建，等人工放行（决策 cc008b7e 人工关口）` }] : []),
      ],
      reason: firstExternal ? '建上线跑工单 + 人工关口' : '建上线跑工单',
    };
  }

  // s === 7 守护
  const threshold = Math.min(cfg?.guard_fail_threshold ?? 3, l.window_k);
  const tail = tailConsecutiveFails(l.recent_runs || []);
  if (tail >= threshold) {
    const why = `规则退回：⑦守护线上连续 fail ${tail} 次（阈值 ${threshold}）→ 回 6 蒸馏`;
    return { actions: [{ type: 'transition', to_stage: 6, reason: why, evidence_run_ids: runIds(l) }, { type: 'notify', level: 'P1', message: `技能工厂守护劣化：${l.workflow_key} ${why}` }], reason: '守护劣化，退回' };
  }
  return { actions: [], reason: `守护中（尾部连续 fail ${tail}/${threshold}）` };
}

// ── 建单参数 ───────────────────────────────────────────────────────────
function deviceLine(d) {
  return `设备：node=${d.node} profile=${d.profile} serial=${d.serial}${d.ssh_host ? ` ssh_host=${d.ssh_host}` : ''}`;
}

export function buildExecSpec({ ledger: l, cfg, stage, skill, round }) {
  const candidate = l.candidate_version;
  const src = candidate && cfg.candidate_sources?.[candidate];
  const skillLines = stage === 3 || stage === 5
    ? [`使用 skill：${skill}（候选版整流程 skill，正常跑一次${src ? `；全文在 ${src}` : ''}）`]
    : [`使用 skill：${skill}`, ...(candidate ? [`被打磨的流程 skill：${candidate}${src ? `（全文在 ${src}）` : ''}`] : [])];
  const lines = [
    '【执行参数】',
    `阶段：${STAGE_NAMES[stage]}（技能工厂 stage ${stage}，推进器自动建单，第 ${round} 轮）`,
    ...skillLines,
    `台账：factory_ledger ${l.id}（workflow ${l.workflow_key}，验证口径 ${l.validation_mode}，滑窗 ${l.recent_pass}/${l.window_k}）`,
    deviceLine(cfg.device),
    ...(Array.isArray(cfg.brief) ? cfg.brief : []),
    ...(cfg.acceptance ? [`验收：${cfg.acceptance}`] : []),
    ...(cfg.delivery_contract ? [`交付：${cfg.delivery_contract}`] : ['交付：写入 result.delivery，含 run_id、claimed_result、lock_released、side_effects、final_evidence、fail_reason']),
    'run_id：由派发器生成并写进派发消息（<run_prefix>-<任务id前8位>-<上海日期>-r<轮次>），全程 --lock-owner 用它',
  ];
  return {
    title: `技能工厂 ${STAGE_NAMES[stage]} ${l.workflow_name || l.workflow_key} 第${round}轮（推进器）`,
    description: lines.join('\n'),
    task_type: 'research',
    priority: 'P1',
    trigger_source: 'manual',
    allow_unscoped: true,
    source: 'scheduler',
    source_id: `factory-pusher:${l.id}:s${stage}:r${round}`,
    created_by: 'factory-pusher',
    payload: {
      factory_dispatch: true,
      headed_manual: 'true',
      factory_ledger_id: l.id,
      agent: cfg.agent,
      skill,
      flow_skill: candidate || null,
      ...(cfg.anchor ? { anchor: cfg.anchor } : {}),
      factory: {
        stage: String(stage),
        workflow_key: l.workflow_key,
        device: { ...cfg.device },
        agent: cfg.agent,
        skill,
        round,
        run_prefix: `sf${stage}`,
        message: `技能工厂推进器第 ${round} 轮：先读任务正文【执行参数】逐条照做（只私密/单次点发布/--outward 位置/时段/锁纪律以正文为准）。`,
        ledger_id: l.id,
        candidate_version: candidate || null,
      },
    },
  };
}

export function buildTicketSpec({ ledger: l, cfg, stage, kind }) {
  const isDev = kind === 'dev';
  const what = stage === 4 ? '沉淀：把验证通过的候选版 skill 固化成契约（skill→契约）' : stage === 6 ? '蒸馏：把稳定 Step 换成脚本（Step→脚本）' : '上线跑：经 Commander（work-commander）按 workflow 真跑';
  const desc = [
    `技能工厂 stage ${stage} ${STAGE_NAMES[stage]} 工单（推进器自动建单，${isDev ? '本次只建单不自动写码' : '本次只建单，交给 work-commander 编排'}）`,
    `要做：${what}`,
    `台账：factory_ledger ${l.id}（workflow ${l.workflow_key}，候选 ${l.candidate_version || '无'}，生产 ${l.production_version || '无'}）`,
    '完成判据：本工单 completed 后推进器自动把台账推进到下一阶段',
  ].join('\n');
  const base = {
    title: `技能工厂 ${STAGE_NAMES[stage]} ${l.workflow_name || l.workflow_key}（推进器工单）`,
    description: desc,
    priority: 'P2',
    trigger_source: 'manual',
    allow_unscoped: true,
    source: 'scheduler',
    source_id: `factory-pusher:${l.id}:s${stage}:${kind}:${new Date(l.stage_changed_at).getTime()}`,
    created_by: 'factory-pusher',
    payload: {
      headed_manual: 'true',
      factory_ledger_id: l.id,
      factory_ticket_kind: kind,
      factory_ticket_stage: stage,
      ...(cfg?.anchor ? { anchor: cfg.anchor } : {}),
      ...(isDev ? {} : { factory_commander: { agent: 'work-commander', workflow_key: l.workflow_key, version: l.candidate_version || null } }),
    },
  };
  if (!isDev) return { ...base, task_type: 'research' };
  return {
    ...base,
    task_type: 'dev',
    declared_change_kind: cfg.dev.change_kind || 'capability_change',
    repo_hint: cfg.dev.repo_hint,
    map_scope_hint: cfg.dev.map_scope_hint || [],
  };
}
