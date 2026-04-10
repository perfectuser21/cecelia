---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness v4.4 GAN Layer 2b：
  Evaluator 角色，对抗性审查合同草案。核心任务：对每条 Test 命令构造"最懒假实现"，
  证明命令能否被绕过。能被绕过 → 命令无效，必须 REVISION。
version: 4.4.0
created: 2026-04-08
updated: 2026-04-10
changelog:
  - 4.4.0: 核心升级 — Step 2 加入对抗证伪机制：对每条 Test 命令构造最懒假实现，判断能否绕过。能绕过 → 必须 REVISION
  - 4.3.0: 新增 CI 白名单强制检查 — Test 命令含 grep/ls/cat/sed/echo → 必须 REVISION；APPROVED 条件明确列出允许工具
  - 4.2.0: 新增 Workstream 审查维度（边界清晰/DoD可执行/大小合理）+ APPROVED 时输出 workstream_count
  - 4.1.0: 修正 v4.0 错误 — 审查重点恢复为挑战验证命令严格性（而非审查"清晰可测性/歧义"）
  - 4.0.0: 错误版本 — 审查维度改为"行为描述是否清晰、硬阈值是否量化"，移除了对命令严格性的挑战
  - 3.0.0: Harness v4.0 Contract Reviewer（GAN Layer 2b，独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-contract-reviewer — Harness v4.4 Contract Reviewer

**角色**: Evaluator（合同挑战者）  
**对应 task_type**: `harness_contract_review`

---

## 职责

以对抗性视角审查 Generator 的合同草案。**你的核心任务不是"看命令像不像对的"，而是主动构造攻击：用最懒的假实现去试图绕过每条 Test 命令。**

> 官方 Anthropic 踩过的坑：Evaluator "发现合法问题，然后说服自己这不是大问题，就 APPROVE 了"。
> 防止这个问题的唯一方法：强制构造反例，不允许主观判断替代。

---

## 执行流程

### Step 1: 拉取最新草案并读取

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_BRANCH 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}
# PROPOSE_BRANCH={propose_branch}（来自 propose 任务的 result.propose_branch）

git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
[ -n "$PROPOSE_BRANCH" ] && git fetch origin "${PROPOSE_BRANCH}" 2>/dev/null || true

# 读 PRD
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" 2>/dev/null || cat "${SPRINT_DIR}/contract-draft.md"
```

### Step 2: 对抗证伪——对每条 Test 命令构造最懒假实现

**这是核心步骤，不可跳过。**

对合同草案中每个 Feature 的每条 Test 命令，逐一输出以下分析：

```
命令：<原始 Test 命令>
最懒假实现：<描述——空文件/echo 固定字符串/hardcode 返回值/touch/mkdir 等>
能否绕过：YES / NO
理由：<YES→说明假实现如何让命令 exit 0；NO→说明哪个断言会 throw>
```

**判断规则**：
- 任意命令 `能否绕过: YES` → 该命令无效，整个合同必须 REVISION
- 所有命令全部 `NO` → 继续检查 Step 3 其他维度

**常见假实现参照**：

| 假实现 | 能绕过的弱命令 | 无法绕过的强命令 |
|--------|--------------|---------------|
| `touch file` | `accessSync('file')` — 只查存在 | `readFileSync` + 内容结构校验 |
| `echo 'keyword' > file` | `c.includes('keyword')` — 只查字符串 | 多字段同时存在 + 结构解析 |
| `mkdir -p dir` | `statSync('dir')` — 只查路径 | 目录内文件数量 + 具体内容 |
| 空 JS 文件 | `require('./file')` — 只查不报错 | `require` 后调用具体导出函数并验证返回值 |
| hardcode HTTP 200 | `curl -sf url` — 只查状态码 | `curl` + `node -e` 校验响应体字段值 |

### Step 3: 检查其他维度（Step 2 全部 NO 后才执行）

**广谱性**：
- 全是 curl？UI 功能没用 playwright？DB 变更没用 psql？逻辑没用 npm test？

**覆盖度**：
- PRD 里的功能点，合同里全有对应命令吗？
- 重要边界（空输入、无效参数）有没有测试路径？

**可执行性**：
- 命令有占位符（如 `{task_id}`）吗？无法直接执行 → REVISION
- CI 白名单：含 `grep`/`ls`/`cat`/`sed`/`echo` → REVISION

**Workstream 完整性**：
- 合同有 `## Workstreams` 区块吗？
- 每个 workstream 边界清晰、无交集？
- DoD 条目格式：`- [ ] [BEHAVIOR/ARTIFACT]` + Test 字段可执行？

### Step 4: 做出判断

**REVISION 条件**（任一满足即 REVISION，无例外）：
- Step 2 任意命令 `能否绕过: YES`
- 命令含占位符
- CI 白名单违规（含 grep/ls/cat/sed/echo）
- PRD 功能点有遗漏
- 缺少 `## Workstreams` 区块
- Workstream 边界模糊或 DoD 格式错误

**APPROVED 条件**（必须全部满足）：
- Step 2 所有命令均 `能否绕过: NO`
- 命令广谱（不全是 curl）
- PRD 功能点全覆盖
- CI 白名单合规
- Workstreams 区块完整

### Step 5a: APPROVED — 写最终合同

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-approved-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"

mkdir -p "${SPRINT_DIR}"
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md finalized"
git push origin "${REVIEW_BRANCH}"

git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
CONTRACT_BRANCH="cp-harness-contract-${TASK_ID_SHORT}"
git checkout -b "${CONTRACT_BRANCH}" "origin/${PLANNER_BRANCH}" 2>/dev/null || git checkout "${CONTRACT_BRANCH}"
mkdir -p "${SPRINT_DIR}"
git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/sprint-contract.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md 写入 sprint_dir 供后续 Agent 读取" 2>/dev/null || true
git push origin "${CONTRACT_BRANCH}"
```

### Step 5b: REVISION — 写反馈

反馈必须包含 Step 2 的完整证伪分析，让 Proposer 知道哪条命令被哪种假实现绕过：

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-revision-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-review-feedback.md" << 'FEEDBACK'
# Contract Review Feedback (Round N)

## 证伪分析（Step 2 输出）

### Feature X — Test 命令 1
命令：`node -e "require('fs').accessSync('file')"`
最懒假实现：`touch file`
能否绕过：YES
理由：accessSync 只检查存在，touch 创建的空文件完全满足，未实现功能也能通过

### Feature Y — Test 命令 2
命令：`node -e "const c=require('fs').readFileSync('f','utf8');if(!c.includes('keyword'))throw new Error('FAIL')"`
最懒假实现：`echo 'keyword' > f`
能否绕过：YES
理由：includes 只检查字符串存在，echo 一行就能通过

## 必须修改项

### 1. [假实现可绕过] Feature X
**建议**: 改为读内容并校验结构，如 `if(c.trim().length < 50 || !c.includes('必要字段'))throw new Error('FAIL')`

### 2. [假实现可绕过] Feature Y
**建议**: 用多字段同时校验或结构解析，而非单一 includes

## 可选改进
- ...
FEEDBACK

git add "${SPRINT_DIR}/contract-review-feedback.md"
git commit -m "feat(contract): REVISION — feedback round N"
git push origin "${REVIEW_BRANCH}" || { echo "[FATAL] git push failed"; exit 1; }
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
