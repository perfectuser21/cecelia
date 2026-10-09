/**
 * 测试 callCodexHeadless OAuth team 账号轮换
 * 验证：不再注入 OPENAI_API_KEY，改用 CODEX_HOME 选择 OAuth 账号
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// 读取源码做静态检查
const SRC = readFileSync(new URL('../llm-caller.js', import.meta.url), 'utf8');

describe('callCodexHeadless OAuth team 轮换', () => {
  it('源码不含 OPENAI_API_KEY: apiKey 强制注入', () => {
    expect(SRC).not.toContain('OPENAI_API_KEY: apiKey');
  });

  it('源码不含 CODEX_API_KEY: apiKey 强制注入', () => {
    expect(SRC).not.toContain('CODEX_API_KEY: apiKey');
  });

  it('源码包含 CODEX_TEAM_HOMES 定义', () => {
    expect(SRC).toContain('CODEX_TEAM_HOMES');
  });

  it('源码包含 getNextCodexTeamHome 函数', () => {
    expect(SRC).toContain('getNextCodexTeamHome');
  });

  it('源码包含 CODEX_HOME 赋值', () => {
    expect(SRC).toContain('env.CODEX_HOME = teamHome');
  });

  it('源码包含删除 OPENAI_API_KEY 逻辑', () => {
    expect(SRC).toContain('delete env.OPENAI_API_KEY');
  });

  it('源码不应再包含 fallback 到 API key 的逻辑（2026-09-02 已禁止，防止重新引入按量计费）', () => {
    // 曾经的危险模式：无可用 team 账号时把 apiKey 塞进 env 直接计费调用 codex，
    // 期间静默烧掉约 24 美元。修复后应直接抛错，绝不能再把 apiKey 赋值给
    // env.OPENAI_API_KEY / env.CODEX_API_KEY。
    expect(SRC).not.toContain('env.OPENAI_API_KEY = apiKey');
    expect(SRC).not.toContain('env.CODEX_API_KEY = apiKey');
  });
});

describe('getNextCodexTeamHome round-robin 逻辑', () => {
  it('轮换池实际包含 team1 与 team2 的账号目录', async () => {
    // 原断言检查源码里出现字面量 '.codex-team1'/'.codex-team2'。
    // 2026-09-06 起 CODEX_TEAM_HOMES 改为从 llm-capacity.js 的 CODEX_ACCOUNTS 派生
    // （修的是 llm-caller 只有 team1/team2 而登记表有 5 个、T3/T4/T5 从未被调用），
    // 源码里不再出现这些字面量。改成断运行时真实值——比断源码文本更强：
    // 派生写错、登记表被删账号，这条都会红，而文本断言只能看见字符串在不在。
    const { CODEX_TEAM_HOMES } = await import('../llm-caller.js');
    expect(CODEX_TEAM_HOMES).toContain(join(homedir(), '.codex-team1'));
    expect(CODEX_TEAM_HOMES).toContain(join(homedir(), '.codex-team2'));
  });

  it('auth.tokens 是选择 team 账号的条件', () => {
    expect(SRC).toContain('auth.tokens');
  });

  it('round-robin：_codexTeamIndex 递增', () => {
    expect(SRC).toContain('_codexTeamIndex');
    expect(SRC).toContain('% CODEX_TEAM_HOMES.length');
  });
});
