# DoD: Gate3 假红根治——assert-deploy-effect 等待预算重试

- [x] [BEHAVIOR] wait_budget_s 预算内版本追上 → SUCCESS；耗尽仍旧版 → VERSION_MISMATCH；不带参数 = 现行为一锤（8 case 全绿，TDD Red 先行）
      Test: manual:bash scripts/ci/__tests__/assert-deploy-effect.test.sh
- [x] workflow 断言步传 600s 预算 + job 超时 20min
      Test: manual:bash -c "grep -q '900 600' .github/workflows/brain-ci-deploy.yml && grep -q 'timeout-minutes: 20' .github/workflows/brain-ci-deploy.yml"
