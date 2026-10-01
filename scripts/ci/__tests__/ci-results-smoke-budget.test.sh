#!/usr/bin/env bash
# 直接执行 workflow 中的门禁和 smoke 循环，保护取消状态与串行预算。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 - "$ROOT/.github/workflows/ci.yml" "$TMP" <<'PY'
import pathlib, re, sys
workflow = pathlib.Path(sys.argv[1]).read_text()
out = pathlib.Path(sys.argv[2])
gate = workflow.split('  ci-passed:\n', 1)[1].split('  auto-merge:\n', 1)[0]
gate_run = gate.split('        run: |\n', 1)[1]
gate_run = '\n'.join(line[10:] for line in gate_run.splitlines() if line.startswith('          '))
for status in ['success', 'skipped', 'failure', 'cancelled', 'unknown', '']:
    run = re.sub(r'\$\{\{ needs\.[\w-]+\.result \}\}',
                 lambda m: 'success' if 'core-regression' in m[0] else status, gate_run)
    (out / ('gate-' + (status or 'empty') + '.sh')).write_text(run)
smoke_job = workflow.split('  real-env-smoke:\n', 1)[1].split('\n  harness-dod-integrity:', 1)[0]
minutes = int(re.search(r'    timeout-minutes: (\d+)', smoke_job)[1])
(out / 'budget').write_text(str(minutes))
smoke_run = smoke_job.split('      - name: Run all packages/brain/scripts/smoke/*.sh\n', 1)[1]
smoke_run = smoke_run.split('        run: |\n', 1)[1].split('      - name: Cleanup', 1)[0]
smoke_run = '\n'.join(line[10:] for line in smoke_run.splitlines() if line.startswith('          '))
smoke_run = smoke_run.replace('SMOKE_DIR=packages/brain/scripts/smoke', 'SMOKE_DIR="$1"')
(out / 'smoke.sh').write_text(smoke_run)
PY
FAILED=0
for state in success skipped failure cancelled unknown empty; do
  code=0
  bash "$TMP/gate-$state.sh" > "$TMP/gate-$state.log" 2>&1 || code=$?
  case "$state" in
    success|skipped) expected=0 ;;
    *) expected=1 ;;
  esac
  if [[ "$code" != "$expected" ]]; then
    echo "FAIL: ci-passed $state exit=${code}，期望 $expected"
    FAILED=$((FAILED + 1))
  fi
done
if [[ $(cat "$TMP/budget") -lt 30 ]]; then
  echo 'FAIL: 498 条串行 smoke 加启动时间需要至少 30 分钟预算'
  FAILED=$((FAILED + 1))
fi
# 真 sleep 被 timeout 终止；后续脚本仍执行，整批必须失败。
mkdir "$TMP/scripts"
printf 'sleep 8\n' > "$TMP/scripts/01-hang.sh"
printf 'echo completed > "%s"\n' "$TMP/after-timeout" > "$TMP/scripts/02-after.sh"
code=0
SMOKE_SCRIPT_TIMEOUT_SECONDS=1 timeout --kill-after=1s 5s bash "$TMP/smoke.sh" "$TMP/scripts" > "$TMP/smoke.log" 2>&1 || code=$?
if [[ "$code" != 1 || ! -f "$TMP/after-timeout" ]]; then
  echo "FAIL: 超时必须继续运行其余 smoke 且整批退出 1，实际 exit=$code"
  FAILED=$((FAILED + 1))
fi
if ! grep -qE 'TIMEOUT.*01-hang.sh|01-hang.sh.*TIMEOUT' "$TMP/smoke.log"; then
  echo 'FAIL: 超时必须报告具体脚本名'
  FAILED=$((FAILED + 1))
fi
if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
echo 'PASS: CI 状态白名单、串行预算、真超时终止与继续执行均通过'
