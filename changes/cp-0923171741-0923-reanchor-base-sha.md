## Brain {VERSION} — 派发时重锚定 base_sha（接班收据），main 合并不再冻全队列

- 迁移 465：`work_routing_receipts.anchor_generation`，唯一键改 `(source,source_id,router_version,anchor_generation)` + `UNIQUE(supersedes_receipt_id)`，`initiative_runs(current_task_id)` 索引
- 预检 `map_revision_mismatch` 时先调 `reanchorReceiptIfEmptyBranch`：分支无产出（无 initiative_runs）→ 同事务插接班收据并同步 `tasks.payload/metadata`，留痕 `work_route_reanchored` / `base_sha_reanchored`；有产出 → `needs_rebase`；快进 ≥5 次 → `map_thrash`
- `createKernelRun` 取 `metadata`、透传 `createdSource`、返回体带 `base_sha`/`routing_receipt_id`，relay/headed 三处 `syncTaskPayloadFromKernelRun` 回流内存 task
- 路由收据回读取最新代（`anchor_generation DESC`），幂等比对忽略 `REANCHOR_EVIDENCE_KEYS`；planner recovery / observability 改按最新代取收据
- dispatcher/executor 派发失败 `reason_code` 结构化（`KNOWN_REASON_CODES` 白名单）；`needs_rebase` 直接停车不计熔断，停车失败升 P2 `needs_rebase_park_failed`
- 一次性回填脚本 `scripts/reanchor-blocked-tasks.mjs`（`--dry-run` / `--confirm-database=`，有 run 的任务改标 `needs_rebase` 不解锁）
- 真 PG 集成测试：接班收据 × 421 触发器 × 465 唯一键 × 索引 × `createKernelRun` 端到端（任务 d9c405e2）
