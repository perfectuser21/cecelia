#!/usr/bin/env bash
# generator-publisher-boundary-smoke.sh
# Generator/Publisher 权限边界生产回归 smoke（Sprint 08160155-kernel-ff2b0fa9）
#
# 守三条边界（纯源结构断言，免装 npm / 无 DB / 可 CI 长期反复运行）：
#   B1  Dispatcher 为 role=generator 注入 server-owned runtime_resources 且 postgres=true
#       （caller false 不降权由 permanent vitest 承担真值行为断言，本 smoke 只锁源结构）
#   B2  generator objective = 只产本地已提交候选，明确不 push / 不建 PR
#   B3  publisher objective = 唯一远端发布角色（只发布 Judge/merge fence 授权的 exact 候选）
#
# 降级语义（PRD 边界情况）：dispatcher.js 不存在（容器镜像未带 src 目录）→ ENOENT 放行退出 0，
#   不假绿也不误红（与既有 smoke 的 skip_if_unavailable 语义一致）。任一断言失败 → 打印失败
#   边界名并非零退出。
#
# 权限不扩大：本 smoke 只读源文件断言边界不变，不改任何凭据/权限。
set -uo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DISPATCHER="$REPO_ROOT/packages/brain/src/orchestrator/dispatcher.js"

if [ ! -f "$DISPATCHER" ]; then
  printf 'SKIP: dispatcher.js 不存在（镜像未带 src 目录），按降级语义放行\n'
  exit 0
fi

fail() { printf 'FAIL[%s]: %s\n' "$1" "$2" >&2; exit 1; }

# 用 node 内建 fs + 正则解析源结构（免装 npm，无 DB）。node 缺失极罕见，作硬前提。
command -v node >/dev/null 2>&1 || fail ENV "node 不可用，无法解析 dispatcher 源结构"

DISPATCHER="$DISPATCHER" node <<'NODE'
const fs = require('node:fs');
const src = fs.readFileSync(process.env.DISPATCHER, 'utf8');
const die = (b, m) => { process.stderr.write(`FAIL[${b}]: ${m}\n`); process.exit(1); };

// ── B1: generator 纳入 server-owned runtime_resources 注入，且 postgres 为 true ──
// 定位 runtime_resources 注入的角色门（形如 ['proposer','reviewer','evaluator','generator'].includes(spec.role)）
const gateMatch = src.match(/\[([^\]]*?)\]\.includes\(spec\.role\)\s*\)\s*\{\s*common\.runtime_resources\s*=\s*\{([\s\S]*?)\};/);
if (!gateMatch) die('B1', 'runtime_resources 注入的角色门/赋值块未找到（结构漂移）');
const roleGate = gateMatch[1];
const assignBody = gateMatch[2];
if (!/['"]generator['"]/.test(roleGate)) die('B1', "runtime_resources 角色门未包含 'generator'（generator 未获 server-owned 资源）");
// postgres 表达式必须让 generator 得到 true：evaluator/generator 分支或直接 true
const postgresLine = (assignBody.match(/postgres\s*:\s*([^,\n]+)/) || [])[1] || '';
const generatorGetsPostgres = /['"]generator['"]/.test(postgresLine) || /(^|[^!])\btrue\b/.test(postgresLine.trim());
if (!generatorGetsPostgres) die('B1', `generator 未获 postgres=true（postgres 表达式=${postgresLine.trim()}）`);

// ── B2: generator objective 只产本地候选、不 push/建 PR ──
const genObj = (src.match(/generator:\s*'((?:[^'\\]|\\.)*)'/) || [])[1] || '';
if (!/committed local candidate/i.test(genObj)) die('B2', 'generator objective 未声明 committed local candidate');
if (!/Do not push or create a pull request/i.test(genObj)) die('B2', 'generator objective 未禁止 push/建 PR');
if (!/Publisher owns remote publication/i.test(genObj)) die('B2', 'generator objective 未把远端发布交给 Publisher');

// ── B3: publisher 是唯一远端发布角色 ──
const pubObj = (src.match(/publisher:\s*'((?:[^'\\]|\\.)*)'/) || [])[1] || '';
if (!/Publish only the exact local candidate/i.test(pubObj)) die('B3', 'publisher objective 未锁定"只发布 Judge/merge fence 授权的 exact 候选"');
if (!/Judge and merge fence/i.test(pubObj)) die('B3', 'publisher objective 未引用 Judge and merge fence 授权闸');

process.stdout.write('PASS: B1 generator server-owned postgres | B2 generator no-push local candidate | B3 publisher sole remote publisher\n');
NODE
