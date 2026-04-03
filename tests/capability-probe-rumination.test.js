/**
 * BEHAVIOR test: capability-probe.js rumination probe 逻辑
 * 验证 probeRumination 使用 48h 窗口并包含 idle 状态判断
 * 以及 3 阶段检查逻辑防止"空白日"误报
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
  });

  it('probeRumination detail 字段格式使用 48h_count', () => {
    expect(ruminationFn).toContain('48h_count=');
  });

  it('probeRumination 包含未消化 learnings 的次级检查（idle 状态判断）', () => {
    expect(ruminationFn).toContain('digested = false');
    expect(ruminationFn).toContain('undigested');
  });

  it('probeRumination idle 状态时 detail 包含 no_pending_learnings 标记', () => {
    expect(ruminationFn).toContain('no_pending_learnings');
  });
});

describe('probeRumination — 阶段 3：防误报检查（rumination_output 事件）', () => {
  it('阶段 3 检查 cecelia_events 中的 rumination_output 事件', () => {
    // 有未消化 learnings 但无近期 synthesis 时，额外查 rumination_output
    expect(ruminationFn).toContain("event_type = 'rumination_output'");
    expect(ruminationFn).toContain('recentRuns');
  });

  it('阶段 3 使用 24h 窗口检查 rumination_output 事件', () => {
    // rumination_output 检查窗口为 24h
    expect(ruminationFn).toContain("INTERVAL '24 hours'");
  });

  it('阶段 3 在 rumination 运行但无 synthesis 更新时返回 ok=true（防止"空白日"误报）', () => {
    // 有近期 output 且 72h 内有 synthesis → ok=true，detail 含 running: 标注
    expect(ruminationFn).toContain('(running: recent_outputs=');
  });

  it('阶段 3 兜底检查使用 72h 窗口（确保真实故障不被掩盖）', () => {
    expect(ruminationFn).toContain("INTERVAL '72 hours'");
    expect(ruminationFn).toContain('within72h');
  });

  it('阶段 3 无 rumination_output 时仍返回 ok=false（真实故障）', () => {
    // recent_outputs=0 时 detail 中含 recent_outputs=
    expect(ruminationFn).toContain('recent_outputs=');
  });
});
