#!/usr/bin/env bash
# dead-man-switch-usvps-smoke.sh — 死人开关改指 us-vps 回归（决策 b08a085c）
#   1. DMS_PG* 连接参数透传给 psql（生产库已迁 us-vps，MMV 本机无 cecelia 库）
#   2. 孤儿哨兵键（已下线 job，长期不更新）不得触发误报：窗口内报到键数 >= 预期即健康
#   3. 窗口内报到键数 < 预期 → 告警
#   4. psql 连不上 → 告警
#   5. opc-watchdog 纳入仓库且已去掉退役网关探针
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DMS="$ROOT/scripts/sentinel/dead-man-switch.sh"
OPC="$ROOT/scripts/ops/us-vps/opc-watchdog.sh"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home/.credentials" "$TMP/state"
echo 'BARK_TOKEN=smoke-token' > "$TMP/home/.credentials/bark.env"

cat > "$TMP/bin/psql" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG/psql.args"
[[ "${FAKE_PSQL_FAIL:-0}" == "1" ]] && exit 2
case "$*" in
  *scheduler_jobs_expected*) echo "${FAKE_EXPECT:-72}" ;;
  *FILTER*)                  echo "${FAKE_FRESH:-72}|${FAKE_TOTAL:-74}" ;;
  *)                         echo "${FAKE_TOTAL:-74}|6591696" ;;
esac
EOF
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG/curl.calls"
exit 0
EOF
cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cp "$TMP/bin/docker" "$TMP/bin/orbctl"
chmod +x "$TMP/bin/"*

run_dms() { # 其余参数为 KEY=VAL 环境
  rm -f "$TMP/state/"* "$TMP/psql.args" "$TMP/curl.calls"
  env HOME="$TMP/home" FAKE_LOG="$TMP" \
    DMS_PSQL="$TMP/bin/psql" DMS_CURL="$TMP/bin/curl" DMS_DOCKER="$TMP/bin/docker" DMS_ORBCTL="$TMP/bin/orbctl" \
    DMS_STATE_DIR="$TMP/state" "$@" bash "$DMS" >"$TMP/out.log" 2>&1
}
bark_called() { [[ -s "$TMP/curl.calls" ]] && grep -q "api.day.app" "$TMP/curl.calls"; }

# 1. 连接参数透传
run_dms DMS_PGHOST=localhost DMS_PGPORT=15432 DMS_PGUSER=cecelia DMS_PGDATABASE=cecelia
if grep -q -- "-p 15432" "$TMP/psql.args" 2>/dev/null && grep -q -- "-U cecelia" "$TMP/psql.args"; then
  ok "DMS_PG* 连接参数透传给 psql"
else
  fail "psql 未收到 DMS_PG* 参数（仍写死 5432/postgres）"
fi

# 2. 孤儿键场景：总 74、窗口内 72、预期 72 → 健康不告警
run_dms DMS_PGPORT=15432 FAKE_EXPECT=72 FAKE_FRESH=72 FAKE_TOTAL=74
if ! bark_called && grep -q "OK" "$TMP/out.log"; then ok "孤儿哨兵键不触发误报"; else fail "孤儿哨兵键触发了误报：$(tail -1 "$TMP/out.log")"; fi

# 3. 窗口内报到不足 → 告警
run_dms DMS_PGPORT=15432 FAKE_EXPECT=72 FAKE_FRESH=70 FAKE_TOTAL=74
if bark_called; then ok "报到键不足时告警"; else fail "报到键不足却未告警"; fi

# 4. 连不上库 → 告警
run_dms DMS_PGPORT=15432 FAKE_PSQL_FAIL=1
if bark_called; then ok "连不上库时告警"; else fail "连不上库却未告警"; fi

# 5. opc-watchdog 纳入仓库、去掉网关探针、其余探针在
if [[ -f "$OPC" ]] && bash -n "$OPC" 2>/dev/null; then ok "opc-watchdog 在仓库且语法正确"; else fail "opc-watchdog 缺失或语法错"; fi
if [[ -f "$OPC" ]] && ! grep -q "docker inspect openclaw-gateway" "$OPC"; then ok "已去掉退役网关探针"; else fail "仍含退役网关探针"; fi
if [[ -f "$OPC" ]] && grep -q "/api/brain/health" "$OPC"; then ok "Brain 探针保留"; else fail "Brain 探针丢失"; fi

echo "  结果: $PASS 通过 / $FAIL 失败"
[[ "$FAIL" == "0" ]] || exit 1
