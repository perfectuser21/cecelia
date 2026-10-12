## Brain {VERSION} — coding workflow 回归 smoke 在 CI 首跑失败由 runner 剔除失败条目重新固化一次

- 新增 `runner/lib/smoke-refit.mjs`：cw PR 的 Smoke Glob Runner 红、且红的是 runner 固化的 `cw-*-qa-smoke.sh` → 从 job 日志本脚本段里的 `FAIL: T-n` 定位失败条目，剔除后重新固化并推送（runner 署名提交），每个 PR 最多一次（`qa-<pr>.json` 的 `smoke_refit`，随状态镜像进 Brain）；smoke_note 追加「CI 首跑 Smoke Glob Runner 失败，剔除 T-n(ci_failed)」；已批准的改绑到新 head（不撤销、不重跑 QA）
- 不派 CI 修复会话（它无权改 smoke，只会撞 protected_path 升级），不计 CI 修复尝试
- 剔除后零固化：删脚本、撤 allowlist / write-targets 登记；PR 改了 API 面 → 撤销批准，升级 `qa_smoke_missing` 交 commander（决策 4fe863c3，同 C2b 口径）；没改 API 面 → 记「无回归 smoke」照常合并
- 已剔过一次仍红 / 日志定位不到 `FAIL: T-n` / 剔除失败 → 升级 `ci_fix_exhausted`（reason `qa_smoke_refit_exhausted` / `qa_smoke_fail_unlocated` / `qa_smoke_refit_failed:*`），`prompts/commander.md` 补裁法
- `lib/qa-smoke.mjs` 新增 `smokeCiFailures` / `dropSmokeBlocks` / `unregisterSmoke`；`cifix-scan.mjs` 抽出 `checkLog`（完整 job 日志），失败检查带 link
- 运行时口径：runner 每 300s 自更新到 origin/main，合并后下一轮起生效；只影响已固化 smoke 且 Smoke Glob Runner 红的 cw PR
