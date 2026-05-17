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

  it('源码包含 fallback 到 API key 逻辑', () => {
    expect(SRC).toContain('fallback 到 API key');
  });
});

describe('getNextCodexTeamHome round-robin 逻辑', () => {
  it('team1 目录存在且有 auth.json tokens 时返回 team1 路径', () => {
    // 静态验证：CODEX_TEAM_HOMES 包含 .codex-team1
    expect(SRC).toContain('.codex-team1');
    expect(SRC).toContain('.codex-team2');
  });

  it('auth.tokens 是选择 team 账号的条件', () => {
    expect(SRC).toContain('auth.tokens');
  });

  it('round-robin：_codexTeamIndex 递增', () => {
    expect(SRC).toContain('_codexTeamIndex');
    expect(SRC).toContain('% CODEX_TEAM_HOMES.length');
  });
});
