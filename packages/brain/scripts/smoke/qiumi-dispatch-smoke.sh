#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-dispatch-smoke.sh
# Smoke: 秋米派发与收割（PR3-乙）真库三闸——假 ssh（execFileFn）+ 真 Postgres（cecelia_test）。
# 只验接线之后这一层：收割结账 / 还在跑的不许被结账 / device_job 子任务进不了中文表推送窗口。
# 判定层（routing/*）那三闸在 PR3-甲 的 qiumi-routing-smoke.sh。
# 闸的内容见 .mjs 头注释。只删自己插的行（固定 title 前缀带 pid），绝不动别人的行。
set -euo pipefail
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"
# host 守卫：只准 localhost/127.0.0.1，或本机自己的 hostname（防 DATABASE_URL 被误配成远程生产 host——
# 光凭库名后缀 _test/_scratch 判断不出连去了哪台机）。
DB_HOST="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(u.hostname)" "$DATABASE_URL")"
[[ -n "$DB_HOST" ]] || fail "拒绝连接：DATABASE_URL 解析不出 host"
SELF_SHORT="$(hostname -s 2>/dev/null || true)"
SELF_FQDN="$(hostname -f 2>/dev/null || hostname 2>/dev/null || true)"
case "$DB_HOST" in
  localhost|127.0.0.1) ;;
  *) [[ -n "$SELF_SHORT" && "$DB_HOST" == "$SELF_SHORT" ]] || [[ -n "$SELF_FQDN" && "$DB_HOST" == "$SELF_FQDN" ]] \
       || fail "拒绝连接非本机数据库 host: ${DB_HOST}（只准 localhost/127.0.0.1/本机 hostname）" ;;
esac

# db.js 走 db-config 的 DB_NAME/DB_HOST（不读 DATABASE_URL）：openclaw-agent-executor 的默认 pool
# 就是那个模块级 Pool，不对齐会去连默认库名 cecelia，把本 smoke 的结果变成假绿/假红。
export DB_NAME="$DB_NAME"
export DB_HOST="$DB_HOST"

cd "$(dirname "$0")/../.." && node scripts/smoke/qiumi-dispatch-smoke.mjs
