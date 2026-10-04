## Brain {VERSION} — 部署链剩余两处 healthy 硬编码：sidecar /healthz 探针与 Auto Staging Deploy 等待脚本

- `scripts/lib/bluegreen-sidecar.sh`：`/api/brain/healthz` 以 tick 存活为 200 条件，tick 被有意封停（决策 751f73be）后恒为 503，`curl -f` 在「等 healthz」第一步就失败，后面折算 `/health` 的逻辑（#5949）根本走不到——1.371.2 部署时再次复现，drain 与台账都要手工收尾。新增 `_sidecar_healthz`：只放行「503 且 body.db=connected」，DB 异常/传输失败/其他状态码仍失败；tick 死亡是否属有意封停仍由后面的 `/health` 折算判定（`scheduler.enabled=false` 才折算）。
- `scripts/wait-for-production-sha.sh`：Auto Staging Deploy 用它等生产 healthy+同 SHA，自 1.370.13 起每次因 degraded 超时失败，Dashboard staging 从未出包。改为与部署收账同口径（`policy.deployHealth`，导入失败=严格口径）。
- 回归：sidecar fixture 忠实模拟 `/healthz` 503 与 `curl -f`；`wait-for-production-sha.test.sh` 新增封停放行、断路器 OPEN/非封停仍超时三个用例（任务 a9adc667）。
