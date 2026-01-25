#!/usr/bin/env bash
# ============================================================================
# Stop Hook: 质检门控（两阶段分离）
# ============================================================================
# 根据当前阶段（p0/p1/p2/pending）决定检查什么：
#
# p0 (Published 阶段):
#   - 检查质检（Step 7）
#   - 检查 PR 创建（Step 8）
#   - 不检查 CI（创建 PR 后立即结束，不等 CI）
#
# p1 (CI fail 阶段):
#   - 检查质检（Step 7）
#   - 检查 PR 存在（Step 8）
#   - 检查 CI 状态（Step 9）
#     - CI fail → exit 2（继续修）
#     - CI pending → exit 0（退出，等下次唤醒）
#     - CI pass → exit 0（结束）
#
# p2/pending:
#   - 直接允许结束（exit 0）
# ============================================================================

set -euo pipefail

# ===== 读取 Hook 输入（JSON） =====
# Stop Hook 接收 JSON 输入，包含 stop_hook_active 等字段
HOOK_INPUT=$(cat)

# ===== 检查是否已经因为 Stop Hook 而继续过一次 =====
# 防止无限循环：如果 stop_hook_active=true，说明已经重试过了
STOP_HOOK_ACTIVE=$(echo "$HOOK_INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")

if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: 防止无限循环]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  检测到 stop_hook_active=true" >&2
    echo "  已经重试过一次，允许会话结束（防止无限循环）" >&2
    echo "" >&2
    echo "  如果质检仍未通过，请手动运行:" >&2
    echo "    npm run qa:gate" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0  # 允许结束，防止无限循环
fi

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== 检查是否在 git 仓库中 =====
if ! git rev-parse --git-dir &>/dev/null; then
    exit 0  # 不在 git 仓库，跳过
fi

# ===== 获取当前分支 =====
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
    exit 0  # 无法获取分支，跳过
fi

# ===== 只检查功能分支 =====
if [[ ! "$CURRENT_BRANCH" =~ ^cp- ]] && [[ ! "$CURRENT_BRANCH" =~ ^feature/ ]]; then
    exit 0  # 不是功能分支，跳过（main/develop 可以正常退出）
fi

# ===== 检测当前阶段 =====
# Stop Hook 根据阶段决定检查什么（两阶段分离）
PHASE=""
if [[ -f "$PROJECT_ROOT/scripts/detect-phase.sh" ]]; then
    PHASE=$(bash "$PROJECT_ROOT/scripts/detect-phase.sh" 2>/dev/null | grep "^PHASE:" | awk '{print $2}' || echo "")
fi

# 如果无法检测阶段，回退到 unknown
if [[ -z "$PHASE" ]]; then
    PHASE="unknown"
fi

# unknown 阶段：直接退出，不动作（旁路控制）
# 防止因 gh API 临时错误导致误判和瞎跑
if [[ "$PHASE" == "unknown" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: unknown 阶段]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  无法检测阶段（可能是 gh API 临时错误）" >&2
    echo "  直接退出，不执行检查（避免误判）" >&2
    echo "" >&2
    echo "  如需强制进入 p1，使用: PHASE_OVERRIDE=p1" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0  # 安全退出
fi

# ===== Step 7 质检流程检查 =====
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [Stop Hook: Step 7 质检门控]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  分支: $CURRENT_BRANCH" >&2
echo "" >&2

# ===== Step 7.1: 检查 Audit 报告 (L2A) =====
AUDIT_REPORT="$PROJECT_ROOT/docs/AUDIT-REPORT.md"

if [[ ! -f "$AUDIT_REPORT" ]]; then
    echo "  ❌ Step 7.1: Audit 报告缺失！" >&2
    echo "" >&2
    echo "  找不到: docs/AUDIT-REPORT.md" >&2
    echo "" >&2
    echo "  你需要:" >&2
    echo "    1. 调用 /audit Skill 生成审计报告" >&2
    echo "    2. 或手动创建 docs/AUDIT-REPORT.md" >&2
    echo "" >&2
    echo "  参考: skills/dev/steps/07-quality.md" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

# ===== Step 7.2: 检查 Audit Decision (Blocker) =====
AUDIT_DECISION=$(grep -i "^Decision:" "$AUDIT_REPORT" | head -1 | awk '{print $2}' | tr -d ' \n\r')

if [[ "$AUDIT_DECISION" != "PASS" ]]; then
    echo "  ❌ Step 7.2: Audit 未通过！" >&2
    echo "" >&2
    echo "  当前 Decision: $AUDIT_DECISION" >&2
    echo "" >&2
    echo "  Audit 报告显示有 blocker（L1/L2 问题）" >&2
    echo "" >&2
    echo "  你需要:" >&2
    echo "    1. 查看 docs/AUDIT-REPORT.md 中的 Findings" >&2
    echo "    2. 修复所有 L1 和 L2 问题" >&2
    echo "    3. 重新运行 /audit" >&2
    echo "    4. 确保 Decision: PASS" >&2
    echo "" >&2
    echo "  (Retry Loop: Audit → FAIL → 修复 → 重新审计)" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

echo "  ✅ Step 7.1: Audit 报告存在" >&2
echo "  ✅ Step 7.2: Decision: PASS (无 blocker)" >&2
echo "" >&2

# ===== Step 7.3: 检查自动化测试 (L1) =====
QUALITY_GATE_FILE="$PROJECT_ROOT/.quality-gate-passed"

if [[ ! -f "$QUALITY_GATE_FILE" ]]; then
    echo "  ❌ Step 7.3: 自动化测试未通过！" >&2
    echo "" >&2
    echo "  找不到质检门控文件: .quality-gate-passed" >&2
    echo "" >&2
    echo "  你需要:" >&2
    echo "    1. 运行: npm run qa:gate" >&2
    echo "    2. 确保 typecheck + test + build 全部通过" >&2
    echo "    3. 生成 .quality-gate-passed 文件" >&2
    echo "" >&2
    echo "  如果测试失败，请修复后重新运行 npm run qa:gate" >&2
    echo "  (Retry Loop: 失败 → 修复 → 再试，直到通过)" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

# ===== 检查质检文件时效性 =====
# 确保质检是最新的（代码改动后需要重新质检）

# 获取最新的代码文件修改时间
LATEST_CODE_MTIME=0
while IFS= read -r -d '' file; do
    FILE_MTIME=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo "0")
    if (( FILE_MTIME > LATEST_CODE_MTIME )); then
        LATEST_CODE_MTIME=$FILE_MTIME
    fi
done < <(find "$PROJECT_ROOT/src" "$PROJECT_ROOT/tests" -type f \( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" \) -print0 2>/dev/null)

# 获取质检文件修改时间
GATE_MTIME=$(stat -c %Y "$QUALITY_GATE_FILE" 2>/dev/null || stat -f %m "$QUALITY_GATE_FILE" 2>/dev/null || echo "0")

if (( LATEST_CODE_MTIME > GATE_MTIME )); then
    echo "  ⚠️  代码已修改，质检结果过期！" >&2
    echo "" >&2
    echo "  最新代码修改: $(date -d @$LATEST_CODE_MTIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $LATEST_CODE_MTIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" >&2
    echo "  质检文件时间: $(date -d @$GATE_MTIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $GATE_MTIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" >&2
    echo "" >&2
    echo "  请重新运行质检: npm run qa" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

    # exit 2: 阻止会话结束
    exit 2
fi

# ===== Step 7 全部通过 =====
echo "  ✅ Step 7.3: 自动化测试通过 (L1)" >&2
echo "" >&2
echo "  质检完成时间: $(date -d @$GATE_MTIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $GATE_MTIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" >&2
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  ✅ Step 7 质检全部通过！" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  完成项:" >&2
echo "    ✅ L2A: Audit 审计 (Decision: PASS)" >&2
echo "    ✅ L1: 自动化测试 (typecheck + test + build)" >&2
echo "" >&2

# ===== Step 8: 检查 PR 是否已创建 =====
# 质检通过后，根据当前阶段决定下一步检查：
# - p0: 检查 PR 创建，创建后立即结束（不检查 CI）
# - p1: 检查 PR 存在 + CI 状态

if command -v gh &>/dev/null; then
    PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || echo "")

    if [[ -z "$PR_NUMBER" ]]; then
        # PR 未创建（只可能在 p0）
        echo "  ⚠️  Step 8: PR 未创建" >&2
        echo "" >&2
        echo "  质检已通过，但 PR 尚未创建。" >&2
        echo "" >&2
        echo "  下一步: 创建 PR" >&2
        echo "    gh pr create --title \"feat: ...\" --body \"...\"" >&�
        echo "" >&2
        echo "  (p0 循环: 质检通过 → 创建 PR → 再尝试结束)" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

        # exit 2: 阻止会话结束，让 AI 继续创建 PR
        exit 2
    fi

    # PR 已创建
    echo "  ✅ Step 8: PR 已创建 (#$PR_NUMBER)" >&2
    echo "" >&2

    # ===== 阶段分支：p0 和 p1 的检查不同 =====
    if [[ "$PHASE" == "p0" ]]; then
        # p0 阶段：PR 创建后立即结束，不检查 CI
        echo "  📌 当前阶段: p0 (Published)" >&2
        echo "  ✅ PR 创建完成，p0 阶段结束" >&2
        echo "" >&2
        echo "  不检查 CI（p0 不等待 CI，直接结束）" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  ✅ p0 任务完成" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "  完成步骤:" >&2
        echo "    ✅ Step 7: 质检通过（Audit + 测试）" >&2
        echo "    ✅ Step 8: PR 创建完成 (#$PR_NUMBER)" >&2
        echo "" >&2
        echo "  后续: CI 自动运行，下次启动检测 CI 结果（p1/p2）" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

        # exit 0: p0 阶段结束，允许会话结束
        exit 0

    elif [[ "$PHASE" == "p1" ]] || [[ "$PHASE" == "unknown" ]]; then
        # p1 阶段：检查 CI 状态
        echo "  📌 当前阶段: p1 (CI fail 修复)" >&2
        echo "" >&2

        # ===== Step 9: 检查 CI 状态 =====
        CI_STATUS=$(gh pr checks "$PR_NUMBER" --json state -q '.[].state' 2>/dev/null | head -1 || echo "")

        if [[ -z "$CI_STATUS" ]] || [[ "$CI_STATUS" == "PENDING" ]] || [[ "$CI_STATUS" == "QUEUED" ]]; then
            # pending: 退出，等下次唤醒（事件驱动）
            echo "  ⏳ Step 9: CI 运行中" >&2
            echo "" >&2
            echo "  CI 状态: ${CI_STATUS:-PENDING}" >&2
            echo "  退出，等待下次 CI 结果（事件驱动，不挂着）" >&2
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  ⏳ p1 推送完成，等待 CI" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            # exit 0: 允许结束（不挂着等 CI）
            exit 0

        elif echo "$CI_STATUS" | grep -qi "FAILURE\|ERROR"; then
            # CI fail: 继续修复循环
            echo "  ❌ Step 9: CI 失败" >&2
            echo "" >&2
            echo "  CI 状态: FAILURE" >&2
            echo "" >&2
            echo "  下一步: 分析并修复 CI 失败" >&2
            echo "    1. 查看失败详情: gh pr checks $PR_NUMBER" >&2
            echo "    2. 修复问题" >&2
            echo "    3. push 代码: git push" >&2
            echo "    4. 再次尝试结束（触发 CI 状态检查）" >&2
            echo "" >&2
            echo "  (p1 事件驱动循环: CI fail → 修复 → push → 退出 → 等下次唤醒)" >&2
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

            # exit 2: 阻止会话结束，让 AI 继续修复 CI
            exit 2

        elif echo "$CI_STATUS" | grep -qi "SUCCESS\|PASS"; then
            # CI pass: p1 结束
            echo "  ✅ Step 9: CI 全绿" >&2
            echo "" >&2
            echo "  CI 状态: SUCCESS" >&2
            echo "  GitHub Actions 将自动 merge" >&2
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  ✅ p1 任务完成（CI 全绿）" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            # exit 0: 允许结束
            exit 0
        else
            # 未知状态
            echo "  ⚠️  Step 9: CI 状态未知" >&2
            echo "" >&2
            echo "  CI 状态: $CI_STATUS" >&2
            echo "" >&2
            # exit 0: 允许结束
            exit 0
        fi

    elif [[ "$PHASE" == "p2" ]] || [[ "$PHASE" == "pending" ]]; then
        # p2/pending: 直接允许结束
        echo "  📌 当前阶段: $PHASE" >&2
        echo "  ✅ 直接允许结束" >&2
        echo "" >&2
        exit 0
    fi
else
    # gh 命令不可用，跳过 PR/CI 检查（fallback）
    echo "  ⚠️  Step 8/9: 无法检查 PR/CI（gh 命令不可用）" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ✅ Step 7 质检通过（允许结束）" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    # exit 0: 允许会话结束（fallback）
    exit 0
fi
