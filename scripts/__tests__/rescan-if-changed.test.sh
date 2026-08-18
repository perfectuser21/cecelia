#!/usr/bin/env bash
# =============================================================================
# rescan-if-changed.test.sh — 照相层事件扳机测试
# 覆盖:SHA 未变不扫 / 变了触发扫 / 扫失败不记账(下轮重试) / 成功记账
# 使用方式:bash scripts/__tests__/rescan-if-changed.test.sh
# =============================================================================
set -euo pipefail
ERRORS=0; PASS=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SCRIPT="$REPO_ROOT/scripts/scan/rescan-if-changed.sh"
TMPD=$(mktemp -d -t rescan-test.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT
STATE="$TMPD/last-sha"
MARK="$TMPD/scan-called"
STUB_OK="$TMPD/stub-ok.sh"; STUB_FAIL="$TMPD/stub-fail.sh"
printf '#!/usr/bin/env bash\nprintf "%%s" "$EXPECTED_SCAN_SHA" > "%s"\ntouch "%s"\nexit 0\n' "$TMPD/expected-sha" "$MARK" > "$STUB_OK"; chmod +x "$STUB_OK"
printf '#!/usr/bin/env bash\ntouch "%s"\nexit 1\n' "$MARK" > "$STUB_FAIL"; chmod +x "$STUB_FAIL"

echo "=== rescan-if-changed.sh 事件扳机测试 ==="

# 1 脚本存在
if [[ -f "$SCRIPT" ]]; then pass "脚本存在"; else fail "脚本缺失: $SCRIPT"; fi

CUR_SHA=$(git ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}')
if [[ -z "$CUR_SHA" ]]; then
  echo "⚠️ 拿不到 origin/main SHA(离线环境),跳过行为用例"; echo "结果: PASS=$PASS FAIL=$ERRORS"; exit $((ERRORS>0?1:0))
fi

# 2 SHA 未变 → 不触发扫描
echo "$CUR_SHA|1000" > "$STATE"; rm -f "$MARK"
RC=0; RESCAN_NOW_EPOCH=1200 RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
if [[ $RC -eq 0 && ! -f "$MARK" ]]; then pass "SHA 未变:exit 0 且未触发扫描"; else fail "SHA 未变却触发了扫描或退出码非 0(rc=$RC)"; fi

# 2b GNU stat 的 `-f %m` 会成功返回非数字；legacy 单 SHA 记账仍必须用 `-c %Y`
GNU_STAT_DIR="$TMPD/gnu-bin"; mkdir -p "$GNU_STAT_DIR"
cat > "$GNU_STAT_DIR/stat" <<'STAT'
#!/usr/bin/env bash
if [[ "$1" == "-c" && "$2" == "%Y" ]]; then echo 1000; exit 0; fi
if [[ "$1" == "-f" && "$2" == "%m" ]]; then echo 0; exit 0; fi
exit 1
STAT
chmod +x "$GNU_STAT_DIR/stat"
echo "$CUR_SHA legacy" > "$STATE"; rm -f "$MARK"
RC=0; PATH="$GNU_STAT_DIR:$PATH" RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" RESCAN_NOW_EPOCH=1000 bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
if [[ $RC -eq 0 && ! -f "$MARK" ]]; then pass "GNU stat:旧记账无效时间戳不误扫"; else fail "GNU stat 兼容路径异常(rc=$RC)"; fi

# 3 SHA 变了 → 触发扫描且成功后记账
echo "old-sha-000" > "$STATE"; rm -f "$MARK"
RC=0; RESCAN_NOW_EPOCH=1200 RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
if [[ $RC -eq 0 && -f "$MARK" && "$(cat "$STATE")" == "$CUR_SHA|1200" && "$(cat "$TMPD/expected-sha")" == "$CUR_SHA" ]]; then pass "SHA 变化:锁定目标 revision 扫描并记账时间"; else fail "SHA 变化路径异常(rc=$RC, mark=$([[ -f $MARK ]] && echo y || echo n), state=$(cat "$STATE"))"; fi

# 4 扫描失败 → 不记账(下轮重试)且退出非 0
echo "old-sha-000" > "$STATE"; rm -f "$MARK"
RC=0; RESCAN_NOW_EPOCH=1200 RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_FAIL" bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
if [[ $RC -ne 0 && "$(cat "$STATE")" == "old-sha-000" ]]; then pass "扫描失败:SHA 不记账且 exit 非 0"; else fail "失败路径异常(rc=$RC, state=$(cat "$STATE"))"; fi

# 5 SHA 未变但快照接近 15min TTL → 主动重扫保鲜
echo "$CUR_SHA|100" > "$STATE"; rm -f "$MARK"
RC=0; RESCAN_NOW_EPOCH=1000 RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
if [[ $RC -eq 0 && -f "$MARK" && "$(cat "$STATE")" == "$CUR_SHA|1000" ]]; then pass "SHA 未变但超过 10min:主动重扫保鲜"; else fail "同 SHA 保鲜路径异常(rc=$RC, state=$(cat "$STATE"))"; fi

# 6 空格分隔旧状态也按相同 10 分钟预算保鲜
# 5 SHA 稳定但最近一次成功扫描超过 10 分钟 → 仍重拍，防 15 分钟 freshness 腐烂
echo "old-sha-000 0" > "$STATE"; rm -f "$MARK"
RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" RESCAN_NOW_EPOCH=1000 bash "$SCRIPT" >/dev/null 2>&1
rm -f "$MARK"
RC=0; RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" RESCAN_NOW_EPOCH=1601 bash "$SCRIPT" >/dev/null 2>&1 || RC=$?
if [[ $RC -eq 0 && -f "$MARK" ]]; then pass "SHA 稳定但扫描账龄超过10分钟:仍触发刷新"; else fail "稳定 SHA 超龄后未刷新(rc=$RC,state=$(cat "$STATE"))"; fi

# 7 单飞:上一轮还在跑时必须跳过,且要出声(静默跳过=故障隐身)
# 2026-08-17 事故:cron 每5分钟起一次,单次全量扫描要 15-40 分钟,无锁 → 堆到
# 11 个 rescan + 13 个 scan-graph 进程占 3.7GB → OOM 杀镜像构建、node_not_base_admitted。
LOCKDIR="${RESCAN_LOCK_DIR:-$TMPD/rescan.lock}"
echo "old-sha-000|0" > "$STATE"; rm -f "$MARK"; mkdir -p "$LOCKDIR"
OUT="$TMPD/skip.err"; RC=0
RESCAN_LOCK_DIR="$LOCKDIR" RESCAN_NOW_EPOCH=99999 RESCAN_STATE_FILE="$STATE" \
  RESCAN_SCAN_CMD="$STUB_OK" bash "$SCRIPT" >/dev/null 2>"$OUT" || RC=$?
if [[ $RC -eq 0 && ! -f "$MARK" ]] && grep -qE "仍在运行|still running" "$OUT"; then
  pass "并发:跳过本轮且在 stderr 出声"
else
  fail "并发未被单飞拦住或跳过时不出声(rc=$RC, mark=$([[ -f $MARK ]] && echo yes || echo no), err=$(head -c 120 "$OUT"))"
fi

# 8 陈旧锁自愈:持锁者卡死后必须能被抢占,否则一次挂死=永久停摆
touch -t 200001010000 "$LOCKDIR" 2>/dev/null || true
OUT2="$TMPD/stale.err"; rm -f "$MARK"; RC=0
RESCAN_LOCK_DIR="$LOCKDIR" RESCAN_LOCK_STALE_SECONDS=60 RESCAN_NOW_EPOCH=99999 \
  RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_OK" bash "$SCRIPT" >/dev/null 2>"$OUT2" || RC=$?
if [[ $RC -eq 0 && -f "$MARK" ]] && grep -qE "陈旧|stale" "$OUT2"; then
  pass "陈旧锁:抢占并完成扫描"
else
  fail "陈旧锁未被抢占(rc=$RC, mark=$([[ -f $MARK ]] && echo yes || echo no), err=$(head -c 120 "$OUT2"))"
fi

# 9 正常收尾必须把锁还回去,否则下一轮被自己挡住
if [[ ! -d "$LOCKDIR" ]]; then pass "正常收尾释放锁"; else fail "锁残留: $LOCKDIR"; fi

# 10 扫描卡死必须被超时打断,不能一直占着锁
STUB_HANG="$TMPD/stub-hang.sh"
printf '#!/usr/bin/env bash\nsleep 300\n' > "$STUB_HANG"; chmod +x "$STUB_HANG"
echo "old-sha-000|0" > "$STATE"; OUT3="$TMPD/hang.err"; RC=0
START=$(date +%s)
RESCAN_LOCK_DIR="$TMPD/rescan2.lock" RESCAN_SCAN_TIMEOUT_SECONDS=5 RESCAN_NOW_EPOCH=99999 \
  RESCAN_STATE_FILE="$STATE" RESCAN_SCAN_CMD="$STUB_HANG" bash "$SCRIPT" >/dev/null 2>"$OUT3" || RC=$?
ELAPSED=$(( $(date +%s) - START ))
if (( ELAPSED < 60 )) && grep -qE "超时|timed out" "$OUT3" && [[ ! -d "$TMPD/rescan2.lock" ]]; then
  pass "扫描卡死:超时打断、出声、释放锁"
else
  fail "扫描卡死未被超时打断(elapsed=${ELAPSED}s, err=$(head -c 120 "$OUT3"))"
fi

echo ""; echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
