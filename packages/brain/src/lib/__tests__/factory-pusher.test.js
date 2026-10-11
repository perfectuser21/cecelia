/** 技能工厂推进器纯规则（任务 a5f42455）：推进、清零、退回、卡点不越过、在途去重、时段外不建单、建单契约。 */
import { describe, it, expect } from 'vitest';
import { decideLedger, withinPublishHours, buildExecSpec, buildTicketSpec, tailConsecutiveFails, PUSHER_TAG } from '../factory-pusher.js';
import { checkTransition } from '../factory-ledger.js';
import { resolveWorkflowConfig } from '../factory-workflow-config.js';
import { parseFactoryContract } from '../../../scripts/factory-dispatcher/factory-dispatcher.js';

const cfg = resolveWorkflowConfig('douyin_video_publish.android');
const DAY = new Date('2026-10-11T06:00:00Z'); // 上海 14:00
const NIGHT = new Date('2026-10-11T16:30:00Z'); // 上海 00:30
const run = (id, pass, extra = {}) => ({ run_id: id, pass, ...extra });
const L = (over = {}) => ({
  id: '1b5a0be0-f0b2-4960-af44-f09790a039c1', workflow_key: 'douyin_video_publish.android', workflow_name: '抖音 · 视频发布（安卓真机）',
  stage: 3, validation_mode: 'use_while_validate', window_k: 3, recent_runs: [], recent_pass: 0, recent_total: 0,
  candidate_version: 'android-douyin-private-video@1.0.8', production_version: null, blocked_kind: 'none', blocked_reason: null,
  next_action: null, stage_changed_at: '2026-10-11T09:01:48.958Z', ...over,
});
const types = (d) => d.actions.map((a) => a.type);

describe('跑验类 1/2/3', () => {
  it('无在途、不卡、时段内 → 建执行单（stage 3 用候选版本）', () => {
    const d = decideLedger({ ledger: L(), cfg, now: DAY });
    expect(types(d)).toEqual(['dispatch']);
    expect(d.actions[0]).toMatchObject({ stage: 3, skill: 'android-douyin-private-video@1.0.8' });
  });
  it('stage 1 用 skill-explore、stage 2 用 skill-boundary', () => {
    expect(decideLedger({ ledger: L({ stage: 1 }), cfg, now: DAY }).actions[0].skill).toBe('skill-explore');
    expect(decideLedger({ ledger: L({ stage: 2 }), cfg, now: DAY }).actions[0].skill).toBe('skill-boundary');
  });
  it('滑窗满且全过 → rule 推进到下一阶段（带证据 run_id）', () => {
    const runs = [run('a', true), run('b', true), run('c', true)];
    const d = decideLedger({ ledger: L({ recent_runs: runs, recent_pass: 3, recent_total: 3 }), cfg, now: NIGHT });
    expect(d.actions).toEqual([expect.objectContaining({ type: 'transition', to_stage: 4, evidence_run_ids: ['a', 'b', 'c'] })]);
  });
  it('滑窗里出现 fail → 清零重来并继续建单', () => {
    const d = decideLedger({ ledger: L({ recent_runs: [run('a', true), run('b', false)], recent_pass: 1, recent_total: 2 }), cfg, consecutiveFails: 1, now: DAY });
    expect(types(d)).toEqual(['reset_window', 'dispatch']);
    expect(d.actions[0].evidence_run_ids).toEqual(['b']);
  });
  it('stage 3 连续失败达阈值（默认 3）→ 退回 2；未达阈值只清零', () => {
    const ledger = L({ recent_runs: [run('c', false)], recent_pass: 0, recent_total: 1 });
    expect(decideLedger({ ledger, cfg, consecutiveFails: 3, now: DAY }).actions).toEqual([expect.objectContaining({ type: 'transition', to_stage: 2 })]);
    expect(types(decideLedger({ ledger, cfg, consecutiveFails: 2, now: DAY }))).toEqual(['reset_window', 'dispatch']);
    expect(types(decideLedger({ ledger, cfg: { ...cfg, retreat_fail_threshold: 2 }, consecutiveFails: 2, now: DAY }))).toEqual(['transition']);
  });
  it('stage 2 出现 fail 不退回（只清零），因为 rule 不许 2→1', () => {
    const d = decideLedger({ ledger: L({ stage: 2, recent_runs: [run('x', false)], recent_pass: 0, recent_total: 1 }), cfg, consecutiveFails: 9, now: DAY });
    expect(types(d)).toEqual(['reset_window', 'dispatch']);
    expect(checkTransition({ from: 2, to: 1, actor: 'rule' }).ok).toBe(false);
  });
  it('人工关口 / 安全红线 → 不动（滑窗全过也不推进）；台账层 rule 越过即 409 码', () => {
    for (const kind of ['human_gate', 'safety']) {
      const d = decideLedger({ ledger: L({ blocked_kind: kind, recent_runs: [run('a', true), run('b', true), run('c', true)], recent_pass: 3, recent_total: 3 }), cfg, now: DAY });
      expect(d.actions).toEqual([]);
      expect(checkTransition({ from: 3, to: 4, actor: 'rule', blockedKind: kind })).toMatchObject({ ok: false, code: 'BLOCKED_NEEDS_HUMAN' });
    }
  });
  it('有在途单 → 不建第二张（同行最多 1 张在途）', () => {
    const d = decideLedger({ ledger: L(), cfg, inFlight: { id: 't1', status: 'in_progress' }, now: DAY });
    expect(d.actions).toEqual([]);
    expect(d.keep).toBe('t1');
  });
  it('发布时段外不建执行单（但滑窗清零照做）', () => {
    expect(decideLedger({ ledger: L(), cfg, now: NIGHT }).actions).toEqual([]);
    expect(types(decideLedger({ ledger: L({ recent_runs: [run('b', false)], recent_pass: 0, recent_total: 1 }), cfg, now: NIGHT }))).toEqual(['reset_window']);
  });
  it('取不到配置 / 设备 / 候选版本 → blocked_kind=resource 写原因，不猜；原因不变不重复写', () => {
    const d = decideLedger({ ledger: L(), cfg: null, now: DAY });
    expect(d.actions).toEqual([expect.objectContaining({ type: 'block', kind: 'resource' })]);
    expect(d.actions[0].reason.startsWith(PUSHER_TAG)).toBe(true);
    const noDev = decideLedger({ ledger: L(), cfg: { ...cfg, device: { node: 'n' } }, now: DAY });
    expect(noDev.actions[0].reason).toContain('profile/serial');
    const noCand = decideLedger({ ledger: L({ candidate_version: null }), cfg, now: DAY });
    expect(noCand.actions[0].reason).toContain('candidate_version');
    const again = decideLedger({ ledger: L({ blocked_kind: 'resource', blocked_reason: d.actions[0].reason }), cfg: null, now: DAY });
    expect(again.actions).toEqual([]);
  });
  it('推进器自己标的资源卡点，配置补齐后自动解除再建单；人工标的资源卡点不碰', () => {
    expect(types(decideLedger({ ledger: L({ blocked_kind: 'resource', blocked_reason: `${PUSHER_TAG} 缺设备` }), cfg, now: DAY }))).toEqual(['unblock', 'dispatch']);
    expect(decideLedger({ ledger: L({ blocked_kind: 'resource', blocked_reason: '手机送修' }), cfg, now: DAY }).actions).toEqual([]);
  });
});

describe('4/5/6/7', () => {
  it('4 沉淀 / 6 蒸馏：建 /dev 工单；工单完成后推进', () => {
    expect(types(decideLedger({ ledger: L({ stage: 4 }), cfg, now: NIGHT }))).toEqual(['dev_ticket']);
    expect(decideLedger({ ledger: L({ stage: 6 }), cfg, ticketsDone: 1, now: DAY }).actions).toEqual([expect.objectContaining({ type: 'transition', to_stage: 7 })]);
  });
  it('5 上线跑：建 Commander 工单；对外首次上生产加人工关口；内部流程不加', () => {
    expect(types(decideLedger({ ledger: L({ stage: 5 }), cfg, now: DAY }))).toEqual(['commander_ticket']);
    const ext = decideLedger({ ledger: L({ stage: 5 }), cfg: { ...cfg, outward_external: true }, now: DAY });
    expect(types(ext)).toEqual(['commander_ticket', 'block']);
    expect(ext.actions[1].kind).toBe('human_gate');
    expect(types(decideLedger({ ledger: L({ stage: 5 }), cfg: { ...cfg, outward_external: true }, ticketsTotal: 1, now: DAY }))).toEqual(['commander_ticket']);
  });
  it('7 守护：尾部连续 fail 达阈值 → 退回 6 并告警；safe_stop 不计', () => {
    const bad = [run('a', true), run('b', false), run('c', false), run('d', false)];
    const d = decideLedger({ ledger: L({ stage: 7, window_k: 5, recent_runs: bad, recent_pass: 1, recent_total: 4 }), cfg, now: DAY });
    expect(types(d)).toEqual(['transition', 'notify']);
    expect(d.actions[0].to_stage).toBe(6);
    expect(tailConsecutiveFails([run('a', false), run('b', false, { safe_stop: true }), run('c', false)])).toBe(2);
    expect(decideLedger({ ledger: L({ stage: 7, window_k: 5, recent_runs: [run('a', false), run('b', true)], recent_pass: 1, recent_total: 2 }), cfg, now: DAY }).actions).toEqual([]);
  });
});

describe('时段与建单契约', () => {
  it('上海 09:00–23:00 为发布时段', () => {
    expect(withinPublishHours(new Date('2026-10-11T01:00:00Z'))).toBe(true); // 09:00
    expect(withinPublishHours(new Date('2026-10-11T00:59:00Z'))).toBe(false); // 08:59
    expect(withinPublishHours(new Date('2026-10-11T15:00:00Z'))).toBe(false); // 23:00
  });
  it('stage 3 执行单：派发器能解析契约，正文含实测要求的全部纪律', () => {
    const spec = buildExecSpec({ ledger: L(), cfg, stage: 3, skill: 'android-douyin-private-video@1.0.8', round: 1 });
    const parsed = parseFactoryContract({ payload: spec.payload });
    expect(parsed.ok).toBe(true);
    expect(parsed.contract).toMatchObject({ stage: '3', agent: 'skill-factory', skill: 'android-douyin-private-video@1.0.8', workflow_key: 'douyin_video_publish.android' });
    expect(parsed.contract.device).toEqual({ node: 'XIAN-M4-PHONE', profile: 'xiaolongxia', serial: 'ANGYVB4311010223', ssh_host: 'xian-m4' });
    for (const s of ['只私密发布', '单次点发布', '--outward publish` 必须放在子命令及其参数（COMMAND）之后', '第18轮', '09:00–23:00', '派发器代领', '5f00cf51'])
      expect(spec.description).toContain(s);
    expect(spec.payload).toMatchObject({ factory_dispatch: true, headed_manual: 'true', factory_ledger_id: L().id });
    expect(spec.source_id).toBe(`factory-pusher:${L().id}:s3:r1`);
  });
  it('/dev 工单照建单五坑：change_kind / repo_hint 完整 URL / map_scope_hint / manual + headed_manual', () => {
    const spec = buildTicketSpec({ ledger: L({ stage: 4 }), cfg, stage: 4, kind: 'dev' });
    expect(spec.task_type).toBe('dev');
    expect(spec.declared_change_kind).toBe('capability_change');
    expect(spec.repo_hint).toMatch(/^https:\/\/github\.com\//);
    expect(spec.map_scope_hint).toEqual(['factory']);
    expect(spec.trigger_source).toBe('manual');
    expect(spec.payload.headed_manual).toBe('true');
    expect(spec.payload.factory_dispatch).toBeUndefined();
  });
});
