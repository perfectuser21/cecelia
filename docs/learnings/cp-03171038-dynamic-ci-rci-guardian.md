# Learning: 动态 CI 守护 — RCI 清理 + 覆盖完整性检查

**分支**: cp-03171038-dynamic-ci-rci-guardian
**日期**: 2026-03-17

---

### 根本原因

engine RCI (`packages/engine/regression-contract.yaml`) 中积累了大量垃圾条目，根本原因是：

1. **RCI 与代码物理分离**：契约写在 YAML 里，代码改了没人更新 YAML，时间一长必然漂移
2. **没有反向守护**：新功能加进来不需要有测试，删功能不需要清 RCI，CI 对此完全无感知
3. **DevGate 不读 engine RCI**：`rci-execution-gate.sh` 写死只读 quality 包的 RCI，engine 的 RCI 从未被执行

具体触发点：PR #961 重构 `/dev` 步骤文件时删了 `03-branch.md`，里面的 `.dev-lock` 创建逻辑一起消失，CI 没有报错，因为没有任何测试验证这个行为还在。

---

### 下次预防

- [ ] 新加 `hooks/*.sh` 文件时，同时创建 `tests/hooks/<name>.test.ts`（`check-coverage-completeness` 会在 CI 强制检查）
- [ ] 新加 P0 RCI 条目时，必须填写真实 `test` 字段（`check-rci-health` 会在 CI 硬失败）
- [ ] 删除 hook/lib 文件时，同时删除对应 RCI 条目（`check-rci-health` 的孤儿检测会告警）
- [ ] RCI 的 `evidence.file` 路径改变时，同步更新 YAML（孤儿检测会发现）
- [ ] `continue-on-error: true` 是过渡措施，待存量 18 个 P0 空头契约补完测试后必须去掉

---

### 技术决策记录

**为什么用 `--changed-only` 而不是全量检查**：
存量有大量无测试的源文件（技术债），全量检查会立刻让所有 PR 红。`--changed-only` 只检查本 PR 新改动的文件，不处理存量，既能对新功能形成约束，又不阻塞日常开发。

**为什么 check-rci-health 用 continue-on-error**：
存量有 18 个 P0 空头契约，如果立即严格执行会导致所有涉及 engine RCI 的 PR 失败。过渡期用 warning 模式，待补完测试后移除 continue-on-error。

**RCI 是声明式的，动态检查是程序式的**：
两者互补。RCI YAML 描述"应该有什么行为"，动态检查脚本发现"实际有没有"。RCI 不能自我执行，动态检查让它活起来。
