import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SPRINT_DIR = 'sprints/07212136-relay-7630f4fb';
const TASK_ID = '7630f4fb-0acf-4f7a-ad42-e2dea3485089';
const SMOKE_SCRIPT = 'packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh';
const ALLOWLIST = 'packages/quality/smoke-allowlist.txt';

async function readFile(relPath: string): Promise<string> {
  return await fs.readFile(path.join(process.cwd(), relPath), 'utf8');
}

async function fileExists(relPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(process.cwd(), relPath));
    return true;
  } catch {
    return false;
  }
}

describe('e2e-verify.sh 骨架 [BEHAVIOR]', () => {
  it('e2e-verify.sh 文件存在', async () => {
    const exists = await fileExists(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(exists).toBe(true);
  });

  it('e2e-verify.sh 锚定当前 task_id 与 sprint_dir', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toContain(TASK_ID);
    expect(content).toContain(SPRINT_DIR);
  });

  it('e2e-verify.sh 复用（不重实现）既有 claude-headed-dispatch-smoke.sh', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toContain(SMOKE_SCRIPT);
  });

  it('e2e-verify.sh 校验 allowlist 精确登记（不重复登记）', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toContain(ALLOWLIST);
    expect(content).toMatch(/grep -Fxq/);
  });

  it('e2e-verify.sh 校验 Brain API payload 关键字段（mode/executor/orchestrator/journey_id）', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toMatch(/payload\.mode/);
    expect(content).toMatch(/payload\.executor/);
    expect(content).toMatch(/payload\.orchestrator/);
    expect(content).toMatch(/payload\.journey_id/);
  });

  it('e2e-verify.sh 对敏感字段做反向存在性断言（token/github_token/anthropic_token/thin_prd）', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toMatch(/has\("token"\)/);
    expect(content).toMatch(/has\("github_token"\)/);
    expect(content).toMatch(/has\("anthropic_token"\)/);
    expect(content).toMatch(/has\("thin_prd"\)/);
  });

  it('e2e-verify.sh 定点查询 initiative_runs 并精确匹配 orchestrator_host', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toMatch(/initiative_runs/);
    expect(content).toContain('skill-relay-claude-headed');
  });

  it('e2e-verify.sh 拒绝 phase=failed/unknown 且校验合法枚举', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).toMatch(/phase.*!=.*failed|failed.*exit 1/s);
    expect(content).toMatch(/unknown/);
    expect(content).toMatch(/A_planning\|planning\|gan\|generate\|evaluate\|done/);
  });

  it('e2e-verify.sh 不改动 claude-headed-dispatch-smoke.sh 本体或 ci.yml（不在本脚本内写入这两个文件）', async () => {
    const content = await readFile(`${SPRINT_DIR}/e2e-verify.sh`);
    expect(content).not.toMatch(/>\s*\.github\/workflows/);
    expect(content).not.toMatch(/>>\s*packages\/quality\/smoke-allowlist\.txt/);
  });
});
