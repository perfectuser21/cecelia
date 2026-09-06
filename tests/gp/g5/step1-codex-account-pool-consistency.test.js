// G5「管家 · 算力与基础设施调度」步骤 1「接单即选到有额度的执行体」
// —— 边：llm-caller 选 Codex OAuth 账号
//
// Regression: Codex 账号池两处定义漂移，三个满额度账号从未被调用
//
// 现场（2026-09-06 实测）：
//   llm-capacity.js  CODEX_ACCOUNTS   登记 team1~team5（5 个）——容量统计看得到 5 个
//   llm-caller.js    CODEX_TEAM_HOMES 只有 team1、team2（2 个）——实际调用只轮 2 个
// 后果：T1 5h 打满 100%、T2 7d 17%，而 T3/T4/T5 的 5h 与 7d 全部 0%，
// 三个满额度 Team 账号从头到尾没被派过一次活；调度侧还以为有 5 个账号的容量。
// 连 callCodexHeadless 的报错文案都写死「team1/team2 全部掉线」，掩盖了池子只有 2 个的事实。
//
// 本测试锁死的不变量：**调用池必须覆盖容量登记表的全部账号**。
// 这条断言的价值不在于"现在是 5 个"，而在于两处再次漂移时立刻红——
// 单纯把 team3/4/5 补进数组治不了本，下次加 team6 照样会漏。
import { describe, it, expect } from 'vitest';
import { CODEX_ACCOUNTS } from '../../../packages/brain/src/llm-capacity.js';
import { CODEX_TEAM_HOMES } from '../../../packages/brain/src/llm-caller.js';

describe('G5 step1 · Codex 账号池与容量登记表一致性', () => {
  it('容量登记表 CODEX_ACCOUNTS 可被外部引用（单一来源前提）', () => {
    expect(Array.isArray(CODEX_ACCOUNTS)).toBe(true);
    expect(CODEX_ACCOUNTS.length).toBeGreaterThanOrEqual(5);
    for (const a of CODEX_ACCOUNTS) {
      expect(a.vendor).toBe('codex');
      expect(typeof a.home).toBe('string');
      expect(a.home.length).toBeGreaterThan(0);
    }
  });

  it('调用池 CODEX_TEAM_HOMES 被导出（否则无法机械校验，漂移只能靠人眼）', () => {
    expect(Array.isArray(CODEX_TEAM_HOMES)).toBe(true);
  });

  // 核心断言：一个都不能少
  it('调用池覆盖容量登记表的每一个账号 home', () => {
    const registered = CODEX_ACCOUNTS.map((a) => a.home);
    const missing = registered.filter((h) => !CODEX_TEAM_HOMES.includes(h));
    expect(missing).toEqual([]);
  });

  it('调用池不含容量登记表之外的野账号（反向也不许漂）', () => {
    const registered = new Set(CODEX_ACCOUNTS.map((a) => a.home));
    const extra = CODEX_TEAM_HOMES.filter((h) => !registered.has(h));
    expect(extra).toEqual([]);
  });

  it('team3/team4/team5 确实在调用池里（本次事故的三个账号）', () => {
    for (const name of ['team3', 'team4', 'team5']) {
      const acct = CODEX_ACCOUNTS.find((a) => a.name === name);
      expect(acct, `${name} 应登记在 CODEX_ACCOUNTS`).toBeTruthy();
      expect(CODEX_TEAM_HOMES, `${name} 应在调用池`).toContain(acct.home);
    }
  });
});
