#!/usr/bin/env bash
# self_model 滚动窗口冒烟：真调用 trimSelfModelContent 验证 128KB 上限、头部保留、最老先裁。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

node --input-type=module -e "
import { trimSelfModelContent, MAX_SELF_MODEL_BYTES } from './packages/brain/src/self-model.js';
const head = '头部身份段，永不裁剪。';
const entries = Array.from({ length: 1500 }, (_, i) => \`[2026-0\${(i % 8) + 1}-1\${i % 9}] 第 \${i} 条洞察：\` + 'x'.repeat(180));
const content = head + '\n\n' + entries.join('\n\n');
const out = trimSelfModelContent(content);
if (Buffer.byteLength(out, 'utf8') > MAX_SELF_MODEL_BYTES) { console.error('超上限'); process.exit(1); }
if (!out.startsWith(head)) { console.error('头部被裁'); process.exit(1); }
if (!out.includes('第 1499 条洞察')) { console.error('最新条目丢失'); process.exit(1); }
if (out.includes('第 0 条洞察')) { console.error('最老条目未被裁'); process.exit(1); }
console.log('trim ok', Buffer.byteLength(out, 'utf8'), 'bytes');
" || fail "trimSelfModelContent 行为不符"
pass "128KB 滚动窗口：上限/头部保留/最老先裁/最新保留"
echo "selfmodel-cap-smoke: ALL PASS"
