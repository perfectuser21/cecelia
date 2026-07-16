# Sprint PRD — G3 每日部署演习

- sprint_id: 07161700-deploy-daily-drill
- task_id: d71972e6-6a4f-4ca2-9541-1edb1b3f282b
- journey_type: nightly_drill
- target_environment: local_api
- 日期: 2026-07-16
- 前置: G1（SHA对账判变）✅ G2（漂移哨兵）✅

---

## Invariant 约束

从 PRD §4 铁律 + 系统全局 INV 加载：

| ID | 约束 |
|----|------|
| INV-01 | SHA 对账是唯一判变真相；禁引入任何"文件列表/路径过滤"类判据 |
| INV-02 | 蓝绿/pre-swap/post-deploy 现有机制一律保留不动 |
| INV-03 | 自动补部署必须沿用 brain-deploy.sh 全闸路径，禁旁路直切 |
| INV-04 | 测试禁 mock 真实外部命令行为（gh/docker 退出码语义必须真实复现）|
| INV-05 | GH API 失败时演习 skip（fail open），不假红 |
| INV-06 | 无 merge 的日子输出 no_merge_skip（诚实，不算绿、不算红）|
| INV-07 | 不另建 DB 表，deploy_records 来源仅用 GitHub Actions workflow runs API |
| INV-08 | 违约（merge 后 15min 内无成功部署且 SHA 匹配）→ 演习红 + Bark + incidents 落档 |

---

## 累积 FR（G3，编号从 FR-20 起）

| ID | 描述 | 验收断言 |
|----|------|---------|
| FR-20 | 编写 `scripts/smoke/e2e/deploy-daily-drill.sh`：查过去 24h merged 的 brain 相关 PR（`gh api /repos/.../pulls?state=closed&base=main`），与 brain-ci-deploy.yml workflow runs 时间线对账 | 脚本可独立运行，exit 0=绿/1=红/2=skip |
| FR-21 | 对账断言：每个 merge 后 15min 内必须有 conclusion=success 的 brain-ci-deploy 运行，且 head_sha 匹配该 PR 的 merge_commit_sha | fixture 测试覆盖正例和漏跑反例 |
| FR-22 | 演习红时触发 Bark 告警，内容含 PR 链接 + merge 时间 + 预期部署窗口 | Bark 调用可用环境变量 BARK_KEY 控开关 |
| FR-23 | 演习红/skip/绿均写 design_docs 表（type=diary）或 incidents 表（红时）落档 | 调 `POST localhost:5221/api/brain/design-docs` 或 incidents 端点 |
| FR-24 | 新建 `.github/workflows/deploy-daily-drill-nightly.yml`，cron `0 1 * * *`（UTC 01:00 = 北京 09:00），错开已有 nightly（03:00/04:30）| workflow 文件可 lint 通过，cron 表达式正确 |
| FR-25 | 挂载到现有 `.github/workflows/smoke-e2e-nightly.yml` 可选：以 `workflow_call` 或独立 workflow 均可，两种均不破坏现有 nightly | 两个 workflow YAML 均通过 `actionlint` |
| FR-26 | 先写 failing test：构造 fixture（merge 记录存在，无对应 deploy run）→ 断言脚本 exit 1（现版本无此脚本，test 必须 failing on first commit）| `packages/quality/tests/deploy-daily-drill.test.sh` 初始 failing 可复现 |
| FR-27 | 实弹验证：本 sprint 自身 PR merge 后，演习脚本在次日 09:00 nightly 断言该 merge 在 15min 内被 G1/G2 自动部署（全链首次实战）| nightly run 日志显示 GREEN 且 PR SHA 匹配 |
| FR-28 | `docs/current/README.md` 巡检表新增本演习行（G3 每日演习，nightly 09:00，deploy-daily-drill-nightly.yml）| 文件改动在同一 commit |
| FR-29 | `docs/current/SYSTEM_MAP.md` 交付轴段补录 G1/G2/G3 三件（SHA对账判变、漂移哨兵、每日演习）| SYSTEM_MAP 有「交付轴 Golden Path」段 |

---

## NFR

| ID | 约束 |
|----|------|
| NFR-01 | 脚本执行时间 ≤ 60s（GH API 调用加 timeout 10s，超时即 skip）|
| NFR-02 | 不污染 git 历史（不造无害 PR，只查 deploy record 时间线）|
| NFR-03 | 脚本无副作用副本（无 DB 写操作，除 FR-23 落档外）|
| NFR-04 | 全部新增文件纳入本 sprint 一次 PR，不分散提交 |

---

## 交付顺序

```
step-1  写 failing test (FR-26) → commit "test: failing deploy-daily-drill fixture"
step-2  实现 deploy-daily-drill.sh (FR-20/21/22/23) → test 转绿
step-3  新建 deploy-daily-drill-nightly.yml (FR-24/25)
step-4  更新 README + SYSTEM_MAP (FR-28/29)
step-5  PR merge → 等次日 09:00 实弹 (FR-27)
```

---

## Golden Path

（pre-merge evaluator gate 验证范围；E2E-05 实弹为 post-merge async，排除在外）

1. E2E-01：有 merge 且 15min 内有匹配 deploy run → exit 0，stdout 含 GREEN
2. E2E-02：merge 后 15min 内无 deploy run → exit 1，stdout 含 DRILL_RED
3. E2E-03：GH API 不可达（DRILL_GH_API_FAIL=1）→ exit 2，stdout 含 gh_api_error（fail open）
4. E2E-04：无 merge 的日子（DRILL_MOCK_MERGES=[]）→ exit 2，stdout 含 no_merge_skip
5. E2E-B6：nightly workflow cron 表达式为 0 1 * * *（UTC 01:00）
6. E2E-B7：guard probe — deploy-daily-drill.sh 存在且可执行（exit 0）

---

journey_type: nightly_drill
target_environment: local_api
