import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOTES_PATH = resolve(HERE, '../../../../docs/learnings/w8-langgraph-v15-e2e.md');

describe('Workstream 1 — Walking Skeleton 实证笔记 [BEHAVIOR]', () => {
  it('文件存在且 fs.readFileSync 不抛 ENOENT，内容长度 > 0', () => {
    expect(existsSync(NOTES_PATH)).toBe(true);
    const content = readFileSync(NOTES_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('首行（去掉 markdown header 前缀后）包含 sprint 标识 "W8 v15 LangGraph E2E 实证"', () => {
    const firstLine = readFileSync(NOTES_PATH, 'utf8').split('\n')[0].replace(/^#+\s*/, '');
    expect(firstLine).toContain('W8 v15 LangGraph E2E 实证');
  });

  it('文件含 journey_type=dev_pipeline 元数据声明', () => {
    const content = readFileSync(NOTES_PATH, 'utf8');
    expect(content).toMatch(/journey_type[:\s]+dev_pipeline/);
  });

  it('文件含 4 项实证字段占位：node_durations / gan_proposer_rounds / pr_url / run_date', () => {
    const content = readFileSync(NOTES_PATH, 'utf8');
    for (const key of ['node_durations', 'gan_proposer_rounds', 'pr_url', 'run_date']) {
      expect(content, `missing field: ${key}`).toContain(key);
    }
  });
});
