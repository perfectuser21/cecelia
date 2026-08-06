#!/bin/bash
# 合同 E2E 验收脚本（原样落地自 contract-draft.md「## E2E 验收」区块）
# task_id: b30fe42b-86c7-412e-9e05-eb08ac26488e
set -euo pipefail

SPRINT_DIR="sprints/08061902-relay-b30fe42b"
ARTIFACT="$SPRINT_DIR/smoke-artifact.json"
EXPECT_TASK_ID="b30fe42b-86c7-412e-9e05-eb08ac26488e"
EXPECT_SMOKE_TAG="claude-headed-dispatch-local-31156-4267"
EXPECT_MODE="headed"

# 1. 派发锚点留痕（Golden Path Step 1）
grep -q "$EXPECT_SMOKE_TAG" "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: PRD 缺冒烟锚点"; exit 1; }

# 2. 工件存在且为合法 JSON（Golden Path Step 2）
jq empty "$ARTIFACT" || { echo "FAIL: 工件缺失或 JSON 不合法"; exit 1; }

# 3. 三字段与 payload 字面相等（含大小写）
jq -e --arg v "$EXPECT_TASK_ID" '.task_id == $v' "$ARTIFACT" || { echo "FAIL: task_id 不字面相等"; exit 1; }
jq -e --arg v "$EXPECT_SMOKE_TAG" '.smoke_tag == $v' "$ARTIFACT" || { echo "FAIL: smoke_tag 不字面相等"; exit 1; }
jq -e --arg v "$EXPECT_MODE" '.mode == $v' "$ARTIFACT" || { echo "FAIL: mode 不等于 headed"; exit 1; }

# 4. schema 封闭性：顶层 keys 完全等于预期（Golden Path Step 4）
jq -e 'keys == ["mode","smoke_tag","task_id"]' "$ARTIFACT" || { echo "FAIL: 顶层 keys 不完全等于预期"; exit 1; }

# 5. 负向自证：oracle 对篡改副本必 FAIL —— 临时文件落会话独享路径
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/smoke-e2e-b30fe42b-XXXXXX")
jq '.smoke_tag = "tampered"' "$ARTIFACT" > "$TMPD/bad.json"
if jq -e --arg v "$EXPECT_SMOKE_TAG" '.smoke_tag == $v' "$TMPD/bad.json"; then
  echo "FAIL: 篡改副本竟通过断言 - oracle 假绿"; rm -rf "$TMPD"; exit 1
fi
rm -rf "$TMPD"

# 6. git 留痕：工件必须进分支提交（Golden Path Step 3）
git ls-files --error-unmatch "$ARTIFACT" >/dev/null || { echo "FAIL: 工件未被 git 跟踪/commit"; exit 1; }

echo "✅ Golden Path 冒烟验证通过"
