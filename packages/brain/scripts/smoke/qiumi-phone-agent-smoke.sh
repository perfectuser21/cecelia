#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-phone-agent-smoke.sh
# Smoke: 秋米手机活改走 OpenClaw agent（开关 QIUMI_DEVICE_DELEGATION_ENABLED）真库三闸
#   —— 假 Jev（fetchFn）+ 假 ssh（spawnFn）+ 真 Postgres（cecelia_test）。
# 三闸：默认关走 agent 并留痕 device_hint / 开关开仍派生 device_job 子任务 / agent prompt 带设备提示段。
# 判定层旧三闸在 qiumi-routing-smoke.sh，收割层在 qiumi-dispatch-smoke.sh，本刀只验开关这条新缝。
# 闸的内容见 .mjs 头注释。只删自己插的行（固定 title 前缀带 pid + 序列号 SMOKE-<pid>），绝不动别人的行。
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

# db.js 走 db-config 的 DB_NAME/DB_HOST（不读 DATABASE_URL）：openclaw-agent-executor 里
# recordTaskEventSafe 之外若有走模块级默认 Pool 的调用，都认这两个变量，不对齐会去连默认库名
# cecelia，把本 smoke 的结果变成假绿/假红。
export DB_NAME="$DB_NAME"
export DB_HOST="$DB_HOST"

# 两个闸的 env 由 .mjs 按闸构造（qiumiEnv 吃传入对象），这里只保证 JEV_API_KEY 有值——
# 没有 key 时 decideWithFallback 会跳过 jev 直接去问 terra（真打 LLM）。
export JEV_API_KEY="${JEV_API_KEY:-smoke-stub}"

# 闸 3 断言节点名是 'XIAN-M4-PHONE'，而它由 deviceHintOf → phoneNodeName 按 process.env 里的
# QIUMI_PHONE_NODE_MAP 决定（映射表优先于 `<HOST>-PHONE` 派生）。执行机上若恰好配了这张表，
# 断言会无缘无故变红/变绿，所以先摘干净——本 smoke 验的是派生规则，不是某台机的映射配置。
unset QIUMI_PHONE_NODE_MAP
# 同理：开关由 .mjs 按闸显式传，外部导出的值一律不许漏进来（漏进来闸 1 就在验开关开的行为）。
unset QIUMI_DEVICE_DELEGATION_ENABLED

cd "$(dirname "$0")/../.." && node scripts/smoke/qiumi-phone-agent-smoke.mjs
