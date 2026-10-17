import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cannotVerifyAccepted, qaAcceptanceContext } from '../lib/cv-accepted.mjs';

let dir, cfg;
const current = { taskId: '11111111-1111-4111-8111-111111111111',
  sprintDir: 'sprints/10171320-cw-11111111', head: 'a'.repeat(40),
  specSha256: 'b'.repeat(64), executionContextSha256: 'c'.repeat(64), round: 2 };
const item = { id: 'T-2', covers: ['Q-1'], reason: '预览缺少 ffprobe' };
const scope = () => ({ schema_version: 1, task_id: current.taskId, sprint_dir: current.sprintDir,
  head: current.head, spec_sha256: current.specSha256,
  execution_context_sha256: current.executionContextSha256,
  source_qa_stage_event_id: '22222222-2222-4222-8222-222222222222',
  source_round: 1, applies_to_round: 2, items: [{ ...item }] });
function seed({ bound = true, verdict = '维持规格', scopePatch = {}, original = item } = {}) {
  const intervention = { n: 1, kind: 'qa', action: 'resume',
    escalation: { type: 'qa_cannot_verify', round: 1, cannot_verify: [original] },
    rulings: [{ issue: original.id, verdict, reason: '该环境能力限制已明确' }],
    ...(bound ? { cv_scope: { ...scope(), ...scopePatch } } : {}) };
  fs.writeFileSync(path.join(dir, 'commander-77.json'), JSON.stringify({ interventions: [intervention] }));
}
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-cv-bound-'));cfg = { logDir: dir }; });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CANNOT_VERIFY 的旧裁决只匹配明确问题与执行合同', () => {
  it('相同环境模型与产品合同下可信执行控制器身份变化必须改变上下文摘要', () => {
    const sprint = path.join(dir, current.sprintDir); fs.mkdirSync(sprint, { recursive: true });
    fs.writeFileSync(path.join(sprint, '02-spec.md'), '固定规格');
    const qa = { env: { kind: 'preview', url: 'http://127.0.0.1:5300', transport: 'loopback' }, provider: 'codex', model: 'local-stub' };
    const stage = '22222222-2222-4222-8222-222222222222';
    const first = qaAcceptanceContext(dir, current, current.head, 2, qa, stage, 'a'.repeat(64));
    const changed = qaAcceptanceContext(dir, current, current.head, 2, qa, stage, 'b'.repeat(64));
    expect(first.specSha256).toBe(changed.specSha256);
    expect(first.executionContextSha256).not.toBe(changed.executionContextSha256);
  });
  it('旧 covers-only 接受记录不证明本轮问题已被裁决', () => {
    seed({ bound: false });
    expect(cannotVerifyAccepted(cfg, 77, [item], current)).toBeNull();
  });
  it('同一 Q 换成新原因不能沿用旧接受', () => {
    seed();
    expect(cannotVerifyAccepted(cfg, 77, [{ ...item, reason: '读取历史报告被策略禁止' }], current)).toBeNull();
  });
  it.each([
    ['taskId', '33333333-3333-4333-8333-333333333333'],
    ['sprintDir', 'sprints/10171320-cw-33333333'],
    ['head', 'd'.repeat(40)], ['specSha256', 'e'.repeat(64)],
    ['executionContextSha256', 'f'.repeat(64)], ['round', 3],
  ])('%s 变化必须重新取得本轮实际验证', (key, value) => {
    seed();
    expect(cannotVerifyAccepted(cfg, 77, [item], { ...current, [key]: value })).toBeNull();
  });
  it('没有当前可信上下文不能由模型条目自行选择旧豁免', () => {
    seed();
    expect(cannotVerifyAccepted(cfg, 77, [item])).toBeNull();
  });
  it('明确同问题、同合同和授权的下一轮仅返回处置匹配事实', () => {
    seed();
    expect(cannotVerifyAccepted(cfg, 77, [item], current)).toEqual(['T-2']);
    expect(item.reason).toBe('预览缺少 ffprobe');
  });
  it('没有真实原 QA stage 身份的 scope 不能成为接受凭据', () => {
    seed({ scopePatch: { source_qa_stage_event_id: null } });
    expect(cannotVerifyAccepted(cfg, 77, [item], current)).toBeNull();
  });
});
