---
name: engine-enrich
version: 15.0.0
updated: 2026-04-19
description: Cecelia Engine /dev 接力链第 2 棒。thin PRD 通过 Enrich Subagent 自反思丰满为完整 PRD（Superpowers 无此环节，Engine 独有）。
trigger: engine-worktree 的 TERMINAL IMPERATIVE 点火
---

# Engine Enrich — /dev 接力链 Step 2/4

> **CRITICAL LANGUAGE RULE**: 所有输出必须使用简体中文。

**职责单一**：判断 PRD 是否 thin，thin 则派 Enrich Subagent 多轮自反思补全；丰满则直接通过。全程 autonomous，**严禁问用户**。

## 为什么 Superpowers 没有这个环节

Superpowers `brainstorming` 假设 PRD 从"人与 AI 对话"开始，由 Claude 问用户问题补全。Cecelia 的 /dev 大多由 Brain 派任务触发（粗粒度、一句话 PRD），没有用户在场问问题 —— 必须靠 subagent 自反思代替。enrich 产物 `.enriched-prd-<branch>.md` 作为后续 `superpowers:brainstorming` / `writing-plans` 的输入。

## 1. 判断是否需要 enrich

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
RAW_PRD=".raw-prd-${BRANCH_NAME}.md"

bash packages/engine/skills/dev/scripts/enrich-decide.sh "$RAW_PRD"
if [[ $? -eq 0 ]]; then
    echo "PRD 已足够丰满，跳过 enrich"
fi
```

判断规则（任一不满足即 thin）：
- 长度 >= 500 字节
- 含 `## 成功标准` section
- 含 `## 不做` section

## 2. 派 Enrich Subagent（thin PRD 才派）

主 agent 调 Task/Agent 工具派遣 Enrich Subagent，prompt 模板：

---

你是 PRD Enrich Subagent。读 raw PRD，通过多轮自反思产出一份详细、可行、零歧义的 enriched PRD。

**严禁问用户问题**。一切空白自己用代码探索 + 合理默认填。

### 步骤

1. **读 raw PRD**
2. **探索代码库找背景**：搜关键词、读相关文件、查 git log
3. **5 自问**（brainstorming 骨架，自己回答）：
   - 真实目的是什么？用户为什么要这个？
   - 技术约束是什么？
   - 成功怎么验证？
   - 有哪些实现方案？列 2-3 个，Good/Bad 对比
   - Scope 边界在哪？"不做"列表
4. **3 轮自 review**：初稿 → 找漏洞 → 零占位符
5. **产出 enriched PRD** 格式：

```markdown
# PRD: <主题>

## 背景
## 真实目的
## 成功标准
## 方案选择
## 涉及文件
## 不做
## 假设
```

### 输出

- 写入 `.enriched-prd-<branch>.md`
- 返回 DONE 或 BLOCKED

---

## 3. 主 agent 最终 review

```bash
bash packages/engine/skills/dev/scripts/enrich-decide.sh ".enriched-prd-${BRANCH_NAME}.md"
if [[ $? -eq 1 ]]; then
    echo "Enrich 产出仍 thin，派一次 revise"
fi
```

## 完成标志

- `.enriched-prd-${BRANCH_NAME}.md` 存在且通过 enrich-decide 检查（或 `.raw-prd` 本身已丰满）

---

## TERMINAL IMPERATIVE

engine-enrich 完成。**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-decision"})
```

不要 `Read`。不要 `Bash`。不要 `Grep`。不要 inline 查决策。

这不是文档引用，这是你下一步的 tool call 指令。engine-decision 会接力查 Brain decisions 表作为实现约束。
