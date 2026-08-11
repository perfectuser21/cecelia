#!/usr/bin/env bash
# fail-closed 三态断言：Brain 5xx / 非法 JSON / 超时 → should-auto-merge.sh 必须 SKIP。
# 用 PATH 注入 fake curl 制造三种故障；断言脚本一律 fail-closed 输出 SKIP（任一 MERGE 即失败）。
# 该脚本是通道 1 脚本↔Brain HTTP 边的「脚本侧」快验 oracle（真 HTTP 边由 ## E2E 验收 覆盖）。
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$ROOT/.github/workflows/scripts/should-auto-merge.sh"
[ -f "$SCRIPT" ] || { echo "FAIL: 找不到 $SCRIPT"; exit 1; }
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
cat > "$D/curl" <<'FAKE'
#!/usr/bin/env bash
# 模拟 Brain 归属端点三种故障；脚本约定用 curl -w $'\n%{http_code}'，故输出 body\n<code>。
case "${FAKE_MODE:-}" in
  5xx)     printf '{"error":"boom"}\n500' ;;
  badjson) printf 'not-json-at-all\n200' ;;
  timeout) exit 28 ;;                      # curl 超时退出码
  *)       printf '\n000' ;;
esac
FAKE
chmod +x "$D/curl"
fail=0
for m in 5xx badjson timeout; do
  out="$(FAKE_MODE="$m" PATH="$D:$PATH" BRAIN_URL="http://brain.invalid" bash "$SCRIPT" cp-x 4755 2>&1 || true)"
  if printf '%s' "$out" | grep -q '^SKIP'; then
    echo "PASS fail-closed[$m]: $out"
  else
    echo "FAIL fail-closed[$m] 期望 SKIP，实际: $out"; fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1
echo "OK: fail-closed 三态（5xx/非法 JSON/超时）均 SKIP"
