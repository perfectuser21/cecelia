/**
 * W8 Acceptance — Workstream 1: acceptance-fixture shape
 *
 * 验证 sprints/w8-langgraph-v8/acceptance-fixture.json 是合法的最短 Golden Path 派发载荷。
 * Generator 阶段会创建该文件 — 当前 Round 1 Red 阶段：文件不存在 → 5 个 it 全 fail。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'acceptance-fixture.json'
);

function loadFixture(): unknown {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw);
}

describe('Workstream 1 — acceptance-fixture shape [BEHAVIOR]', () => {
  it('fixture JSON 文件存在且可解析', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
    const j = loadFixture();
    expect(j).toBeTypeOf('object');
    expect(j).not.toBeNull();
  });

  it("task_type === 'harness_initiative'", () => {
    const j = loadFixture() as { task_type: string };
    expect(j.task_type).toBe('harness_initiative');
  });

  it('payload.prd_content 长度 ≥ 200 字符（防过短被 ganLoop 拒）', () => {
    const j = loadFixture() as { payload: { prd_content: string } };
    expect(typeof j.payload?.prd_content).toBe('string');
    expect(j.payload.prd_content.length).toBeGreaterThanOrEqual(200);
  });

  it('payload.task_plan 至少 1 个 sub_task 且每个 sub_task 含 id/title/dod 字段', () => {
    const j = loadFixture() as {
      payload: { task_plan: Array<{ id: string; title: string; dod: unknown[] }> };
    };
    expect(Array.isArray(j.payload?.task_plan)).toBe(true);
    expect(j.payload.task_plan.length).toBeGreaterThanOrEqual(1);
    for (const t of j.payload.task_plan) {
      expect(typeof t.id).toBe('string');
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.title).toBe('string');
      expect(t.title.length).toBeGreaterThan(0);
      expect(Array.isArray(t.dod)).toBe(true);
      expect(t.dod.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('payload.fixture_marker === true（acceptance 标记，便于事后 SELECT）', () => {
    const j = loadFixture() as { payload: { fixture_marker: boolean } };
    expect(j.payload?.fixture_marker).toBe(true);
  });
});
