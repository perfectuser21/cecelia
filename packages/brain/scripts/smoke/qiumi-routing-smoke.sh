#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-routing-smoke.sh
# Smoke: 秋米路由判定（PR3-甲）真库三闸——假 Jev（fetchFn）+ 真 Postgres（cecelia_test）。
# 只验判定层（routing/*）：agent 决策 / device 派生子任务+对账 / 设备含糊 fail-closed。
# 收割与中文表推送收窄那两闸要 import openclaw-agent-executor.js 与 notion-gtd-sync.js，
# 都是 PR3-乙 才落地的文件，见 qiumi-dispatch-smoke.sh。
# 闸的内容见 .mjs 头注释。只删自己插的行（固定 title 前缀 + 序列号 SMOKE1），绝不动别人的行。
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

# db.js 走 db-config 的 DB_NAME/DB_HOST（不读 DATABASE_URL）：凡是走模块级默认 Pool 的调用
# 都认那两个变量，不对齐会去连默认库名 cecelia，把本 smoke 的结果变成假绿/假红。
export DB_NAME="$DB_NAME"
export DB_HOST="$DB_HOST"

# 三闸需要三组不同的 Jev 答案，所以 stub 写在 .mjs 里按闸构造，不走 env.js 的 QIUMI_JEV_STUB 单值开关。
# 这里只保证 JEV_API_KEY 有值——没有 key 时 decideWithFallback 会跳过 jev 直接去问 terra（真打 LLM）。
export JEV_API_KEY="${JEV_API_KEY:-smoke-stub}"

# 本 smoke 验的是 device 派生层（闸 2/3 断言父任务 blocked/delegated_device_job + 子任务）。
# 0923 起该层封存在 QIUMI_DEVICE_DELEGATION_ENABLED 后面（默认关＝手机活走 openclaw agent），
# 不显式打开这里就是 12 项假红。默认关那条路的真库 smoke 在 qiumi-phone-agent-smoke.sh。
export QIUMI_DEVICE_DELEGATION_ENABLED=true

cd "$(dirname "$0")/../.." && node scripts/smoke/qiumi-routing-smoke.mjs
