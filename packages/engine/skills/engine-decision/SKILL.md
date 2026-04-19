---
name: engine-decision
version: 15.0.0
updated: 2026-04-19
description: Cecelia Engine /dev 接力链第 3 棒。查 Brain decisions 表作为 Superpowers brainstorming/writing-plans 的推理输入（Engine 独有，Superpowers 无此环节）。
trigger: engine-enrich 的 TERMINAL IMPERATIVE 点火
---

# Engine Decision — /dev 接力链 Step 3/4

> **CRITICAL LANGUAGE RULE**: 所有输出必须使用简体中文。

**职责单一**：调 Brain `/api/brain/decisions/match` 拿到与当前 PRD 相关的历史决策，写 `.decisions-<branch>.yaml`，让后续 Superpowers 接力链读到 Alex 的历史决策避免瞎想。missing_critical → 暂停 autonomous 等 Alex。

## 为什么 Superpowers 没有这个环节

Superpowers 的 brainstorming/writing-plans 是"在当前对话里从零想方案"，没有项目记忆层。Cecelia Brain 保存了 Alex 的历史决策（`decisions` 表），某些决策是硬约束（比如"用 PostgreSQL + pgvector"），AI 想新方案时必须先查。**Decisions 是推理输入（理由参考）不是硬约束**，Superpowers subagent 读决策后仍然做 first-principles 分析。

## 1. 调 Brain decisions 匹配 API

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
PRD_FILE=".enriched-prd-${BRANCH_NAME}.md"
[[ ! -f "$PRD_FILE" ]] && PRD_FILE=".raw-prd-${BRANCH_NAME}.md"
[[ ! -f "$PRD_FILE" ]] && { echo "no PRD found"; exit 1; }

PRD_CONTENT=$(cat "$PRD_FILE")
RESULT=$(curl -s --connect-timeout 3 --max-time 10 \
  -X POST "http://localhost:5221/api/brain/decisions/match" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg prd "$PRD_CONTENT" '{prd: $prd}')" 2>/dev/null || echo '{}')
```

## 2. 分类处理

```bash
MATCHED=$(echo "$RESULT" | jq -r '.matched // [] | length')
MISSING=$(echo "$RESULT" | jq -c '.missing // []')

missing_critical=$(echo "$MISSING" | jq -c '[.[] | select(.classification == "critical")]')
missing_routine=$(echo "$MISSING" | jq -c '[.[] | select(.classification == "routine")]')

critical_count=$(echo "$missing_critical" | jq 'length')
if [[ "$critical_count" -gt 0 ]]; then
  echo "[DECISION-QUERY] missing_critical: $critical_count topics, 暂停 autonomous"
  curl -s -X POST "http://localhost:5221/api/brain/tasks" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --argjson missing "$missing_critical" \
      '{type:"decision_needed",title:"autonomous_mode 等待 Alex 决策",meta:{missing_critical:$missing}}')" \
    > /dev/null
  exit 2
fi
```

## 3. 写产出文件

```bash
{
  echo "matched:"
  echo "$RESULT" | jq -r '.matched[]? | "  - topic: \(.decision_topic)\n    decision: \(.decision)\n    confidence: \(.confidence)\n    source_id: \(.source_id)"'
  echo "missing_defaults:"
  echo "$missing_routine" | jq -r '.[]? | "  - topic: \(.topic)\n    default: auto\n    reason: no decision found, using project convention"'
} > ".decisions-${BRANCH_NAME}.yaml"

echo "[DECISION-QUERY] wrote .decisions-${BRANCH_NAME}.yaml"
```

## 完成标志

- `.decisions-${BRANCH_NAME}.yaml` 存在（或 Brain 不可达时 missing_routine 全默认 + 记录）
- 无 missing_critical 未处理

## 后续 skill 如何消费

- Superpowers `brainstorming` / `writing-plans` 里主 agent 应 `cat .decisions-<branch>.yaml` 读决策作为推理输入
- Superpowers `subagent-driven-development` 派 Implementer 时 prompt 里嵌入决策约束

---

## TERMINAL IMPERATIVE

engine-decision 完成，Engine 前置 3 step 全部结束。**你的下一个 tool call 必须是**：

```
Skill({"skill":"superpowers:brainstorming"})
```

不要 `Read`。不要 `Bash`。不要 inline brainstorming。不要派 subagent 手动想方案。

这不是文档引用，这是你下一步的 tool call 指令。从这里开始进入 Superpowers 原生接力链：brainstorming → writing-plans → subagent-driven-development → finishing-a-development-branch，每个 skill 自带结尾指令接到下一个。当 finishing-a-development-branch 完成（push + PR 已创建）后，autonomous-research-proxy 的硬规则会引导你回到 Engine 的收尾 skill `engine-ship`。
