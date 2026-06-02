#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"; cd "$ROOT_DIR"
node --input-type=module -e "
import { readFileSync } from 'fs';
const s = readFileSync('./packages/brain/src/workflows/harness-gan.graph.js','utf8');
if (!s.includes('defaultCleanupContainer')) { console.error('FAIL: 无 defaultCleanupContainer'); process.exit(1); }
if (!s.includes('await cleanupContainer(taskId)')) { console.error('FAIL: spawn 前未清理容器'); process.exit(1); }
// 关键回归守卫：绝不能用 rm -f（会杀活容器 → exit 137）
if (/\['rm',\s*'-f'/.test(s)) { console.error('FAIL: 仍用 rm -f 会杀活容器！'); process.exit(1); }
if (!/\['rm',\s*name\]/.test(s)) { console.error('FAIL: 未用安全的 docker rm name'); process.exit(1); }
if (!s.includes('cecelia-task-')) { console.error('FAIL: 容器名契约丢失'); process.exit(1); }
console.log('OK: docker-name-collision smoke passed（rm 不带 -f，不杀活容器）');
"
