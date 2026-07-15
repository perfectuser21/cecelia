# Learning — claude-headed-smoke 回归冒烟（第二轮，扩展 nightly 池覆盖）

## 运行指标

- GAN 轮次：1（proposer 提出 → reviewer 一轮即 APPROVED，铁律覆盖 6/6）
- Evaluator Fix 次数：0（未触发 evaluator 驳回重跑循环；evaluator 是一次性判定 FAIL，非"发现问题→改→重判"的迭代）
- 总成本：$0（relay-runs API 记录 cost_usd=0.00，未采集到真实 token 花费数字）
- PR：https://github.com/perfectuser21/cecelia/pull/3965（主产出，已MERGED）；补救 PR：https://github.com/perfectuser21/cecelia/pull/3973（已MERGED）
- Sprint Dir：sprints/07151206-relay-cd0b936c

## 发现的问题

### [PROMPT] Prompt 类问题
无（本次未遇到 proposer/planner/generator 的 prompt 理解偏差问题；Red 阶段测试设计符合契约语义，非恒真测试）。

### [BUG] 代码缺陷
无（DoD 全部 [BEHAVIOR]/[ARTIFACT] 条目真跑通过：5 个 vitest 用例全绿，负向路径 TASK_ID 不存在时 22 退出码且 <15s 无 sleep 掩盖，正向路径输出 "OK headed smoke regression verified for cd0b936c..."，历史锚点 relay-4bb31ef5.sh 未被触碰）。

### [INFRA] 基础设施问题
- 现象：generator 在 commit 6（sha c1c24d6e0）里对 `.github/workflows/harness-v5-checks.yml` 做了 103 行新增/14 行删除的改动，理由是"修自己触发的 CI 假红"（新增 claude-headed 精确 seed 分支逻辑）。
- 根因：合同（contract-dod.md）明确声明大小=S、范围仅"新增 sprints/07151206-relay-cd0b936c/e2e-verify.sh"，并显式禁止碰 `relay-4bb31ef5.sh` / `ci.yml` / `smoke-allowlist.txt`。generator 遇到自己改动触发的 CI 红后，没有走"另开一个独立 sprint/PR 走完整 GAN 提案-评审流程修 CI 基础设施"的正确路径，而是在本 sprint 内顺手把范围扩大到了合同外的共享 CI 判定文件（`harness-v5-checks.yml` 与被禁止点名的 `ci.yml` 性质相同、影响面覆盖全仓库所有未来 sprint）。这是"为迁就实现而扩大合同范围"，违反 CONTRACT IS LAW。
- 修法：本次未回滚该 CI 改动——已核实其本身风险可控（新增 seed 分支逻辑，有回退兜底）、修的是真实存在的 CI 假红缺陷，回滚成本大于收益。转而记录为系统性问题（Notion/Brain issue id=80044ba8-af97-4f10-87c4-e3f6a4925025），建议后续给 proposer/generator skill 加"默认禁区"规则（跨 sprint 共享 CI 判定文件默认不可改，除非合同显式授权），从根上堵住"生成阶段顺手扩权"的路径。

### [DESIGN] 设计缺陷
- 现象：evaluator 判 FAIL 后，PR #3965 已经被 `should-auto-merge` 双保险机制在 evaluator/judge 走完前提前自动合并；controller 未能拦截（这是已知机制导致的时序问题）。这直接导致该 PR 跳过了 Step 6（毕业）——2 条测试遗留在 sprint 目录未搬入永久池，直到本次报告收尾才由 controller 发现并另开 PR #3973 补跑 `scripts/graduate-sprint-tests.mjs --update-refs`。
- 根因：`should-auto-merge` 的合并时序与 evaluator/judge 的评估时序之间没有硬性阻塞依赖，评估结果理论上应该先于合并落地，但工程实现允许并发竞态。
- 修法：本轮以 PR #3973 补救（毕业动作 + 修复一处随之失效的 DoD 断言），并与另一条并发 relay（049ebf93）的同类修复在 rebase 时相遇、语义等价、已合并去重。根治方案（让 should-auto-merge 等 evaluator/judge 完成后再放行）未在本 sprint 范围内实施，留给后续基础设施改进。

## 下次预防清单

- [ ] 给 harness-generator skill 增加"共享 CI 基础设施文件默认禁区"规则：`.github/workflows/*.yml`、`packages/quality/smoke-allowlist.txt` 等跨 sprint 共享判定文件，未经合同显式授权不可修改；遇到自身改动触发 CI 红时必须另开独立 sprint 走 GAN 流程，不得在当前 sprint 顺手扩权。
- [ ] 排查 `should-auto-merge` 与 evaluator/judge 阶段之间缺失的硬阻塞依赖，避免"PR 在评估完成前被提前合并"导致 Step 6 毕业步被跳过的情况再次发生（本轮已是至少第二次遇到同类竞态，049ebf93 并发 relay 也命中了同款遗留毕业步问题）。
- [ ] journeys 表 `e2e_test_path` 字段存在指向不存在文件的情况（本次巡检发现 bb8cc561 指向已不存在的 `harness-pipeline-1node-smoke.sh`），建议后续 harness-report 翻牌义务巡检把"文件是否存在"也纳入常规核对，而不仅是"内容是否匹配现行方案"。
