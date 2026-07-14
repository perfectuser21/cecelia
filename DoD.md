# DoD: Gate3 自动部署恢复——green 容器内不可达根治 + 变更检测死代码修复

- [x] [BEHAVIOR] green canary docker run 带 --network <blue 所在网络>，容器模式 smoke BRAIN_URL 用 green_ip:5221，宿主模式保持 localhost（3 用例回归测试，TDD 序 Red 先行）
      Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/bluegreen-green-url.test.js"
- [x] [BEHAVIOR] Gate3 变更检测空结果（shallow diff 失败/grep 无命中/首次 push）fallback 全量 brain 部署，不再静默送空列表
      Test: manual:bash scripts/ci/__tests__/gate3-changed-paths.test.sh
- [x] brain-ci-deploy.yml 计算变更路径改调 gate3-changed-paths.sh，changed_paths 输出变量不变
      Test: manual:bash -c "grep -q 'gate3-changed-paths.sh' .github/workflows/brain-ci-deploy.yml"
- [x] gate3 回归测试已接线 ci.yml（scripts/ci bash 测试无 glob 自动发现）
      Test: manual:bash -c "grep -q 'gate3-changed-paths.test.sh' .github/workflows/ci.yml"
- [x] 既有蓝绿 5 不变量 + canary 关 tick 不变量未破
      Test: manual:bash -c "cd packages/brain && npx vitest run src/__tests__/bluegreen-swap.test.js src/__tests__/canary-no-tick.test.js"
- [x] 版本四处同步 1.263.2 + facts 一致
      Test: manual:bash scripts/check-version-sync.sh
