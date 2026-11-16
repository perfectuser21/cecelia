#!/usr/bin/env bash
# 对账检查的执行器提前异常/未到达判变末尾，不能被“没有Dashboard改动”误判成功。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE/scripts/smoke"
cp "$ROOT/scripts/smoke/dashboard-sha-reconcile-smoke.sh" "$FIXTURE/scripts/smoke/"
cat > "$FIXTURE/scripts/deploy-local.sh" <<'STUB'
#!/usr/bin/env bash
if [[ "$CECELIA_PROD_DASHBOARD_SHA" != "$(git -C "$CECELIA_DEPLOY_ROOT" rev-parse HEAD)" ]]; then
  echo 'Dashboard 改动'; echo '✅ 部署完成'; exit 0
fi
[[ "$CASE" != exit-error ]] || exit 37
# 退出0但未抵达真实dry-run末尾同样不能证明正确跳过。
exit 0
STUB
for scenario in exit-error incomplete-success; do
  if CASE="$scenario" bash "$FIXTURE/scripts/smoke/dashboard-sha-reconcile-smoke.sh" > "$FIXTURE/output" 2>&1; then
    cat "$FIXTURE/output"
    echo "FAIL: $scenario 被SHA对账检查伪报成功" >&2
    exit 1
  fi
  echo "PASS: $scenario 正确使SHA对账报红"
done
