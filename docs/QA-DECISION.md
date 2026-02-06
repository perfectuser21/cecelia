# QA Decision - Cecelia 丘脑 (Thalamus) 事件路由器

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "thalamus.js 实现事件分析"
    method: auto
    location: brain/src/__tests__/thalamus.test.js

  - dod_item: "decision-executor.js 实现决策执行"
    method: auto
    location: brain/src/__tests__/decision-executor.test.js

  - dod_item: "Validator 验证 Decision 合法性"
    method: auto
    location: brain/src/__tests__/thalamus.test.js

  - dod_item: "快速路由处理简单事件（不调 LLM）"
    method: auto
    location: brain/src/__tests__/thalamus.test.js

  - dod_item: "降级机制：Sonnet 失败时回退到代码"
    method: auto
    location: brain/src/__tests__/thalamus.test.js

  - dod_item: "单元测试覆盖核心逻辑"
    method: auto
    location: brain/src/__tests__/thalamus.test.js, brain/src/__tests__/decision-executor.test.js

  - dod_item: "接入 Tick 事件流"
    method: manual
    location: manual:验证 Tick 事件能触发 Thalamus 处理

RCI:
  new:
    - RCI-THAL-001  # 丘脑事件分析
    - RCI-THAL-002  # 决策执行器
  update: []

Reason: 丘脑是 Cecelia 的核心决策层，负责事件路由和决策生成。必须有完整的单元测试覆盖 Decision 验证、Action 白名单、快速路由和降级机制。
