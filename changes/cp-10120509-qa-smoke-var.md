## Brain {VERSION} — coding workflow 回归 smoke 生成器识别「预览地址先赋给变量」写法

- `lib/qa-smoke.mjs` 新增 `targetsPreviewApi` / `previewApiSkipReason` / `selectQaSmokeItems`：收字面量 `<预览地址>/api/`，也收 `B=<预览地址>; curl "$B/api/…"`（`export B='…'`、`${B}` 同样认）
- 剔除并写明原因：`browser`（开浏览器）、`production`（复用 qa-report 导出的 `PRODUCTION_TARGET_RE` / `PRODUCTION_ASSIGN_RE`）、`other_port`（打本机其他端口）、`local_path`（依赖 /Users、/tmp、cd / 等本机路径）、`not_preview`
- `buildQaSmoke` 返回值加 `skipped: [{id, reason}]`；runner QA 门的 `smoke_note` 追加「剔除 T-n(原因)」
- 运行时口径：runner 每 tick 自更新到 origin/main，合并后下一轮 QA 通过的 PR 即按新口径固化（未含预跑与 smoke_missing 升级，另见 C2b）
