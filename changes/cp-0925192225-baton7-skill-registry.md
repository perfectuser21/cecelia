## Brain {VERSION} — getSkillForTaskType 改查 skill_registry：能力账本参与执行时选择（链 bf5088a3 棒7，任务 9917a588，决策 105a5868）

- 病根：`executor.getSkillForTaskType` 只读硬编码 `EXECUTOR_SKILL_MAP`，`skill_registry` 只用于展示对账，账本改了执行不变（账实分叉）
- 迁移 470：`skill_registry` 加 `task_types TEXT[]` + `dispatch_command TEXT`（GIN 索引），并把 `EXECUTOR_SKILL_MAP` 全部非空条目幂等 UPSERT 灌进账本（task_types 取并集、dispatch_command 只补空值、不覆盖已有行其它列；research 空串不入账）；含回滚脚本
- 解析改读账本：新 `lib/skill-binding-registry.js`，`getSkillForTaskType` 仍同步，读进程内快照；`preparePrompt` 经 `resolveSkillWithLedger` 刷新（TTL 60s 零逐任务查库、并发共享在途查询、800ms 超时、失败保留旧快照并退避 30s，回落硬编码，绝不拖垮派发）；`payload.skill_override` 仍最优先且不查库
- 漂移告警：账本与硬编码不一致以账本为准并 `console.warn`（每 task_type 每进程一次）；账本缺映射走硬编码并告警；日报新增「skill 绑定漂移」板块、晨报新增一行，缺映射/分歧/多 skill 冲突均标 🟡 AMBER，检测不可用不出该行
- 范围说明：账本驱动的是走 `_prepareDefaultPrompt` 的 task_type（dev/pipeline_rescue/initiative_execute/intent_expand 等）；`initiative_plan`/`prd_review` 等有专属 prepare 函数的类型自带硬编码 skill，不在本刀范围
- 测试：单测 27 项（改映射/缺映射/override/故障/超时/缓存/退避/冲突）+ executor 接线 + 日报晨报渲染与接线 + 迁移 470 结构（回填清单与 `EXECUTOR_SKILL_MAP` 逐项比对）+ 真 PG 集成（建库跑全量迁移，改账本一行无需改代码即生效）；smoke `skill-registry-binding-smoke.sh` 登记 allowlist
