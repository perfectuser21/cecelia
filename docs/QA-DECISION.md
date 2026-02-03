# QA Decision

Decision: NO_RCI
Priority: P2
RepoType: Engine

## Tests

- dod_item: "workflow 文件添加了 if 条件到 check-trigger job"
  method: manual
  location: manual:检查 .github/workflows/back-merge-main-to-develop.yml 第 13 行

- dod_item: "在非 main 分支 push 时，workflow 完全不运行"
  method: manual
  location: manual:push 到 develop 分支后检查 GitHub Actions 页面

- dod_item: "在 main 分支 push 时，workflow 正常运行"
  method: manual
  location: manual:将来合并到 main 后验证

- dod_item: "workflow 其他逻辑未被修改"
  method: manual
  location: manual:代码审查确认只修改了 if 条件

- dod_item: "npm run qa 通过"
  method: auto
  location: contract:C2-001

- dod_item: "CI 通过，无新增失败"
  method: manual
  location: manual:等待 CI 运行完成

## RCI

new: []
update: []

## Reason

这是一个 CI 配置优化（修复 GitHub Actions 误触发），不涉及核心功能变更或回归风险。修改范围极小（单文件单行），影响仅限于减少 CI 噪音。无需新增回归契约，现有 CI 测试（C2-001）足够覆盖。
