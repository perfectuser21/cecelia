/**
 * BEHAVIOR test: capability-probe.js rumination probe 逻辑
 * 验证 probeRumination 使用 48h 窗口并包含 idle 状态判断
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PROBE_PATH = path.resolve('packages/brain/src/capability-probe.js');
const content = fs.readFileSync(PROBE_PATH, 'utf8');

// 提取 probeRumination 函数体（从 async function probeRumination 到下一个同级函数）
const fnMatch = content.match(/async function probeRumination\(\)[^]*?(?=\nasync function |\nexport )/);
const ruminationFn = fnMatch ? fnMatch[0] : '';

describe('probeRumination — 48h 窗口 + idle 状态判断', () => {
  it('probeRumination 函数使用 48h 窗口检查 synthesis_archive', () => {
    expect(ruminationFn).toContain("INTERVAL '48 hours'");
    expect(ruminationFn).not.toContain("INTERVAL '24 hours'");
  });

  it('probeRumination detail 字段格式使用 48h_count', () => {
    expect(ruminationFn).toContain('48h_count=');
    expect(ruminationFn).not.toContain('24h_count=');
  });

  it('probeRumination 包含未消化 learnings 的次级检查（idle 状态判断）', () => {
    expect(ruminationFn).toContain('digested = false');
    expect(ruminationFn).toContain('undigested');
  });

  it('probeRumination idle 状态时 detail 包含 no_pending_learnings 标记', () => {
    expect(ruminationFn).toContain('no_pending_learnings');
  });
});
