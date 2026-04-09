# Sprint PRD — Harness Pipeline 自检：三处系统性缺陷修复

## 背景

本轮 Harness Pipeline 经历了四轮演进（PR #2159/#2162/#2163/#2164/#2165/#2166），
核心机制已到位（Stop Hook 会话隔离、串行 Workstream、Contract DoD 完整性校验），
但通过代码审查发现三处系统性缺陷，会在真实运行时导致 Pipeline 失败或产生幽灵文件。

## 目标

修复三处导致 Harness Pipeline 在真实运行时失败的缺陷，不新增功能。

---

## 功能列表

### Feature 1: Reviewer 新增 CI 白名单强制检查

**用户行为**: Reviewer 审查合同草案时，遇到含 `grep`/`ls`/`cat`/`sed`/`echo` 的 Test 命令  
**系统响应**: Reviewer 必须将此判为 REVISION，不得 APPROVED。只允许 `node`/`npm`/`curl`/`bash`/`psql`  
**当前问题**: `harness-contract-reviewer/SKILL.md` 的 APPROVED 条件和 REVISION 触发条件中，
  均未明确列出 CI 白名单规则。Reviewer 可能批准含 `grep -c` / `ls` / `cat` 的命令，
  Generator 原样复制到 DoD.md 后，CI 的 "DoD BEHAVIOR 命令执行" 步骤会因白名单拦截而失败。
**不包含**: 不修改 CI 本身的白名单逻辑，只修改 Reviewer 的审查标准

### Feature 2: contract-dod-ws{N}.md 路径归一到 sprint_dir

**用户行为**: Planner 发起多个 harness 任务（串行或并发）  
**系统响应**: 每个任务的 contract-dod-ws{N}.md 存放在各自的 `${SPRINT_DIR}/` 下，互不干扰  
**当前问题**: `harness-contract-proposer/SKILL.md` 把 `contract-dod-ws*.md` 写在 repo 根目录，
  `harness-generator/SKILL.md` 和 `ci.yml` 也从根目录读取。
  多次 harness 运行时根目录会积累 contract-dod-ws1.md / contract-dod-ws2.md 等幽灵文件，
  后一轮的文件会覆盖前一轮，导致 CI 校验对比错误的合同版本。
**目标**: 三处统一改为 `${SPRINT_DIR}/contract-dod-ws{N}.md`（Proposer 写，Generator/CI 读）
**不包含**: 不修改 .gitignore，不清理历史文件

### Feature 3: harness-planner 输出可追溯的 PRD（含受影响文件列表）

**用户行为**: 用户描述一个改动需求  
**系统响应**: Planner 在 sprint-prd.md 中除了 Feature 描述，还附上"预期受影响文件"列表（从实际代码路径推断，非臆测）  
**当前问题**: `harness-planner/SKILL.md` v4.0.0 只写 What，未要求 Planner 读取代码确认受影响范围。
  Proposer 在没有文件路径提示的情况下写合同，验证命令中的路径可能不存在（如旧路径引用），
  导致 DoD Test 命令在实际环境中 `accessSync` 失败。
**目标**: Planner 在写 PRD 前先 `ls` + `cat` 相关目录，在 PRD 末尾附"受影响文件"小节
**不包含**: 不要求 Planner 提出解决方案，只提供文件路径上下文

---

## 成功标准

- Reviewer SKILL.md 明确列出 CI 白名单（node/npm/curl/bash/psql），违反即 REVISION
- Proposer / Generator / CI 三处的 contract-dod 路径均改为 `${SPRINT_DIR}/contract-dod-ws{N}.md`
- Planner SKILL.md 新增"Step 0: 读取受影响文件"，PRD 末尾有"预期受影响文件"小节

## 范围限定

**在范围内**:
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md`
- `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- `packages/workflows/skills/harness-generator/SKILL.md`
- `packages/workflows/skills/harness-planner/SKILL.md`
- `.github/workflows/ci.yml`（harness-dod-integrity job 中的路径）

**不在范围内**: Brain executor.js、execution.js、Stop Hook、DoD 格式校验逻辑
