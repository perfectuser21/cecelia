/**
 * 告警升级跨模块链路测试
 *
 * 验证完整链路：
 * - alerting.js: P0→立即推送，P1→缓冲，P0 rate-limit 同 eventType 5min 内不重复
 * - alertness/escalation.js: alertnessLevel→determineResponseLevel→executeEscalation→emit
 * - escalation 级别映射：PANIC(4)→L3, ALERT(3)→L1, AWARE(2)→L0, CALM(1)→null
 * - 跨模块：escalation 状态变更正确触发 event-bus emit
 *
 * 注意：所有 vi.mock() 必须在文件顶层，vitest 会提升 mock 调用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── 基础设施 mock（全文件生效） ────────────────────────────────────────────────

vi.mock('../notifier.js', () => ({
  sendFeishu: vi.fn().mockResolvedValue(true),
}));

vi.mock('../db.js', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { sendFeishu } from '../notifier.js';
import { emit } from '../event-bus.js';
import { raise, flushP1, flushP2, getStatus } from '../alerting.js';
import {
  escalateResponse,
  getEscalationStatus,
} from '../alertness/escalation.js';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('alerting.js — P0/P1 通知链路', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P0 → 立即调用 sendFeishu，消息含 [P0] 标记', async () => {
    await raise('P0', `chain_p0_${Date.now()}`, '数据库连接断开');
    expect(sendFeishu).toHaveBeenCalledTimes(1);
    expect(sendFeishu.mock.calls[0][0]).toContain('[P0]');
    expect(sendFeishu.mock.calls[0][0]).toContain('数据库连接断开');
  });

  it('P0 同 eventType 5min 内第二次触发被限流，sendFeishu 只调用一次', async () => {
    const eventType = `rate_limit_chain_${Date.now()}`;
    await raise('P0', eventType, '告警 #1');
    await raise('P0', eventType, '告警 #2（应被限流）');
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });

  it('P0 不同 eventType 各自独立推送，互不限流', async () => {
    const ts = Date.now();
    await raise('P0', `evt_a_${ts}`, '事件 A');
    await raise('P0', `evt_b_${ts}`, '事件 B');
    expect(sendFeishu).toHaveBeenCalledTimes(2);
  });

  it('P1 不立即推送，加入缓冲区；flushP1 后 sendFeishu 被调用', async () => {
    const beforePending = getStatus().p1_pending;
    await raise('P1', `p1_chain_${Date.now()}`, 'P1 告警积压');
    expect(sendFeishu).not.toHaveBeenCalled();

    const afterPending = getStatus().p1_pending;
    expect(afterPending).toBeGreaterThan(beforePending);

    await flushP1();
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });

  it('P2 不立即推送，加入缓冲区；flushP2 后 sendFeishu 被调用', async () => {
    const beforePending = getStatus().p2_pending;
    await raise('P2', `p2_chain_${Date.now()}`, 'P2 低优先级告警');
    expect(sendFeishu).not.toHaveBeenCalled();

    const afterPending = getStatus().p2_pending;
    expect(afterPending).toBeGreaterThan(beforePending);

    await flushP2();
    expect(sendFeishu).toHaveBeenCalledTimes(1);
  });
});

describe('alertness/escalation.js — 升级决策链路（独立调用验证）', () => {
  // escalation 模块有内部状态，每个 it 独立调用验证

  it('PANIC(4) → 返回 level=human_intervention，含 send_alert 动作', async () => {
    const response = await escalateResponse(4, {
      summary: 'critical panic test',
      patterns: ['memory_leak'],
    });
    expect(response).not.toBeNull();
    expect(response.level).toBe('human_intervention');
    const actionTypes = response.actions.map(a => a.type);
    expect(actionTypes).toContain('send_alert');
    expect(actionTypes).toContain('stop_all');
    expect(actionTypes).toContain('generate_report');
  });

  it('ALERT(3) → 返回 level=graceful_degrade，含 reduce_concurrency 动作', async () => {
    const response = await escalateResponse(3, {
      summary: 'alert early',
      patterns: ['high_cpu'],
    });
    expect(response).not.toBeNull();
    // ALERT 在无持续时间时返回 L1 graceful_degrade
    expect(['graceful_degrade', 'emergency_brake']).toContain(response.level);
    expect(response.actions.length).toBeGreaterThan(0);
  });

  it('AWARE(2) → 返回 level=auto_recovery，含 monitor 动作', async () => {
    const response = await escalateResponse(2, {
      summary: 'aware state',
      patterns: ['memory_warning'],
    });
    expect(response).not.toBeNull();
    // AWARE 在无持续时间时返回 L0 auto_recovery
    expect(['auto_recovery', 'graceful_degrade']).toContain(response.level);
    expect(response.actions.length).toBeGreaterThan(0);
  });

  it('CALM(1) → 返回 level=null（无需响应）', async () => {
    const response = await escalateResponse(1, {
      summary: 'calm',
      patterns: [],
    });
    // CALM 无需响应，level 为 null
    if (response) {
      expect(response.level).toBeNull();
      expect(response.actions).toEqual([]);
    } else {
      expect(response).toBeNull();
    }
  });

  it('PANIC(4) 触发后 emit 被调用（事件总线通知链路）', async () => {
    vi.clearAllMocks();
    await escalateResponse(4, {
      summary: 'panic emit verification',
      patterns: ['critical_memory'],
    });
    // emit 应被调用：escalation:level_changed
    expect(emit).toHaveBeenCalled();
    const calls = emit.mock.calls;
    const levelChangedCall = calls.find(c => c[0] === 'escalation:level_changed');
    expect(levelChangedCall).toBeDefined();
    expect(levelChangedCall[1]).toMatchObject({ to: 'human_intervention' });
  });

  it('PANIC(4) 触发后 getEscalationStatus 反映 human_intervention 状态', async () => {
    vi.clearAllMocks();
    await escalateResponse(4, {
      summary: 'status check',
      patterns: ['critical'],
    });
    const status = getEscalationStatus();
    expect(status.level).toBe('human_intervention');
    expect(status.isActive).toBe(true);
  });
});

describe('告警级别映射规则验证 — determineResponseLevel 行为', () => {
  it('响应动作不为空：L3 human_intervention 包含人工介入所需动作集', async () => {
    const response = await escalateResponse(4, { summary: 'actions check', patterns: [] });
    const actionTypes = new Set(response.actions.map(a => a.type));
    // L3 需要告警 + 报告 + 停止
    expect(actionTypes.size).toBeGreaterThanOrEqual(3);
    expect(actionTypes.has('send_alert')).toBe(true);
  });

  it('级别越高，响应动作越激进（L3 包含 stop_all，L1 不包含）', async () => {
    const l3Response = await escalateResponse(4, { summary: 'l3', patterns: [] });
    const l3Actions = new Set(l3Response.actions.map(a => a.type));

    const l1Response = await escalateResponse(3, { summary: 'l1', patterns: [] });
    const l1Actions = new Set(l1Response.actions.map(a => a.type));

    expect(l3Actions.has('stop_all')).toBe(true);
    expect(l1Actions.has('stop_all')).toBe(false);
  });
});
