---
id: codex-evidence-spec
version: 1.0.0
created: 2026-03-20
updated: 2026-03-20
---

# Codex 审查 Evidence 文件规范

> SSOT：本文件定义 `.dev-codex-evidence.{branch}.json` 的格式。
> Pipeline v2 使用 2 个 Codex Gate（spec_review / code_review_gate）替代了旧的 3 个 Skill。
> 旧 Skill（cto-review / code-quality / prd-audit）已于 v13.8.0 删除。

---

## 文件命名

```
.dev-codex-evidence.{branch}.json
```

例：`.dev-codex-evidence.cp-03200056-codex-evidence.json`

文件位于仓库根目录（与 `.dev-mode`、`.task-*.md` 同级），**不进入 git（.gitignore 排除）**，
由 Codex Agent 执行 `git add -f` 强制追踪后 push 到功能分支。

---

## JSON 格式

```json
{
  "version": "1.0.0",
  "branch": "cp-MMDDHHNN-task-name",
  "task_card_hash": "sha256:abcdef1234...",
  "created_at": "2026-03-20T10:00:00+08:00",
  "updated_at": "2026-03-20T10:05:00+08:00",
  "overall_decision": "PENDING",
  "reviews": [
    {
      "reviewer_type": "cto_review",
      "reviewer_agent": "codex-local",
      "brain_task_id": "abc-123-def",
      "decision": "PASS",
      "checks": [
        { "name": "需求符合度", "result": "PASS" },
        { "name": "架构合理性", "result": "PASS" },
        { "name": "代码质量",   "result": "PASS" },
        { "name": "DoD符合度",  "result": "PASS" },
        { "name": "安全性",     "result": "PASS" }
      ],
      "summary": "实现符合需求，无 L1 问题，DoD 全覆盖",
      "timestamp": "2026-03-20T10:00:00+08:00"
    }
  ]
}
```

---

## 字段说明

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | string | 格式版本，当前 `"1.0.0"` |
| `branch` | string | 功能分支名 |
| `task_card_hash` | string | Task Card 文件的 SHA256 哈希（`sha256:` 前缀 + 哈希值） |
| `created_at` | string | 文件创建时间（上海时间 ISO 8601） |
| `updated_at` | string | 最后更新时间（每次追加 review 后更新） |
| `overall_decision` | string | 整体决定：`"PENDING"` / `"PASS"` / `"FAIL"` |
| `reviews` | array | 各 Codex 审查结果数组（最多 3 条） |

### overall_decision 规则

| 状态 | 条件 |
|------|------|
| `"PENDING"` | 审查未全部完成（reviews 数量 < 3 且无 FAIL） |
| `"PASS"` | 全部 3 个审查完成且 decision 均为 `"PASS"` 或 `"WARN"` |
| `"FAIL"` | 任意一个审查 decision 为 `"FAIL"` |

### reviews[] 单条字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `reviewer_type` | string | `"cto_review"` / `"code_quality_review"` / `"prd_coverage_audit"` |
| `reviewer_agent` | string | 执行审查的 Agent 标识（如 `"codex-local"`） |
| `brain_task_id` | string | Brain 中对应任务的 ID（来自 `$BRAIN_TASK_ID` 环境变量） |
| `decision` | string | `"PASS"` / `"WARN"` / `"FAIL"` |
| `checks` | array | 各维度检查结果（`{ name, result }`） |
| `summary` | string | 审查摘要（1-2 句） |
| `timestamp` | string | 审查完成时间（上海时间 ISO 8601） |

---

## 写入逻辑（伪代码）

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
EVIDENCE_FILE=".dev-codex-evidence.${BRANCH}.json"

# 计算 task_card_hash
TASK_CARD_FILE=".task-${BRANCH}.md"
TASK_CARD_HASH="sha256:$(sha256sum "$TASK_CARD_FILE" 2>/dev/null | cut -d' ' -f1 || echo 'unknown')"

NOW=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)

if [ ! -f "$EVIDENCE_FILE" ]; then
  # 第一个 Codex：创建文件
  jq -n \
    --arg version "1.0.0" \
    --arg branch "$BRANCH" \
    --arg task_card_hash "$TASK_CARD_HASH" \
    --arg created_at "$NOW" \
    --arg updated_at "$NOW" \
    --arg overall_decision "PENDING" \
    '{version: $version, branch: $branch, task_card_hash: $task_card_hash,
      created_at: $created_at, updated_at: $updated_at,
      overall_decision: $overall_decision, reviews: []}' > "$EVIDENCE_FILE"
fi

# 追加本次 review
EXISTING=$(cat "$EVIDENCE_FILE")
NEW_REVIEW='{...本次审查数据...}'
UPDATED=$(echo "$EXISTING" | jq --argjson review "$NEW_REVIEW" '.reviews += [$review] | .updated_at = "'"$NOW"'"')

# 计算 overall_decision
REVIEW_COUNT=$(echo "$UPDATED" | jq '.reviews | length')
FAIL_COUNT=$(echo "$UPDATED"   | jq '[.reviews[] | select(.decision == "FAIL")] | length')
PASS_COUNT=$(echo "$UPDATED"   | jq '[.reviews[] | select(.decision == "PASS" or .decision == "WARN")] | length')

if [ "$FAIL_COUNT" -gt 0 ]; then
  OVERALL="FAIL"
elif [ "$REVIEW_COUNT" -ge 3 ] && [ "$PASS_COUNT" -ge 3 ]; then
  OVERALL="PASS"
else
  OVERALL="PENDING"
fi

echo "$UPDATED" | jq --arg od "$OVERALL" '.overall_decision = $od' > "$EVIDENCE_FILE"

# Push 到功能分支
git add -f "$EVIDENCE_FILE"
git commit -m "chore(evidence): update codex review evidence [${REVIEWER_TYPE}=${DECISION}]"
git push origin "$BRANCH"
```

---

## 关联 Gate（Pipeline v2）

| Gate | reviewer_type | 写入时机 |
|-------|---------------|---------|
| `spec_review` | `spec_review` | Stage 1 Spec 完成后 |
| `code_review_gate` | `code_review_gate` | Stage 3 CI 通过后 |

### 已废弃（Pipeline v1）

以下 Skill 已删除，仅保留文档记录：
- ~~cto-review~~ → 替代：code_review_gate
- ~~code-quality~~ → 替代：code_review_gate
- ~~prd-audit~~ → 替代：spec_review
