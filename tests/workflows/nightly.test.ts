import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

describe('Nightly Workflow', () => {
  const workflowPath = join(__dirname, '../../.github/workflows/nightly.yml');
  let workflow: any;

  it('C1-005: 应使用 upload-artifact 而不是 git push', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    // 检查包含 upload-artifact
    expect(content).toContain('upload-artifact');

    // 检查不包含 git push（在 LEARNINGS 相关步骤中）
    const lines = content.split('\n');
    let inLearningsStep = false;
    let foundGitPush = false;

    lines.forEach(line => {
      if (line.includes('LEARNINGS') || line.includes('learnings')) {
        inLearningsStep = true;
      }
      if (inLearningsStep && line.includes('git push')) {
        foundGitPush = true;
      }
      // Reset when reaching next step
      if (line.trim().startsWith('- name:') && !line.includes('LEARNINGS')) {
        inLearningsStep = false;
      }
    });

    expect(foundGitPush).toBe(false);
  });

  it('regression job 应该有 read-only 权限', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    const regressionJob = workflow.jobs.regression;
    expect(regressionJob).toBeDefined();
    expect(regressionJob.permissions).toBeDefined();
    expect(regressionJob.permissions.contents).toBe('read');
  });

  it('应该有 Upload LEARNINGS Report 步骤', () => {
    const content = readFileSync(workflowPath, 'utf8');

    expect(content).toContain('Upload LEARNINGS Report');
    expect(content).toContain('learnings-report-');
    expect(content).toContain('docs/LEARNINGS.md');
  });

  it('应该有 Generate LEARNINGS Report 步骤（不再 commit）', () => {
    const content = readFileSync(workflowPath, 'utf8');

    expect(content).toContain('Generate DevGate Report for LEARNINGS');
    expect(content).toContain('append-learnings.cjs');

    // 不应该有 git commit 相关命令
    const lines = content.split('\n');
    let inGenerateStep = false;
    let foundGitCommit = false;

    lines.forEach(line => {
      if (line.includes('Generate DevGate Report')) {
        inGenerateStep = true;
      }
      if (inGenerateStep && line.includes('git commit')) {
        foundGitCommit = true;
      }
      if (line.trim().startsWith('- name:') && !line.includes('Generate')) {
        inGenerateStep = false;
      }
    });

    expect(foundGitCommit).toBe(false);
  });

  it('P1 fix: 应包含注释说明不再 push', () => {
    const content = readFileSync(workflowPath, 'utf8');

    expect(content).toContain('P1 fix: 不再 push，只读权限即可');
  });
});
