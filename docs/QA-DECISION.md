---
id: qa-decision-kr1-intent-recognition
version: 1.0.0
created: 2026-02-01
updated: 2026-02-01
changelog:
  - 1.0.0: 初始版本（KR1 意图识别功能）
---

# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "API 端点接受自然语言输入并返回结构化结果"
    method: auto
    location: apps/core/src/brain/__tests__/intent.test.js

  - dod_item: "能正确识别三种意图类型：create-okr、create-project、create-task"
    method: auto
    location: apps/core/src/brain/__tests__/intent.test.js

  - dod_item: "提取信息包含 title、description、priority、parent"
    method: auto
    location: apps/core/src/brain/__tests__/intent.test.js

  - dod_item: "测试覆盖至少 5 种典型场景"
    method: auto
    location: apps/core/src/brain/__tests__/intent.test.js

  - dod_item: "返回 ParsedIntent 对象包含 confidence 分数（0-1 范围）"
    method: auto
    location: apps/core/src/brain/__tests__/intent.test.js

  - dod_item: "对于低置信度结果（< 0.6），返回建议的追问问题"
    method: auto
    location: apps/core/src/brain/__tests__/intent.test.js

  - dod_item: "核心模块测试通过"
    method: manual
    location: manual:cd apps/core && npm test

RCI:
  new: []
  update: []

Reason: Business repo 新增业务功能（Brain 意图识别），无核心 Hook/Gate/CI 变更，不需要添加或更新回归契约。
