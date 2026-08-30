#!/usr/bin/env bash
# attempt-run-smoke.sh —— 第 51 批 attempt-run 薄端点的真环境冒烟（决策 bc242b62）。
# 在部署后的生产 Brain（loopback）上：
#   1) POST /api/brain/harness/attempt-run 派发一个只读 spawn:canary（无 skill、无副作用）
#   2) 轮询 GET /api/brain/harness/attempt-run/:id 直到终态
#   3) 断言 result.decision.outcome == CANARY_OK
# 机器容量被占（machine_capacity_contended / capacity 类 preflight BLOCKED）时重试后软跳过——
# 部署窗口常有在途 attempt，这不是本端点的缺陷；其它失败一律硬红。
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
POLL_LIMIT="${POLL_LIMIT:-40}"          # 40 × 15s = 10 分钟
DISPATCH_RETRIES="${DISPATCH_RETRIES:-3}"

echo "🔍 attempt-run smoke — $BRAIN_URL"

# 鸡生蛋守卫：端点尚未部署（旧版本 Brain 返回 404/HTML）→ 软跳过。
# real-env-smoke 在 PR 阶段对着未含本端点的生产 Brain 跑；真验证发生在 brain-deploy 部署后。
PROBE_CODE=$(curl -s -m 15 -o /dev/null -w "%{http_code}" -X POST "$BRAIN_URL/api/brain/harness/attempt-run" -H "Content-Type: application/json" -d '{}')
if [ "$PROBE_CODE" = "404" ]; then
  echo "⚠️  端点未部署（HTTP 404，Brain 版本落后于本 PR），软跳过；部署后由 post-deploy smoke 真跑"
  exit 0
fi

ATTEMPT_ID=""
for i in $(seq 1 "$DISPATCH_RETRIES"); do
  RESP=$(curl -s -m 60 -X POST "$BRAIN_URL/api/brain/harness/attempt-run" \
    -H "Content-Type: application/json" \
    -d '{"role":"canary","title":"attempt-run smoke: read-only fleet canary","payload":{"sprint_dir":"/var/empty/attempt-run-smoke","role_assignments":{"canary":{"provider":"codex","account":"team1"},"reporter":{"provider":"codex","account":"team1"}}}}')
  STATUS=$(printf '%s' "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status") or d.get("error") or "")' 2>/dev/null || echo parse_error)
  if [ "$STATUS" = "LAUNCHED" ]; then
    ATTEMPT_ID=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["attempt_id"])')
    break
  fi
  DETAIL=$(printf '%s' "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("detail") or "")' 2>/dev/null || echo "")
  if printf '%s' "$DETAIL" | grep -qiE 'capacity|contended'; then
    echo "  ⏳ 第 $i 次：机器容量被占（$DETAIL），60s 后重试"
    sleep 60
    continue
  fi
  echo "::error::attempt-run 派发失败：$RESP"
  exit 1
done

if [ -z "$ATTEMPT_ID" ]; then
  echo "⚠️  连续 $DISPATCH_RETRIES 次容量被占，软跳过（端点本身已返回结构化 502，非缺陷）"
  exit 0
fi
echo "  LAUNCHED attempt=$ATTEMPT_ID，轮询终态…"

for i in $(seq 1 "$POLL_LIMIT"); do
  ROW=$(curl -s -m 30 "$BRAIN_URL/api/brain/harness/attempt-run/$ATTEMPT_ID")
  ST=$(printf '%s' "$ROW" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status") or "")' 2>/dev/null || echo "")
  case "$ST" in
    completed)
      OUTCOME=$(printf '%s' "$ROW" | python3 -c 'import sys,json; print(((json.load(sys.stdin).get("result") or {}).get("decision") or {}).get("outcome") or "")')
      if [ "$OUTCOME" = "CANARY_OK" ]; then
        echo "✅ attempt-run smoke 通过：canary completed / CANARY_OK"
        exit 0
      fi
      echo "::error::canary completed 但 outcome=$OUTCOME（期望 CANARY_OK）：$ROW"
      exit 1
      ;;
    failed|cancelled|blocked|needs_context)
      echo "::error::canary 终态 $ST：$ROW"
      exit 1
      ;;
  esac
  sleep 15
done
echo "::error::canary 在 $((POLL_LIMIT*15))s 内未达终态"
exit 1
