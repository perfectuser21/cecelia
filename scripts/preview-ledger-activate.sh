#!/usr/bin/env bash
# preview-ledger-activate.sh — 把 preview_environments 账本里某个 PR 的行翻成 active
#
# ── 为什么独立成一个脚本 ──────────────────────────────────────────────────
# 这一步是 Deploy Preview 长期假红的真根因（2026-09-22 实证）。原先它嵌在
# preview-env-start.sh 第 7 步里，硬编码库名 `cecelia`，失败还被 `|| log 非致命`
# 咽掉。嵌在那儿既没人测得到、失败了也看不见。拆出来是为了能拿真库跑守卫
# （packages/brain/scripts/smoke/preview-ledger-activate-smoke.sh）。
#
# 用法：preview-ledger-activate.sh <LEDGER_DB> <PR_NUMBER>
#   LEDGER_DB  = preview_environments 账本所在的库。
#                注意它**不是**本次创建的预览库 cecelia_preview_<PR> ——
#                两者同名混淆正是当初写错的由来。
#
# 连库参数走环境变量：DB_HOST / DB_USER / DB_PASSWORD（与调用方一致）。
#
# 退出码：
#   0  至少命中一行并置为 active
#   1  连不上 / 库不存在 / 一行都没命中
#   2  参数不合法
set -uo pipefail

LEDGER_DB="${1:?LEDGER_DB 必须提供（preview_environments 账本所在的库）}"
PR_NUMBER="${2:?PR_NUMBER 必须提供}"

# PR 号直接拼进 SQL，先把它钉成纯数字
case "$PR_NUMBER" in
  ''|*[!0-9]*)
    echo "[preview-ledger] PR_NUMBER 必须是纯数字，收到 '${PR_NUMBER}'" >&2
    exit 2
    ;;
esac

# ── mock/受限环境豁免 ────────────────────────────────────────────────────
# preview-env-start.sh 的自测（scripts/__tests__/preview-env-start.test.sh）用一个
# 恒退 0、无输出的 psql 桩把整条脚本跑一遍，那里根本没有 postgres，账本回写无从谈起。
# 这种情况跳过并退 0，与脚本里 _PG_REACHABLE 的既有判据同源。
#
# ⚠️ 豁免的判据只能是「**整个 postgres 都连不上**」，绝不能是「这个库不存在」——
#    MMV 上 postgres 好好的、只是没有 cecelia 这个库，那必须报死：那正是 0922 假红根因。
#    守卫里这两条是配对断言（②库不存在→退非 0 ／ ⑦整体不可达→退 0），缺一不可。
if ! PGPASSWORD="${DB_PASSWORD:-cecelia}" psql \
     -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
     -d postgres -tAc "SELECT 1" 2>/dev/null | grep -q '^1$'; then
  echo "[preview-ledger] postgres 整体不可达（mock/受限环境），跳过账本回写"
  exit 0
fi

# RETURNING 1 是关键：psql 对 "UPDATE 0" 和 "UPDATE 1" 都退 0，
# 不显式数行就分辨不出「写进去了」和「一行都没匹配上」。
OUT="$(PGPASSWORD="${DB_PASSWORD:-cecelia}" psql \
  -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" -d "$LEDGER_DB" \
  -v ON_ERROR_STOP=1 -tAc \
  "UPDATE preview_environments
      SET status='active', updated_at=NOW()
    WHERE pr_number=${PR_NUMBER} AND status<>'inactive'
   RETURNING 1;" 2>&1)" || {
  echo "[preview-ledger] 连库或执行失败（账本库=${LEDGER_DB}）：" >&2
  printf '%s\n' "$OUT" >&2
  echo "  账本库名可能传错了。执行机（MMV）上账本在 cecelia_staging，没有叫 cecelia 的库；" >&2
  echo "  可用 PREVIEW_LEDGER_DB 显式指定。CI 只认 preview_environments.status='active'，" >&2
  echo "  回写不成功 = 预览环境再健康，CI 也必然等到超时假红。" >&2
  exit 1
}

COUNT="$(printf '%s\n' "$OUT" | grep -c '^1$')"
if [ "${COUNT:-0}" -lt 1 ]; then
  echo "[preview-ledger] 账本回写一行都没命中：库=${LEDGER_DB} pr=${PR_NUMBER}" >&2
  echo "  可能原因：这个 PR 的行不在这个库里（账本库传错），或该行已是 inactive。" >&2
  exit 1
fi

echo "[preview-ledger] 已置 active：库=${LEDGER_DB} pr=${PR_NUMBER}（命中 ${COUNT} 行）"
