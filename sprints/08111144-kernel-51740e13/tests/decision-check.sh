#!/usr/bin/env bash
# 通道 1 脚本决策三态断言（不看标题，只看 Brain 归属）：
#   Brain owned:true → SKIP（harness-owned，交 harness gate）
#   Brain owned:false + cp-* → MERGE（手动 /dev 不回归，红线）
#   非 cp-* 分支 → SKIP（保留原有行为）
# 用 PATH 注入 fake curl 控制 Brain 应答；脚本约定 curl -w $'\n%{http_code}'，输出 body\n<code>。
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT/.github/workflows/scripts/should-auto-merge.sh"
[ -f "$SCRIPT" ] || { echo "FAIL: 找不到 $SCRIPT"; exit 1; }
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
cat > "$D/curl" <<'FAKE'
#!/usr/bin/env bash
case "${FAKE_OWNED:-}" in
  true)  printf '{"owned":true,"run_id":"11111111-1111-4111-8111-111111111111","pr_number":4755,"reason":"x"}\n200' ;;
  false) printf '{"owned":false,"run_id":null,"pr_number":123,"reason":"x"}\n200' ;;
  *)     printf '\n000'; exit 7 ;;
esac
FAKE
chmod +x "$D/curl"
fail=0
run() { FAKE_OWNED="$1" PATH="$D:$PATH" BRAIN_URL="http://brain.local" bash "$SCRIPT" "$2" "$3" 2>&1 || true; }

out="$(run true cp-08101107-04e4690d 4755)"
printf '%s' "$out" | grep -q '^SKIP' && { echo "PASS owned→SKIP: $out"; } || { echo "FAIL owned 期望 SKIP: $out"; fail=1; }

out="$(run false cp-manual-dev 123)"
printf '%s' "$out" | grep -q 'MERGE' && { echo "PASS not_owned→MERGE: $out"; } || { echo "FAIL not_owned 期望 MERGE: $out"; fail=1; }

# 非 cp-* 分支：脚本在 curl 之前就 SKIP，FAKE_OWNED 无关
out="$(FAKE_OWNED=false PATH="$D:$PATH" BRAIN_URL=http://brain.local bash "$SCRIPT" feature/manual-branch 999 2>&1 || true)"
printf '%s' "$out" | grep -q '^SKIP' && { echo "PASS 非cp-*→SKIP: $out"; } || { echo "FAIL 非cp-* 期望 SKIP: $out"; fail=1; }

[ "$fail" -eq 0 ] || exit 1
echo "OK: 决策三态（owned→SKIP / not_owned→MERGE / 非cp-*→SKIP）"
