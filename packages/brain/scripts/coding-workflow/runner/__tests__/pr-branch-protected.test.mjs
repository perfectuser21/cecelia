// C6：修复提交的受保护路径按仓库——runner 固化的 QA 回归 smoke 在哪个目录由 repos.json qa_smoke 决定；
// 不固化的仓库（zenithjoy 第一阶段 qa_smoke=null）只保护 sprints/ 与 agent 配置。
import { describe, it, expect } from 'vitest';
import { protectedPath, smokeDirOf } from '../lib/pr-branch.mjs';
import { QA_SMOKE_DIR } from '../../lib/qa-smoke.mjs';
import fs from 'node:fs';

const REPOS = JSON.parse(fs.readFileSync(new URL('../../repos.json', import.meta.url), 'utf8')).repos;
const ZJ = REPOS.find((r) => r.key === 'zenithjoy-workspace');

describe('protectedPath', () => {
  const CW = `${QA_SMOKE_DIR}/cw-12345678-qa-smoke.sh`;
  it('默认（cecelia）：sprints/、.claude/、CLAUDE.md、AGENTS.md、cecelia 的 cw-*-qa-smoke.sh 受保护；别的 smoke 不受', () => {
    for (const f of ['sprints/x/01-intent.md', '.claude/settings.json', 'CLAUDE.md', 'AGENTS.md', CW]) expect(protectedPath(f), f).toBe(true);
    for (const f of [`${QA_SMOKE_DIR}/my-smoke.sh`, 'packages/brain/src/x.js', 'docs/CLAUDE.md']) expect(protectedPath(f), f).toBe(false);
  });
  it('传了别的 smoke 目录：只保护那个目录下的 cw-*-qa-smoke.sh', () => {
    expect(protectedPath('.github/workflows/scripts/smoke/cw-12345678-qa-smoke.sh', '.github/workflows/scripts/smoke')).toBe(true);
    expect(protectedPath(CW, '.github/workflows/scripts/smoke')).toBe(false);
  });
  it('smoke 目录为 null（本仓不固化）：只保护 sprints/ 与 agent 配置', () => {
    expect(protectedPath(CW, null)).toBe(false);
    expect(protectedPath('sprints/x/02-spec.md', null)).toBe(true);
  });
  it('smokeDirOf：cfg.repoProfile 的 qa_smoke.dir；没带 profile = cecelia 目录；zenithjoy = null', () => {
    expect(smokeDirOf({})).toBe(QA_SMOKE_DIR);
    expect(smokeDirOf({ repoProfile: ZJ })).toBeNull();
  });
});
