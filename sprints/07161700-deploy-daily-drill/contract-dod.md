# Contract DoD — G3 每日部署演习

- sprint_id: 07161700-deploy-daily-drill
- task_id: d71972e6-6a4f-4ca2-9541-1edb1b3f282b
- contract_version: v1.0
- 日期: 2026-07-16

---

## [BEHAVIOR] 行为规约

[BEHAVIOR] B1: deploy-daily-drill.sh 有 merge 且 deploy 成功且 SHA 匹配 → exit 0
- 触发条件：过去 24h 内有 brain 相关 PR merge，且对应 merge_commit_sha 在 15min 内有 conclusion=success 的 brain-ci-deploy run，head_sha 匹配
- 期望输出：exit 0，stdout 含 `GREEN` 或 `drill_pass`
- 验证方式：fixture T2_green（DRILL_MOCK_RUNS 含匹配 SHA）→ exit 0

[BEHAVIOR] B2: deploy-daily-drill.sh merge 后 15min 内无 deploy run → exit 1 且调 Bark
- 触发条件：过去 24h 内有 merge，但 15min 窗内无 head_sha 匹配的成功 deploy run
- 期望输出：exit 1，stdout 含 `DRILL_RED`；BARK_KEY 非空时发送 Bark 通知（含 PR 链接 + merge 时间 + 预期部署窗口）
- 验证方式：fixture T2（DRILL_MOCK_RUNS=[]，DRILL_MOCK_MERGES 含最近 merge）→ exit 1

[BEHAVIOR] B3: GH API 不可达 → exit 2（fail open，不假红）
- 触发条件：DRILL_GH_API_FAIL=1 或 gh api 调用超时（>10s）
- 期望输出：exit 2，stdout 含 `gh_api_error` 或 `skip`
- 验证方式：fixture T4（DRILL_GH_API_FAIL=1）→ exit 2，不触发 Bark/incidents

[BEHAVIOR] B4: 无 merge 的日子 → exit 2 且 stdout 含 no_merge_skip
- 触发条件：过去 24h 内无 brain 相关 PR merge
- 期望输出：exit 2，stdout 必须含字符串 `no_merge_skip`
- 验证方式：fixture T3（DRILL_MOCK_MERGES=[]）→ exit 2，grep no_merge_skip

[BEHAVIOR] B5: 演习红时 POST /api/brain/incidents 落档
- 触发条件：B2 触发（exit 1）
- 期望输出：向 `$BRAIN_URL/api/brain/incidents` 发 POST，body 含 `{ type: "deploy_drill_red", pr_sha, merged_at, expected_window }`
- 验证方式：Brain 可达时检查 incidents 表有新记录；Brain 不可达时跳过（不影响 exit 码）

[BEHAVIOR] B6: nightly workflow 每天 UTC 01:00 触发，cron 表达式正确
- 触发条件：`.github/workflows/deploy-daily-drill-nightly.yml` 被创建
- 期望输出：cron 字段为 `0 1 * * *`，不与已有 nightly（03:00/04:30 UTC）冲突
- 验证方式：`grep 'cron:' .github/workflows/deploy-daily-drill-nightly.yml | grep '0 1 \* \* \*'`

[BEHAVIOR] B7: failing test fixture 初始 CI red（脚本不存在时 exit 1）
- 触发条件：`scripts/smoke/e2e/deploy-daily-drill.sh` 不存在
- 期望输出：`tests/deploy-daily-drill.test.sh` 运行后 FAIL_COUNT >= 1，整体 exit 1
- 验证方式：第一个 commit 时 CI 运行 test → red（T1 FAIL）；实现后转绿

---

## manual:bash 验收命令

```bash
manual:bash: bash sprints/07161700-deploy-daily-drill/tests/deploy-daily-drill.test.sh 2>&1 | tail -20
```

---

## DoD Checklist

### 代码产物

- [ ] `scripts/smoke/e2e/deploy-daily-drill.sh` 存在且可执行（chmod +x）
- [ ] 脚本支持环境变量 `DRILL_MOCK_MERGES` / `DRILL_MOCK_RUNS` / `DRILL_GH_API_FAIL` 用于测试注入
- [ ] 脚本支持 `BRAIN_URL` 环境变量（默认 `http://localhost:5221`）
- [ ] 脚本支持 `BARK_KEY` 环境变量（为空时静默跳过 Bark）
- [ ] exit 码语义正确：0=绿 / 1=红 / 2=skip
- [ ] GH API 调用带 `--timeout 10` 或等效超时保护（NFR-01）

### 测试

- [ ] `sprints/07161700-deploy-daily-drill/tests/deploy-daily-drill.test.sh` 存在
- [ ] 初始 commit 时 T1 FAIL（B7 验证）
- [ ] 实现后 T1/T2/T3/T4 全部 PASS
- [ ] `manual:bash` 命令可在本地复现

### workflow

- [ ] `.github/workflows/deploy-daily-drill-nightly.yml` 存在
- [ ] cron 表达式为 `0 1 * * *`（B6 验证）
- [ ] workflow 通过 `actionlint`（FR-24/25）
- [ ] 不破坏现有 smoke-e2e-nightly.yml

### 落档

- [ ] 演习红时 POST /api/brain/incidents（B5 验证）
- [ ] 演习绿/skip 时写 design_docs（type=diary）

### 文档

- [ ] `docs/current/README.md` 巡检表新增 G3 每日演习行（FR-28）
- [ ] `docs/current/SYSTEM_MAP.md` 交付轴补录 G1/G2/G3（FR-29）

### 实弹验证

- [ ] 本 sprint PR merge 后次日 09:00（北京）nightly run 状态 = success（E2E-05）
- [ ] nightly run 日志含 `GREEN`，本 sprint PR SHA 匹配（FR-27）

### INV 合规

- [ ] INV-01：仅用 SHA 对账，无路径过滤
- [ ] INV-04：测试不 mock gh/docker 退出码（用环境变量注入 fixture 数据）
- [ ] INV-05：GH API 失败 → exit 2，不假红
- [ ] INV-06：无 merge → exit 2 + no_merge_skip
- [ ] INV-07：不建 DB 表，仅用 GH API
- [ ] INV-08：违约 → exit 1 + Bark + incidents 落档

### INV 合规声明

- [x] INV-01: 对账脚本纯只读，不引入任何路径过滤判据，仅查 GH workflow run SHA 匹配（非路径判变）
- [x] INV-02: 本 sprint 不修改蓝绿/pre-swap/post-deploy 机制（bluegreen.sh 未改动，仅查 deploy 结果）
- [x] INV-03: 本 sprint 不调用 brain-deploy.sh，仅读取 deploy 时间线记录；补部署责任归 G2 drift-sentinel
- [x] INV-04: 测试 fixture 通过环境变量注入 mock 数据，不 mock 真实 gh/docker 调用（脚本走真实 GH API）
- [x] INV-05: GH API 失败 → exit 2 skip，fail open（B3 覆盖）
- [x] INV-06: 无 merge 的日子 → no_merge_skip（B4 覆盖）
- [x] INV-07: deploy_records 来源仅 GitHub Actions workflow runs API，不建 DB 表
- [x] INV-08: 违约 → exit 1 + Bark + incidents 落档（B2/B5 覆盖）
