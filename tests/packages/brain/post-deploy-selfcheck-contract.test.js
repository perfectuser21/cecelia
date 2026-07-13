/**
 * post-deploy-selfcheck-contract.test.js
 * 环境守卫：部署后 5221 健康检查失败时必须 send_bark 告警——2026-07-05 outage 时
 * 5221 挂了却无人知，就是缺这个告警（issue f38f989f / 8ae2e116）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const SH = readFileSync(resolve(REPO_ROOT, 'scripts/brain-deploy.sh'), 'utf8');

describe('post-deploy 5221 自检 + Bark', () => {
  it('顶层 source bluegreen.sh（send_bark/bluegreen_swap 两模式都可用）', () => {
    // 顶层（VERSION 定义之前）已 source，保证 launchd 模式也有 send_bark
    const head = SH.slice(0, SH.indexOf('VERSION='));
    expect(head).toMatch(/source\s+["']?\$\{?SCRIPT_DIR\}?\/lib\/bluegreen\.sh/);
  });

  it('健康检查失败路径 send_bark 告警', () => {
    const idx = SH.indexOf('Health check timed out');
    expect(idx).toBeGreaterThan(0);
    // 失败段（前后各取一段）必须含 send_bark
    const failSection = SH.slice(idx, idx + 400);
    expect(failSection).toContain('send_bark');
    expect(failSection).toMatch(/5221/);
  });
});
