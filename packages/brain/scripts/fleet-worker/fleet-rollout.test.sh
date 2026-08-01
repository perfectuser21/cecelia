#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2016
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLOUT="$SCRIPT_DIR/fleet-rollout.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -x "$ROLLOUT" ]] || fail "missing fleet-rollout.sh entrypoint"

if grep -Fq \
  '"$staged_root/source/packages/brain/scripts/fleet-worker/"*.sh' \
  "$ROLLOUT"; then
  fail "root-only staging expands the Fleet script glob before sudo"
fi

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fake_bin="$test_root/bin"
mkdir -p "$fake_bin"
artifact_log="$test_root/artifacts.log"
transport_log="$test_root/transport.log"
node_log="$test_root/node.log"
worker_token="$test_root/worker-token"
expected_runner_digest='sha256:f57591df89aa1a15e49019f306abcc5606039314ebf5d293d884c055cbfe1d00'
touch "$artifact_log" "$transport_log" "$node_log"
printf 'fleet-worker-transport-token-at-least-32-bytes\n' > "$worker_token"
chmod 0600 "$worker_token"
export FLEET_ROLLOUT_WORKER_TOKEN_FILE="$worker_token"

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
  '  if [[ "${1:-}" == "-c" && "${2:-}" == "tar.umask=0022" ]]; then shift 2; fi' \
  '  if [[ "$*" == "status --porcelain --untracked-files=all" ]]; then exit 0; fi' \
  '  if [[ "$*" == "rev-parse --verify HEAD^{commit}" ]]; then' \
  '    exec /usr/bin/git -C "$repo_root" "$@"' \
  '  fi' \
  '  if [[ "${1:-}" == "archive" ]]; then' \
  '    output=""' \
  '    while [[ $# -gt 0 ]]; do' \
  '      if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi' \
  '      shift' \
  '    done' \
  '    exec /usr/bin/tar -cf "$output" -C "$repo_root" packages/brain/package.json packages/brain/config/fleet-node-profiles.json packages/brain/src/orchestrator/fleet-node/node-profile.js packages/brain/src/orchestrator/fleet-node/node-admission.js packages/brain/scripts/fleet-worker' \
  '  fi' \
  '  if [[ "${1:-}" == "init" && "${2:-}" == "--bare" ]]; then mkdir -p "$3"; exit 0; fi' \
  '  if [[ "$*" == *" fetch --no-tags "* || "$*" == *" update-ref "* || "$*" == *" symbolic-ref HEAD "* ]]; then exit 0; fi' \
  '  if [[ "$*" == *" bundle create "* ]]; then' \
  '    while [[ $# -gt 0 && "$1" != "create" ]]; do shift; done' \
  '    shift' \
  '    printf "bundle\n" > "$1"' \
  '    exit 0' \
  '  fi' \
  '  if [[ -n "$repo_root" ]]; then exec /usr/bin/git -C "$repo_root" "$@"; fi' \
  '  exec /usr/bin/git "$@"' \
  'fi' \
  'if [[ "$*" == *"rev-parse --verify HEAD^{commit}"* ]]; then' \
  '  count=0' \
  '  [[ -f "${FLEET_TEST_GIT_STATE:?}" ]] && read -r count < "$FLEET_TEST_GIT_STATE"' \
  '  count=$((count + 1))' \
  '  printf "%s\n" "$count" > "$FLEET_TEST_GIT_STATE"' \
  '  if [[ "${FLEET_TEST_HEAD_DRIFT:-0}" == 1 && "$count" -gt 1 ]]; then' \
  '    printf "%040d\n" 2' \
  '  else' \
  '    printf "%040d\n" 1' \
  '  fi' \
  '  exit 0' \
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
  'if [[ "${1:-}" == "run" ]]; then' \
  '  [[ "${FLEET_TEST_RUNNER_CONTRACT_FAIL:-0}" != 1 ]]' \
  '  exit' \
  'fi' \
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
  '  if [[ "${FLEET_TEST_SSH_TRUNCATE:-0}" == 1 ]]; then exec /bin/bash -c "$1" </dev/null; fi' \
  '  exec /bin/bash -c "$1"' \
  'fi' \
  'cat >/dev/null' \
  '[[ "${FLEET_TEST_SSH_FAIL:-0}" != 1 ]]'

write_executable "$fake_bin/sudo" \
  '#!/usr/bin/env bash' \
  'printf "sudo %s\n" "$*" >> "${FLEET_TEST_TRANSPORT_LOG:?}"' \
  '[[ "${1:-}" == "-n" ]] && shift' \
  'if [[ "${1:-}" == "/usr/bin/mktemp" && -n "${FLEET_TEST_REMOTE_STAGE_ROOT:-}" ]]; then' \
  '  /bin/mkdir -p "$FLEET_TEST_REMOTE_STAGE_ROOT"' \
  '  /bin/chmod 0700 "$FLEET_TEST_REMOTE_STAGE_ROOT"' \
  '  printf "%s\n" "$FLEET_TEST_REMOTE_STAGE_ROOT"' \
  '  exit 0' \
  'fi' \
  'if [[ "${1:-}" == "/bin/test" && "${@: -1}" == "${FLEET_TEST_PROTECTED_TOKEN_SOURCE:-}" ]]; then exit 0; fi' \
  'if [[ "${1:-}" == "/usr/bin/install" && "${@: -2:1}" == "${FLEET_TEST_PROTECTED_TOKEN_SOURCE:-}" ]]; then' \
  '  /bin/cp "${FLEET_TEST_PROTECTED_TOKEN_BACKING:?}" "${@: -1}"' \
  '  /bin/chmod 0600 "${@: -1}"' \
  '  exit 0' \
  'fi' \
  'if [[ "${1:-}" == "/bin/kill" && "${FLEET_TEST_SUDO_FAIL_KILL:-0}" == 1 ]]; then exit 25; fi' \
  'if [[ "${1:-}" == "/bin/mkdir" && "${*: -1}" == "/var/run/cecelia" ]]; then exit 0; fi' \
  'if [[ "${1:-}" == "/usr/bin/touch" && "${2:-}" == "/var/run/cecelia/fleet-worker.drain" ]]; then' \
  '  [[ "${FLEET_TEST_SUDO_FAIL_TOUCH:-0}" == 1 ]] && exit 26' \
  '  [[ -n "${FLEET_TEST_NODE_LOG:-}" ]] && printf "drain emergency\n" >> "$FLEET_TEST_NODE_LOG"' \
  '  exit 0' \
  'fi' \
  'if [[ "${1:-}" == "/bin/launchctl" ]]; then' \
  '  if [[ "${FLEET_TEST_SUDO_FAIL_TOUCH:-0}" == 1 && -n "${FLEET_TEST_NODE_LOG:-}" ]]; then' \
  '    printf "drain emergency\n" >> "$FLEET_TEST_NODE_LOG"' \
  '  fi' \
  '  exit 0' \
  'fi' \
  'if [[ "${1:-}" == "/bin/rm" && "${FLEET_TEST_SUDO_PARTIAL_RM:-0}" == 1 ]]; then' \
  '  target="${@: -1}"' \
  '  case "$target" in' \
  '    /var/tmp/cecelia-fleet-rollout.*)' \
  '      /bin/rm -f -- "$target/source/packages/brain/scripts/fleet-worker/fleet-rollout.sh" "$target/source/packages/brain/scripts/fleet-worker/fleet-nodectl.sh"' \
  '      exit 24' \
  '      ;;' \
  '  esac' \
  'fi' \
  'if [[ "${1:-}" == "/bin/rm" && "${FLEET_TEST_SUDO_SIGNAL_RM:-0}" == 1 ]]; then' \
  '  target="${@: -1}"' \
  '  if [[ "$target" == /var/tmp/cecelia-fleet-rollout.* && ! -e "${FLEET_TEST_RM_SIGNAL_STATE:?}" ]]; then' \
  '    : > "$FLEET_TEST_RM_SIGNAL_STATE"' \
  '    kill -TERM "$PPID"' \
  '    sleep 0.1' \
  '  fi' \
  'fi' \
  'if [[ "${1:-}" == "/bin/rm" && "${FLEET_TEST_SUDO_FAIL_RM:-0}" == 1 ]]; then exit 24; fi' \
  'if [[ "${1:-}" == "/usr/bin/stat" ]]; then' \
  '  target="${@: -1}"' \
  '  if [[ ( "${3:-}" == "%Lp" || "${3:-}" == "%a" ) && "$target" == "${FLEET_TEST_PROTECTED_TOKEN_SOURCE:-}" ]]; then' \
  '    printf "600\n"' \
  '  elif [[ "${FLEET_TEST_STAGE_INVALID_OWNER:-0}" == 1 ]]; then' \
  '    printf "501:755\n"' \
  '  elif [[ "${FLEET_TEST_STAGE_WRITABLE:-0}" == 1 && "$target" == */fleet-rollout.sh ]]; then' \
  '    printf "0:777\n"' \
  '  elif [[ "$target" == */source/* ]]; then' \
  '    printf "0:755\n"' \
  '  else' \
  '    printf "0:700\n"' \
  '  fi' \
  '  exit 0' \
  'fi' \
  'if [[ "${1:-}" == "/bin/test" && "${2:-}" == "!" && "${3:-}" == "-L" ]]; then' \
  '  if [[ "${FLEET_TEST_STAGE_SYMLINK:-0}" == 1 && "${4:-}" == */fleet-nodectl.sh ]]; then exit 1; fi' \
  'fi' \
  'if [[ "${FLEET_TEST_SUDO_NOEXEC:-0}" == 1 ]]; then' \
  '  case "${1:-}" in' \
  '    /usr/bin/mktemp|/usr/bin/tar|/usr/bin/find|/bin/mkdir|/bin/chmod|/bin/rm|/bin/kill|/bin/test|/bin/realpath) exec "$@" ;;' \
  '    */fleet-rollout.sh)' \
  '      if [[ "${2:-}" == "__node-apply" ]]; then' \
  '        exec /bin/bash -c '"'"'source "$1"; run_node_apply "$2" "$3" "${FLEET_ROLLOUT_NODECTL:-}"'"'"' -- "$1" "$3" "$4"' \
  '      fi' \
  '      exec "$@"' \
  '      ;;' \
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
  'if [[ "$command_name" == "admit" && -n "${FLEET_TEST_NODE_ADMIT_FAIL_ONCE_STATE:-}" && ! -e "$FLEET_TEST_NODE_ADMIT_FAIL_ONCE_STATE" ]]; then' \
  '  : > "$FLEET_TEST_NODE_ADMIT_FAIL_ONCE_STATE"' \
  '  exit 23' \
  'fi' \
  'if [[ "$command_name" == "${FLEET_TEST_NODE_FAIL:-}" ]]; then exit 23; fi' \
  'if [[ "$command_name" == "admit" ]]; then' \
  '  printf "%s\n" '"'"'{"base_admitted":true,"dispatch_ready":false}'"'"'' \
  'fi'

run_rollout() {
  FLEET_TEST_ARTIFACT_LOG="$artifact_log" \
  FLEET_TEST_TRANSPORT_LOG="$transport_log" \
  FLEET_TEST_GIT_STATE="$test_root/git.state" \
  FLEET_ROLLOUT_GIT="$fake_bin/git" \
  FLEET_ROLLOUT_DOCKER="$fake_bin/docker" \
  FLEET_ROLLOUT_SSH="$fake_bin/ssh" \
  FLEET_ROLLOUT_TAR="$(command -v tar)" \
  FLEET_ROLLOUT_TMPDIR="$test_root/tmp" \
  FLEET_ROLLOUT_WORKER_TOKEN_FILE="${FLEET_TEST_TOKEN_SOURCE:-$worker_token}" \
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

protected_token_source='/var/lib/cecelia/fleet-worker/worker-auth'
: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_TOKEN_SOURCE="$protected_token_source" \
FLEET_TEST_PROTECTED_TOKEN_SOURCE="$protected_token_source" \
FLEET_TEST_PROTECTED_TOKEN_BACKING="$worker_token" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout xian-mac-m4 --apply >/dev/null \
  || fail "controller could not stage the protected production Worker token"
grep -Fq "sudo -n /bin/test -f $protected_token_source" "$transport_log" \
  || fail "protected Worker token was not validated across the sudo boundary"
grep -Fq "sudo -n /usr/bin/install" "$transport_log" \
  || fail "protected Worker token was not copied through root-owned staging"

if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_DIRTY=1 \
  run_rollout xian-mac-m4 --apply >"$test_root/dirty.out" 2>&1; then
  fail "dirty rollout source was accepted"
fi
grep -Fq 'rollout_source_dirty' "$test_root/dirty.out" \
  || fail "dirty source failure was not explicit"

rm -f "$test_root/git.state"
: > "$transport_log"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_HEAD_DRIFT=1 \
  run_rollout xian-mac-m4 --apply >"$test_root/head-drift.out" 2>&1; then
  fail "rollout accepted a source commit that changed during artifact creation"
fi
grep -Fq 'rollout_source_changed' "$test_root/head-drift.out" \
  || fail "source commit drift failure was not explicit"
[[ ! -s "$transport_log" ]] || fail "rollout transported artifacts after source drift"

rm -f "$test_root/git.state"
: > "$artifact_log"
: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
  run_rollout xian-mac-m4 --apply >/dev/null \
  || fail "valid Xian M4 rollout transport failed"
grep -Fq 'archive --format=tar --output' "$artifact_log" \
  || fail "rollout did not archive committed source"
grep -Fq -- '-c tar.umask=0022 archive --format=tar' "$artifact_log" \
  || fail "rollout source archive did not remove group/world write bits"
grep -Eq 'archive --format=tar --output .* 0000000000000000000000000000000000000001 ' \
  "$artifact_log" \
  || fail "rollout archive did not use the frozen commit"
grep -Fq \
  'packages/brain/src/orchestrator/fleet-node/node-admission.js' \
  "$artifact_log" \
  || fail "rollout archive omitted the admission evaluator consumed by fleet-nodectl"
grep -Fq 'bundle create' "$artifact_log" \
  || fail "rollout did not create a Git bundle"
grep -Eq 'symbolic-ref HEAD refs/heads/fleet-rollout$' "$artifact_log" \
  || fail "rollout bundle repository HEAD did not resolve to the frozen rollout ref"
grep -Eq 'bundle create .* HEAD$' "$artifact_log" \
  || fail "rollout bundle did not publish the HEAD ref consumed by baseline"
grep -Eq 'fetch --no-tags .* 0000000000000000000000000000000000000001$' \
  "$artifact_log" \
  || fail "rollout bundle did not fetch the frozen commit"
grep -Fq 'docker save --output' "$artifact_log" \
  || fail "rollout did not export the Runner image"
grep -Fq 'docker run --rm --entrypoint sh' "$artifact_log" \
  && fail "rollout still uses a static source-string image contract"
grep -Fq '__cecelia_runner_credential_contract_probe__' "$artifact_log" \
  || fail "rollout did not execute the pinned Runner functional credential probe"
grep -Fq "$expected_runner_digest" "$artifact_log" \
  || fail "rollout did not export the verified origin/main Runner digest"
grep -Fq 'jinnuoshengyuan@100.86.57.69' "$transport_log" \
  || fail "Xian M4 SSH target drifted"
grep -Fq 'BatchMode=yes' "$transport_log" \
  || fail "SSH transport is not non-interactive"
grep -Fq 'StrictHostKeyChecking=yes' "$transport_log" \
  || fail "SSH transport does not enforce host identity"

: > "$artifact_log"
: > "$transport_log"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_RUNNER_CONTRACT_FAIL=1 \
  run_rollout xian-mac-m4 --apply >"$test_root/runner-contract.out" 2>&1; then
  fail "rollout accepted a Runner image without the credential contract"
fi
grep -Fq 'runner_image_contract_invalid' "$test_root/runner-contract.out" \
  || fail "invalid Runner image contract failure was not explicit"
if grep -Fq 'docker save --output' "$artifact_log"; then
  fail "rollout exported a Runner image after its contract failed"
fi
[[ ! -s "$transport_log" ]] \
  || fail "rollout transported artifacts after Runner image contract failure"

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
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
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
grep -Fq 'sudo -n /usr/bin/stat -f %u:%Lp -- /var/tmp/cecelia-fleet-rollout.' \
  "$transport_log" \
  || fail "remote rollout did not validate root staging ownership and mode"

: > "$transport_log"
remote_transfer_stage="$test_root/remote-transfer-stage"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_REAL_GIT=1 \
  FLEET_TEST_SSH_EXECUTE=1 \
  FLEET_TEST_SSH_TRUNCATE=1 \
  FLEET_TEST_SUDO_NOEXEC=1 \
  FLEET_TEST_REMOTE_STAGE_ROOT="$remote_transfer_stage" \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout xian-mac-m4 --apply >"$test_root/remote-transfer-interrupt.out" 2>&1; then
  fail "truncated remote transport was reported as success"
fi
[[ ! -e "$remote_transfer_stage" ]] \
  || fail "truncated remote transport left root staging behind"
grep -Fq 'sudo -n /usr/bin/touch /var/run/cecelia/fleet-worker.drain' \
  "$transport_log" \
  || fail "truncated remote transport did not fail closed with drain"

: > "$transport_log"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_REAL_GIT=1 \
  FLEET_TEST_SSH_EXECUTE=1 \
  FLEET_TEST_SUDO_NOEXEC=1 \
  FLEET_TEST_STAGE_INVALID_OWNER=1 \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout xian-mac-m4 --apply >"$test_root/remote-invalid-owner.out" 2>&1; then
  fail "remote rollout accepted non-root staging"
fi
grep -Fq 'rollout_staging_invalid' "$test_root/remote-invalid-owner.out" \
  || fail "remote invalid staging failure was not explicit"
if grep -Eq '^sudo .*__node-apply' "$transport_log"; then
  fail "remote invalid staging reached privileged controller execution"
fi

: > "$transport_log"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout us-mac-m4 --apply >/dev/null \
  || fail "executable local rollout contract failed"
first_local_sudo="$(grep '^sudo ' "$transport_log" | head -n 1)"
[[ "$first_local_sudo" == *'mktemp -d /var/tmp/cecelia-fleet-rollout.'* ]] \
  || fail "local payload was not staged into a root-owned directory first: $first_local_sudo"
if grep -Eq "^sudo .* $test_root/tmp/.*/fleet-nodectl\\.sh " "$transport_log"; then
  fail "sudo executed a Fleet script from the controller user's writable temp directory"
fi
grep -Fq 'sudo -n /usr/bin/stat -f %u:%Lp -- /var/tmp/cecelia-fleet-rollout.' \
  "$transport_log" \
  || fail "local rollout did not validate root staging ownership and mode"

for invalid_stage in owner writable symlink; do
  : > "$transport_log"
  invalid_owner=0
  invalid_writable=0
  invalid_symlink=0
  case "$invalid_stage" in
    owner) invalid_owner=1 ;;
    writable) invalid_writable=1 ;;
    symlink) invalid_symlink=1 ;;
  esac
  if CECELIA_MACHINE_ID=us-mac-m4 \
    FLEET_TEST_REAL_GIT=1 \
    FLEET_TEST_SUDO_NOEXEC=1 \
    FLEET_TEST_STAGE_INVALID_OWNER="$invalid_owner" \
    FLEET_TEST_STAGE_WRITABLE="$invalid_writable" \
    FLEET_TEST_STAGE_SYMLINK="$invalid_symlink" \
    FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
    run_rollout us-mac-m4 --apply >"$test_root/invalid-$invalid_stage.out" 2>&1; then
    fail "local rollout accepted invalid root staging: $invalid_stage"
  fi
  grep -Fq 'rollout_staging_invalid' "$test_root/invalid-$invalid_stage.out" \
    || fail "invalid staging failure was not explicit: $invalid_stage"
  if grep -Eq '^sudo .*__node-apply' "$transport_log"; then
    fail "invalid staging reached privileged controller execution: $invalid_stage"
  fi
done

admit_ready="$test_root/public-admit.ready"
: > "$node_log"
rm -f "$admit_ready"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_TEST_SUDO_EXEC_NODE=1 \
FLEET_TEST_SUDO_FAIL_KILL=1 \
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_NODE_ADMIT_READY="$admit_ready" \
FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_TEST_ARTIFACT_LOG="$artifact_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_TEST_GIT_STATE="$test_root/git.state" \
FLEET_ROLLOUT_GIT="$fake_bin/git" \
FLEET_ROLLOUT_DOCKER="$fake_bin/docker" \
FLEET_ROLLOUT_SSH="$fake_bin/ssh" \
FLEET_ROLLOUT_TAR="$(command -v tar)" \
FLEET_ROLLOUT_TMPDIR="$test_root/tmp" \
  "$ROLLOUT" us-mac-m4 --apply >"$test_root/public-signal.out" 2>&1 &
public_rollout_pid=$!
for _ in {1..600}; do
  [[ -e "$admit_ready" ]] && break
  kill -0 "$public_rollout_pid" 2>/dev/null \
    || fail "public rollout exited before reaching admission"
  sleep 0.02
done
[[ -e "$admit_ready" ]] \
  || fail "public rollout never reached admission: $(<"$test_root/public-signal.out")"
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
grep -Eq '^sudo -n /bin/kill -s TERM [0-9]+$' "$transport_log" \
  || fail "public TERM was not forwarded across the sudo ownership boundary"

: > "$node_log"
rm -f "$admit_ready"
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SSH_EXECUTE=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_TEST_SUDO_FAIL_KILL=1 \
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_NODE_ADMIT_READY="$admit_ready" \
FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_TEST_ARTIFACT_LOG="$artifact_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_TEST_GIT_STATE="$test_root/git.state" \
FLEET_ROLLOUT_GIT="$fake_bin/git" \
FLEET_ROLLOUT_DOCKER="$fake_bin/docker" \
FLEET_ROLLOUT_SSH="$fake_bin/ssh" \
FLEET_ROLLOUT_TAR="$(command -v tar)" \
FLEET_ROLLOUT_TMPDIR="$test_root/tmp" \
  "$ROLLOUT" xian-mac-m4 --apply >"$test_root/public-remote-signal.out" 2>&1 &
public_remote_pid=$!
for _ in {1..600}; do
  [[ -e "$admit_ready" ]] && break
  kill -0 "$public_remote_pid" 2>/dev/null \
    || fail "public remote rollout exited before reaching admission"
  sleep 0.02
done
[[ -e "$admit_ready" ]] || fail "public remote rollout never reached admission"
kill -TERM "$public_remote_pid"
public_remote_status=0
wait "$public_remote_pid" || public_remote_status=$?
[[ "$public_remote_status" -ne 0 ]] \
  || fail "TERM at the public SSH rollout entrypoint was reported as success"
for _ in {1..150}; do
  [[ "$(awk 'END {print NR}' "$node_log")" -ge 5 ]] && break
  sleep 0.02
done
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "public SSH TERM after undrain did not restore drain: $node_sequence"
grep -Fq 'jinnuoshengyuan@100.86.57.69' "$transport_log" \
  || fail "public SSH interruption did not exercise the remote path"

: > "$node_log"
: > "$transport_log"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_REAL_GIT=1 \
  FLEET_TEST_SUDO_NOEXEC=1 \
  FLEET_TEST_SUDO_EXEC_NODE=1 \
  FLEET_TEST_SUDO_PARTIAL_RM=1 \
  FLEET_TEST_NODE_LOG="$node_log" \
  FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout us-mac-m4 --apply >"$test_root/cleanup-failure.out" 2>&1; then
  fail "root staging cleanup failure was reported as success"
fi
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "cleanup failure after admission did not restore drain: $node_sequence"

: > "$node_log"
: > "$transport_log"
if CECELIA_MACHINE_ID=us-mac-m4 \
  FLEET_TEST_REAL_GIT=1 \
  FLEET_TEST_SUDO_NOEXEC=1 \
  FLEET_TEST_SUDO_EXEC_NODE=1 \
  FLEET_TEST_SUDO_PARTIAL_RM=1 \
  FLEET_TEST_SUDO_FAIL_TOUCH=1 \
  FLEET_TEST_NODE_LOG="$node_log" \
  FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout us-mac-m4 --apply >"$test_root/emergency-drain-failure.out" 2>&1; then
  fail "failed emergency drain was reported as rollout success"
fi
grep -Fq 'sudo -n /bin/launchctl bootout system/com.perfect21.fleet-worker' \
  "$transport_log" \
  || fail "marker failure skipped emergency launchd bootout"
grep -Fq 'emergency_drain_failed' "$test_root/emergency-drain-failure.out" \
  || fail "emergency drain failure was not observable"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "launchd fallback did not close failed emergency drain: $node_sequence"

: > "$node_log"
rm_signal_state="$test_root/rm-signal.state"
rm -f "$rm_signal_state"
cleanup_signal_status=0
CECELIA_MACHINE_ID=us-mac-m4 \
FLEET_TEST_REAL_GIT=1 \
FLEET_TEST_SUDO_NOEXEC=1 \
FLEET_TEST_SUDO_EXEC_NODE=1 \
FLEET_TEST_SUDO_SIGNAL_RM=1 \
FLEET_TEST_RM_SIGNAL_STATE="$rm_signal_state" \
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_ROLLOUT_NODECTL="$fake_bin/nodectl" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  run_rollout us-mac-m4 --apply >"$test_root/cleanup-signal.out" 2>&1 \
  || cleanup_signal_status=$?
[[ "$cleanup_signal_status" -ne 0 ]] \
  || fail "TERM during root staging cleanup was reported as success"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "TERM during root staging cleanup did not restore drain: $node_sequence"

payload_root="$test_root/payload"
node_source="$payload_root/source/packages/brain/scripts/fleet-worker"
mkdir -p "$node_source"
cp "$fake_bin/nodectl" "$node_source/fleet-nodectl.sh"
printf 'bundle\n' > "$payload_root/repository.bundle"
printf 'runner\n' > "$payload_root/runner.tar"

run_node_apply_for_test() (
  source "$ROLLOUT"
  run_node_apply "$1" "$2" "$3"
)

: > "$node_log"
if FLEET_TEST_NODE_LOG="$node_log" \
  run_node_apply_for_test xian-mac-m4 "$payload_root" \
    "$node_source/fleet-nodectl.sh" >/dev/null 2>&1; then
  fail "node-local apply accepted a payload without Worker transport auth"
fi

cp "$worker_token" "$payload_root/worker-token"
chmod 0600 "$payload_root/worker-token"

: > "$node_log"
if FLEET_TEST_NODE_LOG="$node_log" \
  FLEET_TEST_TRANSPORT_LOG="$transport_log" \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  "$ROLLOUT" __node-apply xian-mac-m4 "$payload_root" \
  >"$test_root/direct-internal.out" 2>&1; then
  fail "unprivileged caller entered the privileged node-apply entrypoint"
fi
grep -Fq 'rollout_internal_root_required' "$test_root/direct-internal.out" \
  || fail "unprivileged internal-entry failure was not explicit"
[[ ! -s "$node_log" ]] \
  || fail "unprivileged internal entrypoint executed a user-writable nodectl"

: > "$node_log"
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  run_node_apply_for_test xian-mac-m4 "$payload_root" \
    "$node_source/fleet-nodectl.sh" >/dev/null \
  || fail "node-local apply sequence failed"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit' ]] \
  || fail "node-local apply order drifted: $node_sequence"
grep -Fq 'admit xian-mac-m4 xian-mac-m4' "$node_log" \
  || fail "node-local command lost the physical machine identity"

: > "$node_log"
admit_retry_state="$test_root/admit-retry.state"
rm -f "$admit_retry_state"
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_NODE_ADMIT_FAIL_ONCE_STATE="$admit_retry_state" \
FLEET_ROLLOUT_SLEEP=/usr/bin/true \
  run_node_apply_for_test xian-mac-m4 "$payload_root" \
    "$node_source/fleet-nodectl.sh" >/dev/null \
  || fail "node-local apply did not recover from a transient first admission probe"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,admit' ]] \
  || fail "node-local admission retry order drifted: $node_sequence"

: > "$node_log"
if FLEET_TEST_NODE_LOG="$node_log" \
  FLEET_TEST_TRANSPORT_LOG="$transport_log" \
  FLEET_TEST_NODE_FAIL=admit \
  FLEET_ROLLOUT_SLEEP=/usr/bin/true \
  FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
  FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  run_node_apply_for_test xian-mac-m4 "$payload_root" \
    "$node_source/fleet-nodectl.sh" \
  >"$test_root/admit.out" 2>&1; then
  fail "failed admission was hidden"
fi
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,admit,admit,drain' ]] \
  || fail "failed admission did not restore drain: $node_sequence"

: > "$node_log"
signal_status=0
FLEET_TEST_NODE_LOG="$node_log" \
FLEET_TEST_TRANSPORT_LOG="$transport_log" \
FLEET_TEST_NODE_SIGNAL_PARENT=1 \
FLEET_ROLLOUT_SUDO="$fake_bin/sudo" \
FLEET_ROLLOUT_NODECTL="$node_source/fleet-nodectl.sh" \
  run_node_apply_for_test xian-mac-m4 "$payload_root" \
    "$node_source/fleet-nodectl.sh" \
  >"$test_root/signal.out" 2>&1 \
  || signal_status=$?
[[ "$signal_status" -ne 0 ]] || fail "TERM during admission was reported as success"
node_sequence="$(awk '{print $1}' "$node_log" | paste -sd, -)"
[[ "$node_sequence" == 'drain,bootstrap,undrain,admit,drain' ]] \
  || fail "TERM after undrain did not restore drain: $node_sequence"

if run_rollout moon-base --apply >/dev/null 2>&1; then
  fail "unknown rollout target was accepted"
fi

if grep -Eni '\.codex|auth\.json|credentials|CODEX_ACCOUNT|token|prompt|bridge.*/run' \
  "$artifact_log" "$transport_log" "$node_log"; then
  fail "rollout artifacts or transport contain account, Prompt, or Bridge authority"
fi

echo "PASS: Fleet rollout behavioral contract"
