import { describe, it, expect } from 'vitest';
import { classifyCodexFailure, CODEX_FATAL_PATTERNS } from '../codex-fatal-patterns.js';

// 三条正样本均为 2026-08-05 生产容器实测原文（codex 0.116.0 × 宿主 0.146.0 维护的 config）
describe('classifyCodexFailure — 环境级致命错误命中', () => {
  it('旧 CLI 读新 config 键：启动即死（stderr）', () => {
    const stderr = 'Error: default_permissions requires a `[permissions]` table';
    const r = classifyCodexFailure('', stderr);
    expect(r).toEqual({ configError: true, reason: 'codex_config_incompatible' });
  });

  it('模型-版本不匹配：API 400（stdout ERROR JSON 行）', () => {
    const stdout = 'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.6-sol\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}';
    const r = classifyCodexFailure(stdout, '');
    expect(r).toEqual({ configError: true, reason: 'codex_version_too_old' });
  });

  it('cwd 不受信任（stderr）', () => {
    const stderr = 'Not inside a trusted directory and --skip-git-repo-check was not specified.';
    const r = classifyCodexFailure('', stderr);
    expect(r).toEqual({ configError: true, reason: 'codex_untrusted_cwd' });
  });
});

describe('classifyCodexFailure — 真任务失败不误伤', () => {
  it('正常 verdict FAIL 的 stdout 不命中', () => {
    expect(classifyCodexFailure('{"verdict":"FAIL","summary":"代码存在空指针风险"}', '')).toBeNull();
  });

  it('普通 lint/构建报错不命中', () => {
    expect(classifyCodexFailure('', "error TS2304: Cannot find name 'foo'.\nnpm error Lifecycle script failed")).toBeNull();
  });

  it('空输入不命中', () => {
    expect(classifyCodexFailure('', '')).toBeNull();
    expect(classifyCodexFailure(undefined, undefined)).toBeNull();
  });
});

describe('CODEX_FATAL_PATTERNS 结构', () => {
  it('每条含 pattern(RegExp) 与 reason(string)', () => {
    expect(CODEX_FATAL_PATTERNS.length).toBeGreaterThanOrEqual(3);
    for (const p of CODEX_FATAL_PATTERNS) {
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(typeof p.reason).toBe('string');
    }
  });
});
