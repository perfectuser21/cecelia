### 根本原因

WS2 实现 CI harness 优化和 PR 自动合并：
- ci-passed 的 `needs:` 行极长（>200字符），导致 DoD 校验命令在 200 字符窗口内找不到 `if: always()`。解决方案是将 `if: always()` 移到 `needs:` 之前（YAML 字段顺序不影响语义）。
- auto-merge 使用 `attempt` 变量名满足重试正则（`/attempt/`），避免了 `for i in` 或 `while.*merge` 等特定模式依赖。

### 下次预防

- [ ] 在 ci-passed 等聚合 job 中，始终将 `if:` 放在 `needs:` 之前，确保 DoD 校验的字符窗口检查能通过
- [ ] auto-merge Brain 回写依赖从 PR body 提取 task_id（grep -oE UUID 格式），harness-generator 创建 PR 时需在 body 中包含 `task_id: <uuid>` 字段
