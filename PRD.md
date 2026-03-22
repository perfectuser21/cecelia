# Brain 部署脚本支持 launchd 模式

## 背景

Brain 在 Mac mini 上通过 **launchd** 管理（`com.cecelia.brain.plist`），不用 Docker。
现有 `brain-deploy.sh` 全程依赖 Docker，无法在无 Docker 环境下工作，导致 deploy webhook 链路断裂。

## 成功标准

1. `brain-deploy.sh` 新增 launchd 模式：Docker 不可用时自动切换，跳过镜像构建，用 `launchctl kickstart -k` 重启
2. `brain-reload.sh` 新增 launchd 模式：Docker 不可用时用 launchctl 替代 docker compose restart
3. `bash scripts/brain-deploy.sh --dry-run` 在当前 Mac mini 输出 launchd 模式路径
4. 修复 `/home/xx/` 硬编码路径 → `${HOST_HOME:-$HOME}`
5. 所有现有测试通过
