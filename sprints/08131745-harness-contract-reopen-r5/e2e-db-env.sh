#!/usr/bin/env bash
# e2e-db-env.sh — 从连接串派生离散 DB 连接变量（幂等）。
#
# 背景：DB_DEFAULTS（packages/brain/src/db-config.js）与 migrate.js 只认离散变量
#   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD；而 Fleet evaluator（模式B）
#   与本 sprint 的 run-case.sh / E2E 只被注入一个连接串（DB_URL）。本脚本把连接串
#   解析成离散变量并 export，同时保证 DATABASE_URL / DB 存在（contract-store.test.js
#   的 HAS_REAL_POSTGRES 门控 = DATABASE_URL || DB）。
#
# 幂等：已存在的离散变量原样保留（CI dod-behavior-dynamic 两者都注入），仅补齐缺失项。
# 被 `source` 调用（run-case.sh / E2E 脚本），运行在调用方的 `set -euo pipefail` 下，
# 故所有展开都用 `${VAR:-}` 默认值，规避 nounset。

# 关闭 vitest ANSI 颜色：run-case.sh / E2E 脚本用 `grep -qE 'Tests[^0-9]*[1-9][0-9]* passed'`
# 断言 vitest 摘要，而彩色摘要里数字前的转义序列（如 [1m/[32m）含数字，会截断 [^0-9]* 桥接
# 导致 grep 匹配不到真实计数（实证 dod-behavior-dynamic：测试 ✓ 通过但 run-case.sh 报 FAIL）。
# run-case.sh 在跑 vitest 前 source 本文件，故在此关色让摘要为纯文本，断言即稳定命中。
export NO_COLOR="${NO_COLOR:-1}"
export FORCE_COLOR="${FORCE_COLOR:-0}"

_SRC_URL="${DB_URL:-${DATABASE_URL:-${DB:-}}}"

if [ -n "${_SRC_URL}" ]; then
  # postgresql://user[:password]@host[:port]/dbname[?query]
  _re='^[a-zA-Z][a-zA-Z0-9+.-]*://([^:/@]+)(:([^@/]*))?@([^:/]+)(:([0-9]+))?/([^?]+)'
  if [[ "${_SRC_URL}" =~ ${_re} ]]; then
    export DB_USER="${DB_USER:-${BASH_REMATCH[1]}}"
    export DB_PASSWORD="${DB_PASSWORD:-${BASH_REMATCH[3]}}"
    export DB_HOST="${DB_HOST:-${BASH_REMATCH[4]}}"
    export DB_PORT="${DB_PORT:-${BASH_REMATCH[6]:-5432}}"
    export DB_NAME="${DB_NAME:-${BASH_REMATCH[7]}}"
  fi
  export DATABASE_URL="${DATABASE_URL:-${_SRC_URL}}"
  export DB="${DB:-${_SRC_URL}}"
fi

unset _SRC_URL _re 2>/dev/null || true
