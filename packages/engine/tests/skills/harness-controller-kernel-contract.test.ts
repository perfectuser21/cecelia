import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const skillPath = resolve(
  import.meta.dirname,
  '../../../workflows/skills/harness-controller/SKILL.md',
);
const content = readFileSync(skillPath, 'utf8');

describe('harness-controller Kernel contract snapshot', () => {
  it.each([
    'Kernel Run Controller',
    '每个 `run_id` 一个逻辑 Controller',
    'Attempts per role',
    'Fleet Supervisor = machine-only',
    'exact-SHA',
    'effect receipt',
  ])('declares the unified authority token %s', (token) => {
    expect(content).toContain(token);
  });

  it.each([
    '唯一编排路径',
    'PR-level 单 session',
    'tmux kill-session',
    'gh pr merge',
  ])('does not restore retired authority %s', (token) => {
    expect(content).not.toContain(token);
  });

  it('uses a major-version contract break for the generated snapshot', () => {
    expect(content).toMatch(/^version:\s*3\.0\.0$/m);
  });
});
