# Sprint PRD — Harness Pipeline 自我优化 v1

## 背景

Harness v4.x pipeline 已完成核心六步骤（Planner → Proposer ↔ Reviewer → Generator → Evaluator → Report）。但在实际运行中暴露了三个短板：

1. **CI 缺口**：ci.yml 没有 harness 合同专属校验，DoD 格式错误、白名单工具违规等问题只能靠 Reviewer 人工拦截，漏网率高
2. **Reviewer 防护不足**：triple 分析覆盖率阈值（60%）偏低，假实现绕过场景在 self-check-v2 中已被证实（Feature 2 验证 2、Feature 4 验证 1）
3. **Report 生成无重试**：harness-watcher CI 通过后创建 `harness_report` 任务，若 report 任务失败则 pipeline 静默中断，无人感知

## 目标

让 Harness pipeline 在无人干预下具备自我纠错能力：CI 机械拦截格式/工具违规，Reviewer 拦截假实现绕过，Report 失败自动重试至完成。

## 功能列表

### Feature 1: Harness 合同 CI 校验 Job

**用户行为**: Generator 提交 PR（含 DoD.md + contract-dod-ws*.md）  
**系统响应**:  
- CI 新增 `harness-contract-lint` job，仅在检测到 `DoD.md` 或 `contract-dod-ws*.md` 文件变更时触发  
- 校验规则：  
  - 每个 `[BEHAVIOR]` 条目的 `Test:` 字段只使用白名单工具（node/npm/curl/bash/psql）  
  - 每个 `[BEHAVIOR]` 条目的 `Test:` 字段非空  
  - DoD 所有条目在 push 时已勾选 `[x]`  
- 校验失败 → job 红灯 + 输出违规条目清单  
**不包含**: 不校验合同的业务语义正确性（那是 Reviewer 的职责）

### Feature 2: Reviewer Triple 覆盖率提升 + 证伪留痕

**用户行为**: Proposer 提交 contract-draft.md 后 Reviewer 开始审查  
**系统响应**:  
- Triple 分析覆盖率阈值从 `Math.ceil(cmds * 0.6)` 提升至 `Math.ceil(cmds * 0.8)`  
- 每个 `can_bypass: Y` 的 triple 必须附带具体的假实现代码片段（proof-of-falsification），而非仅文字描述  
- Reviewer 输出的 REVISION feedback 中，每个 issue 必须包含：原始命令 → 假实现片段 → 建议修复命令  
**不包含**: 不改变 Reviewer APPROVED/REVISION 二元判定机制

### Feature 3: Report 任务失败重试机制

**用户行为**: Generator PR 通过 CI 并被 auto-merge  
**系统响应**:  
- harness-watcher 创建 `harness_report` 任务后，监听该任务状态  
- 若 report 任务 5 分钟内未变为 `completed`，自动重新创建一次 `harness_report` 任务（最多重试 2 次）  
- 若 3 次均失败，创建 P1 告警任务通知用户，附带 sprint_dir 和失败原因  
**不包含**: 不重试 Generator/Evaluator 等其他步骤的失败

## 成功标准

- 标准 1: 提交含白名单违规 `Test: grep -c ...` 的 DoD.md PR 时，`harness-contract-lint` job 红灯并输出违规行号
- 标准 2: Reviewer 输出的 triple 分析覆盖 >= 80% 的验证命令，且每个 `can_bypass: Y` 附带可执行假实现片段
- 标准 3: 模拟 report 任务失败场景后，harness-watcher 自动重试且第二次成功时 pipeline 正常完结
- 标准 4: 连续 3 次 report 失败后，Brain tasks 表中出现 P1 告警任务

## 范围限定

**在范围内**:
- `.github/workflows/ci.yml` 新增 harness-contract-lint job
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md` 修改覆盖率阈值和证伪格式要求
- `packages/brain/src/harness-watcher.js` 新增 report 重试逻辑
- 相关单元测试

**不在范围内**:
- Planner / Proposer / Generator / Evaluator 的功能变更
- harness pipeline 新增步骤
- Brain task-router 或 thalamus 路由变更
- 数据库 schema 变更

## 预期受影响文件

- `.github/workflows/ci.yml`：新增 `harness-contract-lint` job（条件触发）
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md`：triple 覆盖率阈值 0.6→0.8 + proof-of-falsification 格式强制
- `packages/brain/src/harness-watcher.js`：report 任务创建后增加状态轮询 + 重试逻辑（最多 2 次）+ 超限告警
- `packages/quality/tests/harness/`（新建目录）：CI lint 脚本 + 单元测试
