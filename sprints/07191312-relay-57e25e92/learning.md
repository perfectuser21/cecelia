# Learning — headed-smoke-test（headed relay 派发链路自测，task 57e25e92）

## 运行指标

- GAN 轮次：5（round1 起草被 judge 实测 FAIL 打回，round5 修正轮 APPROVED，rubric 7 项 8-10 分）
- Evaluator Fix 次数：多轮迭代（.harness/verdicts 下 21 个 evaluate-* 记录），最终 evaluate-91b4917 verdict=PASS（FIXED 归一 PASS）+ judge PASS
- 总成本：未采集（headed 前台点火不产 relay_runs 行，`/api/brain/orchestrator/relay-runs?task_id=` 返回空数组）
- PR：https://github.com/perfectuser21/cecelia/pull/4109（squash MERGED @2026-07-20T01:52:36Z）
- Sprint Dir：sprints/07191312-relay-57e25e92
- re-anchor：merge 前两次合法 re-anchor（91b49176 → f0f6f6bf 毕业 commit 纯 rename 豁免；f0f6f6bf → 5d6ee32dd gh pr update-branch 轻量合并豁免），CI 全绿后合并
- 交付物：e2e-verify 毕业至 scripts/smoke/e2e/relay-57e25e92.sh（smoke-e2e-nightly.yml 收集）；合同测试 tests/regression/relay-57e25e92/headed-smoke-contract.test.ts 永久入库

## 发现的问题

### [PROMPT] Prompt 类问题

- 现象：GAN round1 合同起草误判 host 白名单，未识别「人工前台接管」场景 → judge 实测 FAIL；根因：contract-proposer 起草期只按 spawn 无头场景假设执行 host，headed 接管路径没有进入对抗清单；修法：round5 修正轮重写白名单判据后 APPROVED，起草期环境假设需显式过一遍 headed/人工接管分支。

### [BUG] 代码缺陷

- 无（本次未遇到；round5 修复后 evaluator/judge 双 PASS，无遗留缺陷）。

### [INFRA] 基础设施问题

- 现象：judge 阶段 Brain toapis 调用失败；根因：凭据过期；修法：`source ~/.credentials/sync-credentials.sh` 从 1Password 重拉后恢复（台账 line 7）。
- 现象：report 阶段 PATCH completed 被拒 `pr_not_found`；根因：headed 前台点火全程未回写 tasks.pr_url / payload.pr_url / payload.base_repo，也未上报 evaluator phase-event，finalizeHarnessTask 收账权守卫对外部真相「失明」；修法：经官方 `POST /api/brain/harness/phase-event` 补报 evaluator done（verdict 文件为凭据）+ 补写 payload.pr_url 指针，守卫独立 gh 核验 PR MERGED 后放行。
- 现象：headed run 成本遥测缺失；根因：前台点火不产 relay_runs 行，cost_usd 无处累计；修法：本次按「未采集」如实上报，后续 headed 路径需接入 relay-runs 或 phase-event cost 字段。

### [DESIGN] 设计缺陷

- 现象：watchdog 的 GitHub 分支名反查（headRefName 含 task short id）对本 sprint 失效；根因：分支名 cp-07191320-harness-prd 不含 short id 57e25e92，且 payload.base_repo 缺失导致反查根本无仓库可查；修法：headed relay 分支命名应遵守 cp-*-<short> 规约，或点火时写入 base_repo，二者取一即可让收账兜底链路恢复。

## 下次预防清单

- [ ] headed relay 点火时把 base_repo（或 merge 后的 pr_url）写入 task payload，且分支名带 task short id，保证 finalize/watchdog 反查链路可用
- [ ] relay 各 phase（含 headed 前台）实时走 POST /api/brain/harness/phase-event 上报，evaluator done 事件不留到收尾补报
- [ ] contract-proposer 起草 host/环境白名单类断言时，强制核对 headed 人工接管场景，避免 round1 那类 judge 实测才暴露的误判
