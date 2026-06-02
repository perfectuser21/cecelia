#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"; cd "$ROOT_DIR"
node --input-type=module -e "
import { readFileSync } from 'fs';
const s = readFileSync('./packages/brain/src/workflows/harness-gan.graph.js','utf8');
if (!s.includes('defaultCleanupContainer')) { console.error('FAIL: 无 defaultCleanupContainer'); process.exit(1); }
if (!s.includes('await cleanupContainer(taskId)')) { console.error('FAIL: spawn 前未清理容器'); process.exit(1); }
if (!s.includes(\"'rm', '-f'\")) { console.error('FAIL: 未用 docker rm -f'); process.exit(1); }
// 容器名必须保持确定性 cecelia-task-{id}（跨系统查找契约，不能随机化）
if (!s.includes('cecelia-task-')) { console.error('FAIL: 容器名契约丢失'); process.exit(1); }
console.log('OK: docker-name-collision smoke passed');
"
