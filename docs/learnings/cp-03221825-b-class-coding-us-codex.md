# Learning: 编码类B類任务改为 us+本机Codex，纯策略类保持xian

## 任务概述

精细化 B類任务路由策略：需读代码上下文的任务在 US 本机 Codex 执行，
纯策略/知识类任务路由到西安 Codex。

### 根本原因

PR #1361 将所有B類任务都改到xian，但code_review/decomp_review/
initiative_plan等任务需要访问本地代码文件，在西安 Codex bridge 
执行时无法读取 US 本机的代码上下文，会导致审查质量下降。

### 最终路由策略

**US 本机 Codex（编码类，需读代码）**：
- code_review, decomp_review, initiative_plan, initiative_verify
- arch_review, architecture_design, architecture_scan

**西安 Codex Bridge（纯策略/知识类）**：
- strategy_session, suggestion_plan, knowledge
- scope_plan, project_plan（规划层级，不需要读具体代码）

**西安 Codex Bridge（原有）**：
- pr_review, codex_qa/dev/playwright/test_gen, content-*

### executor.js 路由机制

编码类任务加入 REVIEW_TASK_TYPES → triggerCodexReview（本机Codex CLI + review池）
而非 triggerCeceliaRun（Claude Code cecelia-bridge）

### 下次预防

- [ ] 新增 task_type 时在 LOCATION_MAP 注释中标注「需读代码/纯策略」
- [ ] 需读本地文件的任务必须在 US 本机执行（无论用 Codex 还是 Claude Code）
