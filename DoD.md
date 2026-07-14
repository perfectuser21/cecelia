# DoD: brain 镜像补 jq——pre-swap smoke 容器内 jq: command not found 假红 [1.262.2]

- [x] [BEHAVIOR] brain Dockerfile 运行时层安装 jq（smoke-core 脚本依赖）
      Test: manual:bash scripts/__tests__/brain-image-smoke-deps.test.sh
- [x] 版本四处同步 1.262.2
      Test: manual:bash scripts/check-version-sync.sh
- [x] facts-check 通过
      Test: manual:node scripts/facts-check.mjs
