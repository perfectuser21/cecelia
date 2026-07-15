# DoD: preview 泄漏根治①——preview-reaper 对账器 + cleanup 诚实化

- [x] [BEHAVIOR] closed PR 三源回收 / open 不动 / 状态未知 fail-safe / 表行标 inactive / dry-run（5 case，TDD Red 先行）
      Test: manual:bash scripts/ci/__tests__/preview-reaper.test.sh
- [x] cleanup workflow curl 失败必红且评论如实
      Test: manual:bash -c "grep -q 'exit 1' .github/workflows/preview-cleanup.yml && grep -q 'preview-reaper' .github/workflows/preview-cleanup.yml"
- [x] reaper 测试已接线 ci.yml
      Test: manual:bash -c "grep -q 'preview-reaper.test.sh' .github/workflows/ci.yml"
