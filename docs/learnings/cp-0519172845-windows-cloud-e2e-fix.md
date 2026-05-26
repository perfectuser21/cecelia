## windows_cloud E2E 链路断链修复（2026-05-19）

### 根本原因

`final_evaluate` 节点启动 evaluator 容器时，env block 缺少 `TARGET_ENV` 和 `GITHUB_REPO` 两个变量，导致：

1. Evaluator 读不到 `target_environment`，始终用默认 `local_api` 而非 `windows_cloud`
2. `GITHUB_REPO` 硬编码为 `perfectuser21/cecelia`，ZenithJoy sprint 触发错误 repo 的 workflow
3. `zenithjoy-workspace` 从未有 `e2e-windows.yml`，所有 windows_cloud 触发必然 404
4. `SKILL.md` Step B-1 只提取 bash 块，windows_cloud 合同用 powershell 块导致"未找到脚本"

### 下次预防

- [ ] 新增 target_environment 时同步检查 graph 注入 env block
- [ ] base_repo 映射（zenithjoy → zenithjoy-workspace）统一放 graph 层，不在 SKILL 里重复判断
- [ ] 新建外部 repo 的 harness sprint 时，检查目标 repo 是否有对应 workflow 文件
- [ ] contract-proposer 写 E2E 验收时，windows_cloud 合同必须用 ` ```powershell ` 块，proposer SKILL 应强制此规则
