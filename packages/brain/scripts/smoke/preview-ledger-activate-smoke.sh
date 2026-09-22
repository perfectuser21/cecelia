#!/usr/bin/env bash
# preview-ledger-activate-smoke.sh — 预览账本回写守卫
#
# ── 为什么有这个守卫（2026-09-22 实证根因）────────────────────────────────
# Deploy Preview Environment 长期假红。挖到底不是预览起不来 —— 预览环境好好的
# （PR#5475 的实例 :5305 health 正常），而是**最后一步把状态写错了库**：
#
#   preview-env-start.sh Step 7 的 psql 把账本库名硬编码成 `cecelia`，
#   而预览自 2026-09-17 下放到执行机后，账本在 MMV 的 cecelia_staging，
#   MMV 上根本没有叫 cecelia 的库：
#     FATAL: database "cecelia" does not exist        （/tmp/preview-5475.log:906）
#
# 更要命的是这行后面跟着 `|| log "⚠ DB 状态更新失败（非致命）"` —— 错误被咽掉，
# 脚本继续打印「✅ 预览环境启动完成」并退出 0。于是 preview_environments 永远停在
# starting，CI 的 wait-preview-active.sh 干等 1200s 超时报红，而日志里只有一句
# 「非致命」，没人会顺着它往下查。
#
# 这一步失败**从来就不是非致命**：CI 只认 status='active'，写不进去 = 必然假红。
#
# 同源教训：PREVIEW_SOURCE_DB 早在 2026-09-17 就为完全一样的理由参数化过了
# （「源库不再必然叫 cecelia」），唯独漏了账本库这一处。
#
# ── 守卫盯五件事 ──────────────────────────────────────────────────────────
#   ① 真库回写：拿真 postgres 建 starting 行 → 跑 activate → 必须变 active
#   ② 库不存在要报死：这正是 MMV 上发生的事，绝不许再退回「非致命」
#   ③ 没命中行要报死：UPDATE 0 与成功同形，静默放过等于假绿
#   ④ 取值顺序：LEDGER_DB 必须在 DB_NAME 被 $4 覆盖**之前**求值 ——
#      写反了拿到的是预览库名，账本照样永远写不进去，现象与修之前一模一样
#   ⑤ Step 7 不许再出现硬编码库名
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ACTIVATE="$REPO_ROOT/scripts/preview-ledger-activate.sh"
START_SH="$REPO_ROOT/scripts/preview-env-start.sh"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  ❌ %s\n' "$1"; }

echo "▶️  preview 账本回写守卫"

# ── 连库参数：CI 同时给了 PG* 与 DB_*，两套都认，DB_* 优先（与被测脚本一致）──
PGH="${DB_HOST:-${PGHOST:-localhost}}"
PGU="${DB_USER:-${PGUSER:-cecelia}}"
PGP="${DB_PASSWORD:-${PGPASSWORD:-cecelia}}"
LEDGER_DB="${DB_NAME:-${PGDATABASE:-cecelia_test}}"

psql_q() { PGPASSWORD="$PGP" psql -h "$PGH" -U "$PGU" -d "$1" -tAc "$2" 2>&1; }

# postgres 必须真的在。这里**不做静默跳过** —— 一个从不执行的守卫等于没有守卫，
# 而 CI（ci-smoke-glob-runner.yml）永远挂着 postgres service，连不上就是真出事了。
if ! psql_q postgres "SELECT 1" | grep -q '^1$'; then
  echo "  ❌ postgres 连不上（host=$PGH user=$PGU）—— 守卫无法执行，判红"
  exit 1
fi

[ -f "$ACTIVATE" ] || { echo "  ❌ 找不到 $ACTIVATE"; exit 1; }

# ── ① 真库回写 ───────────────────────────────────────────────────────────
# 用高位 PR 号当哨兵，不会和真实 PR 撞
SENTINEL_PR=$(( 990000 + (RANDOM % 9000) ))
cleanup() {
  psql_q "$LEDGER_DB" "DELETE FROM preview_environments WHERE pr_number=${SENTINEL_PR}" >/dev/null 2>&1
}
trap cleanup EXIT

if ! psql_q "$LEDGER_DB" "SELECT to_regclass('public.preview_environments')" | grep -q preview_environments; then
  echo "  ❌ ${LEDGER_DB} 里没有 preview_environments 表（迁移没跑？）—— 判红"
  exit 1
fi

cleanup
psql_q "$LEDGER_DB" \
  "INSERT INTO preview_environments (pr_number, branch_name, port, db_name, status)
   VALUES (${SENTINEL_PR}, 'smoke/ledger-guard', 5399, 'cecelia_preview_${SENTINEL_PR}', 'starting')" >/dev/null

OUT=$(bash "$ACTIVATE" "$LEDGER_DB" "$SENTINEL_PR" 2>&1); RC=$?
STATUS_AFTER=$(psql_q "$LEDGER_DB" "SELECT status FROM preview_environments WHERE pr_number=${SENTINEL_PR}" | tr -d '[:space:]')

[ "$RC" -eq 0 ] && ok "真库回写 → 退出码 0" || bad "真库回写却退出码 $RC：$OUT"
[ "$STATUS_AFTER" = "active" ] && ok "真库回写 → status 确实变成 active" \
  || bad "status 仍是 '${STATUS_AFTER}'，没写进去（这就是 CI 干等 1200s 的现场）"

# ── ② 库不存在必须报死（MMV 上发生的就是这个）──────────────────────────
GHOST_DB="cecelia_no_such_db_$$"
OUT=$(bash "$ACTIVATE" "$GHOST_DB" "$SENTINEL_PR" 2>&1); RC=$?
[ "$RC" -ne 0 ] && ok "账本库不存在 → 退出码非 0（不再当「非致命」咽掉）" \
  || bad "账本库不存在却退出码 0 —— 正是 0922 假红的原样复发"

# ── ②b postgres 整体不可达 → 跳过并退 0（mock 环境豁免）────────────────
# 这条和 ② 是**配对**的，必须一起看：
#   ②  postgres 在、但库不存在  → 报死（MMV 上发生的，真故障）
#   ②b postgres 整体连不上      → 跳过退 0（自测的 psql 桩环境，不是故障）
# 只有 ② 没有 ②b，preview-env-start 的自测会被打死；只有 ②b 没有 ②，
# 「库名写错」又会重新变成静默放过。把豁免收窄到「整个 PG 都没有」是唯一安全的口径。
OUT=$(DB_HOST=/nonexistent-socket-dir bash "$ACTIVATE" "$LEDGER_DB" "$SENTINEL_PR" 2>&1); RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q '跳过'; then
  ok "postgres 整体不可达 → 跳过并退 0（mock 环境不被打死）"
else
  bad "postgres 整体不可达时应跳过退 0，实得退出码 $RC：$OUT"
fi

# ── ③ 没命中行必须报死 ───────────────────────────────────────────────────
# UPDATE 0 和 UPDATE 1 在 psql 默认输出里都是「成功」，不显式数行就会静默放过。
OUT=$(bash "$ACTIVATE" "$LEDGER_DB" 999999 2>&1); RC=$?
[ "$RC" -ne 0 ] && ok "账本无该 PR 的行 → 退出码非 0（UPDATE 0 不算成功）" \
  || bad "UPDATE 0 却判成功 —— CI 会以为预览就绪，实际账本没动"

# ── ④ 取值顺序：LEDGER_DB 必须在 DB_NAME 被 $4 覆盖之前求值 ──────────────
# 这条不是形式检查。脚本里 DB_NAME 先是「调用方自己连的库」（账本所在），
# 第 24 行起被 $4 覆盖成「本次要创建的预览库」。顺序写反 → LEDGER_DB 拿到预览库名
# → 账本照样永远写不进去，而且日志现象和修之前**一模一样**，极难二次发现。
LINE_LEDGER=$(grep -n '^LEDGER_DB=' "$START_SH" | head -1 | cut -d: -f1)
LINE_OVERWRITE=$(grep -n '^DB_NAME="\${4' "$START_SH" | head -1 | cut -d: -f1)
if [ -z "$LINE_LEDGER" ] || [ -z "$LINE_OVERWRITE" ]; then
  bad "在 preview-env-start.sh 里找不到 LEDGER_DB 赋值或 DB_NAME=\$4 覆盖（守卫失去锚点）"
elif [ "$LINE_LEDGER" -lt "$LINE_OVERWRITE" ]; then
  ok "LEDGER_DB（第 ${LINE_LEDGER} 行）在 DB_NAME=\$4（第 ${LINE_OVERWRITE} 行）之前求值"
else
  bad "LEDGER_DB 在第 ${LINE_LEDGER} 行、DB_NAME=\$4 在第 ${LINE_OVERWRITE} 行 —— 顺序反了，账本会被写成预览库名"
fi

# ── Step 7 的**代码**（剥掉注释）─────────────────────────────────────────
# 必须剥注释再断言：本文件和 preview-env-start.sh 的注释里都反复写着「非致命」
# 「硬编码 cecelia」在讲这段历史，连注释一起 grep 会把讲解当成违规，
# 基线直接判红 —— 守卫抓的必须是真在执行的那几行。
STEP7_CODE="$(sed -n '/log "Step 7:/,$p' "$START_SH" | grep -vE '^[[:space:]]*#')"

# ── ⑤ 账本库必须来自 LEDGER_DB，不许硬编码 ───────────────────────────────
if ! printf '%s\n' "$STEP7_CODE" | grep -q 'preview-ledger-activate.sh'; then
  bad "Step 7 没有调用 preview-ledger-activate.sh（守卫失去锚点）"
elif printf '%s\n' "$STEP7_CODE" | grep -qE 'preview-ledger-activate\.sh"?[[:space:]]+"\$LEDGER_DB"'; then
  ok "Step 7 用 \$LEDGER_DB 当账本库（不再硬编码）"
else
  bad "Step 7 传给 activate 的账本库不是 \$LEDGER_DB —— 硬编码库名正是 0922 假红根因"
fi

# ── ⑥ Step 7 回写失败必须致命 ────────────────────────────────────────────
# ①②③ 测的是 activate 脚本自己的退出码；调用方接住非 0 之后**怎么处理**是另一件事。
# 原写法 `|| log "⚠ 非致命"` 然后照样 exit 0 —— activate 喊破喉咙也没用。
#
# 第一版这条断言写成「grep 有没有『非致命』这个词」，变异测试当场打脸：换个措辞
# （`|| log "DB 状态更新失败"`）再留一个走不到的 `exit 1`，断言照样全绿，
# 而行为已经退回假红。**那是在守卫一个词，不是守卫一个行为。**
#
# 改成钉结构：脚本顶上有 set -euo pipefail，调用**裸跑**时失败即终止。
# 于是要把它变回非致命，只有三条路，逐条堵死：
#   a) 删掉 set -euo pipefail          → 下面第一条断言
#   b) 加 `|| ...` 把失败吞掉          → 第二条
#   c) 包进 `if ! ...` / `&&` 里       → 第三条（要求该行以 bash 开头）
ACTIVATE_LINE="$(printf '%s\n' "$STEP7_CODE" | grep -n 'preview-ledger-activate.sh' | head -1 | cut -d: -f2-)"
if ! grep -qE '^set -euo pipefail$' "$START_SH"; then
  bad "preview-env-start.sh 没有 set -euo pipefail —— 裸调不再致命，回写失败会被静默放过"
elif printf '%s' "$ACTIVATE_LINE" | grep -qE '\|\|'; then
  bad "账本回写调用被 || 吞掉了失败：${ACTIVATE_LINE}"
elif ! printf '%s' "$ACTIVATE_LINE" | grep -qE '^[[:space:]]*bash[[:space:]]'; then
  bad "账本回写不是裸调（被 if/&& 包住，失败可被降级）：${ACTIVATE_LINE}"
else
  ok "Step 7 裸调 + set -e → 回写失败即终止（不再降级成非致命）"
fi

printf '\n结果: PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
