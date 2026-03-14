import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

/**
 * CI 超时配置测试
 *
 * 验证所有 CI workflow 文件的 job timeout 配置正确。
 * 旧的 engine-ci.yml 已在 CI 架构重构时拆分为 4 个文件：
 *   - ci-l1-process.yml    (PRD/DoD/DevGate/Known-Failures)
 *   - ci-l2-consistency.yml (Version/Contract/Impact)
 *   - ci-l3-code.yml       (TypeCheck/Tests/Build/ShellCheck)
 *   - ci-l4-runtime.yml    (Integration tests)
 *
 * @see PR #755 - CI 体系重构 V2+V3
 */

const WORKFLOWS_DIR = join(__dirname, '../../../../.github/workflows');

type WorkflowFile = {
  name: string;
  path: string;
  keyJobs: string[];  // 必须存在的关键 job
};

const CI_FILES: WorkflowFile[] = [
  {
    name: 'ci-l1-process.yml',
    path: join(WORKFLOWS_DIR, 'ci-l1-process.yml'),
    keyJobs: ['changes', 'dod-check', 'engine-l1', 'l1-passed'],
  },
  {
    name: 'ci-l2-consistency.yml',
    path: join(WORKFLOWS_DIR, 'ci-l2-consistency.yml'),
    keyJobs: ['changes', 'engine-l2', 'l2-passed'],
  },
  {
    name: 'ci-l3-code.yml',
    path: join(WORKFLOWS_DIR, 'ci-l3-code.yml'),
    keyJobs: ['changes', 'engine-l3', 'l3-passed'],
  },
  {
    name: 'ci-l4-runtime.yml',
    path: join(WORKFLOWS_DIR, 'ci-l4-runtime.yml'),
    keyJobs: ['changes', 'l4-passed'],
  },
];

describe('CI Workflow - Timeout Configuration', () => {
  it('C1-004: 所有 CI 文件必须存在（旧 engine-ci.yml 已拆分为 4 个文件）', () => {
    for (const file of CI_FILES) {
      expect(existsSync(file.path), `${file.name} should exist`).toBe(true);
    }
    // 旧文件不应存在
    const oldFile = join(WORKFLOWS_DIR, 'engine-ci.yml');
    expect(existsSync(oldFile), 'engine-ci.yml should not exist (replaced by l1/l2/l3/l4)').toBe(false);
  });

  it('C1-004: 所有关键 jobs 应该有 timeout-minutes', () => {
    for (const file of CI_FILES) {
      if (!existsSync(file.path)) continue;
      const workflow = yaml.load(readFileSync(file.path, 'utf8')) as any;

      for (const jobName of file.keyJobs) {
        const job = workflow.jobs[jobName];
        expect(job, `${file.name}: Job ${jobName} should exist`).toBeDefined();
        expect(job['timeout-minutes'], `${file.name}: Job ${jobName} should have timeout-minutes`).toBeDefined();
        expect(
          job['timeout-minutes'],
          `${file.name}: Job ${jobName} timeout should be reasonable (< 60)`
        ).toBeLessThanOrEqual(60);
      }
    }
  });

  it('engine-l3 (tests) 超时应该合理（15-30 分钟）', () => {
    const workflow = yaml.load(readFileSync(
      join(WORKFLOWS_DIR, 'ci-l3-code.yml'), 'utf8'
    )) as any;
    const engineL3 = workflow.jobs['engine-l3'];
    expect(engineL3).toBeDefined();
    expect(engineL3['timeout-minutes']).toBeGreaterThanOrEqual(15);
    expect(engineL3['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('test job 超时应该比快速 jobs 更长（15-30 分钟）', () => {
    const workflow = yaml.load(readFileSync(
      join(WORKFLOWS_DIR, 'ci-l3-code.yml'), 'utf8'
    )) as any;
    const engineL3 = workflow.jobs['engine-l3'];
    expect(engineL3['timeout-minutes']).toBeGreaterThanOrEqual(15);
    expect(engineL3['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('快速 jobs 超时应该短（≤ 5 分钟）', () => {
    for (const file of CI_FILES) {
      if (!existsSync(file.path)) continue;
      const workflow = yaml.load(readFileSync(file.path, 'utf8')) as any;

      // changes job + passed gate jobs 应该都是 5 分钟以下
      const fastJobs = ['changes'];
      // 每个文件的 *-passed job
      const passedJob = Object.keys(workflow.jobs).find(j => j.endsWith('-passed'));
      if (passedJob) fastJobs.push(passedJob);

      for (const jobName of fastJobs) {
        const job = workflow.jobs[jobName];
        if (!job) continue;
        expect(
          job['timeout-minutes'],
          `${file.name}: ${jobName} should have short timeout (≤ 5)`
        ).toBeLessThanOrEqual(5);
      }
    }
  });

  it('不应该有默认 360 分钟的 jobs（所有 jobs 必须有显式 timeout）', () => {
    for (const file of CI_FILES) {
      if (!existsSync(file.path)) continue;
      const workflow = yaml.load(readFileSync(file.path, 'utf8')) as any;

      Object.keys(workflow.jobs).forEach(jobName => {
        const job = workflow.jobs[jobName];
        expect(
          job['timeout-minutes'],
          `${file.name}: Job ${jobName} must have explicit timeout`
        ).toBeDefined();
      });
    }
  });
});
