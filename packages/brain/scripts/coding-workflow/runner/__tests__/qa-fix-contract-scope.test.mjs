import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, BRANCH, SPRINT, INTENT } from './helpers/qa-env.mjs';

// 真 qaFix/loadPrompt -> CLI 接缝；外部模型替身只捕获输入，不证明模型遵守指令。
describe('QA 修复的合同范围与回归方式', () => {
  const E = useQaEnv();

  it('README-only 合同抵达修复入口：许可只读/内存 RED-GREEN，不无条件命令永久新增测试文件', async () => {
    E.addToBranch(`${SPRINT}/01-intent.md`, `${INTENT}\n只允许修改 README.md；禁止新增或修改仓库测试、代码和配置。\n`);
    E.addToBranch('README.md', '# 基线\n');
    const before = E.remoteHead();
    const r = await E.go(E.green({ prs: [E.pr({ headRefOid: before })] }), {
      mode: 'fail', extra: { FAKE_CIFIX_MODE: 'none' },
    });
    expect(r.exitCode, r.stderr).toBe(0);
    const prompt = fs.readFileSync(E.files.prompt, 'utf8');
    expect(prompt).toContain(`INTENT_PATH: `);
    expect(prompt).toContain(`${SPRINT}/01-intent.md`);
    expect(prompt).toMatch(/INTENT_PATH[^\n]*SPEC_PATH[^\n]*文件[^\n]*操作范围/);
    expect(prompt).toMatch(/文档[^\n]*限定文件[^\n]*只读[^\n]*内存[^\n]*RED[^\n]*GREEN/);
    expect(prompt).toMatch(/不得[^\n]*TDD[^\n]*新增[^\n]*合同禁止/);
    expect(prompt).not.toContain('修 bug 的测试永久留着。');
    // none 不能被当作修复成功；QA 记录之外没有偷偷提交仓库测试。
    expect(E.state().escalated).toMatchObject({ type: 'qa_fix_failed' });
    const changed = git(E.sb.origin, 'diff', '--name-only', before, BRANCH).trim().split('\n');
    expect(changed).toEqual([`${SPRINT}/05-qa-report-r1.md`]);
  });

  it('允许代码修复仍正常检查并推送提交，永久回归仅在合同许可范围内要求', async () => {
    const r = await E.go(E.green(), { mode: 'fail' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state().rounds[0].fix).toBe('pushed');
    expect(git(E.sb.origin, 'show', `${BRANCH}:src/fix.txt`)).toBe('fixed\n');
    const prompt = fs.readFileSync(E.files.prompt, 'utf8');
    expect(prompt).toMatch(/代码[^\n]*合同允许[^\n]*永久[^\n]*回归/);
    expect(prompt).toContain('不删除或放宽已有测试的断言');
  });

  it('裁决与合同冲突不提交修复、不推送产品变化，保留失败并升级 ruling_conflict', async () => {
    const before = E.remoteHead();
    const r = await E.go(E.green(), { mode: 'fail', extra: { FAKE_CIFIX_MODE: 'ruling-conflict' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state().escalated).toMatchObject({ type: 'qa_fix_failed', reason: 'ruling_conflict' });
    expect(E.state().rounds[0]).toMatchObject({ verdict: 'FAIL', fix: 'ruling_conflict' });
    expect(git(E.sb.origin, 'diff', '--name-only', before, BRANCH).trim()).toBe(`${SPRINT}/05-qa-report-r1.md`);
    const prompt = fs.readFileSync(E.files.prompt, 'utf8');
    expect(prompt).toMatch(/不得[^\n]*放宽[^\n]*INTENT_PATH[^\n]*SPEC_PATH/);
    expect(prompt).toContain('RULING_CONFLICT:');
  });
});
