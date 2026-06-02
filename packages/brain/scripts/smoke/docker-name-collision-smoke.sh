#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"; cd "$ROOT_DIR"
node --input-type=module -e "
import { readFileSync } from 'fs';
const s = readFileSync('./packages/brain/src/docker-executor.js','utf8');
if (!s.includes('removeStaleContainer')) { console.error('FAIL: 无 removeStaleContainer'); process.exit(1); }
if (!s.includes('await removeStaleContainer(name)')) { console.error('FAIL: executeInDocker 未在跑前清理'); process.exit(1); }
if (!s.includes(\"'rm', '-f'\")) { console.error('FAIL: 未用 docker rm -f'); process.exit(1); }
console.log('OK: docker-name-collision smoke passed');
"
