# Sprint PRD — Harness Planner 升级为 AI-Native 自决策 Planner

## 背景

当前 `harness-planner` (v4.1) 输出的 PRD 过于单薄——只有"功能名 + 用户行为 + 系统响应"三行描述，缺乏结构化的验收场景、边界条件和假设声明。下游 `contract-proposer` 拿到这种薄 PRD 后只能自行脑补验收标准，导致生成的 DoD 质量差、验证命令不精准。

行业对标（GitHub spec-kit 87k stars、Addy Osmani agent-skills 12k stars）显示，高质量 PRD 需要包含：User Story + Given-When-Then 验收场景 + 编号化需求 + 显式假设 + 歧义消解。但这些工具都是 Human-in-the-Loop 设计（每步停下来问人），不适合 Cecelia 的 AI-Native 24/7 自动开发模式。

本次升级的核心理念：**借鉴 spec-kit 的结构化模板，但用 AI 自决策替代人工审批**——Planner 自动读取 Brain context / OKR / 代码库来补全细节，只在真正无法推断时才向用户提问。

## 目标

将 `harness-planner` SKILL.md 升级为 v5.0，使其输出的 PRD 结构化程度达到 spec-kit 水平，同时保持全自动运行能力（不在每个步骤停下来等人）。

## 功能列表

### Feature 1: 自动上下文采集（Step 0 增强）
**用户行为**: 用户给出一句话需求（如"优化 harness pipeline 的 PRD 质量"）
**系统响应**: Planner 自动调用 Brain API 获取 OKR 进度、活跃任务、最近 PR、有效决策，结合任务描述判断意图层级和上下文，无需用户额外提供信息
**不包含**: 不读代码实现细节（那是 GAN 层的事）

### Feature 2: 结构化 PRD 模板（spec-kit 级别）
**用户行为**: 无需用户参与
**系统响应**: PRD 输出包含以下结构化章节：
  - **User Stories**（按 P1/P2/P3 优先级排列，每个可独立测试）
  - **验收场景**（Given-When-Then 格式，每个 User Story 至少 1 个）
  - **功能需求编号**（FR-001, FR-002...，供 DoD 追溯引用）
  - **成功标准编号**（SC-001...，必须可量化、技术无关）
  - **显式假设列表**（Planner 做出的所有假设，供 GAN reviewer 质疑）
  - **边界情况**（Edge Cases 章节）
  - **范围限定**（在范围/不在范围）
  - **预期受影响文件**（已有，保留）
**不包含**: 不写技术实现方案（How）、不写验证命令（那是 Proposer 的事）

### Feature 3: AI 自决策歧义消解（替代 spec-kit 的 /clarify）
**用户行为**: 无需用户回答歧义问题
**系统响应**: Planner 在写 PRD 前执行 9 类歧义自检扫描：
  1. 功能范围 → 从 Brain task 描述推断
  2. 数据模型 → 从 Brain context 推断（不读代码）
  3. UX 流程 → 从任务类型推断（API/UI/CLI）
  4. 非功能需求 → 做保守假设并标注
  5. 集成点 → 从 OKR/Project 上下文推断
  6. 边界情况 → 列出常见边界并标注为假设
  7. 约束 → 从 CLAUDE.md / CI 规则推断
  8. 术语 → 从代码库命名约定推断
  9. 完成信号 → 从 OKR 目标反推
  
  无法推断的项 → 标记 `[ASSUMPTION: ...]`，写入假设列表。只有影响方向性决策的歧义才向用户提问（预期 0-1 个问题，而非 5 个）。
**不包含**: 不做代码级的歧义分析（那是 GAN 层的事）

### Feature 4: OKR 对齐检查
**用户行为**: 无需用户参与
**系统响应**: PRD 顶部包含 `## OKR 对齐` 章节，标明该任务对应哪个 KR、当前 KR 进度、本次任务预期推进多少。如果任务描述与任何活跃 KR 对不上，在假设列表中标注。
**不包含**: 不创建新 OKR 或修改现有 OKR

## 成功标准

- SC-001: 升级后的 SKILL.md 输出的 PRD 包含至少 1 个 User Story（含 Given-When-Then）、至少 1 个编号需求（FR-xxx）、至少 1 个编号成功标准（SC-xxx）、至少 1 个显式假设
- SC-002: PRD 模板中不包含任何需要用户交互才能填写的占位符（如 `[请用户确认]`）
- SC-003: SKILL.md 的 Step 0 包含 `curl localhost:5221/api/brain/context` 调用指令
- SC-004: 改动范围限定在 `packages/workflows/skills/harness-planner/SKILL.md` 一个文件

## 范围限定

**在范围内**:
- `harness-planner/SKILL.md` 的模板升级
- PRD 输出格式的结构化增强
- Brain API 上下文采集的指令添加

**不在范围内**:
- `harness-contract-proposer` 的改动（它需要适配新 PRD 格式，但那是后续任务）
- `harness-contract-reviewer` 的改动
- Brain API 新端点开发
- CI 流程改动
- 新增 `/clarify` 独立 skill（歧义消解内置在 Planner 中）

## 预期受影响文件

- `packages/workflows/skills/harness-planner/SKILL.md`：核心改动目标，模板升级 + Step 0 增强 + 歧义自检逻辑
