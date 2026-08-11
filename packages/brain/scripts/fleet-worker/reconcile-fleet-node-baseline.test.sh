#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECONCILER="$SCRIPT_DIR/reconcile-fleet-node-baseline.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -x "$RECONCILER" ]] || fail "missing reconcile-fleet-node-baseline.sh entrypoint"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fake_bin="$test_root/bin"
state_root="$test_root/state"
system_root="$test_root/system"
mkdir -p "$fake_bin" "$state_root" "$system_root"
mutation_log="$state_root/mutations.log"
service_state="$state_root/service-user"
runner_state="$state_root/runner"
postgres_content_state="$state_root/postgres-content"
postgres_reference_state="$state_root/postgres-reference"
touch "$mutation_log"

write_executable() {
  local target="$1"
  shift
  printf '%s\n' "$@" > "$target"
  chmod +x "$target"
}

tailscale_app="$system_root/Applications/Tailscale.app/Contents/MacOS/Tailscale"
mkdir -p "$(dirname "$tailscale_app")"
write_executable "$tailscale_app" \
  '#!/usr/bin/env bash' \
  'echo "100.88.166.55"'

write_executable "$fake_bin/id" \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "-u" && $# -eq 1 ]]; then echo "${FLEET_TEST_EFFECTIVE_UID:-0}"; exit 0; fi' \
  'if [[ "$1" == "-u" && "${2:-}" == "fleet-admin" ]]; then echo 501; exit 0; fi' \
  'if [[ "$1" == "-u" && "${2:-}" == "_cecelia" && -f "${FLEET_TEST_SERVICE_STATE:?}" ]]; then echo 450; exit 0; fi' \
  'if [[ "$1" == "-g" && "${2:-}" == "_cecelia" && -f "${FLEET_TEST_SERVICE_STATE:?}" ]]; then echo 450; exit 0; fi' \
  'exit 1'

write_executable "$fake_bin/dscl" \
  '#!/usr/bin/env bash' \
  'printf "dscl %s\n" "$*" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  'if [[ "$*" == *"-search /Users UniqueID 450"* ]]; then' \
  '  [[ "${FLEET_TEST_ID_COLLISION:-0}" == 1 ]] && echo "somebody 450"' \
  '  exit 0' \
  'fi' \
  'if [[ "$*" == *"-search /Groups PrimaryGroupID 450"* ]]; then' \
  '  if [[ "${FLEET_TEST_ID_COLLISION:-0}" == 1 ]]; then echo "somegroup 450"; fi' \
  '  if [[ "${FLEET_TEST_PARTIAL_GROUP:-0}" == 1 ]]; then echo "_cecelia 450"; fi' \
  '  exit 0' \
  'fi' \
  'if [[ "$*" == *"-create /Users/_cecelia"* ]]; then' \
  '  touch "${FLEET_TEST_SERVICE_STATE:?}"' \
  'fi' \
  'exit 0'

write_executable "$fake_bin/uname" \
  '#!/usr/bin/env bash' \
  '[[ "${1:-}" == "-m" ]] && echo "${FLEET_TEST_ARCH:-arm64}" || echo Darwin'

write_executable "$fake_bin/sw_vers" \
  '#!/usr/bin/env bash' \
  '[[ "${1:-}" == "-productVersion" ]] && echo "${FLEET_TEST_OS_VERSION:-15.6.1}" || exit 1'

write_executable "$fake_bin/uuidgen" \
  '#!/usr/bin/env bash' \
  'state="${FLEET_TEST_UUID_STATE:?}"' \
  'count=0' \
  '[[ ! -f "$state" ]] || read -r count < "$state"' \
  'count=$((count + 1))' \
  'printf "%s\n" "$count" > "$state"' \
  'printf "11111111-2222-3333-4444-%012d\n" "$count"'

write_executable "$fake_bin/curl" \
  '#!/usr/bin/env bash' \
  'output=""' \
  'while [[ $# -gt 0 ]]; do' \
  '  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; continue; fi' \
  '  shift' \
  'done' \
  '[[ -n "$output" ]] || exit 2' \
  'printf "download\n" > "$output"' \
  'printf "curl %s\n" "$output" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/shasum" \
  '#!/usr/bin/env bash' \
  'target="${@: -1}"' \
  'base="${target##*/}"' \
  'case "$base" in' \
  '  node-v*) echo "75ff6fd07e0a85fb4d2529f6189c996014b1d3d83180c31e65feb2b3eaeec5d9  $target" ;;' \
  '  *) echo "5bc1719c3c987c4c60c65be9fdd65b4730990e1697ec1cb1c33e6bba31bf92b5  $target" ;;' \
  'esac'

: <<'REPLACED_FAKE_ARTIFACT_BUILDERS'
write_executable "$fake_bin/tar" \
  '#!/usr/bin/env bash' \
  'destination=""' \
  'while [[ $# -gt 0 ]]; do' \
  '  if [[ "$1" == "-C" ]]; then destination="$2"; shift 2; continue; fi' \
  '  shift' \
  'done' \
  'target="$destination/node-v25.8.0-darwin-arm64/bin"' \
  'mkdir -p "$target"' \
  'cat > "$target/node" <<'"'"'NODE"'"'' \
  '#!/usr/bin/env bash' \
  'echo v25.8.0' \
  'NODE' \
  'cat > "$target/npm" <<'"'"'NPM"'"'' \
  '#!/usr/bin/env bash' \
  'prefix=""' \
  'while [[ $# -gt 0 ]]; do' \
  '  if [[ "$1" == "--prefix" ]]; then prefix="$2"; shift 2; continue; fi' \
  '  shift' \
  'done' \
  'mkdir -p "$prefix/bin"' \
  'cat > "$prefix/bin/codex" <<'"'"'CODEX"'"'' \
  '#!/usr/bin/env bash' \
  'echo "codex-cli 0.145.0"' \
  'CODEX' \
  'chmod +x "$prefix/bin/codex"' \
  'printf "npm pinned-codex\n" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  'NPM' \
  'chmod +x "$target/node" "$target/npm"' \
  'printf "tar node\n" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/hdiutil" \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "attach" ]]; then' \
  '  mountpoint=""' \
  '  while [[ $# -gt 0 ]]; do' \
  '    if [[ "$1" == "-mountpoint" ]]; then mountpoint="$2"; shift 2; continue; fi' \
  '    shift' \
  '  done' \
  '  app_bin="$mountpoint/OrbStack.app/Contents/MacOS/bin"' \
  '  mkdir -p "$app_bin"' \
  '  cat > "$app_bin/orbctl" <<'"'ORBCTL"'"'' \
  '#!/usr/bin/env bash' \
  'echo "Version: 2.2.1 (2020100)"' \
  'ORBCTL' \
  '  cat > "$app_bin/orb" <<'"'ORB"'"'' \
  '#!/usr/bin/env bash' \
  'exit 0' \
  'ORB' \
  '  chmod +x "$app_bin/orbctl" "$app_bin/orb"' \
  '  printf "hdiutil attach\n" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  '  exit 0' \
  'fi' \
  'printf "hdiutil detach\n" >> "${FLEET_TEST_MUTATION_LOG:?}"'
REPLACED_FAKE_ARTIFACT_BUILDERS

write_executable "$fake_bin/toolchain-node" \
  '#!/usr/bin/env bash' \
  'echo v25.8.0'

write_executable "$fake_bin/toolchain-codex" \
  '#!/usr/bin/env bash' \
  'if [[ "${FLEET_TEST_REQUIRE_TOOLCHAIN_NODE_PATH:-0}" == 1 ]]; then' \
  '  [[ "$(command -v node || true)" == "${FLEET_TEST_EXPECTED_NODE:?}" ]] || { echo "clean-codex-node-path-missing" >&2; exit 127; }' \
  'fi' \
  'echo "codex-cli 0.145.0"'

write_executable "$fake_bin/toolchain-npm" \
  '#!/usr/bin/env bash' \
  'if [[ "${FLEET_TEST_REQUIRE_TOOLCHAIN_NODE_PATH:-0}" == 1 ]]; then' \
  '  [[ "$(command -v node || true)" == "${FLEET_TEST_EXPECTED_NODE:?}" ]] || { echo "clean-node-path-missing" >&2; exit 127; }' \
  'fi' \
  'prefix=""' \
  'while [[ $# -gt 0 ]]; do' \
  '  if [[ "$1" == "--prefix" ]]; then prefix="$2"; shift 2; continue; fi' \
  '  shift' \
  'done' \
  'mkdir -p "$prefix/bin"' \
  'cp "${FLEET_TEST_FAKE_CODEX:?}" "$prefix/bin/codex"' \
  'chmod +x "$prefix/bin/codex"' \
  'printf "npm pinned-codex\n" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/tar" \
  '#!/usr/bin/env bash' \
  'destination=""' \
  'while [[ $# -gt 0 ]]; do' \
  '  if [[ "$1" == "-C" ]]; then destination="$2"; shift 2; continue; fi' \
  '  shift' \
  'done' \
  'target="$destination/node-v25.8.0-darwin-arm64/bin"' \
  'mkdir -p "$target"' \
  'cp "${FLEET_TEST_FAKE_NODE:?}" "$target/node"' \
  'cp "${FLEET_TEST_FAKE_NPM:?}" "$target/npm"' \
  'chmod +x "$target/node" "$target/npm"' \
  'printf "tar node\n" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/orbstack-orbctl" \
  '#!/usr/bin/env bash' \
  'echo "Version: 2.2.1 (2020100)"'

write_executable "$fake_bin/orbstack-orb" \
  '#!/usr/bin/env bash' \
  'printf "orb %s\n" "$*" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  'if [[ "${1:-}" == start ]]; then' \
  '  socket="${FLEET_TEST_SOCKET_ROOT:?}/Users/fleet-admin/.orbstack/run/docker.sock"' \
  '  mkdir -p "$(dirname "$socket")"' \
  '  if [[ ! -e "$socket" ]]; then' \
  '    : > "$socket"' \
  '  fi' \
  'fi' \
  'if [[ "${FLEET_TEST_ORB_ASYNC_START:-0}" == 1 ]]; then' \
  '  if [[ "${1:-}" == start ]]; then' \
  '    touch "${FLEET_TEST_ORB_STATE:?}"' \
  '    exit 1' \
  '  fi' \
  '  if [[ "${1:-}" == status ]]; then' \
  '    [[ -f "${FLEET_TEST_ORB_STATE:?}" ]]' \
  '    exit $?' \
  '  fi' \
  'fi' \
  'exit 0'

write_executable "$fake_bin/hdiutil" \
  '#!/usr/bin/env bash' \
  'if [[ "$1" == "attach" ]]; then' \
  '  mountpoint=""' \
  '  while [[ $# -gt 0 ]]; do' \
  '    if [[ "$1" == "-mountpoint" ]]; then mountpoint="$2"; shift 2; continue; fi' \
  '    shift' \
  '  done' \
  '  app_bin="$mountpoint/OrbStack.app/Contents/MacOS/bin"' \
  '  app_xbin="$mountpoint/OrbStack.app/Contents/MacOS/xbin"' \
  '  mkdir -p "$app_bin" "$app_xbin"' \
  '  cp "${FLEET_TEST_FAKE_ORBCTL:?}" "$app_bin/orbctl"' \
  '  cp "${FLEET_TEST_FAKE_ORB:?}" "$app_bin/orb"' \
  '  cp "${FLEET_TEST_FAKE_DOCKER:?}" "$app_xbin/docker"' \
  '  chmod +x "$app_bin/orbctl" "$app_bin/orb" "$app_xbin/docker"' \
  '  printf "hdiutil attach\n" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  '  exit 0' \
  'fi' \
  'printf "hdiutil detach\n" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/ditto" \
  '#!/usr/bin/env bash' \
  'cp -R "$1" "$2"' \
  'printf "ditto orbstack\n" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/codesign" \
  '#!/usr/bin/env bash' \
  'exit 0'

write_executable "$fake_bin/docker" \
  '#!/usr/bin/env bash' \
  'runner_digest="sha256:e958b6abeba555622a2206075b456d679e550cd854b6a9600d6fe68d0908b347"' \
  'postgres_digest="sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"' \
  'postgres_reference="postgres:16-alpine@$postgres_digest"' \
  'postgres_tag="postgres:16-alpine"' \
  'if [[ "${1:-} ${2:-}" == "info --format" ]]; then' \
  '  socket="${FLEET_TEST_SOCKET_ROOT:?}/Users/fleet-admin/.orbstack/run/docker.sock"' \
  '  mkdir -p "$(dirname "$socket")"' \
  '  if [[ ! -e "$socket" ]]; then' \
  '    : > "$socket"' \
  '  fi' \
  'fi' \
  'case "${1:-} ${2:-}" in' \
  '  "info --format") [[ "${FLEET_TEST_DOCKER_FAIL_INFO:-0}" != 1 ]]; exit $? ;;' \
  '  "load --input") touch "${FLEET_TEST_RUNNER_STATE:?}" "${FLEET_TEST_POSTGRES_CONTENT_STATE:?}"; printf "docker load\n" >> "${FLEET_TEST_MUTATION_LOG:?}"; exit 0 ;;' \
  '  "image inspect")' \
  '    case "${3:-}" in' \
  '      "$runner_digest") [[ -f "${FLEET_TEST_RUNNER_STATE:?}" ]] ;;' \
  '      "$postgres_digest") [[ -f "${FLEET_TEST_POSTGRES_CONTENT_STATE:?}" ]] ;;' \
  '      "$postgres_reference") [[ -f "${FLEET_TEST_POSTGRES_REFERENCE_STATE:?}" ]] ;;' \
  '      *) exit 1 ;;' \
  '    esac' \
  '    exit $?' \
  '    ;;' \
  '  "image tag")' \
  '    [[ "${3:-}" == "$postgres_digest" && "${4:-}" == "$postgres_tag" ]] || exit 1' \
  '    [[ -f "${FLEET_TEST_POSTGRES_CONTENT_STATE:?}" ]] || exit 1' \
  '    touch "${FLEET_TEST_POSTGRES_REFERENCE_STATE:?}"' \
  '    printf "docker tag %s %s\n" "$postgres_digest" "$postgres_tag" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  '    exit 0' \
  '    ;;' \
  'esac' \
  'exit 1'

write_executable "$fake_bin/chown" \
  '#!/usr/bin/env bash' \
  'printf "chown %s\n" "$*" >> "${FLEET_TEST_MUTATION_LOG:?}"'

write_executable "$fake_bin/stat" \
  '#!/usr/bin/env bash' \
  '[[ -f "${@: -1}" ]] || exit 1' \
  'echo Socket'

write_executable "$fake_bin/git" \
  '#!/usr/bin/env bash' \
  'safe_directory=""' \
  'repository=""' \
  'args=("$@")' \
  'for (( i = 0; i < ${#args[@]}; i += 1 )); do' \
  '  if [[ "${args[$i]}" == "-c" && "${args[$((i + 1))]:-}" == safe.directory=* ]]; then' \
  '    safe_directory="${args[$((i + 1))]#safe.directory=}"' \
  '  elif [[ "${args[$i]}" == "-C" ]]; then' \
  '    repository="${args[$((i + 1))]:-}"' \
  '  fi' \
  'done' \
  'canonical_repository=""' \
  'if [[ "$repository" == */var/lib/cecelia/repository ]]; then' \
  '  canonical_repository="$(cd "$repository" && pwd -P)"' \
  'fi' \
  'if [[ -n "$canonical_repository" && "$safe_directory" != "$canonical_repository" ]]; then' \
  '  echo "fatal: detected dubious ownership in repository at '"'"'$repository'"'"'" >&2' \
  '  exit 128' \
  'fi' \
  'exec "${FLEET_TEST_REAL_GIT:?}" "$@"'

write_executable "$fake_bin/launchctl" \
  '#!/usr/bin/env bash' \
  'printf "launchctl %s\n" "$*" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  '[[ "${1:-}" == asuser && "${2:-}" =~ ^[0-9]+$ ]] || exit 64' \
  'shift 2' \
  'exec "$@"'

write_executable "$fake_bin/sudo" \
  '#!/usr/bin/env bash' \
  'printf "sudo %s\n" "$*" >> "${FLEET_TEST_MUTATION_LOG:?}"' \
  '[[ "${1:-}" == -H && "${2:-}" == -u && -n "${3:-}" ]] || exit 64' \
  'shift 3' \
  'exec "$@"'

write_executable "$fake_bin/installer" \
  '#!/usr/bin/env bash' \
  'printf "installer %s home=%s\n" "$*" "${FLEET_WORKER_ORBSTACK_HOME:-missing}" >> "${FLEET_TEST_MUTATION_LOG:?}"'

bundle="$test_root/repository.bundle"
runner_archive="$test_root/runner.tar"
worker_token="$test_root/worker-token"
bundle_source="$test_root/bundle-source"
mkdir -p "$bundle_source"
git -C "$bundle_source" init -q
git -C "$bundle_source" config core.hooksPath /dev/null
git -C "$bundle_source" config user.name "Fleet Baseline Test"
git -C "$bundle_source" config user.email "fleet-baseline-test@example.invalid"
printf 'fleet baseline fixture\n' > "$bundle_source/README.md"
git -C "$bundle_source" add README.md
git -C "$bundle_source" commit -q -m "test: seed fleet baseline"
git -C "$bundle_source" bundle create "$bundle" HEAD
printf 'runner archive\n' > "$runner_archive"
printf 'fleet-worker-transport-token-at-least-32-bytes\n' > "$worker_token"
chmod 0600 "$worker_token"

run_reconciler() {
  local root="$1"
  local repository_bundle="${FLEET_TEST_REPOSITORY_BUNDLE-$bundle}"
  local runner_input="${FLEET_TEST_RUNNER_ARCHIVE-$runner_archive}"
  local token_input="${FLEET_TEST_WORKER_TOKEN-$worker_token}"
  local docker_command="${FLEET_TEST_DOCKER_COMMAND-$fake_bin/docker}"
  shift
  FLEET_TEST_MUTATION_LOG="$mutation_log" \
  FLEET_TEST_SERVICE_STATE="$service_state" \
  FLEET_TEST_RUNNER_STATE="$runner_state" \
  FLEET_TEST_POSTGRES_CONTENT_STATE="$postgres_content_state" \
  FLEET_TEST_POSTGRES_REFERENCE_STATE="$postgres_reference_state" \
  FLEET_TEST_ORB_STATE="$state_root/orbstack-running" \
  FLEET_TEST_UUID_STATE="$state_root/uuid-count" \
  FLEET_TEST_FAKE_NODE="$fake_bin/toolchain-node" \
  FLEET_TEST_FAKE_NPM="$fake_bin/toolchain-npm" \
  FLEET_TEST_FAKE_CODEX="$fake_bin/toolchain-codex" \
  FLEET_TEST_EXPECTED_NODE="$root/usr/local/libexec/cecelia/toolchain/bin/node" \
  FLEET_TEST_SOCKET_ROOT="$root" \
  FLEET_TEST_FAKE_ORBCTL="$fake_bin/orbstack-orbctl" \
  FLEET_TEST_FAKE_ORB="$fake_bin/orbstack-orb" \
  FLEET_TEST_FAKE_DOCKER="$fake_bin/docker" \
  FLEET_TEST_REAL_GIT="$(command -v git)" \
  FLEET_TEST_DOCKER_FAIL_INFO="${FLEET_TEST_DOCKER_FAIL_INFO:-0}" \
  FLEET_BASELINE_ID="$fake_bin/id" \
  FLEET_BASELINE_DSCL="$fake_bin/dscl" \
  FLEET_BASELINE_UNAME="$fake_bin/uname" \
  FLEET_BASELINE_SW_VERS="$fake_bin/sw_vers" \
  FLEET_BASELINE_UUIDGEN="$fake_bin/uuidgen" \
  FLEET_BASELINE_CURL="$fake_bin/curl" \
  FLEET_BASELINE_SHASUM="$fake_bin/shasum" \
  FLEET_BASELINE_TAR="$fake_bin/tar" \
  FLEET_BASELINE_HDIUTIL="$fake_bin/hdiutil" \
  FLEET_BASELINE_DITTO="$fake_bin/ditto" \
  FLEET_BASELINE_CODESIGN="$fake_bin/codesign" \
  FLEET_BASELINE_TAILSCALE="$tailscale_app" \
  FLEET_BASELINE_DOCKER="$docker_command" \
  FLEET_BASELINE_GIT="${FLEET_TEST_GIT_COMMAND-$(command -v git)}" \
  FLEET_BASELINE_CHOWN="$fake_bin/chown" \
  FLEET_BASELINE_STAT="$fake_bin/stat" \
  FLEET_BASELINE_LAUNCHCTL="$fake_bin/launchctl" \
  FLEET_BASELINE_SUDO="$fake_bin/sudo" \
  FLEET_BASELINE_ORBSTACK_OWNER=fleet-admin \
  FLEET_BASELINE_INSTALLER="$fake_bin/installer" \
  FLEET_BASELINE_SYSTEM_ROOT="$root" \
  FLEET_BASELINE_TMPDIR="$root/tmp" \
  FLEET_BASELINE_REPOSITORY_BUNDLE="$repository_bundle" \
  FLEET_BASELINE_RUNNER_ARCHIVE="$runner_input" \
  FLEET_BASELINE_WORKER_TOKEN_FILE="$token_input" \
  "$RECONCILER" "$@"
}

: > "$mutation_log"
dry_output="$(run_reconciler "$system_root" us-mac-m4)"
grep -qi 'dry.run' <<<"$dry_output" || fail "default invocation is not dry-run"
[[ ! -s "$mutation_log" ]] || fail "dry-run mutated the node"

if FLEET_TEST_EFFECTIVE_UID=501 run_reconciler "$system_root" us-mac-m4 --apply \
  >"$test_root/non-root.out" 2>&1; then
  fail "non-root apply was accepted"
fi
grep -Fq 'root_required' "$test_root/non-root.out" \
  || fail "non-root failure did not identify root requirement"

if FLEET_TEST_ARCH=x86_64 run_reconciler "$system_root" us-mac-m4 --apply \
  >"$test_root/arch.out" 2>&1; then
  fail "non-arm64 node was accepted"
fi
grep -Fq 'unsupported_architecture' "$test_root/arch.out" \
  || fail "architecture failure was not explicit"

if FLEET_TEST_ID_COLLISION=1 run_reconciler "$system_root" us-mac-m4 --apply \
  >"$test_root/collision.out" 2>&1; then
  fail "service UID/GID collision was accepted"
fi
grep -Fq 'service_identity_collision' "$test_root/collision.out" \
  || fail "service identity collision was not explicit"

if FLEET_TEST_REPOSITORY_BUNDLE='' \
  run_reconciler "$system_root" us-mac-m4 --apply \
  >"$test_root/missing-bundle.out" 2>&1; then
  fail "apply accepted a missing repository bundle"
fi
grep -Fq 'repository_bundle_required' "$test_root/missing-bundle.out" \
  || fail "missing repository bundle was not explicit"

if FLEET_TEST_RUNNER_ARCHIVE='' \
  run_reconciler "$system_root" us-mac-m4 --apply \
  >"$test_root/missing-runner.out" 2>&1; then
  fail "apply accepted a missing Runner archive"
fi
grep -Fq 'runner_archive_required' "$test_root/missing-runner.out" \
  || fail "missing Runner archive was not explicit"

if FLEET_TEST_WORKER_TOKEN='' \
  run_reconciler "$system_root" us-mac-m4 --apply \
  >"$test_root/missing-worker-token.out" 2>&1; then
  fail "apply accepted a missing Worker transport token"
fi
grep -Fq 'worker_token_file_required' "$test_root/missing-worker-token.out" \
  || fail "missing Worker transport token was not explicit"

rollback_root="$test_root/rollback-system"
if FLEET_TEST_DOCKER_COMMAND="$test_root/missing-docker" \
  FLEET_TEST_DOCKER_FAIL_INFO=1 \
  run_reconciler "$rollback_root" us-mac-m4 --apply \
  >"$test_root/rollback.out" 2>&1; then
  fail "apply accepted an unavailable Docker engine"
fi
grep -Fq 'docker_unavailable' "$test_root/rollback.out" \
  || fail "Docker failure was not explicit"
[[ ! -e "$rollback_root/Applications/OrbStack.app" ]] \
  || fail "failed first OrbStack install was not rolled back"
/bin/rm -f "$service_state" "$runner_state" "$postgres_content_state" "$postgres_reference_state"

: > "$mutation_log"
/bin/rm -f "$state_root/orbstack-running"
async_root="$test_root/async-orbstack-system"
FLEET_TEST_ORB_ASYNC_START=1 \
FLEET_TEST_DOCKER_COMMAND="$test_root/missing-docker" \
run_reconciler "$async_root" xian-mac-m4 --apply \
  >"$test_root/async-orbstack.out" 2>&1 \
  || {
    cat "$test_root/async-orbstack.out" >&2
    fail "eventually running OrbStack was rejected after start returned nonzero"
  }
grep -Fq 'orb start' "$mutation_log" \
  || fail "asynchronous OrbStack fixture did not exercise start"
grep -Fq 'orb status' "$mutation_log" \
  || fail "OrbStack start failure was not reconciled with bounded status checks"
grep -Eq "launchctl asuser 501 $fake_bin/sudo -H -u fleet-admin .*/orb start" \
  "$mutation_log" \
  || fail "OrbStack was not started in the rollout user's launchd domain"
grep -Eq "launchctl asuser 501 $fake_bin/sudo -H -u fleet-admin .*/orb status" \
  "$mutation_log" \
  || fail "OrbStack readiness was not checked in the rollout user's launchd domain"
/bin/rm -f "$service_state" "$runner_state" "$postgres_content_state" "$postgres_reference_state" "$state_root/orbstack-running"

socket_conflict_root="$test_root/socket-conflict-system"
mkdir -p "$socket_conflict_root/var/run"
ln -s /tmp/unmanaged-docker.sock "$socket_conflict_root/var/run/docker.sock"
if FLEET_TEST_DOCKER_COMMAND="$test_root/missing-docker" \
  run_reconciler "$socket_conflict_root" xian-mac-m1 --apply \
  >"$test_root/socket-conflict.out" 2>&1; then
  fail "conflicting global Docker socket link was accepted"
fi
grep -Fq 'docker_socket_link_conflict' "$test_root/socket-conflict.out" \
  || fail "Docker socket link conflict lacked a bounded refusal"
/bin/rm -f "$service_state" "$runner_state" "$postgres_content_state" "$postgres_reference_state"

: > "$mutation_log"
/bin/rm -f "$state_root/uuid-count"
FLEET_TEST_DOCKER_COMMAND="$test_root/missing-docker" \
FLEET_TEST_OS_VERSION=15.6.1 \
FLEET_TEST_REQUIRE_TOOLCHAIN_NODE_PATH=1 \
run_reconciler "$system_root" xian-mac-m1 --apply \
  >"$test_root/supported-os.out" 2>&1 \
  || { cat "$test_root/supported-os.out" >&2; fail "clean node baseline apply failed"; }
grep -Fq 'os_security_update_recommended recommended=15.7.4 observed=15.6.1' \
  "$test_root/supported-os.out" \
  || fail "supported older macOS did not receive the security recommendation"
if grep -Fq 'os_version_below_floor' "$test_root/supported-os.out"; then
  fail "supported macOS 15.6.1 was reported below the admission floor"
fi
grep -Fq 'dscl . -create /Groups/_cecelia PrimaryGroupID 450' "$mutation_log" \
  || fail "dedicated service group was not created"
grep -Fq 'dscl . -create /Users/_cecelia UniqueID 450' "$mutation_log" \
  || fail "dedicated service user was not created"
group_uuid="$(
  awk '/-create \/Groups\/_cecelia GeneratedUID/ { print $NF }' "$mutation_log"
)"
user_uuid="$(
  awk '/-create \/Users\/_cecelia GeneratedUID/ { print $NF }' "$mutation_log"
)"
[[ -n "$group_uuid" && -n "$user_uuid" && "$user_uuid" != "$group_uuid" ]] \
  || fail "service user and group reused a GeneratedUID"
grep -Fq 'npm pinned-codex' "$mutation_log" \
  || fail "pinned Codex CLI was not installed"
grep -Fq 'ditto orbstack' "$mutation_log" \
  || fail "pinned OrbStack app was not installed"
grep -Fq 'docker load' "$mutation_log" \
  || fail "pinned Runner archive was not loaded"
grep -Fq 'docker tag sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 postgres:16-alpine' "$mutation_log" \
  || fail "offline PostgreSQL content did not recover its pinned repository tag"
grep -Fq 'installer xian-mac-m1 --apply home=/Users/fleet-admin' "$mutation_log" \
  || fail "Fleet Worker installer was not invoked"
[[ -x "$system_root/usr/local/libexec/cecelia/toolchain/bin/node" ]] \
  || fail "stable Node toolchain command was not installed"
[[ -x "$system_root/usr/local/libexec/cecelia/toolchain/bin/codex" ]] \
  || fail "stable Codex toolchain command was not installed"
[[ -x "$system_root/usr/local/libexec/cecelia/toolchain/bin/orbctl" ]] \
  || fail "stable OrbStack control command was not installed"
[[ -x "$system_root/usr/local/libexec/cecelia/toolchain/bin/docker" ]] \
  || fail "stable OrbStack Docker command was not installed"
[[ -x "$system_root/usr/local/libexec/cecelia/toolchain/bin/tailscale" ]] \
  || fail "stable Tailscale command was not installed"
[[ -L "$system_root/var/run/docker.sock" ]] \
  || fail "clean OrbStack bootstrap did not create the global Docker socket link"
[[ "$(readlink "$system_root/var/run/docker.sock")" \
  == '/Users/fleet-admin/.orbstack/run/docker.sock' ]] \
  || fail "global Docker socket link does not target the rollout owner's socket"
[[ "$(
  readlink "$system_root/usr/local/libexec/cecelia/toolchain/bin/orbctl"
)" == "$system_root/Applications/OrbStack.app/Contents/MacOS/bin/orbctl" ]] \
  || fail "OrbStack control command does not target the pinned app"
[[ "$(
  readlink "$system_root/usr/local/libexec/cecelia/toolchain/bin/docker"
)" == "$system_root/Applications/OrbStack.app/Contents/MacOS/xbin/docker" ]] \
  || fail "Docker command does not target the pinned OrbStack app"
[[ "$(
  readlink "$system_root/usr/local/libexec/cecelia/toolchain/bin/tailscale"
)" == "$tailscale_app" ]] \
  || fail "Tailscale command does not target the official app"
git -C "$system_root/var/lib/cecelia/repository" rev-parse --verify HEAD >/dev/null \
  || fail "credential-free Git baseline was not imported"
cmp -s "$worker_token" "$system_root/var/lib/cecelia/fleet-worker/worker-auth" \
  || fail "US M4 Worker transport token was not installed on the node"

install_mutations_before="$(
  grep -Ec '^(curl|tar node|npm pinned-codex|ditto orbstack|docker load)' \
    "$mutation_log"
)"
FLEET_TEST_GIT_COMMAND="$fake_bin/git" \
run_reconciler "$system_root" xian-mac-m1 --apply >/dev/null \
  || fail "repeat baseline apply failed"
install_mutations_after="$(
  grep -Ec '^(curl|tar node|npm pinned-codex|ditto orbstack|docker load)' \
    "$mutation_log"
)"
[[ "$install_mutations_after" -eq "$install_mutations_before" ]] \
  || fail "repeat apply reinstalled an exact baseline"

/bin/rm -f "$service_state" "$runner_state" "$postgres_content_state" "$postgres_reference_state" "$state_root/uuid-count"
: > "$mutation_log"
partial_root="$test_root/partial-identity-system"
FLEET_TEST_PARTIAL_GROUP=1 \
FLEET_TEST_DOCKER_COMMAND="$test_root/missing-docker" \
run_reconciler "$partial_root" us-mac-m4 --apply >/dev/null \
  || fail "partial service identity was not resumed"
if grep -Fq 'dscl . -create /Groups/_cecelia' "$mutation_log"; then
  fail "existing dedicated service group was recreated"
fi
grep -Fq 'dscl . -create /Users/_cecelia UniqueID 450' "$mutation_log" \
  || fail "missing dedicated service user was not resumed"

newer_root="$test_root/newer-system"
newer_bin="$newer_root/Applications/OrbStack.app/Contents/MacOS/bin"
mkdir -p "$newer_bin"
write_executable "$newer_bin/orbctl" \
  '#!/usr/bin/env bash' \
  'echo "Version: 9.0.0 (9000000)"'
write_executable "$newer_bin/orb" \
  '#!/usr/bin/env bash' \
  'exit 0'
if run_reconciler "$newer_root" us-mac-m4 --apply \
  >"$test_root/newer.out" 2>&1; then
  fail "newer OrbStack was silently downgraded"
fi
grep -Fq 'orbstack_newer_than_baseline' "$test_root/newer.out" \
  || fail "newer OrbStack failure was not explicit"

if run_reconciler "$system_root" moon-base --apply >/dev/null 2>&1; then
  fail "unknown machine was accepted"
fi

if grep -Eni '\.codex|auth\.json|credentials|CODEX_ACCOUNT|token|prompt' \
  "$mutation_log"; then
  fail "baseline mutation log contains credential or Prompt material"
fi

echo "PASS: Fleet node baseline reconciler behavioral contract"
