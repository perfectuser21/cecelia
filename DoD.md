# DoD: 核心 smoke 去 jq 化——canary 容器内 jq 缺失致自动部署拦截

- [x] [BEHAVIOR] smoke-core.txt 全部脚本不依赖 jq（守卫 Red 先行，4 命中→0）
      Test: manual:bash scripts/ci/__tests__/smoke-core-no-jq.test.sh
- [x] [BEHAVIOR] 4 个改造 smoke 对活体 Brain 实测全过（断言语义不变）
      Test: manual:bash -c "bash -n packages/brain/scripts/smoke/healthz-smoke.sh packages/brain/scripts/smoke/version-endpoint-smoke.sh packages/brain/scripts/smoke/harness-ping-smoke.sh packages/brain/scripts/smoke/harness-echo-smoke.sh"
- [x] 守卫已接线 ci.yml
      Test: manual:bash -c "grep -q 'smoke-core-no-jq.test.sh' .github/workflows/ci.yml"
- [x] 版本同步 + facts 一致
      Test: manual:bash scripts/check-version-sync.sh
