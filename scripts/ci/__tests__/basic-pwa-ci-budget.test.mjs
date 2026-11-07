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

function assertMandatoryChecks(candidate) {
  const install = candidate.steps.find(step => step.name === 'Install Chromium');
  assert.ok(install && !install.if && !install['continue-on-error']);
  assert.equal(install.run.trim(), 'node e2e/playwright-cli.mjs install chromium --with-deps');
  assert.ok(install['timeout-minutes'] >= 7 && install['timeout-minutes'] <= 10,
    'slow dependency installation needs a bounded 7–10 minute step budget');
  const expectedCommands = {
    'Verify stale PWA upgrade': ['npm run test:pwa-upgrade'],
    'Verify task desk receipts': ['npm run test:task-desk'],
    'Verify current cockpit inbox and destination routes': [
      'GIT_SHA="$GITHUB_SHA" npx --no-install vite build --outDir .dist-pwa-e2e',
      'node e2e/playwright-cli.mjs test --config ../../tests/regression/manual-ui/playwright.config.ts',
    ],
  };
  for (const [name, commands] of Object.entries(expectedCommands)) {
    const step = candidate.steps.find(step => step.name === name);
    assert.ok(step && step.run && !step.if && !step['continue-on-error'], `${name} must remain mandatory`);
    const lines = step.run.split('\n').map(line => line.trim());
    for (const command of commands) assert.ok(lines.includes(command), `${name} must execute ${command}`);
  }
}

test('system dependency installation stays bounded and does not skip browser checks', () => {
  assertMandatoryChecks(job);
});

for (const name of ['Install Chromium', 'Verify stale PWA upgrade', 'Verify task desk receipts', 'Verify current cockpit inbox and destination routes']) {
  test(`a no-op cannot stand in for ${name}`, () => {
    const mutated = structuredClone(job);
    const step = mutated.steps.find(candidate => candidate.name === name);
    step.run = `echo ${JSON.stringify(step.run)}`;
    assert.throws(() => assertMandatoryChecks(mutated));
  });
  test(`an empty command cannot stand in for ${name}`, () => {
    const mutated = structuredClone(job);
    mutated.steps.find(candidate => candidate.name === name).run = '';
    assert.throws(() => assertMandatoryChecks(mutated));
  });
}

for (const fragment of ['vite build', 'playwright-cli.mjs test']) {
  test(`cockpit check cannot omit ${fragment}`, () => {
    const mutated = structuredClone(job);
    const step = mutated.steps.find(candidate => candidate.name === 'Verify current cockpit inbox and destination routes');
    step.run = step.run.split('\n').filter(line => !line.includes(fragment)).join('\n');
    assert.throws(() => assertMandatoryChecks(mutated));
  });
}
