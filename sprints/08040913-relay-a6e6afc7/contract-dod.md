---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: ledger-hygiene m7「自主循环零产出」探针可信化

**范围**: `packages/brain/src/ledger-hygiene.js` m7 capture 子探针统计口径（北京昨日自然日确定性窗口 + 自产 atom 排除 + organic/self 分解）与三个新导出（`getM7CaptureWindow` / `LEDGER_SELF_ATOM_PREFIX` / `computeMetrics(pool, now?)` 第二参）；合同 tests/ 两个测试文件原样落位 `packages/brain/src/__tests__/`（integration 版进 `integration/` 并登记 `POSTGRES_INTEGRATION_TESTS`）。**不改**：strategist 子探针、m1-m6、棘轮机制（evaluateRatchet）、raiseBreachAlerts 击穿标题与 issue/capture push 通路、未激活降级行为。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] 合同单测按原样落位（CONTRACT IS LAW，逐字节一致）`packages/brain/src/__tests__/ledger-hygiene-m7-organic.test.js`
  Test: node -e "const f=require('fs');const a=f.readFileSync('sprints/08040913-relay-a6e6afc7/tests/ledger-hygiene-m7-organic.test.js','utf8');const b=f.readFileSync('packages/brain/src/__tests__/ledger-hygiene-m7-organic.test.js','utf8');if(a!==b)process.exit(1)"

- [x] [ARTIFACT] 合同集成测试按原样落位 `packages/brain/src/__tests__/integration/ledger-hygiene-m7-organic.integration.test.js`
  Test: node -e "const f=require('fs');const a=f.readFileSync('sprints/08040913-relay-a6e6afc7/tests/ledger-hygiene-m7-organic.integration.test.js','utf8');const b=f.readFileSync('packages/brain/src/__tests__/integration/ledger-hygiene-m7-organic.integration.test.js','utf8');if(a!==b)process.exit(1)"

- [x] [ARTIFACT] 集成测试已登记进 `vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`（brain-unit 排除、brain-integration 真 PG 永跑）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');const i=c.indexOf('POSTGRES_INTEGRATION_TESTS');if(i<0||!c.slice(i).split('];')[0].includes('integration/ledger-hygiene-m7-organic.integration.test.js'))process.exit(1)"

- [x] [ARTIFACT] `ledger-hygiene.js` 含三个新导出且 capture 计数不再挂 24h 滑动窗
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/ledger-hygiene.js','utf8');if(!c.includes('getM7CaptureWindow')||!c.includes('LEDGER_SELF_ATOM_PREFIX'))process.exit(1);if(/capture_atoms[^;]{0,300}NOW\(\)\s*-\s*INTERVAL '24 hours'/s.test(c))process.exit(1)"

## BEHAVIOR 条目（journey_type = autonomous，真 Postgres 场景 oracle，内嵌可执行 manual: 命令）

> 前置：本机 Postgres 可达（`$DB` 缺省 `postgresql://localhost/cecelia`）；`packages/brain` 已 `npm ci`。
> 各场景由 `sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs` 在**一次性独立 schema** 内建最小表、种 atom、跑**真实实现** `computeMetrics`、断言后 DROP SCHEMA；期望窗口由 runner 按北京日历日**独立推导**（不复用实现窗口函数），实现一行未写时 runner 必 FAIL（无 mock、无 exit 0 兜底）。

- [x] [BEHAVIOR] 昨日北京自然日内 1 有机 + 1 自产 atom → m7.value organic=1 / self=1 / captureDebt=0，debt=0 不误报（Golden Path Step 3，PRD 验收点 2）
  Test: manual:bash -c 'node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs organic-self'
  期望: exit 0，末行 OK scenario=organic-self

- [x] [BEHAVIOR] 昨日仅守卫自产 atom → organic=0 / captureDebt=1，debt=1 真零产出仍击穿，不被自产 atom 假绿（Golden Path Step 3，PRD 验收点 3）
  Test: manual:bash -c 'node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs only-self'
  期望: exit 0，末行 OK scenario=only-self

- [x] [BEHAVIOR] 窗口边界确定性：昨日 23:59:59 计入、今日 00:00:00 不计入、前日 23:59:59 不计入（4 枚边界 atom 仅计 2 organic）（Golden Path Step 2，PRD 边界情况 L29）
  Test: manual:bash -c 'node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs boundary'
  期望: exit 0，末行 OK scenario=boundary

- [x] [BEHAVIOR] 运行时刻偏移 ±60 秒真库重算，m7 结果逐字节不变，且 getM7CaptureWindow 界值与独立推导的北京昨日窗口一致（Golden Path Step 2，PRD 验收点 4）
  Test: manual:bash -c 'node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs drift'
  期望: exit 0，末行 OK scenario=drift

- [x] [BEHAVIOR] error path — capture_atoms 表不存在且 strategist 无记录 → m7 保持既有未激活降级（enabled=false / debt=0），不 throw（Golden Path Step 4，PRD 边界情况 L31）
  Test: manual:bash -c 'node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs no-table'
  期望: exit 0，末行 OK scenario=no-table

- [x] [BEHAVIOR] 合同回归测试转绿 + 既有 ledger-hygiene / scheduler-jobs 套件零回退（m1-m6 与 strategist 行为不变）（Golden Path Step 1/5，PRD 验收点 1/5）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/__tests__/ledger-hygiene-m7-organic.test.js src/__tests__/ledger-hygiene-m7.test.js src/__tests__/ledger-hygiene.test.js src/__tests__/scheduler-jobs.test.js --reporter=verbose 2>&1 | tail -25; [ "${PIPESTATUS[0]}" -eq 0 ] && echo OK || exit 1'
  期望: OK（0 failed）

- [x] [BEHAVIOR] 真 Postgres 集成测试全绿（禁 mock 边执法：代码 ↔ capture_atoms 的窗口/分类 SQL 语义在真库验证）（Golden Path Step 2/3）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --config vitest.integration.config.js src/__tests__/integration/ledger-hygiene-m7-organic.integration.test.js --reporter=verbose 2>&1 | tail -20; [ "${PIPESTATUS[0]}" -eq 0 ] && echo OK || exit 1'
  期望: OK（4/4 绿）

- [x] [BEHAVIOR] INV-3 [真环境验证] 接缝断言（时区窗口 SQL 语义）已在真目标（真 Postgres）验证而非仅 mock 绿——drift 场景真库重跑作为铁律覆盖锚点
  Test: manual:bash -c 'node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs drift && node sprints/08040913-relay-a6e6afc7/tests/m7-e2e-runner.mjs boundary'
  期望: exit 0，两场景均输出 OK

## 铁律清单映射（Step 1.3 — 每条铁律 INV 条目或显式 N/A）

- INV-1 [单slot串行] N/A：本 sprint 不触及任务派发/slot 并行逻辑。
- INV-2 [禁写死环境假设] 窗口界从 IANA `Asia/Shanghai` 日历日推导（getM7CaptureWindow），无写死时刻/坐标/偏移值 → 由上方 boundary / drift 两条 [BEHAVIOR] 真库覆盖。
- INV-3 [真环境验证] → 上方独立 [BEHAVIOR] INV-3 条目 + integration 测试进 brain-integration 真 PG 永跑。
- INV-4 [测试多租户] N/A：capture_atoms 无租户列，本 sprint 未引入任何跨租户读写（豁免条件符合 PRD L64）。
- INV-5 [凭据安全] N/A：无新增凭据；测试/runner 的 DB 连接串仅走环境变量，无硬编码密码。
- INV-6 [日志脱敏] N/A：m7 仅统计计数，不将 atom content 写入日志或日报（日报只含数字分解）。
- INV-7 [端点鉴权] N/A：本 sprint 不新增任何 API 端点（PRD L67）。
- INV-8 [租户隔离] N/A：不碰租户数据。
- INV-9 [字段语义重叠] 已本 sprint 内消解：organic/self 为窗口计数、captureDebt 为击穿位，语义不重叠且合同以「value keys 恒定」硬约束锁死（见 contract-draft Response Schema 段）。
- INV-10 [payload真源] N/A：本 sprint 不注册新任务；target_environment=local_api 已由 PRD/task-plan 声明。
- INV-11 [judge格式] 由 proposer 侧 `.brain-result.json` 输出协议满足（顶层字段齐备），交付物本身不产 judge 结果。
- INV-12 [theater检查] N/A：合同文本不含 android 关键词，不触发 theater 不匹配。
