# Contract Draft — G3 每日部署演习

- sprint_id: 07161700-deploy-daily-drill
- task_id: d71972e6-6a4f-4ca2-9541-1edb1b3f282b
- contract_version: v1.0
- 日期: 2026-07-16

---

## 能力承诺

基于 FR-20..FR-29，本 sprint 承诺交付以下可验证能力：

| FR | 能力承诺 | 验收断言 |
|----|---------|---------|
| FR-20 | `scripts/smoke/e2e/deploy-daily-drill.sh` 可独立运行，查过去 24h 内 merged 的 brain 相关 PR 并与 brain-ci-deploy workflow runs 对账 | exit 0=绿 / exit 1=红 / exit 2=skip，三路均有测试覆盖 |
| FR-21 | 每个 merge 后 15min 内必须有 conclusion=success 的 brain-ci-deploy 运行，且 head_sha 与 merge_commit_sha 匹配 | fixture 覆盖正例（匹配→exit 0）和漏跑反例（无 run→exit 1）|
| FR-22 | 演习红时触发 Bark 告警，内容含 PR 链接 + merge 时间 + 预期部署窗口 | 环境变量 `BARK_KEY` 为空时静默跳过，不影响 exit 码 |
| FR-23 | 演习红时 POST `localhost:5221/api/brain/incidents` 落档；绿/skip 写 design_docs（type=diary）| incidents 表有记录，字段含 PR SHA + merge 时间 |
| FR-24 | `.github/workflows/deploy-daily-drill-nightly.yml`，cron `0 1 * * *`（UTC 01:00 = 北京 09:00） | workflow 文件通过 actionlint，cron 表达式正确 |
| FR-25 | 独立 workflow，不破坏已有 nightly（03:00/04:30） | 两个 workflow YAML 均通过 actionlint |
| FR-26 | 先写 failing test：fixture 构造 merge 存在但无 deploy run → 断言脚本 exit 1 | 初始 commit 时 test FAIL（脚本不存在），实现后转绿 |
| FR-27 | 本 sprint PR merge 后次日 09:00 nightly 实弹验证：演习脚本断言该 merge 在 15min 内被自动部署 | nightly run 日志 GREEN，PR SHA 匹配 |
| FR-28 | `docs/current/README.md` 巡检表新增 G3 每日演习行 | 文件改动在同一 commit |
| FR-29 | `docs/current/SYSTEM_MAP.md` 交付轴段补录 G1/G2/G3 三件 | SYSTEM_MAP 含「交付轴 Golden Path」段 |

### INV 约束合规声明

| INV | 遵守方式 |
|-----|---------|
| INV-01 | SHA 对账使用 merge_commit_sha vs head_sha，无路径过滤 |
| INV-02 | 蓝绿/pre-swap/post-deploy 机制零接触 |
| INV-03 | 演习脚本只读检查，不触发补部署（由 G2 哨兵负责） |
| INV-04 | 测试 fixture 用环境变量注入，不 mock gh/docker 退出码 |
| INV-05 | GH API 失败（超时/网络不通）→ exit 2，不假红 |
| INV-06 | 无 merge 日子输出 `no_merge_skip` + exit 2 |
| INV-07 | 不建 DB 表，deploy_records 仅用 GH Actions workflow runs API |
| INV-08 | 违约（merge 后 15min 内无成功部署且 SHA 匹配）→ exit 1 + Bark + incidents 落档 |

---

## E2E 验收

### E2E-01：有 merge 的日子，且 15min 内有匹配 deploy run → exit 0（绿）

**前提条件**：
- 过去 24h 内存在 brain 相关 PR merge 记录
- 对应 merge_commit_sha 在 merge 后 15min 内有 brain-ci-deploy workflow run，conclusion=success，head_sha 匹配

**执行方式**：
```bash
DRILL_MOCK_MERGES='[{"number":1,"merge_commit_sha":"abc1234","merged_at":"<2h前>","title":"feat: test"}]' \
DRILL_MOCK_RUNS='[{"head_sha":"abc1234","conclusion":"success","created_at":"<1h59min前>"}]' \
bash scripts/smoke/e2e/deploy-daily-drill.sh
```

**断言**：exit code = 0，stdout 含 `GREEN` 或 `drill_pass`

---

### E2E-02：merge 后 15min 内无 deploy run → exit 1（红，演习红）

**前提条件**：
- 过去 24h 内存在 brain 相关 PR merge 记录
- 无对应 head_sha 匹配的成功 deploy run（时间窗内）

**执行方式**：
```bash
bash sprints/07161700-deploy-daily-drill/tests/deploy-daily-drill.test.sh 2>&1 | tail -20
```

**断言**：
1. `deploy-daily-drill.sh` exit code = 1
2. stdout 含 `DRILL_RED` 或 `drill_fail`
3. Bark 通知被调用（BARK_KEY 非空时）
4. `POST /api/brain/incidents` 被调用（Brain 可达时）

---

### E2E-03：GH API 不可达 → exit 2（skip，fail open）

**前提条件**：注入 `DRILL_GH_API_FAIL=1` 模拟 GH API 失败

**执行方式**：
```bash
DRILL_GH_API_FAIL=1 bash scripts/smoke/e2e/deploy-daily-drill.sh
```

**断言**：exit code = 2，stdout 含 `gh_api_error` 或 `skip`，不触发 Bark/incidents

---

### E2E-04：无 merge 的日子 → exit 2（no_merge_skip）

**前提条件**：过去 24h 内无 brain 相关 PR merge

**执行方式**：
```bash
DRILL_MOCK_MERGES='[]' bash scripts/smoke/e2e/deploy-daily-drill.sh
```

**断言**：exit code = 2，stdout 含 `no_merge_skip`

---

### E2E-05：实弹验证（本 sprint PR merge 后次日演习绿）

**前提条件**：
- 本 sprint PR 已 merge 到 main
- G1/G2 自动部署链路在 15min 内完成部署
- UTC 01:00 nightly workflow 触发

**执行方式**：等待 `deploy-daily-drill-nightly.yml` 次日自动触发

**断言**：
1. GitHub Actions nightly run status = success
2. run 日志中本 sprint PR 的 merge_commit_sha 被识别
3. 对应 brain-ci-deploy run 在 15min 窗内，SHA 匹配
4. 日志含 `GREEN` / `drill_pass`

---

## Test Contract

| 工作流 | Test File | BEHAVIOR 覆盖 | 预期红色证据 |
|--------|-----------|--------------|------------|
| G3-drill | `../../tests/regression/deploy-daily-drill/deploy-daily-drill.test.js` | B7: deploy-daily-drill.sh 存在/B2: merge 后 15min 内无 deploy run → exit 1/B3: GH API 不可达 → exit 2 fail open/B4: 无 merge 的日子 → exit 2 + stdout 含 no_merge_skip | B7 FAIL when deploy-daily-drill.sh absent（初始 Red commit d5883f01b 验证） |

---

## 未覆盖真实链路清单

以下项目使用 mock/fixture 而非真实外部依赖，豁免原因如下：

| 项目 | 豁免方式 | 豁免原因 |
|------|---------|---------|
| GitHub API（PR list / workflow runs）| 环境变量注入 DRILL_MOCK_MERGES / DRILL_MOCK_RUNS | CI 环境无真实 GH API 权限；E2E-05 实弹覆盖真实链路 |
| Bark 推送 | BARK_KEY 为空时静默跳过 | 测试环境无真实 Bark endpoint；E2E-05 实弹时 BARK_KEY 注入 |
| Brain incidents API | Brain 可达性由 BRAIN_URL 控制；测试中不验证实际落档 | 单元测试阶段 Brain 未必启动；E2E-05 实弹时 Brain 真实运行 |

**非 mock 部分**（必须真实）：
- exit code 语义（0/1/2）：测试直接验证真实 bash exit code，不 mock
- SHA 对账逻辑：fixture 数据经过真实脚本逻辑处理，不绕过
- 15min 时间窗计算：使用真实时间差计算，fixture 构造的时间戳需精确

---

## 运行时守卫

probe: deploy-daily-drill-health

```bash
# 守卫探针：确认演习脚本存在且可执行（nightly_drill 无持续服务，以脚本可执行性为健康指标）
test -x scripts/smoke/e2e/deploy-daily-drill.sh && echo "ok" && exit 0 || exit 1
```
