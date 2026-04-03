/**
 * self-drive.js 状态感知 + tick.js 默认开启 — 静态代码验证
 * Day5: Brain 调度器默认开启 + 状态感知任务生成
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Day5: tick 默认开启', () => {
  it('tick.js 默认 enabled 为 true（不再是 false）', () => {
    const content = readFileSync(resolve(__dirname, '../tick.js'), 'utf-8');
    // 不应再包含 ?? false 的默认值
    const match = content.match(/const enabled = memory\[TICK_ENABLED_KEY\].*?;/s);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('?? true');
    expect(match![0]).not.toContain('?? false');
  });
});

describe('Day5: 状态感知任务生成', () => {
  it('self-drive.js 包含 readCurrentState 函数', () => {
    const content = readFileSync(resolve(__dirname, '../self-drive.js'), 'utf-8');
    expect(content).toContain('function readCurrentState');
  });

  it('readCurrentState 在文件缺失时返回 null（graceful skip）', () => {
    const content = readFileSync(resolve(__dirname, '../self-drive.js'), 'utf-8');
    expect(content).toContain('return null');
    // 确保 null 返回在 readCurrentState 函数块中
    const fnMatch = content.match(/function readCurrentState\(\)[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toContain('return null');
  });

  it('buildAnalysisPrompt 包含"系统当前状态"章节', () => {
    const content = readFileSync(resolve(__dirname, '../self-drive.js'), 'utf-8');
    expect(content).toContain('系统当前状态');
    expect(content).toContain('currentState');
  });

  it('runSelfDrive 调用 readCurrentState() 并传入 analyzeSituation', () => {
    const content = readFileSync(resolve(__dirname, '../self-drive.js'), 'utf-8');
    expect(content).toContain('readCurrentState()');
    expect(content).toContain('currentState');
  });

  it('readCurrentState 对占位符内容返回 null（防止 LLM 误判 degraded）', () => {
    const content = readFileSync(resolve(__dirname, '../self-drive.js'), 'utf-8');
    const fnMatch = content.match(/function readCurrentState\(\)[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toContain('待更新');
    expect(fn).toContain('初始占位');
    expect(fn).toContain('return null');
  });
});
