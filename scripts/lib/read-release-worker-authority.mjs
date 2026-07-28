#!/usr/bin/env node
import { readPrivateReleaseWorkerConfig } from '../../packages/brain/src/orchestrator/release-run-worker-secret.js';

const [file] = process.argv.slice(2);
try {
  const value = readPrivateReleaseWorkerConfig(file);
  process.stdout.write(`${value.authorization}\t${value.deploy_token}`);
} catch {
  process.exitCode = 78;
}
