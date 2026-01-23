# QA Decision

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "添加 CRITICAL → P0 映射"
    method: auto
    location: tests/hooks/detect-priority.test.ts
  - dod_item: "添加 HIGH → P1 映射"
    method: auto
    location: tests/hooks/detect-priority.test.ts
  - dod_item: "添加 security 关键字 → P0 映射"
    method: auto
    location: tests/hooks/detect-priority.test.ts
  - dod_item: "单元测试覆盖新增映射"
    method: auto
    location: tests/hooks/detect-priority.test.ts
  - dod_item: "补充 v8.24.0 安全修复 RCI"
    method: manual
    location: manual:verify-rci
  - dod_item: "更新 QA/Audit SKILL.md 文档"
    method: manual
    location: manual:code-review
  - dod_item: "npm run qa 通过"
    method: auto
    location: contract:C2-001

RCI:
  new:
    - H1-010
    - H1-011
    - H2-011
    - H2-012
    - H2-013
    - H4-003
    - C1-002
    - C1-003
  update: []

Reason: P0 级 Bug 修复 - detect-priority.cjs 未识别 CRITICAL/HIGH，导致 v8.24.0 安全修复绕过 RCI 检查。必须添加 8 个新 RCI 条目。
