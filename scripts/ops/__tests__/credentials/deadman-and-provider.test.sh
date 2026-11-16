#!/usr/bin/env bash
# 真实哨兵与真实provider分支；仅路径/外部命令边界隔离。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/home" "$T/state"
export CALLS="$T/calls" EXPECTED=7 FRESH=7 DB_FAILED=0
cat > "$T/bin/psql" <<'SH'
#!/bin/bash
printf 'psql %s\n' "$*" >> "$CALLS"
[[ "$DB_FAILED" = 1 ]] && exit 1
if [[ "$*" = *scheduler_jobs_expected* ]]; then echo "$EXPECTED"; else echo "$FRESH|99"; fi
SH
cat > "$T/bin/curl" <<'SH'
#!/bin/bash
echo alert >> "$CALLS"
SH
for cmd in docker orbctl; do printf '#!/bin/bash\necho %s >> "$CALLS"\n' "$cmd" > "$T/bin/$cmd"; done
chmod +x "$T/bin/"*
# 哨兵重设PATH，副本只将该环境边界重定向到隔离bin。
sed "s|^export PATH=.*|export PATH=\"$T/bin:$PATH\"|" "$ROOT/scripts/sentinel/dead-man-switch.sh" > "$T/deadman.sh"
run_deadman() {
 env -i HOME="$T/home" PATH="$T/bin:$PATH" CALLS="$CALLS" EXPECTED="$EXPECTED" FRESH="$FRESH" DB_FAILED="$DB_FAILED" \
  BARK_TOKEN=synthetic-not-a-secret DMS_PSQL="$T/bin/psql" DMS_CURL="$T/bin/curl" \
  DMS_DOCKER="$T/bin/docker" DMS_ORBCTL="$T/bin/orbctl" DMS_STATE_DIR="$T/state" \
  bash "$T/deadman.sh" > "$T/out" 2>&1
}
run_deadman
test ! -e "$T/state/dead-man-switch.last-alert"
! grep -q '^alert$' "$CALLS"
FRESH=6
if run_deadman; then echo '哨兵未拒绝过期状态'; exit 1; fi
test "$(grep -c '^alert$' "$CALLS")" = 1
if run_deadman; then exit 1; fi
test "$(grep -c '^alert$' "$CALLS")" = 1
EXPECTED=6; run_deadman
test ! -e "$T/state/dead-man-switch.last-alert"
DB_FAILED=1
if run_deadman; then echo '哨兵未拒绝DB失败'; exit 1; fi
test "$(grep -c '^alert$' "$CALLS")" = 2

# 提取入口现役旧provider兜底分支（不会运行entrypoint初始化/回调/凭据逻辑）。
awk '/^# B7: CECELIA_EXECUTOR=codex/{seen=1} seen && /^if \[\[ -n.*HARNESS_ATTEMPT_ID/{printing=1} printing{print} printing && /^set -e$/{exit}' \
 "$ROOT/docker/cecelia-runner/entrypoint.sh" > "$T/provider.sh"
# 严格拒绝多处marker拼接，避免将未来新启动路径带入此测试。
test "$(grep -c '^if \[\[ -n "${HARNESS_ATTEMPT_ID:-}" \]\]; then$' "$T/provider.sh")" = 1
for cmd in codex grok; do
 printf '#!/bin/bash\nprintf "%s %%s\\n" "$*" >> "$CALLS"\n' "$cmd" > "$T/bin/$cmd"
 chmod +x "$T/bin/$cmd"
done
for provider in codex grok unknown; do
 : > "$CALLS"
 set +e
 env -i HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" CALLS="$CALLS" \
  CECELIA_EXECUTOR="$provider" PROMPT_FILE="$T/missing" STDOUT_FILE="$T/stdout" \
  bash -c 'scan_error_keywords(){ return 1; }; source "$1"; exit "$EXIT_CODE"' _ "$T/provider.sh" > "$T/out" 2>&1
 rc=$?
 set -e
 if [[ "$provider" = unknown ]]; then
  test "$rc" = 1; test ! -s "$CALLS"; grep -q 'unsupported executor: unknown' "$T/out"
 else
  test "$rc" = 0; test "$(wc -l < "$CALLS" | tr -d ' ')" = 1
  grep -q "^$provider " "$CALLS"
 fi
done
echo '体外哨兵动态计数/冷却/断库及真实provider分流，通过'
