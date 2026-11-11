import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

for (const [jobName, installName] of [['checks', 'Install test tools'], ['pwa-upgrade', 'Install Chromium']]) {
  test(`${jobName} prepares Ubuntu package sources before mandatory installation`, () => {
    const job = workflow.jobs[jobName];
    const install = job.steps.findIndex(step => step.name === installName);
    const preparation = job.steps.findIndex(step => step.run === 'node scripts/ci/prepare-ubuntu-archive.mjs');
    assert.ok(preparation >= 0 && preparation < install, 'the failing Azure mirror must be removed before package installation');
    const step = job.steps[preparation];
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
    assert.equal(step['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? '.', '.');
    assert.equal(job.steps[install].if, undefined);
    assert.equal(job.steps[install]['continue-on-error'], undefined);
    if (jobName === 'pwa-upgrade') assert.equal(job.steps[install].run, 'node e2e/playwright-cli.mjs install chromium --with-deps');
  });
}
