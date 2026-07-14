# DoD: graduate --update-refs（毕业时重写根 DoD.md 旧路径引用）

- [x] [BEHAVIOR] 毕业搬运后根 DoD.md 中旧路径全部重写为新路径，无 DoD.md 静默跳过
      Test: tests/graduate-sprint-tests.test.ts
- [x] [BEHAVIOR] guard 全绿（孤儿棘轮 0 不回退）
      Test: manual:node scripts/test-pyramid-guard.mjs
