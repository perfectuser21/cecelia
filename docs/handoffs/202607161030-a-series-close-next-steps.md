# Handoff：A 系列+A8 自愈链战役总收官 → 下一棒作战清单

- 日期：2026-07-16 10:30 CST（管家会话 45f2cb5d）
- 上游：202607150700-dao-a-dogfooding-relay.md（五连发+刀A 四小刀）
- 决策依据：5b0690ca（golden path 组织修复，禁散件）、dc18d43d（无闸不成文）

## 一、已完成（07-14 中午 → 07-16 早，18 个 PR 全流水线自产自验自合）

1. **五连发 dogfooding**：#3869/#3875/#3886/#3904/#3908，零人工完成率基线 2/5；
2. **刀A1-A7**：#3940/#3971/#3945/#3939/#3986/#3985/#3988——死局解除、收口顺序+base_repo、短号防呆、autoblock、gh退出码、judge证据截断、OOM升档；
3. **A8 自愈链 golden path**（PRD #3989=docs/prd/2026-07-15-self-healing-golden-path.prd.md）：A8-1 死因分类器+路由骨架（#3990）、A8-2 三新处置+宿主团灭S0（#3991）、A8-3 金丝雀演习（#3992）；
4. **生产部署**：07-16 早两次手动蓝绿（Gate3 仍坏），A5-A8 全部代码已 live，post-deploy 冒烟全绿；
5. **账面**：决策 5b0690ca 落库；issue 6b047f55 已 Closed（A3+A4 根治）；文档路由表补录（#4000）；memory 三文件更新（harness-lifecycle-gates-shipped / golden-path-three-meanings / feedback_golden_path_not_scattered_fixes）。

## 二、待办清单（按优先级，下一棒从 T1 接）

| # | 事项 | 形态 | 备注 |
|---|------|------|------|
| T1 | **Gate3 假跳过根治 = 交付轴 golden path 立项** | /architect 或直接按 5b0690ca 配方写 PRD → harness | 旅程="PR合并→15min内生产跑新代码且冒烟绿"；演习=每日合并无害PR验自动部署真发生；两天内人肉部署4次，三条路最后一条 |
| T2 | **金丝雀首跑验绿** | 盯 07-17 03:30 CST staging | 连续7天绿=A8验收；失败会 Bark Alex；drill 结果落 design_docs type=drill_report |
| T3 | **版本 bump 防线查因** | issue 已立（P2，07-16） | A系列全程没bump版本，check-version-sync 没叫 |
| T4 | **docs/current 保鲜机械化** | issue 已立（P2，07-16） | facts-check 扩 SYSTEM_MAP 数字对账 + arch_review 几乎不跑查因；07-16 人工补录过一次(#4000) |
| T5 | **EVA v3 重打分** | 手动跑 | 新口径：条文无代码闸计0 + 测试禁mock真实外部命令 |
| T6 | **下轮 dogfooding 重测零人工完成率** | 挑 3-5 只新虫点火 | 基线2/5→目标≥4/5；弹药：zj-skills仓 ci-poll 双行bug(SSOT copy未修)、judge FAIL后session退出烧attempt 等 |

## 三、关键认知（本战役沉淀，下一棒必读）

- **每刀首战必暴露下一虫，根因统一=测试 mock 掉真实外部命令行为**（A4 SQL类型/A5 gh退出码/A6 证据截断三连实证）→ 已入合同"禁 mock 边清单"机制（proposer 9.12/generator 7.10，evaluator 机械 grep 执法）；
- **golden path 一词三义**（sprint 合同尺度/ability 组合尺度/golden_paths 业务表）→ memory golden-path-three-meanings，harness 机制问题先读 skill SSOT 禁凭记忆；
- **合并≠部署**：生产跑镜像快照；smoke=feature 实体上车检查（一 feature 一脚本，目录即注册表 230+）；整条路上车终审=nightly 金丝雀；
- **回归池每 PR 全量陪跑**（vitest include tests/regression/** + core-regression 脱离路径门），快慢分池触发线=PR CI 常态>25-30min，TIA 需依赖图（本仓两次假跳过实证糙版路径判断=假绿）。

## 四、数据源

- PRD：docs/prd/2026-07-15-self-healing-golden-path.prd.md
- memory：harness-lifecycle-gates-shipped.md（总账）/ golden-path-three-meanings.md / feedback_golden_path_not_scattered_fixes.md
- 决策：5b0690ca / dc18d43d；issues：6b047f55(Closed)、07-16 新立两条 P2
- 冒烟/演习：packages/brain/scripts/smoke/（230+）、scripts/canary-death-drill.mjs
