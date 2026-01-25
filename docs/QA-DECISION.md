# QA Decision

Decision: NO_RCI
Priority: P0
RepoType: Quality

## 测试方法

Tests:
  - dod_item: "run.sh check --profile=web 可执行"
    method: manual
    location: manual:run_sh_check_web_works
    rationale: 手动验证脚本功能

  - dod_item: "export-status.sh 可生成有效 JSON"
    method: manual
    location: manual:export_generates_valid_json
    rationale: 手动验证 JSON 输出格式

## RCI 决策

RCI:
  new: []
  update: []

Reason: |
  架构基础设施变更，添加 Profile 系统支持多项目类型。

  不需要 RCI 的原因：
  1. 这是新增的配置系统，不影响现有功能
  2. 是质量平台自身的架构升级，不涉及业务逻辑
  3. 通过手动测试验证功能完整性即可

  未来考虑：
  - Profile 系统稳定后，可为 run.sh 添加集成测试
  - Dashboard schema 可添加格式验证测试
