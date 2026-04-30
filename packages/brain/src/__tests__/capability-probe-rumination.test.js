/**
 * BEHAVIOR test: capability-probe.js probeRumination 心跳检查逻辑
 * 验证 probeRumination 阶段 4：心跳事件区分 loop_dead / consciousness_disabled / degraded_llm_failure
 *
 * 背景：PROBE_FAIL_RUMINATION 存在三种根因：
 * 1. degraded_llm_failure — 循环在跑但 LLM 全失败（有心跳无产出）
 * 2. consciousness_disabled — isConsciousnessEnabled()=false，runRumination 从未被调用
 * 3. loop_dead — 意识开启但循环未知原因未运行
 * 心跳 + consciousness 检查让 probe 区分这三种状态，使 auto-fix 任务精确定向。
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PROBE_PATH = path.resolve('src/capability-probe.js');
const content = fs.readFileSync(PROBE_PATH, 'utf8');

// 提取 probeRumination 函数体（从 async function probeRumination 到下一个同级函数）
const fnMatch = content.match(/async function probeRumination\(\)[^]*?(?=\nasync function |\nexport )/);
const ruminationFn = fnMatch ? fnMatch[0] : '';

describe('probeRumination — 心跳事件区分 dead vs degraded', () => {
  it('失败路径查询 rumination_run 心跳事件（24h 窗口）', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_run'");
    expect(ruminationFn).toContain('recentHeartbeats');
  });

  it('失败 detail 包含 heartbeats_24h 字段供运维诊断', () => {
    expect(ruminationFn).toContain('heartbeats_24h=');
  });

  it('心跳 > 0 时 livenessTag 标为 degraded_llm_failure', () => {
    expect(ruminationFn).toContain('degraded_llm_failure');
  });

  it('心跳 == 0 时 livenessTag 标为 loop_dead（意识开启但循环未运行）', () => {
    expect(ruminationFn).toContain('loop_dead');
  });

  it('心跳 == 0 且 isConsciousnessEnabled()=false 时 livenessTag 标为 consciousness_disabled', () => {
    expect(ruminationFn).toContain('consciousness_disabled');
    expect(ruminationFn).toContain('isConsciousnessEnabled()');
  });

  it('心跳 == 0 且 BRAIN_MINIMAL_MODE=true 时 livenessTag 标为 minimal_mode', () => {
    expect(ruminationFn).toContain('minimal_mode');
    expect(ruminationFn).toContain('BRAIN_MINIMAL_MODE');
  });

  it('consciousness_disabled 时 detail 包含修复提示（DB key 或 env var）', () => {
    expect(ruminationFn).toContain('working_memory.consciousness_enabled');
    expect(ruminationFn).toContain('CONSCIOUSNESS_ENABLED');
  });

  it('心跳写入注释引用 runRumination 入口（不是 digestLearnings）', () => {
    expect(ruminationFn).toContain('runRumination 入口');
  });
});

describe('probeRumination — last_run 真实化 + LLM forensic 透出', () => {
  it('last_run 查询使用全局 max（不含 48h 过滤）— "last_run=never" 仅在表全空时出现', () => {
    // 关键断言：probe 内必须有一次"无 INTERVAL 过滤的 max(created_at)" 查询
    expect(ruminationFn).toMatch(/SELECT\s+max\(created_at\)\s+AS\s+last_run\s+FROM\s+synthesis_archive(?!\s*\n?\s*WHERE)/);
  });

  it('degraded_llm_failure 时查询最近一次 rumination_llm_failure 事件', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_llm_failure'");
    expect(ruminationFn).toContain('ORDER BY created_at DESC');
  });

  it('detail 末尾透出 last_llm_failure 摘要（notebook + llm 错误）', () => {
    expect(ruminationFn).toContain('last_llm_failure');
    expect(ruminationFn).toContain('notebook=');
    expect(ruminationFn).toContain('llm=');
  });
});
