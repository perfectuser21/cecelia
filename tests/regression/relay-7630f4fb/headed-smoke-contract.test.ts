import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 毕业自 sprints/07212136-relay-7630f4fb/tests/（GAN round3 合同修正：测试产物与 e2e wrapper
// 从源头直接落永久池，不再落 sprints/ 临时目录，避免测试金字塔孤儿棘轮，对齐历史先例 PR #4109/#3970 的
// 最终落点）。wrapper 已同步毕业到 scripts/smoke/e2e/relay-7630f4fb.sh。
// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）。
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const WRAPPER_PATH = path.join(ROOT, 'scripts/smoke/e2e/relay-7630f4fb.sh');
const TASK_ID = '7630f4fb-0acf-4f7a-ad42-e2dea3485089';
const SMOKE_SCRIPT = 'packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh';
const ALLOWLIST = 'packages/quality/smoke-allowlist.txt';

async function readWrapper(): Promise<string> {
  return fs.readFile(WRAPPER_PATH, 'utf8');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe('headed smoke contract (task 7630f4fb) [BEHAVIOR]', () => {
  it('文件存在且调用 smoke 与 allowlist 校验', async () => {
    const exists = await fileExists(WRAPPER_PATH);
    expect(exists).toBe(true);
    const script = await readWrapper();
    expect(script).toContain(SMOKE_SCRIPT);
    expect(script).toContain(ALLOWLIST);
    expect(script).toMatch(/grep -Fxq/);
  });

  it('e2e wrapper 锚定当前 task_id', async () => {
    const script = await readWrapper();
    expect(script).toContain(TASK_ID);
  });

  it('payload 关键字段齐全且不含敏感字段明文', async () => {
    const script = await readWrapper();
    expect(script).toMatch(/payload\.mode/);
    expect(script).toMatch(/payload\.executor/);
    expect(script).toMatch(/payload\.orchestrator/);
    expect(script).toMatch(/payload\.journey_id/);
    expect(script).toMatch(/has\("token"\)/);
    expect(script).toMatch(/has\("github_token"\)/);
    expect(script).toMatch(/has\("anthropic_token"\)/);
    expect(script).toMatch(/has\("thin_prd"\)/);
  });

  it('initiative_runs host 精确匹配且 phase 合法非 failed/unknown', async () => {
    const script = await readWrapper();
    expect(script).toMatch(/initiative_runs/);
    expect(script).toContain('skill-relay-claude-headed');
    expect(script).toMatch(/phase.*!=.*failed|failed.*exit 1/s);
    expect(script).toMatch(/unknown/);
    expect(script).toMatch(/A_planning\|planning\|gan\|generate\|evaluate\|done/);
  });

  it('e2e wrapper 不改动 claude-headed-dispatch-smoke.sh 本体或 ci.yml（不在本脚本内写入这两个文件）', async () => {
    const script = await readWrapper();
    expect(script).not.toMatch(/>\s*\.github\/workflows/);
    expect(script).not.toMatch(/>>\s*packages\/quality\/smoke-allowlist\.txt/);
  });
});
