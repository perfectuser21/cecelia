import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { prepareUbuntuSources, assertHostedUbuntu } from '../prepare-ubuntu-archive.mjs';

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

const stanza = (suite, uri = 'mirror+file:/etc/apt/apt-mirrors.txt') =>
  `Types: deb\nURIs: ${uri}\nSuites: ${suite}\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`;
const thirdParty = '# Separate package owner\nTypes: deb\nURIs: https://packages.example.test/repo\nSuites: stable\nComponents: main\nSigned-By: /usr/share/keyrings/third-party.gpg\n';

test('Ubuntu mirror selection is removed while suites, signing and third-party sources remain unchanged', () => {
  const primary = stanza('noble noble-updates noble-backports');
  const security = stanza('noble-security', 'mirror+file:/etc/apt/apt-mirrors-security.txt');
  const input = primary + '\n' + security + '\n' + thirdParty;
  const actual = prepareUbuntuSources(input);
  assert.equal(actual, primary.replace('mirror+file:/etc/apt/apt-mirrors.txt', 'https://archive.ubuntu.com/ubuntu')
    + '\n' + security.replace('mirror+file:/etc/apt/apt-mirrors-security.txt', 'https://security.ubuntu.com/ubuntu')
    + '\n' + thirdParty);
  assert.equal(prepareUbuntuSources(actual), actual);
});

test('Azure Ubuntu URIs use the official security archive for security suites', () => {
  assert.equal(prepareUbuntuSources(stanza('noble-security', 'http://azure.archive.ubuntu.com/ubuntu')),
    stanza('noble-security', 'https://security.ubuntu.com/ubuntu'));
});

test('Windows line endings and comments are retained', () => {
  const input = ('# Ubuntu archive\n' + stanza('noble')).replaceAll('\n', '\r\n');
  assert.equal(prepareUbuntuSources(input), input.replace('mirror+file:/etc/apt/apt-mirrors.txt', 'https://archive.ubuntu.com/ubuntu'));
});

test('unsupported Ubuntu sources fail before any source file can be written', () => {
  for (const input of [
    stanza('noble', 'https://unknown.example/ubuntu'),
    stanza('noble noble-security'),
    stanza('noble').replace('Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n', ''),
    stanza('noble').replace('Suites: noble', 'Suites:'),
    stanza('noble').replace('Types: deb', 'Types: deb\nTypes: deb-src'),
    stanza('noble').replace('Suites: noble', 'Suites: noble\n noble-updates'),
    thirdParty,
  ]) assert.throws(() => prepareUbuntuSources(input), /ubuntu_source/);
});

test('only GitHub-hosted Linux Ubuntu can prepare the fixed package source file', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux' };
  assert.doesNotThrow(() => assertHostedUbuntu(env, 'linux', 'ID=ubuntu\n'));
  for (const [changedEnv, platform, release] of [
    [{ ...env, GITHUB_ACTIONS: 'false' }, 'linux', 'ID=ubuntu\n'],
    [{ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux', 'ID=ubuntu\n'],
    [{ ...env, RUNNER_OS: 'Windows' }, 'linux', 'ID=ubuntu\n'],
    [env, 'darwin', 'ID=ubuntu\n'],
    [env, 'linux', 'ID=debian\n'],
  ]) assert.throws(() => assertHostedUbuntu(changedEnv, platform, release), /github_hosted_ubuntu_required/);
});

test('CLI refuses a non-Actions process with a nonzero exit', () => {
  const child = spawnSync(process.execPath, [new URL('../prepare-ubuntu-archive.mjs', import.meta.url).pathname],
    { env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'false' }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
});
