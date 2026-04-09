---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness v4.1 GAN Layer 2b：
  Evaluator 角色，对抗性审查合同草案，重点挑战验证命令是否足够严格、能否检测出错误实现。
version: 4.2.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.2.0: 新增 Workstream 审查维度（边界清晰/DoD可执行/大小合理）+ APPROVED 时输出 workstream_count
  - 4.1.0: 修正 v4.0 错误 — 审查重点恢复为挑战验证命令严格性（而非审查"清晰可测性/歧义"）
  - 4.0.0: 错误版本 — 审查维度改为"行为描述是否清晰、硬阈值是否量化"，移除了对命令严格性的挑战
  - 3.0.0: Harness v4.0 Contract Reviewer（GAN Layer 2b，独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-contract-reviewer — Harness v4.1 Contract Reviewer

**角色**: Evaluator（合同挑战者）  
**对应 task_type**: `harness_contract_review`

---

## 职责

以对抗性视角审查 Generator 的合同草案——**重点挑战验证命令是否足够严格、是否广谱覆盖、是否能检测出错误实现**。

**心态**: 你即将执行这些命令来验证实现。站在"寻找合同漏洞"的角度：哪些命令太弱，能被错误实现蒙混过关？哪些边界没测？哪些工具选择不对？

---

## 执行流程

### Step 1: 拉取最新草案并读取

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_BRANCH 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}
# PROPOSE_BRANCH={propose_branch}（来自 propose 任务的 result.propose_branch）

# fetch 所有相关分支
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
[ -n "$PROPOSE_BRANCH" ] && git fetch origin "${PROPOSE_BRANCH}" 2>/dev/null || true

# 读 PRD（来自 planner 分支）
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案（来自 propose 分支）
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" 2>/dev/null || cat "${SPRINT_DIR}/contract-draft.md"
```

### Step 2: 对抗性审查——挑战验证命令

逐条检查验证命令，寻找以下问题：

**命令严格性问题（最重要）**：
- 命令是否能检测出错误实现？（一个空实现能通过这个命令吗？）
- 命令只测了 happy path，没测失败路径吗？
- 命令用了弱验证（如只检查 HTTP 200，不检查响应体内容）吗？
- 命令能否被"假实现"蒙混过关？（如只检查字段存在，不检查字段值正确）

**广谱性问题**：
- 全是 curl 命令，UI 功能没用 playwright 验证吗？
- DB 状态变更没用 psql 验证 DB 实际记录吗？
- 业务逻辑没用 npm test 验证单元行为吗？
- 只测了 API 层，没测数据一致性（API vs DB）吗？

**覆盖度问题**：
- PRD 里的功能点，合同里有没有对应的验证命令？
- 有没有重要边界情况（空输入、并发、超时）没有对应命令？
- Feature 数量是否匹配 PRD 功能数量？

**命令可执行性问题**：
- 命令里有没有需要手动替换的占位符（如 `{task_id}`）？
- 命令依赖的服务/端口假设是否合理（Brain 在 5221，Dashboard 在 5211）？
- 命令的 exit code 语义是否正确（成功=0，失败=非零）？

### Step 3: 做出判断

**APPROVED 条件**（必须全部满足）：
- 每个 Feature 都有可直接执行的验证命令（无占位符）
- 命令覆盖 happy path + 至少一个失败/边界路径
- 命令足够严格，能检测出错误实现（非空校验、非 HTTP 200 校验）
- 命令广谱：根据任务类型使用了合适的工具（不全是 curl）
- PRD 里的功能点全部有对应命令
- Evaluator 能无脑执行这些命令并得到明确的 PASS/FAIL 信号
- **合同包含 ## Workstreams 区块**，且每个 workstream：
  - 边界清晰、与其他 workstream 无交集
  - 含 `- [ ] [BEHAVIOR]` 或 `- [ ] [ARTIFACT]` 格式的 DoD 条目
  - DoD Test 字段命令可直接执行（无占位符）
  - 大小估计合理（S/M/L）

**REVISION 条件**（任一满足）：
- 有验证命令含占位符（如 `{task_id}`，无法直接执行）
- 命令只测 happy path，无失败路径
- 命令太弱（只查 HTTP 状态码，不验证响应体）
- 有 PRD 功能点没有对应命令
- 全是 curl，没有 psql/playwright/npm test 等广谱工具
- 命令 exit code 语义不清晰
- **缺少 ## Workstreams 区块**
- Workstream 边界模糊（两个 workstream 改同一文件的同一部分）
- DoD 条目格式不对（缺 [BEHAVIOR]/[ARTIFACT] 标签，或 Test 字段缺失）

### Step 4a: APPROVED — 写最终合同

```bash
# 在独立 review 分支上 push 最终合同
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-approved-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"

# 把草案复制为最终合同（从 propose 分支 checkout）
mkdir -p "${SPRINT_DIR}"
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md finalized"
git push origin "${REVIEW_BRANCH}"

# 同时把合同写到 planner_branch 上，供 harness_generate/harness_evaluate 直接读
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
CONTRACT_BRANCH="cp-harness-contract-${TASK_ID_SHORT}"
git checkout -b "${CONTRACT_BRANCH}" "origin/${PLANNER_BRANCH}" 2>/dev/null || git checkout "${CONTRACT_BRANCH}"
mkdir -p "${SPRINT_DIR}"
git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/sprint-contract.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md 写入 sprint_dir 供后续 Agent 读取" 2>/dev/null || true
git push origin "${CONTRACT_BRANCH}"
```

### Step 4b: REVISION — 写反馈

写反馈时，**必须以"命令问题"为主要反馈类型**，而非"描述模糊"：

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-revision-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-review-feedback.md" << 'FEEDBACK'
# Contract Review Feedback (Round N)

## 必须修改项

### 1. [命令太弱] Feature X — <具体命令问题>
**问题**: <命令只检查 HTTP 200，未验证响应体字段>
**影响**: <空实现也能通过此命令>
**建议**: <加上对响应体关键字段的校验，如 node -e 验证 JSON 结构>

### 2. [缺失边界] Feature Y — <缺失边界路径>
**问题**: <没有测试空输入/无效参数时的返回行为>

### 3. [工具不对] Feature Z — <工具选择问题>
**问题**: <UI 功能应用 playwright 验证，不能只用 curl>

### 4. [有占位符] Feature W — 命令含 `{task_id}`，无法直接执行

### 5. [PRD 遗漏] PRD 里的 Feature V 在合同里没有验证命令

## 可选改进
- ...
FEEDBACK

git add "${SPRINT_DIR}/contract-review-feedback.md"
git commit -m "feat(contract): REVISION — feedback round N"
git push origin "${REVIEW_BRANCH}"
```

**最后一条消息**（字面量 JSON，不要用代码块包裹）：

APPROVED：
```
{"verdict": "APPROVED", "contract_path": "${SPRINT_DIR}/sprint-contract.md", "review_branch": "${REVIEW_BRANCH}", "contract_branch": "${CONTRACT_BRANCH}", "workstream_count": N}
```

REVISION：
```
{"verdict": "REVISION", "feedback_path": "${SPRINT_DIR}/contract-review-feedback.md", "issues_count": N, "review_branch": "${REVIEW_BRANCH}"}
```
