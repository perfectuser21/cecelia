# 小改动 PrepPRD：刀C全家——锚点回填四件套

## 改什么

四个独立子项，同一 PR：

1. **apply器**（新脚本 `scripts/anchor/apply-anchors.js`）：读 `docs/proposals/anchor-approved-20260719.json`（本 PR 一并生成，从已批阅的 `anchor-approved-20260719.md` 派生为机器可读格式），逐条对 `journey_features` 走 `PATCH /api/brain/journey_features/:id` 写 `unit_test_path`/`workflow_ref`/`guard_ref`。支持 `--dry-run`（只打印 diff 不写）。审计不建新表——`decisions` 表里已有本批锚点的裁决记录（id `1e153663-c2fb-4823-b313-ddb6e06b3210`），apply器执行后把"实际写入了哪些 id/字段"打印到 stdout + 落一份 `$SPRINT_DIR/apply-anchors-result.json`，作为本次执行的留痕。

2. **锚点哨兵**（新脚本 `scripts/patrol/anchor-sentinel.sh` + 复用 `packages/brain/src/lib/graph-query.js` 的 `classifyFeatureAnchors()`）：nightly（05:00 LA，接在 `run-all-scans.sh` 后面）跑一遍全量 `journey_features` 分类，统计 `unanchored + uncovered` 的"断锚数"。断锚数只许降不许升的棘轮：状态文件记上次断锚数（沿用 `rescan-if-changed.sh` 的 `/tmp` 状态文件约定），本次 > 上次 → 调 `POST /api/brain/harness/notify`告警（沿用 `main-repo-sentinel.sh` 的 `notify()` 写法），≤ 上次 → 静默更新状态文件。

3. **出生即焊**（改 `packages/brain/src/routes/journeys.js` 的 `POST /journey_features` handler）：新建 feature 时，若 `status` 非空且不等于 `'planned'`（即声明"已经在实现/已完成"），必须至少带一个锚点字段（`unit_test_path`/`workflow_ref`/`guard_ref`）非空，否则 400。`status` 为空或 `'planned'`（骨架阶段，代码还没写）不强制——这是刻意的口子，不是漏洞：骨架 feature 天然没有代码可锚。同步给 `packages/engine/skills/dev/scripts/add-feature.js` 加 `--workflow-ref`/`--guard-ref` 透传参数（目前只透传了 `--unit-test-path`）。

4. **merge自动焊**（改 `packages/brain/scripts/harness-report.mjs`）：Sprint 完成 PATCH `journey_features` 状态那一步（S6，现有代码）之后，若该 sprint 的 `task.payload.feature_id` 对应的 feature 当前 `unit_test_path`/`workflow_ref`/`guard_ref` 三者皆为 null，用本次 PR 的 changed files 里匹配 `*.test.*`/`*.spec.*` 的文件路径回填 `unit_test_path`；只在原字段为 null 时才写（不覆盖已有的人工/apply器焊过的锚点，防止新 sprint 意外抹掉更精确的历史锚点）。

## 为什么改

锚点回填提案（`docs/proposals/anchor-proposal-20260719.md`）主理人已批阅授权 AI 逐行裁决（`decisions` id `1e153663`），批准清单已定稿（`docs/proposals/anchor-approved-20260719.md`，30 条待写库）。但这只解决"存量"；不建四件套，锚点会变成第二本死账——新 feature 继续裸奔创建、sprint merge 后无人回填、断锚发生也没人知道。四件套让存量回填一次性生效、增量从此自动化。

## 关联上下文

- 提案：`docs/proposals/anchor-proposal-20260719.md`
- 批准清单：`docs/proposals/anchor-approved-20260719.md`
- 决策记录：`decisions` 表 id `1e153663-c2fb-4823-b313-ddb6e06b3210`
- 总交接单：`docs/handoffs/202607190102-session-master-handoff.md`（"新 session 第一个动作"第 2 条即本任务）
- 复用的既有机制：`classifyFeatureAnchors()`（`packages/brain/src/lib/graph-query.js`）、`registry-freshness.js` 的账龄判定模式、`main-repo-sentinel.sh` 的 `notify()` 告警写法、`GET /journey_features/unguarded-count` 的"危险状态无锚点"查询先例

## 影响范围

- `packages/brain/src/routes/journeys.js`：POST /journey_features 加校验分支，不影响现有字段为 planned 的创建路径
- `packages/brain/scripts/harness-report.mjs`：S6 之后追加一步，读 payload.feature_id + PR changed files，失败不阻断（try/catch 包裹，锚点回填失败不能让整个 harness-report 收尾失败）
- `packages/engine/skills/dev/scripts/add-feature.js`：新增两个可选参数，向后兼容（不传就是 null，跟现状一致）
- 新增两个独立脚本（apply器一次性 + 哨兵 cron），不影响任何现有代码路径
- crontab 新增一行（05:00 LA，紧跟 run-all-scans.sh 之后）

## 验收标准

- [ ] apply器 `--dry-run` 跑一遍打印 30 条计划更新，不改库
- [ ] apply器去掉 `--dry-run` 实际执行，psql 查 `journey_features` 验证 30 条 `unit_test_path`/`workflow_ref`/`guard_ref` 已写入且匹配 approved 清单
- [ ] 锚点哨兵脚本单独跑一次，输出当前断锚数（应显著下降，因为 30 条已焊）；故意造一次"断锚数上升"场景（本地拿一条已焊 feature 的锚点字段置空模拟）验证 proven-to-fire 真的调用 notify 告警
- [ ] `POST /journey_features` 不带锚点 + `status:'working'` → 400；不带锚点 + `status:'planned'`（或不传 status）→ 正常创建（regression test 覆盖两个分支）
- [ ] harness-report.mjs 锚点回填逻辑单元测试：mock 一个 feature_id 对应 anchor 全 null 的场景，验证会用 changed_files 里的 test 文件路径回填；mock 一个已有锚点的场景，验证不会被覆盖
- [ ] CI 全绿
