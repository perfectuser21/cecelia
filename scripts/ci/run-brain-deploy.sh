#!/usr/bin/env bash
# 保留现役版本身份；只有只读等价证明成立才无需重发 Brain。
set -euo pipefail
BRAIN_URL="${1:?缺少 Brain URL}"
TARGET_SHA="${2:?缺少完整目标 SHA}"
REPORT="${3:?缺少预检报告路径}"
[[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$(dirname "$REPORT")"

fallback_report() {
  jq -nc --arg sha "$TARGET_SHA" '{schema:"brain-deploy-preflight/v1",action:"deploy",deploy_required:true,target_sha:$sha,actual_runtime_sha:null,reason:"preflight_runner_unavailable",host_ops_installation:"not_evaluated",external_services:"not_evaluated"}' > "$REPORT"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'deploy_required=true\n' >> "$GITHUB_OUTPUT"; fi
}
if node "$SCRIPT_DIR/brain-deploy-preflight.mjs" --repo-root "${REPO_DIR:-.}" \
  --target "$TARGET_SHA" --brain-url "$BRAIN_URL" --output "$REPORT"; then
  if ! jq -e --arg sha "$TARGET_SHA" '
    .schema == "brain-deploy-preflight/v1" and .target_sha == $sha and
    ((.action == "rejected" and .deploy_required == false) or
     (.deploy_required == true and .action == "deploy") or
     (.deploy_required == false and (.action == "already_current" or .action == "no_brain_change") and
      (.actual_runtime_sha | test("^[a-f0-9]{40}$")) and
      (.baseline_tree_hash | test("^[a-f0-9]{64}$")) and .baseline_tree_hash == .target_tree_hash))
  ' "$REPORT" >/dev/null; then fallback_report; fi
else
  fallback_report
fi

if [[ "$(jq -r '.action' "$REPORT")" == rejected ]]; then
  echo '::error::DEPLOY_TARGET_REJECTED：目标次序未知或已落后现役，禁止重触发。' >&2
  exit 1
fi
if [[ "$(jq -r '.deploy_required' "$REPORT")" == false ]]; then
  RUNTIME_SHA="$(jq -r '.actual_runtime_sha' "$REPORT")"
  echo "Brain 无需重发：目标 $TARGET_SHA；实际运行 $RUNTIME_SHA。宿主脚本安装另行核验。"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '### Brain 无需重发\n\n- 本次目标：`%s`\n- 实际运行：`%s`\n- 健康、原生收据及完整 Git 树等价证明已核对。\n- 宿主脚本安装与外部业务未在此分支验收。\n' "$TARGET_SHA" "$RUNTIME_SHA" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

# 未得到无需发布证明时，继续原有 exact-SHA 与原生收据链。
code=$(bash "$SCRIPT_DIR/gate3-trigger-deploy.sh" "$BRAIN_URL" "$TARGET_SHA")
case "$code" in
  202|409) ;;
  *) echo "::error::发布请求失败 HTTP $code"; exit 1 ;;
esac
bash "$SCRIPT_DIR/gate3-wait-deploy.sh" "$BRAIN_URL" "$TARGET_SHA"
