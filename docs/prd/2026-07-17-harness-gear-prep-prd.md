# PrepPRD：harness gear 档位一体化（gear管道 + hotfix + segmented）

Brain task: 60a80ddc（P0）｜合并原 W4(fcb459b5, superseded)与 segmented 设计｜设计依据：07-17 探员审计 7 改动点

## 本次要做的
给 harness relay 增加 gear 维度（default/hotfix/segmented 三档），让同一条接力链按活的性质走不同厚度的流程：
- **gear=default**：现行为，一字不动（1 Sprint=1 Generator=1 PR，全量 planner→GAN→generator→evaluator）
- **gear=hotfix**（原W4）：图不变改行为的修复——免 planner/GAN，直通 failing test→generator→evaluator→merge
- **gear=segmented**（模式二）：RPA/真机类——骨架 generator 先落全红测试棋盘，N 个 workstream 串行点绿（每段轻验收），最后总验（现行 evaluator 全量模式）

## Golden Path（dev_pipeline 视角）
1. 用户/Brain 点火 harness_initiative 带 payload.gear=segmented + 段清单 → Brain 校验 gear 枚举 → controller prompt/env 注入 HARNESS_GEAR
2. controller 读档位 → segmented：骨架 generator 落全红棋盘并 commit → 系统可观察：分支上有 tests 全红 commit
3. controller 按 task-plan.json 段清单串行派段 generator → 每段结束段级轻验收（跑本段合同测试断言，跳 final-E2E）→ 绿则 commit 下一段，红则本段重试
4. 全段绿 → 总验（现行 evaluator 全量 final E2E）→ PASS → merge → report
5. gear=hotfix：点火后 controller 跳过 planner/GAN，直接以 payload 里的 failing-test 描述进 generator → evaluator → merge
6. 出错恢复：段验 FAIL → controller 重派该段（带失败摘要），超 2 次升级 escalate；gear 值非法 → 点火即 terminal failed 明确报错

## 改动面（7点，探员审计）
1. packages/brain/src/harness-skill-relay.js（~L80/L226-282）：读 payload.gear（枚举 default|hotfix|segmented，缺省 default），注入 HARNESS_GEAR + 段清单到 controller prompt/env
2. packages/brain/src/executor.js（~L2956 附近）：gear 枚举白名单校验，非法值 terminal failed（同 missing_orchestrator_flag 模式）
3. packages/workflows/skills/harness-controller/SKILL.md：主线按 HARNESS_GEAR 分叉（hotfix 跳 Step1-2；segmented Step3 变骨架+段循环，Step4 前加段验）
4. packages/workflows/skills/harness-contract-proposer/SKILL.md:30：segmented 档解除"task-plan.json 只出 1 task"，输出 workstreams+depends_on 串行链（恢复 v7 前逻辑）
5. packages/workflows/skills/harness-generator/SKILL.md:100：segmented 档支持 workstream_index 定向实现 + is_skeleton 骨架棋盘模式
6. packages/workflows/skills/harness-evaluator/SKILL.md:100-128：新增段级轻验收旗标 SEGMENT_EVAL（跳 final-E2E 只跑本段断言）；总验仍走全量
7. packages/brain/src/dispatcher.js:54-64：确认 segmented 串行多棒不撞并发上限（预期只需断言/注释，不改行为）

## 不包含
- W7 合同 [BEHAVIOR] 剧本化（独立任务 38c0c94e，段验先跑测试棋盘断言不依赖它）
- dispatch-worker 跨账号接入 controller（另一件事，段 generator 仍走现行 spawn）
- LOCATION_MAP/legacy 图编排（已废弃不碰）

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| gear 缺省语义 | ①缺省=default ②必填 | 缺省=default（向后兼容，存量任务零影响） | 存量 payload 无 gear | 误判无：非法值显式报错 |
| 段验判据 | ①LLM自由验收 ②机械跑本段合同测试 | 机械跑测试断言（W7未合，剧本化断言以后再吃） | "简单检测就过"病史 | 测试没覆盖的行为漏验→总验兜底 |
| hotfix 免GAN边界 | ①按title正则 ②显式gear字段 | 只认显式 payload.gear=hotfix（不搞标题推断） | review_required 的标题正则已有误判面 | 用户没标=走全量，安全方向 |

## 前置工作
- [x] Brain 本地可跑（localhost:5221 活着）
- [x] 改动面全部在本仓库，无外部凭据/fixture 依赖
- [x] brain 单测框架 vitest 现成；SKILL.md 无单测，走 harness-contract-lint / facts-check 既有闸

## 验收标准（Final E2E）
- [ ] brain 单测：deriveGear/gear 校验/prompt 注入 全绿（vitest）
- [ ] 非法 gear 点火 → 任务 terminal failed 且 reason 明确（集成断言）
- [ ] gear 缺省任务行为与现行完全一致（回归：现有 relay 单测不改全绿）
- [ ] DevGate 三件套过（facts-check / version-sync / dod-mapping）
- [ ] CI 全绿
