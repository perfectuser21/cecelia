---
branch: cp-03211800-09eb75fd-fd75-4581-9493-40654d
date: 2026-03-22
task: Brain 部署脚本支持 launchd 模式
---

# Learning: brain-deploy.sh launchd 模式支持

## 根本原因

brain-deploy.sh 和 brain-reload.sh 全程依赖 Docker，但当前 Mac mini 上 Brain 以 **launchd** 方式运行（`com.cecelia.brain`），不使用 Docker Compose。导致 deploy webhook 触发后 docker build 失败，整条自动部署链路断裂。

## 修复内容

1. **部署模式检测**：顶部检测 `docker info` 是否可用 + 容器是否存在，不满足时自动切换 launchd 模式
2. **launchd 路径**：跳过 docker build，直接 `node src/migrate.js`/`node src/selfcheck.js`，重启用 `launchctl kickstart -k gui/$(id -u)/com.cecelia.brain`
3. **路径修复**：`/home/xx/` → `${HOST_HOME:-$HOME}`（兼容 macOS `/Users/administrator`）
4. **dry-run 支持**：`--dry-run` 输出当前环境将采用的路径，方便调试

## 下次预防

- [ ] 新增部署相关脚本时，先确认当前环境的 Brain 管理方式（Docker/launchd/systemd）
- [ ] `brain-deploy.sh` 是 mac mini 部署的 SSOT，任何新增部署模式都在此添加分支
- [ ] dry-run 参数必须输出足够信息（mode/paths），便于在不实际执行时验证逻辑
- [ ] rescue pipeline 跨 worktree 更新 .dev-mode 时，hook 会拦截（检查当前 git 上下文），可忽略该元数据文件更新，直接推 PR 进 CI
