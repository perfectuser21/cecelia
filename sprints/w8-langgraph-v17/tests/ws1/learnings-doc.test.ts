import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const LEARNINGS_PATH = resolve(REPO_ROOT, 'docs/learnings/w8-langgraph-v17-e2e.md');

function readDoc(): string {
  if (!existsSync(LEARNINGS_PATH)) {
    throw new Error(`learnings doc missing: ${LEARNINGS_PATH}`);
  }
  return readFileSync(LEARNINGS_PATH, 'utf8');
}

describe('Workstream 1 — walking skeleton learnings doc [BEHAVIOR]', () => {
  it('文件存在且首行包含 W8 v17 LangGraph 标题', () => {
    const content = readDoc();
    const firstLine = content.split('\n')[0];
    expect(firstLine).toMatch(/W8 v17 LangGraph/);
  });

  it('文件含 run_date / gan_proposer_rounds / pr_url 三个核心占位字段', () => {
    const content = readDoc();
    expect(content).toMatch(/run_date:/);
    expect(content).toMatch(/gan_proposer_rounds:/);
    expect(content).toMatch(/pr_url:/);
  });

  it('node_durations 段枚举 LangGraph 五个节点（PLANNER/PROPOSER/REVIEWER/GENERATOR/EVALUATOR）', () => {
    const content = readDoc();
    expect(content).toMatch(/node_durations:/);
    for (const node of ['PLANNER', 'PROPOSER', 'REVIEWER', 'GENERATOR', 'EVALUATOR']) {
      expect(content, `节点 ${node} 缺失`).toContain(node);
    }
  });

  it('文件自指 sprint dir（含 sprints/w8-langgraph-v17）', () => {
    const content = readDoc();
    expect(content).toContain('sprints/w8-langgraph-v17');
  });

  it('DoD 列表至少含一条引用 evaluator/PR/tasks 之一的条目', () => {
    const content = readDoc();
    expect(content).toMatch(/^-\s.+(evaluator|PR|tasks)/im);
  });

  it('文件长度合理（5 ~ 200 行，防 stub 全空 / 防灌水）', () => {
    const content = readDoc();
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeGreaterThanOrEqual(5);
    expect(lineCount).toBeLessThanOrEqual(200);
  });

  it('R1-R4 边界 mitigation 关键词段落齐全（thread_id / callback / retryPolicy / H11）', () => {
    const content = readDoc();
    for (const keyword of ['thread_id', 'callback', 'retryPolicy', 'H11']) {
      expect(content, `mitigation 关键词 ${keyword} 缺失（对应 R1-R4 边界）`).toContain(keyword);
    }
  });
});
