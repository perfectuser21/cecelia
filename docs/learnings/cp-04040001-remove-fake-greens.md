---
branch: cp-04042122-cp-04040001-remove-fake-greens
date: 2026-04-04
type: learning
---

# Learning: 移除 CI continue-on-error 假绿

### 根本原因

三处 `continue-on-error: true` 来自不同时期的技术债：
1. `deploy.yml` deploy job — 部署 webhook 可能不稳定时临时加的
2. `brain-unit` — 506 个测试文件在 ubuntu-latest 上触发 OOM，用 continue-on-error 掩盖
3. `brain-integration` — 环境依赖配置未验证，提前用 continue-on-error 跳过失败

这类假绿的危害：CI 通过不代表系统健康，真实错误被静默吞掉。

### 下次预防

- [ ] OOM 问题应该立即用 `--pool=forks --maxWorkers=N` + `NODE_OPTIONS` 修复，不允许用 continue-on-error 作为 workaround
- [ ] 新增 CI job 时，如果依赖环境未就绪，应该先不加该 job，而不是加 continue-on-error
- [ ] `continue-on-error: true` 只允许用于真正的 advisory 检查（如 lint），不允许用于测试或部署步骤
- [ ] Code Review 时检查 continue-on-error 是否合理，拒绝用它掩盖功能性错误
