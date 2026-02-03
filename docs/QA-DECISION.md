# QA Decision

Decision: UPDATE_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "ci-passed 依赖链修复"
    method: auto
    location: tests/workflow-guard-3.test.ts (新增测试)

  - dod_item: "back-merge 权限修复"
    method: manual
    location: manual:手动触发 back-merge workflow 验证权限

  - dod_item: "强制 checks 目录验证"
    method: auto
    location: tests/ci/evidence.test.ts (扩展现有测试)

  - dod_item: "CI run ID 验证"
    method: auto
    location: tests/ci/evidence.test.ts (新增验证逻辑)

  - dod_item: "时间戳验证"
    method: auto
    location: tests/ci/evidence.test.ts (新增时间戳检查)

  - dod_item: "glob regex bug 修复"
    method: auto
    location: tests/gate/scan-rci-coverage.test.ts (扩展测试用例)

  - dod_item: "shell 转义加强"
    method: auto
    location: tests/scripts/ (新增转义测试)

  - dod_item: "nightly workflow 修复"
    method: manual
    location: manual:手动触发 nightly workflow 验证 artifact 上传

  - dod_item: "超时配置"
    method: auto
    location: 无需测试（配置项）

RCI:
  new: []
  update:
    - W1-001  # CI workflow 修改（ci-passed 依赖链）
    - W2-002  # Evidence 系统加固
    - C1-001  # DevGate 脚本修复

Reason: CI 系统是引擎的核心防护机制，修复 CRITICAL 漏洞必须更新回归契约。涉及 workflow 逻辑变更、evidence 验证机制强化、devgate 脚本 bug 修复，均为 P0 优先级。
