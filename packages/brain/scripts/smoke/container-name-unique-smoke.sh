#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"; cd "$ROOT_DIR"
node --input-type=module -e "
import { readFileSync } from 'fs';
const de = readFileSync('./packages/brain/src/docker-executor.js','utf8');
// 容器名必须带唯一后缀
if (!/randomBytes\(\d+\)\.toString\('hex'\)/.test(de)) { console.error('FAIL: containerName 无唯一后缀'); process.exit(1); }
if (!de.includes('cecelia-task-')) { console.error('FAIL: 前缀契约丢失'); process.exit(1); }
const gan = readFileSync('./packages/brain/src/workflows/harness-gan.graph.js','utf8');
if (gan.includes('cleanupContainer') || /\['rm',\s*'-f'/.test(gan)) { console.error('FAIL: 仍残留 cleanup/rm-f hack'); process.exit(1); }
const q = readFileSync('./packages/brain/src/quarantine.js','utf8');
if (!q.includes('startsWith')) { console.error('FAIL: quarantine 未改前缀匹配'); process.exit(1); }
console.log('OK: container-name-unique smoke passed');
"
