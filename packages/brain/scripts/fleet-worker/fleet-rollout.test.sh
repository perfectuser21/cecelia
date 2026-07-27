#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLOUT="$SCRIPT_DIR/fleet-rollout.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -x "$ROLLOUT" ]] || fail "missing fleet-rollout.sh entrypoint"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"
artifact_log="$test_root/artifacts.log"
transport_log="$test_root/transport.log"
node_log="$test_root/node.log"
touch "$artifact_log" "$transport_log" "$node_log"

write_executable() {
  local target="$1"
  shift
  printf '%s\n' "$@" > "$target"
  chmod +x "$target"
}

write_executable "$fake_bin/git" \
  '#!/usr/bin/env bash' \
  'printf "git %s\n" "$*" >> "${FLEET_TEST_ARTIFACT_LOG:?}"' \
  'if [[ "${FLEET_TEST_REAL_GIT:-0}" == 1 ]]; then' \
  '  repo_root=""' \
  '  [[ "${1:-}" == "-C" ]] && { repo_root="$2"; shift 2; }' \
  '  if [[ "$*" == "status --porcelain --untracked-files=all" ]]; then exit 0; fi' \
  '  if [[ "${1:-}" == "archive" ]]; then' \
  '    output=""' \
  '    while [[ $# -gt 0 ]]; do' \
  '      if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi' \
  '      shift' \
  '    done' \
  '    exec /usr/bin/tar -cf "$output" -C "$repo_root" packages/brain/package.json packages/brain/config/fleet-node-profiles.json packages/brain/src/orchestrator/fleet-node/node-profile.js packages/brain/scripts/fleet-worker' \
  '  fi' \
  '  exec /usr/bin/git -C "$repo_root" "$@"' \
  'fi' \
  'if [[ "$*" == *"status --porcelain"* ]]; then' \
  '  [[ "${FLEET_TEST_DIRTY:-0}" == 1 ]] && echo " M dirty-file"' \
  '  exit 0' \
  'fi' \
  'if [[ "$*" == *"archive --format=tar"* ]]; then' \
  '  output=""' \
  '  while [[ $# -gt 0 ]]; do' \
  '    if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi' \
  '    shift' \
  '  done' \
  '  printf "tracked source\n" > "$output"' \
  '  exit 0' \
  'fi' \
  'if [[ "$*" == *"bundle create"* ]]; then' \
  '  while [[ $# -gt 0 && "$1" != "create" ]]; do shift; done' \
  '  shift' \
  '  printf "bundle\n" > "$1"' \
  '  exit 0' \
  'fi' \
  'exit 0'

write_executable "$fake_bin/docker" \
  '#!/usr/bin/env bash' \
  'printf "docker %s\n" "$*" >> "${FLEET_TEST_ARTIFACT_LOG:?}"' \
  'if [[ "${1:-}" == "save" ]]; then' \
  '  output=""' \
  '  while [[ $# -gt 0 ]]; do' \
  '    if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi' \
  '    shift' \
  '  done' \
  '  printf "runner\n" > "$output"' \
  'fi'

write_executable "$fake_bin/ssh" \
  '#!/usr/bin/env bash' \
  'printf "ssh %s\n" "$*" >> "${FLEET_TEST_TRANSPORT_LOG:?}"' \
  'if [[ "${FLEET_TEST_SSH_EXECUTE:-0}" == 1 ]]; then' \
  '  while [[ "${1:-}" == "-o" ]]; do shift 2; done' \
  '  shift' \
  '  exec /bin/bash -c "$1"' \
  'fi' \
  'cat >/dev/null' \
  '[[ "${FLEET_TEST_SSH_FAIL:-0}" != 1 ]]'

write_executable "$fake_bin/sudo" \
  '#!/usr/bin/env bash' \
  'printf "sudo %s\n" "$*" >> "${FLEET_TEST_TRANSPORT_LOG:?}"' \
  '[[ "${1:-}" == "-n" ]] && shift' \
  'if [[ "${1:-}" == "/bin/rm" && "${FLEET_TEST_SUDO_FAIL_RM:-0}" == 1 ]]; then exit 24; fi' \
  'if [[ "${FLEET_TEST_SUDO_NOEXEC:-0}" == 1 ]]; then' \
  '  case "${1:-}" in' \
  '    /usr/bin/mktemp|/usr/bin/tar|/bin/mkdir|/bin/chmod|/bin/rm) exec "$@" ;;' \
  '    */fleet-rollout.sh) exec "$@" ;;' \
  '    env) [[ "${FLEET_TEST_SUDO_EXEC_NODE:-0}" == 1 ]] && exec "$@"; exit 0 ;;' \
  '    *) exit 0 ;;' \
  '  esac' \
  'fi' \
  'exec "$@"'

write_executable "$fake_bin/nodectl" \
  '#!/usr/bin/env bash' \
  'command_name="$1"' \
  'printf "%s %s\n" "$*" "${CECELIA_MACHINE_ID:-missing}" >> "${FLEET_TEST_NODE_LOG:?}"' \
  'if [[ "$command_name" == "admit" && "${FLEET_TEST_NODE_SIGNAL_PARENT:-0}" == 1 ]]; then' \
  '  kill -TERM "$PPID"' \
  '  exit 143' \
  'fi' \
  'if [[ "$command_name" == "admit" && -n "${FLEET_TEST_NODE_ADMIT_READY:-}" ]]; then' \
  '  : > "$FLEET_TEST_NODE_ADMIT_READY"' \
  '  sleep 2' \
  'fi' \
  'if [[ "$command_name" == "${FLEET_TEST_NODE_FAIL:-}" ]]; then exit 23; fi' \
  'if [[ "$command_name" == "admit" ]]; then' \
  '  printf "%s\n" '"'"'{"base_admitted":true,"dispatch_ready":false}'"'"'' \
  'fi'

run_rollout() {
  FLEET_TEST_ARTIFACT_LOG="$artifact_log" \
  FLEET_TEST_TRANSPORT_LOG="$transport_log" \
  FLEET_ROLLOUT_GIT="$fake_bin/git" \
  FLEET_ROLLOUT_DOCKER="$fake_bin/docker" \
  FLEET_ROLLOUT_SSH="$fake_bin/ssh" \
  FLEET_ROLLOUT_TAR="$(command -v tar)" \
  FLEET_ROLLOUT_TMPDIR="$test_root/tmp" \
  "$ROLLOUT" "$@"
}

: > "$artifact_log"
: > "$transport_log"
dry_output="$(run_rollout xian-mac-m4)"
grep -qi 'dry.run' <<<"$dry_output" || fail "default rollout is not dry-run"
[[ ! -s "$artifact_log" ]] || fail "dry-run built an artifact"
[[ ! -s "$transport_log" ]] || fail "dry-run contacted a node"

all_output="$(run_rollout all)"
all_order="$(
  grep -Eo 'xian-mac-m4|us-mac-m4|xian-mac-m1' <<<"$all_output" \
    | paste -sd, -
)"
[[ "$all_order" == 'xian-mac-m4,us-mac-m4,xian-mac-m1' ]] \
  || fail "all rollout order drifted: $all_order"

if CECELIA_MACHINE_ID=xian-mac-m4 \
  run_rollout xian-mac-m4 --apply >"$test_root/controller.out" 2>&1; then
  fail "non-US controller was accepted"
fi
grep -Fq 'controller_machine_mismatch' "$test_root/controller.out" \
  || fail "controller identity failure was not explicit"
[[ ! -s "$artifact_log" ]] || fail "wrong controller built an artifact"

if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_DIRTY=1 \
  run_rollout xian-mac-m4 --apply >"$test_root/dirty.out" 2>&1; then
  fail "dirty rollout source was accepted"
fi
grep -Fq 'rollout_source_dirty' "$test_root/dirty.out" \
  || fail "dirty source failure was not explicit"

: > "$artifact_log"
: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
  run_rollout xian-mac-m4 --apply >/dev/null \
  || fail "valid Xian M4 rollout transport failed"
grep -Fq 'archive --format=tar --output' "$artifact_log" \
  || fail "rollout did not archive committed source"
grep -Fq 'bundle create' "$artifact_log" \
  || fail "rollout did not create a Git bundle"
grep -Fq 'docker save --output' "$artifact_log" \
  || fail "rollout did not export the Runner image"
grep -Fq 'jinnuoshengyuan@100.86.57.69' "$transport_log" \
  || fail "Xian M4 SSH target drifted"
grep -Fq 'BatchMode=yes' "$transport_log" \
  || fail "SSH transport is not non-interactive"
grep -Fq 'StrictHostKeyChecking=yes' "$transport_log" \
  || fail "SSH transport does not enforce host identity"

: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
  run_rollout xian-mac-m1 --apply >/dev/null \
  || fail "valid Xian M1 rollout transport failed"
grep -Fq 'xx-macmini@100.88.166.55' "$transport_log" \
  || fail "Xian M1 SSH target drifted"

if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_SSH_FAIL=1 \
  run_rollout xian-mac-m4 --apply >"$test_root/ssh.out" 2>&1; then
  fail "SSH transport failure was hidden"
fi

: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SSH_EXECUTE=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout xian-mac-m4 --apply >/dev/null \
  || fail "executable remote rollout contract failed"
first_remote_sudo="$(grep '^sudo ' "$transport_log" | head -n 1)"
[[ "$first_remote_sudo" == *'mktemp -d /var/tmp/cecelia-fleet-rollout.'* ]] \
  || fail "remote payload was not staged into a root-owned directory first: $first_remote_sudo"
if grep -Eq '^sudo .* /tmp/cecelia-fleet-rollout\..*/fleet-nodectl\.sh ' \
  "$transport_log"; then
  fail "sudo executed a Fleet script from the SSH user's writable /tmp"
fi

: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout us-mac-m4 --apply >/dev/null \
  || fail "executable local rollout contract failed"
first_local_sudo="$(grep '^sudo ' "$transport_log" | head -n 1)"
[[ "$first_local_sudo" == *'mktemp -d /var/tmp/cecelia-fleet-rollout.'* ]] \
  || fail "local payload was not staged into a root-owned directory first: $first_local_sudo"
if grep -Eq "^sudo .* $test_root/tmp/.*/fleet-nodectl\\.sh " "$transport_log"; then
  fail "sudo executed a Fleet script from the controller user's writable temp directory"
fi

admit_ready="$test_root/public-admit.ready"
: > "$node_log"
rm -f "$admit_ready"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_TEST_SUDO_EXEC_NODE=1 \
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_NODE_ADMIT_READY="$admit_ready" \
FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_TEST_ARTIFACT_LOG="$artifact_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_ROLLOUT_GIT="$fake_bin/git" \
FLEET_ROLLOUT_DOCKER="$fake_bin/docker" \
FLEET_ROLLOUT_SSH="$fake_bin/ssh" \
FLEET_ROLLOUT_TAR="$(command -v tar)" \
FLEET_ROLLOUT_TMPDIR="$test_root/tmp" \
  "$ROLLOUT" us-mac-m4 --apply >"$test_root/public-signal.out" 2>&1 &
public_rollout_pid=$!
for _ in {1..100}; do
  [[ -e "$admit_ready" ]] && break
  kill -0 "$public_rollout_pid" 2>/dev/null \
    || fail "public rollout exited before reaching admission"
  sleep 0.02
done
[[ -e "$admit_ready" ]] || fail "public rollout never reached admission"
kill -TERM "$public_rollout_pid"
public_signal_status=0
wait "$public_rollout_pid" || public_signal_status=$?
[[ "$public_signal_status" -ne 0 ]] \
  || fail "TERM at the public rollout entrypoint was reported as success"
for _ in {1..150}; do
  [[ "$(awk 'END {print NR}' "$node_log")" -ge 5 ]] && break
  sleep 0.02
done
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "public TERM after undrain did not restore drain: $node_sequence"

: > "$node_log"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_REAL_GIT=1 \
  FLEET_TEST_SUDO_NOEXEC=1 \
  FLEET_TEST_SUDO_EXEC_NODE=1 \
  FLEET_TEST_SUDO_FAIL_RM=1 \
  FLEET_TEST_NODE_LOG="$node_log" \
  FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout us-mac-m4 --apply >"$test_root/cleanup-failure.out" 2>&1; then
  fail "root staging cleanup failure was reported as success"
fi
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "cleanup failure after admission did not restore drain: $node_sequence"

payload_root="$test_root/payload"
node_source="$payload_root/source/packages/brain/scripts/fleet-worker"
mkdir -p "$node_source"
cp "$fake_bin/nodectl" "$node_source/fleet-nodectl.sh"
printf 'bundle\n' > "$payload_root/repository.bundle"
printf 'runner\n' > "$payload_root/runner.tar"

: > "$node_log"
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  "$ROLLOUT" __node-apply xian-mac-m4 "$payload_root" >/dev/null \
  || fail "node-local apply sequence failed"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit' ]] \
  || fail "node-local apply order drifted: $node_sequence"
grep -Fq 'admit xian-mac-m4 xian-mac-m4' "$node_log" \
  || fail "node-local command lost the physical machine identity"

: > "$node_log"
if FLEET_TEST_NODE_LOG="$node_log" \
  FLEET_TEST_TRANSPORT_LOG="$transport_log" \
  FLEET_TEST_NODE_FAIL=admit \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  "$ROLLOUT" __node-apply xian-mac-m4 "$payload_root" \
  >"$test_root/admit.out" 2>&1; then
  fail "failed admission was hidden"
fi
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "failed admission did not restore drain: $node_sequence"

: > "$node_log"
signal_status=0
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_TEST_NODE_SIGNAL_PARENT=1 \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  "$ROLLOUT" __node-apply xian-mac-m4 "$payload_root" \
  >"$test_root/signal.out" 2>&1 \
  || signal_status=$?
[[ "$signal_status" -ne 0 ]] || fail "TERM during admission was reported as success"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "TERM after undrain did not restore drain: $node_sequence"

if run_rollout moon-base --apply >/dev/null 2>&1; then
  fail "unknown rollout target was accepted"
fi

if rg -ni '\.codex|auth\.json|credentials|CODEX_ACCOUNT|token|prompt|bridge.*/run' \
  "$artifact_log" "$transport_log" "$node_log"; then
  fail "rollout artifacts or transport contain account, Prompt, or Bridge authority"
fi

echo "PASS: Fleet rollout behavioral contract"
