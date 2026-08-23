// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：validation clock ↔ orchestrator_decision_log 的 fix 轮时序
//
// 冻结测试（TDD Red）：resolveValidationClock 按 fix 轮自动顺延（有界）[r55]
//
// r50/r51 案卷实证：resolveValidationClock 的 pipeline deadline 永远锚定「hop 最小」的首个
// generator 系 spawn，fix 轮多的 run（CI 红→fix→评→judge 循环 3+ 轮）在管线仍健康推进时就
// 撞死，人工只能 psql 手改 orchestrator_decision_log 的 pipeline_started_at/deadline_at 续命。
// 本 sprint 让时钟在每次 spawn:generator-fix 派发成功时以「最新的 generator 系 spawn」为新原点
// 重新起算 timeout_seconds；顺延有界（每 run 上限 6 次），超上限不再顺延、到期照常判死。
//
// 按产物闸规矩写在被改的边上：真 import 被改模块（validation-clock.js），**不 vi.mock**
// resolveValidationClock 也不 mock decisionLog 数据源；顺延判定为纯函数，只喂 decisionLog 行。
//
// 模块真身锚定（sprint-prd ASSUMPTION 已核实）：resolveValidationClock 定义并 export 于
// packages/brain/src/orchestrator/validation-clock.js（loop.js 仅 import、不 re-export）。
import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../../../packages/brain/src/orchestrator/validation-clock.js';

const TIMEOUT = 5400; // 默认 5400s = 90min = 1.5h（本 sprint 不改默认值）
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-08-20T00:00:00.000Z'); // 首个 spawn:generator 时刻

// created_at 为「NOW()-Nh」的绝对时刻；hop 递增反映派发时序。
function at(hoursAfterT0) {
  return new Date(T0 + hoursAfterT0 * HOUR).toISOString();
}
function deadlineFrom(startedIso) {
  return new Date(Date.parse(startedIso) + TIMEOUT * 1000).toISOString();
}

// 构造首 generator + N 轮 fix 的 orchestrator_decision_log（每行只带 created_at + reason，
// 与「recovers a pre-fix in-flight run」既有范式一致，让 persistedClock 落到 created_at 分支，
// 使唯一改变结果的变量是「选中哪一行作为原点」，从而纯粹检验顺延选点逻辑）。
function log(fixRounds, { fixDetailOverride = null } = {}) {
  const rows = [
    { hop: 10, action: 'spawn:generator', created_at: at(0), detail: { reason: 'contract_approved' } },
  ];
  for (let i = 1; i <= fixRounds; i += 1) {
    const isLast = i === fixRounds;
    rows.push({
      hop: 10 + i * 10,
      action: 'spawn:generator-fix',
      created_at: at(i),
      detail: isLast && fixDetailOverride ? fixDetailOverride : { reason: 'ci_red_fix' },
    });
  }
  return rows;
}

describe('resolveValidationClock 按 fix 轮自动顺延（有界）[r55]', () => {
  it('r50 复刻：两轮 fix 后时钟顺延至最新 generator-fix 存活', () => {
    // 2 轮 fix：原窗口以 T0 起算 5400s（旧行为撞死），新行为以第 2 轮 fix（最新 generator 系
    // spawn，created_at=T0+2h）为新原点重新起算。
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: log(2),
      intentAt: at(3),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock.pipeline_started_at).toBe(at(2));
    expect(clock.deadline_at).toBe(deadlineFrom(at(2)));
    // 旧行为（锚定首 generator）的 deadline 必须已被顺延甩开
    expect(clock.deadline_at).not.toBe(deadlineFrom(at(0)));
  });

  it('顺延重新起算：忽略 fix 行陈旧 persisted 时钟以其 spawn 时刻为新原点', () => {
    // 生产实况：buggy 代码把「首窗 T0 时钟」persist 进每一行 detail。最新 fix 行 detail 携带
    // 陈旧的 {pipeline_started_at:T0, deadline_at:T0+5400}。顺延必须以该行 created_at(T0+2h)
    // 「重新起算」，而不是复用其陈旧 persisted deadline —— 堵「选新行却仍 persistedClock」假绿。
    const staleDetail = {
      pipeline_started_at: at(0),
      deadline_at: deadlineFrom(at(0)),
    };
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: log(2, { fixDetailOverride: staleDetail }),
      intentAt: at(3),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock.pipeline_started_at).toBe(at(2));
    expect(clock.deadline_at).toBe(deadlineFrom(at(2)));
    // 绝不能回落到 fix 行 detail 里的陈旧首窗 deadline
    expect(clock.deadline_at).not.toBe(deadlineFrom(at(0)));
  });

  it('顺延有界：超过 6 次上限后锚定第 6 次 fix 不再前移', () => {
    // 7 轮 fix：顺延上限 6，锚定第 6 轮 fix（created_at=T0+6h），第 7 轮不再顺延，
    // 到期照常判死（deadline 停在第 6 轮 + 5400s，不前移到第 7 轮）。
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: log(7),
      intentAt: at(8),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock.pipeline_started_at).toBe(at(6));
    expect(clock.deadline_at).toBe(deadlineFrom(at(6)));
    // 负向：不得顺延到第 7 轮 fix（防无限续命）
    expect(clock.deadline_at).not.toBe(deadlineFrom(at(7)));
  });

  it('无 fix 轮时窗口语义不变仍锚定首个 generator', () => {
    // 只有首 spawn:generator（携带 persisted 首窗时钟），无 spawn:generator-fix →
    // 顺延次数 0，语义不变，仍复用首 generator 的 persisted clock。
    const persisted = {
      pipeline_started_at: at(0),
      deadline_at: deadlineFrom(at(0)),
    };
    const clock = resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [
        { hop: 10, action: 'spawn:generator', created_at: at(0), detail: persisted },
      ],
      intentAt: at(1),
      timeoutSeconds: TIMEOUT,
    });
    expect(clock).toEqual(persisted);
  });

  it('纯函数可重放：同一 decisionLog 两次调用结果一致', () => {
    // 顺延判定只依赖 decisionLog 行（hop 时序），禁 Date.now 之外的墙钟状态 →
    // 同一输入必得同一时钟。
    const decisionLog = log(3);
    const first = resolveValidationClock({
      action: 'spawn:judge', decisionLog, intentAt: at(4), timeoutSeconds: TIMEOUT,
    });
    const second = resolveValidationClock({
      action: 'spawn:judge', decisionLog, intentAt: at(9), timeoutSeconds: TIMEOUT,
    });
    expect(second).toEqual(first);
  });
});
