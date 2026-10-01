# DoD：活跃锁回归的 Docker 边界隔离

- [x] [BEHAVIOR] Docker 首次探活失败不使活跃锁目录回归误红；真实 Git、文件、mtime 和独立清理锁保持。
  Test: manual:npx vitest run sprints/10020200-active-lock-fixture/tests/docker-boundary.test.mjs --maxWorkers=1 --minWorkers=1
- [x] [BEHAVIOR] 探活失败保留真实目录并记录保守跳过；健康时活跃锁、陈旧锁、无锁与单独锁判断均保留。
  Test: manual:bash -c "cd packages/brain && TZ=UTC DB_NAME=cecelia_scratch npx vitest run ../../tests/integration/startup-recovery-active-lock.test.js --maxWorkers=1 --minWorkers=1"

Task b9ce7deb-4d36-4384-accd-3d87bd67c4f1；正式 native、Evaluator/Judge、CI 尚未完成，不据本 DoD 宣称完成。
