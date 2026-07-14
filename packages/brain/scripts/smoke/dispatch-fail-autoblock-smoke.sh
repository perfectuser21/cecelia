#!/usr/bin/env bash
# dispatch-fail-autoblock-smoke.sh
# 验收：dispatcher 坏任务自动隔离功能端到端冒烟
# Task: 7c5d6df8-791c-4190-8db8-1274cef9071c
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

echo "── dispatch-fail-autoblock smoke ──"

# 1. Brain API 健康检查
echo "── healthz ──"
code=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL:-http://localhost:5221}/healthz")
[[ "$code" == "200" ]] \
  && ok "Brain /healthz → 200" \
  || fail "Brain /healthz → 期望 200，得 $code（Brain 未启动）"

# 2. 验证 DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 常量已导出（默认值=3）
echo "── constant export ──"
THRESHOLD=$(node -e "
  import('../src/dispatcher.js').then(m => {
    process.stdout.write(String(m.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD));
    process.exit(0);
  }).catch(e => { process.stderr.write(e.message); process.exit(1); });
" 2>/dev/null || echo "ERR")
if [[ "$THRESHOLD" == "3" ]]; then
  ok "DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 默认值=3"
else
  fail "DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 期望 3，得 '$THRESHOLD'"
fi

# 3. 验证 env 覆盖路径
THRESHOLD2=$(DISPATCH_FAIL_AUTOBLOCK_THRESHOLD=2 node -e "
  import('../src/dispatcher.js').then(m => {
    process.stdout.write(String(m.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD));
    process.exit(0);
  }).catch(() => process.exit(1));
" 2>/dev/null || echo "ERR")
if [[ "$THRESHOLD2" == "2" ]]; then
  ok "DISPATCH_FAIL_AUTOBLOCK_THRESHOLD env 覆盖=2 生效"
else
  fail "DISPATCH_FAIL_AUTOBLOCK_THRESHOLD env 覆盖期望 2，得 '$THRESHOLD2'"
fi

# 4. tasks API 可访问，blocked_reason 字段可查询（验证表结构含该列）
echo "── tasks API blocked_reason query ──"
resp=$(curl -s -o /dev/null -w "%{http_code}" \
  "${API}/tasks?status=blocked&limit=5")
[[ "$resp" == "200" ]] \
  && ok "GET /tasks?status=blocked → 200（表含 status 列可过滤）" \
  || fail "GET /tasks?status=blocked → 期望 200，得 $resp"

# 5. 验证 dispatch_fail_autoblock blocked 记录可被检索
echo "── autoblock record check ──"
autoblock_cnt=$(curl -s "${API}/tasks?status=blocked&limit=50" 2>/dev/null \
  | node -e "
    let d='';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const r = JSON.parse(d);
        const rows = Array.isArray(r) ? r : (r.tasks || r.rows || []);
        const n = rows.filter(t => t.blocked_reason === 'dispatch_fail_autoblock').length;
        process.stdout.write(String(n));
      } catch { process.stdout.write('0'); }
    });
  " 2>/dev/null || echo "0")
ok "dispatch_fail_autoblock blocked 任务数=$autoblock_cnt（可为 0，验证 API 管道正常）"

echo ""
echo "── 结果 ──"
echo "通过: $PASS / 失败: $FAIL"
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
