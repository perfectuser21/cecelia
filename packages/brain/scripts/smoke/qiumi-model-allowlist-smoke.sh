#!/usr/bin/env bash
# packages/brain/scripts/smoke/qiumi-model-allowlist-smoke.sh
# Smoke: 秋米路由认正文「用 <型号>」（只认 QIUMI_MODEL_ALLOWLIST）真库闸——
#   假 Jev（注入 fetchFn）+ 真 Postgres（cecelia_test），不打真 LLM、不碰真机。
# 闸 0 清单到位 / 闸 1 全名命中压过 engine 查表并落两张真表 / 闸 2 短名歧义（opus-5 不撞 opus-5-5、纯后缀 sol）
#   / 闸 3 不写型号回落 modelMap[engine] + 「用 claude」走 anthropic 原生。
# 判定层旧三闸在 qiumi-routing-smoke.sh，手机活开关在 qiumi-phone-agent-smoke.sh，本刀都不重复。
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

# db.js 走 db-config 的 DB_NAME/DB_HOST（不读 DATABASE_URL）：凡是走模块级默认 Pool 的调用
# 都认那两个变量，不对齐会去连默认库名 cecelia，把本 smoke 的结果变成假绿/假红。
export DB_NAME="$DB_NAME"
export DB_HOST="$DB_HOST"

# 闸的 env 由 .mjs 按闸构造（qiumiEnv 吃传入对象），这里只保证 JEV_API_KEY 有值——
# 没有 key 时 decideWithFallback 会跳过 jev 直接去问 terra（真打 LLM）。
export JEV_API_KEY="${JEV_API_KEY:-smoke-stub}"

# 本 smoke 的地基：允许清单原样取自 OpenClaw agents.defaults.modelPolicy.allow。
# 清单空掉时四个闸会退化成「都没命中所以都对」的假绿，所以 .mjs 闸 0 先断言它有 5 条。
export QIUMI_MODEL_ALLOWLIST='["openai/gpt-5.6-terra","openai/gpt-5.6-sol","anthropic/claude-opus-5","anthropic/claude-opus-5-5","xai/grok-4.7"]'
# 闸 1/3 拿 modelMap[engine] 当对照（codex→openai/gpt-5.3-codex、terra→openai/gpt-5.6-terra、
# claude→anthropic/claude-sonnet-5）。执行机上若配了 QIUMI_MODEL_MAP 覆盖，这些对照会无缘无故
# 变红/变绿——本 smoke 验的是清单命中规则，不是某台机的映射配置，先摘干净。
unset QIUMI_MODEL_MAP
# 同理：手机活开关默认关才是本 smoke 要的路（开了 device 闸会把闸 1 的活改道派成 device_job），
# 外部导出的值一律不许漏进来。
unset QIUMI_DEVICE_DELEGATION_ENABLED

cd "$(dirname "$0")/../.." && node scripts/smoke/qiumi-model-allowlist-smoke.mjs
