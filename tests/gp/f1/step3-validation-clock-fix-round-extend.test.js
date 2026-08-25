// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：validation clock ↔ orchestrator_decision_log fix 轮时序
//
// r50/r51 生产实证（手术实录）：resolveValidationClock 的 pipeline deadline 以最早
// `spawn:generator` 原点起算固定 timeout_seconds（默认 5400s）。fix 轮多的长跑 run
// 在管线仍健康推进（不断派发 `spawn:generator-fix`）时撞死固定 deadline，被判
// automation_deadline_exceeded，人工只能 psql 续命。
//
// 修法（本批 r71）：让 clock 随每次 `spawn:generator-fix` 派发自动顺延、且有界：
//   a) clock 原点从「最早 generator」改为「最后一次 spawn:generator-fix」（deadline =
//      该 fix 行 created_at + timeout_seconds）；
//   b) 顺延有界——上限 6 次，第 7 次起原点冻结在第 6 次 fix（超限照常判死）；
//   c) 纯函数可重放——只依赖 decisionLog 行 hop 时序，fix 行乱序/重复 hop 以 hop 升序取最后
//      一个合法 fix 行；
//   d) 无 fix 轮语义完全不变（回归现状 = 首个 generator 起点）。
//
// 按 GP 产物闸规矩写在边上：真 import validation-clock.js，禁 mock 被改的边
// （resolveValidationClock ↔ decisionLog 行 shape 是本单被改的边，用真实行对象，不 mock）。
import { describe, it, expect } from 'vitest';
import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400; // 90 分钟（PRD 明确不改默认值）

// r50 场景：起点在 5400s 前，途中多次 fix 轮把管线推进到较晚时刻
const GEN = '2026-08-25T00:00:00.000Z';
const GEN_DEADLINE = '2026-08-25T01:30:00.000Z'; // 旧原点 deadline（早已过期 → 旧实现判死）
const FIX1 = '2026-08-25T01:20:00.000Z';
const FIX2 = '2026-08-25T02:40:00.000Z';
const FIX3 = '2026-08-25T04:00:00.000Z';
const NEW_STARTED = FIX3;
const NEW_DEADLINE = '2026-08-25T05:30:00.000Z'; // 04:00 + 5400s，仍在未来 → 新实现存活

// 真实 decisionLog 行形状：generator 行带持久化 clock，fix 行带 reason（不 mock 被改的边）
const genRow = (overrides = {}) => ({
  hop: 10,
  action: 'spawn:generator',
  created_at: GEN,
  detail: { pipeline_started_at: GEN, deadline_at: GEN_DEADLINE, reason: 'contract_approved' },
  ...overrides,
});
const fixRow = (hop, createdAt) => ({
  hop,
  action: 'spawn:generator-fix',
  created_at: createdAt,
  detail: { reason: 'red_fix' },
});

describe('resolveValidationClock — fix 轮自动顺延（有界）[r71]', () => {
  it('RED先行 复刻 r50 场景 起点5400s前多次fix 新实现顺延存活', () => {
    // 旧实现：原点=首个 generator → deadline=01:30（已过期，run 被判死）
    // 新实现：原点=最后一次 fix(FIX3) → deadline=05:30（未来，run 存活）
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), fixRow(20, FIX1), fixRow(30, FIX2), fixRow(40, FIX3)],
      intentAt: '2026-08-25T04:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: NEW_STARTED, deadline_at: NEW_DEADLINE });
    // 显式反证旧判死原点不再被返回
    expect(clock.deadline_at).not.toBe(GEN_DEADLINE);
  });

  it('新派发 spawn:generator-fix 也以最后一次fix为新原点顺延', () => {
    // 下游动作与新一轮 fix 派发本身都必须拿到顺延后的 clock
    const clock = resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog: [genRow(), fixRow(20, FIX1), fixRow(30, FIX2), fixRow(40, FIX3)],
      intentAt: '2026-08-25T04:10:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: NEW_STARTED, deadline_at: NEW_DEADLINE });
  });

  it('spawn:judge 下游复用同一顺延后原点', () => {
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [genRow(), fixRow(20, FIX1), fixRow(30, FIX2), fixRow(40, FIX3)],
      intentAt: '2026-08-25T04:20:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: NEW_STARTED, deadline_at: NEW_DEADLINE });
  });

  it('有界 顺延满6次后照常判死 第7次fix不再顺延原点冻结第6次', () => {
    // 7 个 fix：01:00..07:00（整点）。原点冻结在第 6 次 fix = 06:00，deadline = 07:30
    const fixes = [
      fixRow(20, '2026-08-25T01:00:00.000Z'),
      fixRow(30, '2026-08-25T02:00:00.000Z'),
      fixRow(40, '2026-08-25T03:00:00.000Z'),
      fixRow(50, '2026-08-25T04:00:00.000Z'),
      fixRow(60, '2026-08-25T05:00:00.000Z'),
      fixRow(70, '2026-08-25T06:00:00.000Z'), // 第 6 次 fix（原点冻结点）
      fixRow(80, '2026-08-25T07:00:00.000Z'), // 第 7 次 fix（不再顺延）
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), ...fixes],
      intentAt: '2026-08-25T07:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-25T06:00:00.000Z',
      deadline_at: '2026-08-25T07:30:00.000Z',
    });
    // 第 7 次 fix(07:00) 不得成为原点
    expect(clock.pipeline_started_at).not.toBe('2026-08-25T07:00:00.000Z');
  });

  it('边界 恰好第6次fix仍顺延原点取第6次', () => {
    const fixes = [
      fixRow(20, '2026-08-25T01:00:00.000Z'),
      fixRow(30, '2026-08-25T02:00:00.000Z'),
      fixRow(40, '2026-08-25T03:00:00.000Z'),
      fixRow(50, '2026-08-25T04:00:00.000Z'),
      fixRow(60, '2026-08-25T05:00:00.000Z'),
      fixRow(70, '2026-08-25T06:00:00.000Z'), // 第 6 次 fix = 最后一次，仍顺延
    ];
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow(), ...fixes],
      intentAt: '2026-08-25T06:05:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({
      pipeline_started_at: '2026-08-25T06:00:00.000Z',
      deadline_at: '2026-08-25T07:30:00.000Z',
    });
  });

  it('纯函数可重放 fix行乱序重复hop以hop升序取最后合法fix', () => {
    // 数组顺序打乱，但以 hop 升序判定最后一个 fix = hop 40 (FIX3)
    const scrambled = [fixRow(40, FIX3), genRow(), fixRow(20, FIX1), fixRow(30, FIX2)];
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: scrambled,
      intentAt: '2026-08-25T04:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: NEW_STARTED, deadline_at: NEW_DEADLINE });
    // 可重放：同输入不同数组顺序结果一致
    const reordered = [genRow(), fixRow(30, FIX2), fixRow(40, FIX3), fixRow(20, FIX1)];
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: reordered,
      intentAt: '2026-08-25T04:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    })).toEqual(clock);
  });

  it('回归 无fix轮语义不变 原点=首个generator持久化clock', () => {
    const clock = resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [genRow()],
      intentAt: '2026-08-25T00:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: GEN, deadline_at: GEN_DEADLINE });
  });

  it('回归 无fix轮 pre-fix in-flight run 从首个generator created_at 恢复', () => {
    const clock = resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog: [{ hop: 10, action: 'spawn:generator', created_at: GEN, detail: { reason: 'contract_approved' } }],
      intentAt: '2026-08-25T00:30:00.000Z',
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual({ pipeline_started_at: GEN, deadline_at: GEN_DEADLINE });
  });
});
