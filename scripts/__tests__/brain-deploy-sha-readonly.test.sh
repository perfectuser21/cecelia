#!/usr/bin/env bash
# 真部署脚本与真helper在副本中运行；唯一状态目标改为本人sentinel，绝不碰共享/tmp状态。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/brain-sha-readonly.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE/scripts/brain-image-retention" "$FIXTURE/packages/brain" "$FIXTURE/bin" "$FIXTURE/home"
cp -R "$ROOT/scripts/lib" "$FIXTURE/scripts/lib"
python3 - "$ROOT/scripts/brain-deploy.sh" "$FIXTURE/scripts/brain-deploy.sh" "$FIXTURE/deploy-status.json" <<'PY'
import pathlib,sys
source=pathlib.Path(sys.argv[1]).read_text()
fixed='DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"'
assert source.count(fixed)==1
pathlib.Path(sys.argv[2]).write_text(source.replace(fixed,'DEPLOY_STATUS_FILE="'+sys.argv[3]+'"'))
PY
printf '{"version":"9.9.9"}\n' > "$FIXTURE/packages/brain/package.json"
printf '{"git_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n' > "$FIXTURE/health.json"
cat > "$FIXTURE/scripts/brain-image-retention/cli.mjs" <<'NODE'
import {appendFileSync} from 'node:fs';
appendFileSync(process.env.RETENTION_CALLS, JSON.stringify(process.argv.slice(2))+'\n');
NODE
# dry-run若误触外部边界，记录并失败；fixture从不调用真Docker、生产HTTP或SSH。
for command in docker curl ssh; do
  printf '#!/bin/sh\nprintf "%%s\\n" "$0 $*" >> "$BOUNDARY_CALLS"\nexit 1\n' > "$FIXTURE/bin/$command"
  chmod +x "$FIXTURE/bin/$command"
done
export HOME="$FIXTURE/home" HOST_HOME="$FIXTURE/home" PATH="$FIXTURE/bin:$PATH"
export RETENTION_CALLS="$FIXTURE/retention-calls" BOUNDARY_CALLS="$FIXTURE/boundary-calls"
export CECELIA_IMAGE_DEPLOYMENT_ID='11111111-1111-4111-8111-111111111111'
export CECELIA_INTERNAL_ENV_FILE="$FIXTURE/home/absent.env"
export HEALTH_JSON_OVERRIDE="$FIXTURE/health.json"

check_readonly() {
  local label="$1" expected_code="$2" expected_sha="$3"; shift 3
  printf 'existing real deployment status\n' > "$FIXTURE/deploy-status.json"
  cp "$FIXTURE/deploy-status.json" "$FIXTURE/status-before"
  rm -f "$RETENTION_CALLS" "$BOUNDARY_CALLS"
  local actual=0
  EXPECTED_SHA="$expected_sha" bash "$FIXTURE/scripts/brain-deploy.sh" "$@" > "$FIXTURE/$label.log" 2>&1 || actual=$?
  if [[ "$actual" -ne "$expected_code" ]]; then
    cat "$FIXTURE/$label.log"; echo "FAIL: $label exit=$actual expected=$expected_code"; return 1
  fi
  cmp -s "$FIXTURE/status-before" "$FIXTURE/deploy-status.json" || { echo "FAIL: $label 修改部署状态sentinel"; return 1; }
  [[ ! -e "$RETENTION_CALLS" ]] || { echo "FAIL: $label 调用retention_finish"; cat "$RETENTION_CALLS"; return 1; }
  echo "PASS: $label 保留退出码，状态与retention完全只读"
}

check_readonly sha-only-success 0 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --sha-check-only
check_readonly sha-only-mismatch 1 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --sha-check-only
check_readonly dry-sha-success 0 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --dry-run --sha-check-only
check_readonly dry-sha-mismatch 1 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --dry-run --sha-check-only
check_readonly dry-run 0 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --dry-run

# 参数尚未初始化时helper加载失败：trap还未注册，不应产生部署状态。
printf '\nreturn 37\n' >> "$FIXTURE/scripts/lib/brain-staging.sh"
check_readonly early-source-failure 37 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --dry-run

# 真实部署的原出口仍结算retention和落状态，不因只读guard被一起关掉。
FUNCTION="$(sed -n '/^_write_deploy_status() {$/,/^}$/p' "$ROOT/scripts/brain-deploy.sh")"
for outcome in true false; do
  rm -f "$RETENTION_CALLS"
  DEPLOY_SUCCESS="$outcome" STATUS_TARGET="$FIXTURE/deploy-status.json" STATUS_WRITER="$FUNCTION" \
    bash -euc 'source "$1"; VERSION=9.9.9; DEPLOY_STATUS_FILE="$STATUS_TARGET"; unset DRY_RUN SHA_CHECK_ONLY; eval "$STATUS_WRITER"; _write_deploy_status' \
    _ "$FIXTURE/scripts/lib/brain-image-retention.sh"
  node - "$FIXTURE/deploy-status.json" "$RETENTION_CALLS" "$outcome" <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict');
const success=process.argv[4]==='true';
assert.equal(JSON.parse(fs.readFileSync(process.argv[2])).status,success?'success':'failed');
assert.deepEqual(JSON.parse(fs.readFileSync(process.argv[3],'utf8').trim()),['finish','11111111-1111-4111-8111-111111111111',success?'success':'recovered']);
NODE
  echo "PASS: 真实部署outcome=${outcome}保持原结算与状态写回"
done

# 通用成功收尾也供 launchd 使用，不能只靠 Docker sidecar 的 drain 回归替代。
# 原样执行生产脚本的整个通用健康检查尾段；不会执行上面的构建/迁移/启动步骤。
sed -n '/^drain_cancel_with_retry() {$/,/^}$/p' "$ROOT/scripts/brain-deploy.sh" > "$FIXTURE/drain-function.sh"
sed -n '/^echo "Waiting for health check\.\.\."$/,$p' "$ROOT/scripts/brain-deploy.sh" > "$FIXTURE/health-tail.sh"
[[ -s "$FIXTURE/drain-function.sh" && -s "$FIXTURE/health-tail.sh" ]]
for scenario in ready retry never-ready; do
  calls="$FIXTURE/$scenario.calls"
  (
    export ROOT_DIR="$FIXTURE" HOST_HOME="$FIXTURE/home" DEPLOY_MODE=launchd VERSION=9.9.9
    export EXPECTED_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    export DRAIN_CALLS="$calls" DRAIN_SCENARIO="$scenario"
    sleep() { :; }
    activate_cecelia_map_manifest() { :; }
    run_post_deploy_smoke() { :; }
    send_bark() { :; }
    curl() {
      case "${@: -1}" in
        */tick/status) [[ "$DRAIN_SCENARIO" != never-ready ]] ;;
        */tick/drain-cancel)
          printf 'drain\n' >> "$DRAIN_CALLS"
          [[ "$DRAIN_SCENARIO" != retry || "$(wc -l < "$DRAIN_CALLS")" -ge 3 ]] ;;
        */notion-sync/run) return 0 ;;
        *) echo 'FAIL: unexpected HTTP boundary' >&2; return 97 ;;
      esac
    }
    export -f sleep activate_cecelia_map_manifest run_post_deploy_smoke send_bark curl
    bash -euc 'source "$1"; source "$2"' _ "$FIXTURE/drain-function.sh" "$FIXTURE/health-tail.sh"
  ) > "$FIXTURE/$scenario-tail.log" 2>&1 && code=0 || code=$?
  if [[ "$scenario" == never-ready ]]; then
    [[ "$code" == 1 && ! -e "$calls" ]] || { echo 'FAIL: unhealthy tail canceled drain or succeeded'; exit 1; }
  else
    expected=1
    [[ "$scenario" != retry ]] || expected=3
    [[ "$code" == 0 && -e "$calls" && "$(wc -l < "$calls")" -eq "$expected" ]] || {
      cat "$FIXTURE/$scenario-tail.log"; echo "FAIL: $scenario did not cancel drain with retry"; exit 1;
    }
  fi
  echo "PASS: $scenario 通用收尾 drain 行为"
done
