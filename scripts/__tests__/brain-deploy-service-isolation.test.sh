#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/scripts/brain-deploy.sh"

node --input-type=module - "$DEPLOY_SCRIPT" <<'NODE'
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const lines = source.split('\n');
const lifecycleBlocks = [];

for (let index = 0; index < lines.length; index += 1) {
  if (!lines[index].trimStart().startsWith('docker compose')) continue;
  const block = lines.slice(index, index + 4).join('\n');
  if (/\b(?:up -d|down)\b/.test(block)) lifecycleBlocks.push(block);
}

if (lifecycleBlocks.length === 0) {
  console.error('FAIL: brain-deploy.sh 中未找到 compose 生命周期命令');
  process.exit(1);
}

const unscoped = lifecycleBlocks.filter(block => !/\bnode-brain\b/.test(block));
if (unscoped.length > 0) {
  console.error(`FAIL: ${unscoped.length} 个 Brain 部署命令未限定 node-brain，会重建 frontend`);
  for (const block of unscoped) console.error(`---\n${block}`);
  process.exit(1);
}

console.log(`PASS: ${lifecycleBlocks.length} 个 Brain compose 生命周期命令均限定 node-brain`);
NODE
