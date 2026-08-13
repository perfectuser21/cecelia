#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  process.stderr.write(`[frozen-contract-artifacts] ${message}\n`);
  process.exit(1);
}

const [bundlePath, workspacePath] = process.argv.slice(2);
if (!bundlePath || !workspacePath) fail('bundle and workspace are required');

let envelope;
try {
  envelope = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
} catch (error) {
  fail(`invalid TaskBundle envelope: ${error.message}`);
}

const bundle = envelope.task_bundle;
const role = bundle?.role;
if (!['generator', 'evaluator'].includes(role)) process.exit(0);
const inputs = bundle?.inputs;
const artifacts = inputs?.artifacts;
const sprintDir = inputs?.sprint_dir;
const approvedSha = inputs?.contract?.approved_sha;
if ((!Array.isArray(artifacts) || artifacts.length === 0) && approvedSha == null) {
  process.stdout.write(`[frozen-contract-artifacts] legacy ${role} has no managed contract\n`);
  process.exit(0);
}
if (!Array.isArray(artifacts) || artifacts.length === 0) fail('frozen test artifacts missing');
if (typeof sprintDir !== 'string' || !sprintDir || sprintDir.includes('\\')
    || sprintDir.startsWith('/') || sprintDir.split('/').includes('..')) {
  fail('invalid sprint directory');
}
if (!/^[a-f0-9]{40}$/.test(approvedSha ?? '')) fail('approved SHA missing');

const workspace = path.resolve(workspacePath);
const prefix = `${sprintDir.replace(/\/$/, '')}/tests/`;
const seen = new Set();
for (const artifact of artifacts) {
  if (artifact?.type !== 'frozen_contract_test'
      || typeof artifact.path !== 'string'
      || !artifact.path.startsWith(prefix)
      || artifact.path.includes('\\')
      || artifact.path.split('/').includes('..')
      || typeof artifact.content !== 'string'
      || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? '')
      || artifact.source_sha !== approvedSha
      || seen.has(artifact.path)) {
    fail('invalid frozen test descriptor');
  }
  seen.add(artifact.path);
  const actualDigest = crypto.createHash('sha256').update(artifact.content).digest('hex');
  if (actualDigest !== artifact.sha256) fail(`digest mismatch: ${artifact.path}`);
  const target = path.resolve(workspace, artifact.path);
  if (!target.startsWith(`${workspace}${path.sep}`)) fail(`path escaped workspace: ${artifact.path}`);

  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target, 'utf8');
    if (existing !== artifact.content) fail(`frozen test diverged: ${artifact.path}`);
  } else if (role === 'evaluator') {
    fail(`candidate PR is missing frozen test: ${artifact.path}`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, artifact.content, { encoding: 'utf8', flag: 'wx', mode: 0o444 });
  }
}

process.stdout.write(`[frozen-contract-artifacts] verified ${artifacts.length} tests for ${role}\n`);
