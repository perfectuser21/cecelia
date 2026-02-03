import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

describe('CI Workflow - Timeout Configuration', () => {
  const workflowPath = join(__dirname, '../../.github/workflows/ci.yml');
  let workflow: any;

  it('C1-004: 所有关键 jobs 应该有 timeout-minutes', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    const criticalJobs = [
      'version-check',
      'test',
      'impact-check',
      'contract-drift-check',
      'known-failures-protection',
      'config-audit',
      'regression-pr',
      'release-check',
      'ci-passed',
    ];

    criticalJobs.forEach(jobName => {
      const job = workflow.jobs[jobName];
      expect(job, `Job ${jobName} should exist`).toBeDefined();
      expect(job['timeout-minutes'], `Job ${jobName} should have timeout-minutes`).toBeDefined();
      expect(job['timeout-minutes'], `Job ${jobName} timeout should be reasonable (< 60)`).toBeLessThanOrEqual(60);
    });
  });

  it('impact-check 应该有 5 分钟超时', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    const impactCheck = workflow.jobs['impact-check'];
    expect(impactCheck).toBeDefined();
    expect(impactCheck['timeout-minutes']).toBe(5);
  });

  it('test job 超时应该合理（30 分钟）', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    const testJob = workflow.jobs.test;
    expect(testJob).toBeDefined();
    expect(testJob['timeout-minutes']).toBe(30);
  });

  it('regression jobs 超时应该更长（15-30 分钟）', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    const regressionPr = workflow.jobs['regression-pr'];
    const releaseCheck = workflow.jobs['release-check'];

    expect(regressionPr['timeout-minutes']).toBeGreaterThanOrEqual(15);
    expect(regressionPr['timeout-minutes']).toBeLessThanOrEqual(30);

    expect(releaseCheck['timeout-minutes']).toBeGreaterThanOrEqual(15);
    expect(releaseCheck['timeout-minutes']).toBeLessThanOrEqual(30);
  });

  it('快速 jobs 超时应该短（1-5 分钟）', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    const fastJobs = ['version-check', 'impact-check', 'contract-drift-check', 'ci-passed'];

    fastJobs.forEach(jobName => {
      const job = workflow.jobs[jobName];
      expect(job['timeout-minutes'], `${jobName} should have short timeout`).toBeLessThanOrEqual(5);
    });
  });

  it('不应该有默认 360 分钟的 jobs', () => {
    const content = readFileSync(workflowPath, 'utf8');
    workflow = yaml.load(content);

    // 检查所有 jobs 都有显式 timeout
    Object.keys(workflow.jobs).forEach(jobName => {
      const job = workflow.jobs[jobName];
      expect(job['timeout-minutes'], `Job ${jobName} must have explicit timeout`).toBeDefined();
    });
  });
});
