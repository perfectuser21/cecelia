import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 落点铁律（先例 7630f4fb learning 强制）：contract 测试与 e2e wrapper 从第一次 commit 起即落
// 永久池（tests/regression/relay-f90ddca3/ + scripts/smoke/e2e/relay-f90ddca3.sh），
// 不落 sprints/ 临时目录，从源头避开测试金字塔孤儿棘轮。
// 路径按 repo root 解析，兼容任意 cwd（brain vitest cwd=packages/brain）。
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const WRAPPER_PATH = path.join(ROOT, 'scripts/smoke/e2e/relay-f90ddca3.sh');
const TASK_ID = 'f90ddca3-396d-45b2-ad13-2dfbd9e15080';
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

describe('headed smoke contract (task f90ddca3) [BEHAVIOR]', () => {
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

  it('initiative_runs 存在至少一条 host 精确匹配且 phase 合法非 failed/unknown（EXISTS 语义，容忍历史 failed 行）', async () => {
    const script = await readWrapper();
    expect(script).toMatch(/initiative_runs/);
    // host 精确等值匹配（SQL 等值条件，非宽松 LIKE/包含）
    expect(script).toContain("orchestrator_host='skill-relay-claude-headed'");
    // EXISTS 语义：合法枚举 IN 列表 + 显式排除 failed/unknown（PRD 边界情况：容忍历史 failed 行）
    expect(script).toMatch(/phase IN \('A_planning','planning','gan','generate','evaluate','done'\)/);
    expect(script).toMatch(/phase NOT IN \('failed','unknown'\)/);
    // 两层失败语义：先"无记录 FAIL"，再"无合法记录 FAIL"（不许退化为只看最新一条的口径）
    expect(script).toMatch(/无当前 task run/);
    expect(script).toMatch(/无合法 phase/);
  });

  it('e2e wrapper 不改动 claude-headed-dispatch-smoke.sh 本体或 ci.yml（不在本脚本内写入共享 CI 文件）', async () => {
    const script = await readWrapper();
    expect(script).not.toMatch(/>\s*\.github\/workflows/);
    expect(script).not.toMatch(/>>\s*packages\/quality\/smoke-allowlist\.txt/);
    expect(script).not.toMatch(/test-pyramid-baseline\.json/);
  });
});
