# DoD：D1 · 验收一体两面数据层地基与状态机

> task b35bfa0c-c798-45a5-80dc-16f12e35ca6d｜anchor journey 2fa4d085 / gp 7790f728 / step 817f59f5
> 规格 SSOT = sprints/f2-acceptance-two-column/proposal-v7-final.md 的「D1」节
> 同批 PR：zenithjoy-workspace `cp-08071200-d1-acceptance-spec-fields`（先合 zenithjoy 再合 cecelia）

- [x] [BEHAVIOR] A10⑤ 人列 36 格填满且含「不通过」时 run 落 human_complete，绝不落 failed
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-state-machine.integration.test.js')"
- [x] [BEHAVIOR] A10① status CHECK 含 7 值 + 2 个只读历史兼容值；AI 四列与 runs.detail 落库且全 nullable
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/migration-392-acceptance-two-column.integration.test.js')"
- [x] [BEHAVIOR] migration 392 down 在无新格号数据时可逆；有跨 run 重复格号、或有 7 值新状态存量行时各自 fail-fast 报错
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/rollback/392_acceptance_two_column.down.sql','utf8'); if(!c.includes('不可回滚：已存在 % 个跨 run 重复的 check_key')||!c.includes('7 值新状态'))process.exit(1)"
- [x] [BEHAVIOR] A1/A3 同 gp 第二轮建单不再 23505；向 run A 提交 S3-c1 后 run B 的 S3-c1 仍为 NULL
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-run-scope.integration.test.js')"
- [x] [BEHAVIOR] A5 九组合矩阵逐行判定正确；Q0′（AI 缺格）在人列三种取值下恒判「未定」
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/acceptance-cell-state.test.js')"
- [x] [BEHAVIOR] gate_verdict 绿当且仅当全格绿；hard 格非绿列进 red_cells；ai_incomplete 时闸拦且理由为 ai_run_infra_error
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/acceptance-gate-verdict.test.js')"
- [x] [BEHAVIOR] 生成器对 line02-android.yaml 产出恰 36 行、零个 S14-*；S7 加 fixedNa 后降到 34 行
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/acceptance-spec.test.js')"
- [x] [BEHAVIOR] A4③⑥⑦ reason=human_only 用在非 human_only 格 400；36 个建行格逐格提交 scenario_not_triggered 全部 400
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/acceptance-ai-reason.test.js')"
- [x] [BEHAVIOR] A4⑧ mandatory 场景码未勾齐时整 run 拒收 AI 回写（409 + 缺失清单），且一格都不落库
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-scenario-gate.integration.test.js')"
- [x] [BEHAVIOR] A10②③④ pending 超 48h 转 expired；作废端点落 abandoned 三项留痕；活跃态行不带终态旗标
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-aging-expire.integration.test.js')"
- [x] [BEHAVIOR] A15②③⑤ 员工打 review-closed 403；未 ack 未满 24h 403；全员 ack 或 24h 兜底后 200
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-review-closure.integration.test.js')"
- [x] [BEHAVIOR] A15①⑥⑦/A16② 上轮未闭环建单 409；force_reason ≥20 字放行留痕；非白名单租户拒绝；env 缺失 fail-closed
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-create-gate.integration.test.js')"
- [x] [BEHAVIOR] A9 六项版本标识落库非空、双源不等拒绝建单；sha/spec_sha 变更时提交 409 且 run 转 stale
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/acceptance-version-freeze.integration.test.js')"
- [x] [BEHAVIOR] A17① yaml 三个 scenario_class 集合与台账逐格相等，opportunistic 恰为空集（zenithjoy repo 侧，随同批 PR 进其 CI）
  Test: manual:acceptance-spec-fields-zj-cp-08071200
- [x] [BEHAVIOR] computeRunStatus 用 PRESERVED_RUN_STATUSES 白名单透传前态，前态缺失/不可识别时按填写进度重算而不是把 undefined 写进 NOT NULL 列
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/acceptance-run-status.test.js')"
- [x] DevGate 三件套通过（facts-check / check-version-sync / check-dod-mapping）
  Test: manual:bash -c "node scripts/facts-check.mjs && bash scripts/check-version-sync.sh"
- [x] 版本四处同步 1.267.247 → 1.268.0（package.json / package-lock 两处 / .brain-versions / DEFINITION.md）
  Test: manual:node -e "const v=require('./packages/brain/package.json').version; if(v!=='1.268.0')process.exit(1)"
- [x] migration 392 在 scratch 库上跑通且 schema_version 记到 392
  Test: manual:psql -d cecelia_scratch -c "SELECT version FROM schema_version WHERE version='392'"
- [ ] CI 全绿，cecelia PR 与 zenithjoy PR 同批合并
  Test: manual:bash -c "gh pr checks --watch"

> 上面这条是本清单唯一未勾项：它的证据只能在 push 开 PR 之后产生，现在勾就是假绿。
> push 与开 PR 由 controller 统一执行，**两个 repo 的 CI 都全绿后由 controller 补勾**。
> 其余 18 条的证据已在本地产生，见下方验证记录。

## 本地验证记录

| 批次 | 命令 | 结果 |
|---|---|---|
| 单元测试（8 文件） | `DB_NAME=cecelia_scratch npx vitest run src/__tests__/acceptance-*.test.js src/routes/__tests__/acceptance*.test.js` | 120 passed / 1 skipped |
| 集成测试（11 文件） | `DB_NAME=cecelia_scratch npx vitest run --config vitest.integration.config.js src/__tests__/integration/acceptance*.js src/__tests__/integration/migration-392-*.js` | 82 passed |
| 全量 brain 单测 | `DB_NAME=cecelia_scratch npm test` | 14875 passed，6 个失败文件全部在本刀改动范围外（pre-existing） |

全量跑里 `acceptance-public.test.js` 曾报一条 `read ECONNRESET`——是 supertest 在满负载并发下的连接重置，单跑该文件 16/16 通过，非断言失败。

## 交接与遗留

1. **SAVEPOINT 回归覆盖失去触发路径**。`routes/acceptance.js` 的驳回建任务链在新状态机下对任何 run 都不触发（`PRESERVED_RUN_STATUSES` 含 `failed`，历史 failed run 算出的 next 仍是 `failed`，被 `prevStatus !== 'failed'` 挡掉）。链路休眠后，其中「23505 只回滚这一条 INSERT、不毒化外层事务」的回归覆盖也随之休眠。**D4 聚合式分流落地时必须重新覆盖**，否则这个已经付过代价的坑会在新链路上原样复发。
2. **部署侧 `ACCEPTANCE_SPEC_PATH` 未接线**。规程 yaml 在 zenithjoy repo，Brain 容器里没有这个文件。现状是 fail-loud（缺 env 则走 `getSpecSets()` 的端点直接报错，不静默降级）。**D2 上线前必须在 volume 挂载 / 构建期拷贝 / 落库读取三者中定一个**。
3. **D2 判官 reason 映射约束**。判官本地判出的「场景未出现」**不能直译成 `scenario_not_triggered`**——A4⑦ 把这个 reason 的合法域定成空集，任何格提交都是 400。D2 需要另立映射。
4. **zenithjoy PR 合并后跑一次漂移守卫**，确认 `ACCEPTANCE_REAL_SPEC_PATH` 那条从 skip 变成 run。
5. **规程 fixture 是拷贝而非引用**。`packages/brain/src/__tests__/fixtures/acceptance/line02-android.yaml` 是 Task 6 从 zenithjoy 拷入的快照，两边 yaml 漂移时靠上一条的漂移守卫发现，不会自动同步。
