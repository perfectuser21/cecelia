# harness gear 档位一体化 — 设计

日期：2026-07-17｜Brain task: 60a80ddc（P0）｜PrepPRD: docs/prd/2026-07-17-harness-gear-prep-prd.md｜研究裁决：APPROVE

## 目标
harness relay 增加 gear 维度：`default`（现行为不动）/ `hotfix`（图不变改行为的修复，免 planner/GAN 直通）/ `segmented`（RPA/真机：骨架全红棋盘 + N 段串行点绿 + 段验 + 总验）。

## 核心设计决策
1. **deriveGear(task)**（harness-skill-relay.js）：显式 `payload.gear` ∈ 枚举则用之；缺省/undefined → `'default'`；非法值 → 点火即 terminal failed（executor 校验，reason=`invalid_gear`，同 missing_orchestrator_flag 模式）。
2. **注入照 REVIEW_REQUIRED 模式**：prompt 头 `REVIEW_REQUIRED` 行后加 `HARNESS_GEAR=${gear}`；env block 加 `HARNESS_GEAR`。段清单不塞 prompt 头——segmented 的段来自 proposer 的 task-plan.json（controller 从 CONTRACT_BRANCH 读）。
3. **hotfix 不改 generator（CONTRACT IS LAW 保住）**：controller hotfix 分叉时跳过 planner/GAN，自己用 payload（thin_prd + failing-test 描述）合成极简 `contract-draft.md`（含 ## E2E 验收）+ `contract-dod.md`（[BEHAVIOR] 条目）+ `tests/`（复现红测试）落 CONTRACT_BRANCH，之后 generator→evaluator→merge→report 与现行完全一致。generator 读合同的硬性逻辑一字不改。
4. **segmented 段循环在 controller session 内**（Task tool 派棒），不产生额外 Brain 任务——dispatcher 并发模型不受影响（改动面第7点降级为验证项）。
5. **段验=机械跑断言**：evaluator 新增 `SEGMENT_EVAL=<ws_id>` 旗标——跳 final-E2E，只跑该段 [BEHAVIOR]/tests 断言 + 复跑此前已绿段的测试（回归棘轮：红灯只减不增）。总验仍走现行全量模式。
6. **task-plan.json 多段 schema = 恢复 v7 前原样**（研究已抄出）：`tasks:[{task_id:"ws1..N", title, scope, dod[], files[], depends_on[], complexity, estimated_minutes}]`；线性链死规则：ws1 唯一可 `depends_on:[]`，ws2+ 必须声明前置。proposer 仅在 HARNESS_GEAR=segmented 时输出多段（controller 派 proposer 的 prompt 里透传档位），default 保持单 ws1。
7. **generator segmented 支持**：新增 `WORKSTREAM_INDEX` 定向——只实现本段 scope、禁碰他段实现文件；骨架棒复用现成 `is_skeleton` 钩子（落全红棋盘 commit）。

## 组件与数据流
```
点火 payload{gear} → executor 校验枚举 → skill-relay deriveGear → prompt头 HARNESS_GEAR
controller 分叉：
  default   : Step0-7 现行不动
  hotfix    : Step0 → 合成极简合同 → Step3 generator → Step4 evaluator → merge → report
  segmented : Step1 planner → Step2 GAN(多段 task-plan) → 骨架棒(is_skeleton,全红棋盘)
              → for ws_i 串行: generator(WORKSTREAM_INDEX=i) → evaluator(SEGMENT_EVAL=ws_i)
                 FAIL→重派该段(带失败摘要,上限2次→escalate) ; PASS→下一段
              → 总验 evaluator(全量 final E2E) → merge → report
```

## 错误路径
| 场景 | 行为 |
|---|---|
| gear 非法值 | 点火 terminal failed，reason=invalid_gear |
| gear 缺省 | =default，存量任务零影响（回归断言） |
| hotfix payload 缺 thin_prd/failing-test 描述 | controller 合成合同前校验，缺→任务 failed 明确报错 |
| 段验 FAIL | 重派该段带失败摘要，2 次仍败→escalate 人工 |
| 段验发现已绿段回归变红 | 本段判 FAIL（棘轮），失败摘要注明回归项 |
| 总验 FAIL | 现行 evaluator FAIL 路径不变（GAN 对抗轮次无上限） |

## 测试策略
- **unit（vitest，packages/brain/src/__tests__/harness-skill-relay.test.js 扩展）**：deriveGear 显式/缺省/非法三态；prompt 头 HARNESS_GEAR 注入断言（仿现有 spawnSkillRelaySession fake-deps 用例）；executor invalid_gear terminal failed。
- **integration**：现有 relay 全量单测不改仍绿（gear 缺省回归保证）。
- **SKILL.md 层**：无单测，走既有 harness-contract-lint / facts-check / dod-mapping 闸；controller/proposer/generator/evaluator 四个 SKILL.md 的 gear 分支各带"档位不触发时行为与现行一致"的显式声明段。
- **E2E（合并后）**：手动点火一个 gear=hotfix 的真实小修复任务作首跑验证（不进本 PR）。

## 不做
W7 剧本化（独立任务）；dispatch-worker 接入段派工（v2）；西安远程；legacy 图编排。

## 版本
brain 改动 → packages/brain version bump + 四处同步（DevGate check-version-sync）；SKILL.md 改动 → merge 后刷 dist（skills-dist 分发链）。
