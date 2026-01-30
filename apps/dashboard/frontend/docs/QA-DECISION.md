# QA Decision

Decision: NO_RCI
Priority: P2
RepoType: Business

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| index.ts 导出 contents.api | manual | manual:检查导出语句存在且无编译错误 |
| index.ts 导出 ai-employees.api | manual | manual:检查导出语句存在且无编译错误 |
| 代码通过 CI | auto | contract:CI-lint-build |

## RCI

- new: []
- update: []

## Reason

简单的模块导出补全，不涉及功能逻辑变更，无需纳入回归契约。通过 lint 和 build 即可验证正确性。
