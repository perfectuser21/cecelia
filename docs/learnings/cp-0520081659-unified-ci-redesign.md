## CI 统一改造 code review 修复（2026-05-20）

### 根本原因

1. **protobufjs 漏洞**：`npm audit fix` 未在分支开发期间运行，导致 package-lock.json 中存在可自动修复的漏洞。@opentelemetry/sdk-node 需 major 升级（breaking change），不能自动修复，留作 P2 追踪。

2. **brain-diff-coverage 覆盖率说明缺失**：注释只说"使用 shard 1"，未说明 shard 1 仅覆盖 ~25% 测试文件，导致 reviewer 不清楚门禁是近似值。

3. **smoke 模式不对称未文档化**：`lint-tdd-commit-order.sh` 接受任意 `smoke/*.sh`，而 `lint-test-pairing.sh` 只接受 `golden-path-*`，这是刻意设计但没有注释解释原因，造成理解困惑。

### 下次预防

- [ ] 分支开发期间，push 前必须运行 `npm audit --audit-level=high --omit=dev`，有可自动修复项先跑 `npm audit fix`
- [ ] CI 架构决策（如"使用 shard 1 节省时间"）必须在注释中说明精度权衡
- [ ] 两个脚本行为不对称时，必须在各自注释中交叉说明差异原因，不能让 reviewer 自己猜
- [ ] 已知无法自动修复的高危漏洞（需 breaking upgrade）必须在 ci.yml 注释中记录 GHSA ID + 原因
