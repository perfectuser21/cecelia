# Learning: harness 验证+交付环节 Brain 侧三修复（issue a638f840 / 45dd6925）

## 背景
用 PR#3845 真实产物对 harness-evaluator/harness-report 做实测（非审代码），发现整套 harness pipeline 的"验证+交付"两环节在 relay 架构下不可用；断点恢复实测也未生效。本分支修 Brain 侧三处根因。

### 根本原因
1. **PATCH /tasks/:id 从不写 result 列**：handler 的 setClauses 只有 status/status_history/claimed_by，body.result 仅转发给 promoteRegressionOnHarnessMerged 后即弃——happy path 也静默丢弃，"回写成功"是幻觉。
2. **状态机 `'completed': []` 无补写出路**：report 晚于人工 PATCH completed 时，任何补写 409 INVALID_TRANSITION 且永久无法补救。
3. **spawn 缺省生成的 sprint_dir 不回写 payload**：重派后按新时间戳生成新目录，断点恢复的产物路径漂移（review_required 有持久化，sprint_dir 漏了）。

### 下次预防
- [ ] "API 返回 200 = 写成功"不可信：验收回写类功能必须查库确认字段真实落地（issue a638f840 里 rowsAffected:0 的 HTTP 200 假成功是同款病）
- [ ] 状态机加终态时必须同时想清楚"终态后补数据"的出路，禁止裸 `[]`
- [ ] spawn 时计算的派生值（sprint_dir/review_required 等）凡影响重派幂等性的都必须持久化回 payload，新增字段时对照检查
- [ ] 修 bug 必配 proven-to-fire 守卫：本次 smoke 脚本已亲验报红一次
