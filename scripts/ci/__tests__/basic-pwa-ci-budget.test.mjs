import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const config = yaml.load(readFileSync(new URL('../../../.github/workflows/ci-dashboard-pwa-e2e.yml', import.meta.url), 'utf8'));
const job = config.jobs['pwa-upgrade'];

test('slow system packages leave sufficient time for the browser acceptance suite', () => {
  // Real CI: install took 392s; an independent successful run needed 290s for all other steps.
  // Add 180s of headroom rather than allowing the observed combination to time out.
  const observedInstall = 392;
  const observedRemainder = 290;
  const headroom = 180;
  assert.ok(job['timeout-minutes'] * 60 >= observedInstall + observedRemainder + headroom,
    'PWA job timeout must accommodate the observed slow installation and the full test suite');
});

test('system dependency installation stays bounded and does not skip browser checks', () => {
  const install = job.steps.find(step => step.name === 'Install Chromium');
  assert.match(install.run, /\binstall chromium --with-deps\b/);
  assert.ok(install['timeout-minutes'] >= 7 && install['timeout-minutes'] <= 10,
    'slow dependency installation needs a bounded 7–10 minute step budget');
  for (const name of ['Verify stale PWA upgrade', 'Verify task desk receipts', 'Verify current cockpit inbox and destination routes']) {
    const step = job.steps.find(candidate => candidate.name === name);
    assert.ok(step && step.run && !step.if && !step['continue-on-error'], `${name} must remain mandatory`);
  }
});
