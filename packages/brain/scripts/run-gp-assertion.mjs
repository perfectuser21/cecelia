#!/usr/bin/env node

/* global console, process */

import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGpAssertion } from '../src/gp-assertion-runner.js';

function argumentError(message) {
  return Object.assign(new Error(message), { code: 'INVALID_ARGUMENTS' });
}

export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--verdict') {
      throw argumentError('--verdict is forbidden');
    }
    if (!['--link-id', '--run-id'].includes(flag)) {
      throw argumentError(`Unsupported argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw argumentError(`${flag} requires a value`);
    }
    const key = flag === '--link-id' ? 'linkId' : 'runId';
    if (parsed[key]) throw argumentError(`${flag} may be supplied only once`);
    parsed[key] = value;
    index += 1;
  }
  if (!parsed.linkId) throw argumentError('--link-id is required');
  return parsed;
}

async function resolveRepoRoot() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  return realpath(resolve(scriptDirectory, '../../..'));
}

async function loadPoolWithoutStdoutNoise() {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return (await import('../src/db.js')).default;
  } finally {
    console.log = originalLog;
  }
}

export async function defaultRun(
  { linkId, runId },
  {
    resolveRoot = resolveRepoRoot,
    loadPool = loadPoolWithoutStdoutNoise,
    runAssertion = runGpAssertion,
  } = {},
) {
  const repoRoot = await resolveRoot();
  const pool = await loadPool();
  try {
    return await runAssertion({ pool, linkId, runId, repoRoot });
  } finally {
    await pool.end();
  }
}

export async function main({
  argv = process.argv.slice(2),
  run = defaultRun,
  randomId = randomUUID,
  writeStderr = value => process.stderr.write(value),
} = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    writeStderr(`${JSON.stringify({
      error: error.code ?? 'INVALID_ARGUMENTS',
      message: error.message,
    })}\n`);
    return 2;
  }
  try {
    await run({
      linkId: parsed.linkId,
      runId: parsed.runId ?? randomId(),
    });
    return 1;
  } catch (error) {
    writeStderr(`${JSON.stringify({
      error: error.code ?? 'ASSERTION_RUN_FAILED',
      message: error.message,
    })}\n`);
    return 1;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(exitCode => {
    process.exitCode = exitCode;
  });
}
