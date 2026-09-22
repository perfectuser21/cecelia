## Brain {VERSION} — 预览账本回写不再写死库名，失败不再当「非致命」

- `preview-env-start.sh` Step 7 把 `preview_environments` 的账本库名硬编码成 `cecelia`。预览自 2026-09-17 下放执行机后账本在 MMV 的 `cecelia_staging`，而 MMV 上没有 `cecelia` 库 → `FATAL: database "cecelia" does not exist`（实证 `/tmp/preview-5475.log:906`）。
- 该错误被 `|| log "⚠ DB 状态更新失败（非致命）"` 咽掉，脚本照样打印「✅ 预览环境启动完成」并退出 0。于是预览环境明明健康（PR#5475 实例 `:5305` health 正常），账本却永远停在 `starting`，CI 的 `wait-preview-active.sh` 干等 1200s 超时报红——**Deploy Preview Environment 长期假红的真根因**。
- 修法：①账本库改为 `LEDGER_DB="${PREVIEW_LEDGER_DB:-${DB_NAME:-cecelia}}"`，且**在 `DB_NAME` 被 `$4`（预览库名）覆盖之前**求值；②回写拆成 `scripts/preview-ledger-activate.sh`，`RETURNING` 计行，`UPDATE 0` 判失败；③调用改为裸调，靠 `set -euo pipefail` 令回写失败即终止，不再降级。
- 守卫 `packages/brain/scripts/smoke/preview-ledger-activate-smoke.sh` 拿真 postgres 跑，6 项变异全部被抓（含「换个措辞把失败吞掉」——第一版断言只 grep「非致命」这个词，被该变异当场打脸后改为钉控制流结构）。
