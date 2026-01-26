# QA Decision

Decision: MUST_ADD_RCI
Priority: P0
RepoType: Engine

Tests:
  - dod_item: "detect-phase.sh 脚本创建完成"
    method: manual
    location: "manual: 验证文件存在且可执行"

  - dod_item: "脚本能正确检测 p0 阶段（无 PR）"
    method: manual
    location: "manual: 在无 PR 分支执行脚本，验证输出 PHASE: p0"

  - dod_item: "脚本能正确检测 p1 阶段（PR + CI fail）"
    method: manual
    location: "manual: 模拟 CI fail 场景，验证输出 PHASE: p1"

  - dod_item: "脚本能正确检测 p2 阶段（PR + CI pass）"
    method: manual
    location: "manual: 模拟 CI pass 场景，验证输出 PHASE: p2"

  - dod_item: "脚本能正确检测 pending 阶段（PR + CI pending）"
    method: manual
    location: "manual: 模拟 CI pending 场景，验证输出 PHASE: pending"

  - dod_item: "脚本能正确处理 gh API 错误返回 unknown"
    method: manual
    location: "manual: 模拟 gh 命令失败场景，验证输出 PHASE: unknown"

  - dod_item: "Stop Hook 能成功调用脚本不再报错"
    method: manual
    location: "manual: 在功能分支执行，验证 Stop Hook 不再报 detect-phase.sh 缺失错误"

  - dod_item: "输出格式符合规范（PHASE: xxx / DESCRIPTION: xxx / ACTION: xxx）"
    method: manual
    location: "manual: 验证所有输出格式符合规范"

RCI:
  new: ["W1-004"]
  update: []

Reason: detect-phase.sh 是质检系统核心组件，Stop Hook 依赖它判断阶段。缺失导致质检门控失效（P0 blocker）。必须纳入回归契约确保该脚本存在且功能正确。
