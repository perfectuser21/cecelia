# Sprint PRD — Crystal 第5件：金标集 v0 + 判定器 eval 通过率棘轮进 CI

## OKR 对齐

- **对应 KR**：KR-Cecelia基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+2%（给判定器装上可回归、只升不降的质量闸，杜绝"一会儿好一会儿坏"）

## 背景

判定器（harness judge / 视觉判定器）目前无金标集、无 eval 回归闸，改动后无法机检其判定质量是否退化，成本回归（重复视觉调用）与 fail-open 假绿也无守护。本 sprint 建立金标集 v0 + CI eval 通过率棘轮，把判定质量固化为只升不降的 CI 门禁。属 Crystal 结晶系列质量层，map_scope=F1。

## Golden Path（核心场景）

系统从 [PR 触发 CI] → 经过 [判定器在金标集上跑分 + 4 条纯代码用例] → 到达 [通过率达标则绿、降阈或退化则红]

具体：
1. **入口**：PR 改动判定器相关代码 → CI eval job 启动，加载金标集 v0（09-05 A/B 实验截图五类标注：用户列表页=true；桌面/计算器/搜索历史/联想页=false）。
2. **判定器跑分**：judge 对金标集每条截图产出 verdict，与 ground-truth 标签比对，算出通过率。
3. **棘轮比对**：读取入库的阈值基线；通过率 < 阈值 → CI FAIL；通过率 ≥ 阈值且更高 → 阈值上调（只升不降，降阈提交被 CI 拦截）。
4. **4 条纯代码用例并行**：①序列固化断言（判定步骤序列不漂移）②缓存命中零视觉调用（同输入二次判定不得再发视觉调用，防成本回归）③视觉返回 null 必 fail-closed（判 FAIL，不假绿）④契约完备性 lint（每个技能契约必含 pre + post + side_effects 三段）。
5. **出口**：通过率 ≥ 阈值 **且** 4 条用例全绿 → CI 绿；任一失败或阈值被下调 → CI 红。

<!-- Response Schema 由 Proposer 在 Step 1.1 读现状后推导（判定器 verdict 结构 / eval 报告结构），Planner 不定义技术规范。 -->

## 边界情况

- 金标集为空或标签缺失 → eval job 直接 FAIL（不得空跑判绿）。
- 阈值基线文件缺失/损坏 → fail-closed（FAIL），不得默认放行。
- 视觉调用超时/限流返回 null → 按 fail-closed 判 FAIL（对应用例③）。
- 通过率恰好等于阈值 → 判 PASS（≥ 为准），但不触发上调。

## 范围限定

**在范围内**：
- 金标集 v0 数据集（09-05 A/B 截图五类标注 + ground-truth manifest）落库到 F1 scope。
- CI 新增 eval job（通过率棘轮，只升不降）。
- 4 条纯代码用例（序列固化 / 缓存零视觉 / 视觉 null fail-closed / 契约完备 lint）。

**不在范围内**：
- 不改判定器判定算法本身（本 sprint 只加金标集与闸，不改 judge 逻辑；judge 只读被调用）。
- 不做金标集 v1/扩样、不做 UI 可视化、不接真实微信/真机采集。
- 不新增视觉模型 provider。

## 假设

- [ASSUMPTION: "判定器"指 F1 scope 下被 CI 门禁约束的 judge；若存在独立的视觉判定模块，其精确路径由 Proposer 读代码锚定。]
- [ASSUMPTION: 09-05 A/B 实验截图素材已可获取（截图源已存在，仅需标注入库）；若素材缺失，Proposer 阶段向 Owner 确认素材来源。]
- [ASSUMPTION: 金标集 fixtures 与 4 条用例落在 tests/gp/f1/（与既有 step3-judge-*.test.js 同域）；阈值基线以入库文件承载。]

## 预期受影响文件

- `tests/gp/f1/`：新增金标集 v0 fixtures（截图 + 标签 manifest）+ eval 用例 + 4 条纯代码用例（F1 scope，与既有 step3-judge-*.test.js 同域）。
- `tests/gp/f1/`（阈值基线）：入库的棘轮阈值文件（通过率下限，只升不降）。
- `.github/workflows/`：新增/扩展 CI eval job 触发判定器金标集跑分与 4 条用例。
- `packages/brain/src/harness-judge.js`：判定器主体，可能需暴露可测入口供 eval 调用（若触碰须过 DevGate：facts-check / version-sync / dod-mapping）。

## NFR 约束

<!-- 来源: PrepPRD(task.payload.description) 显式值优先；decisions category=nfr 副源为空 -->
- 成本回归防护：缓存命中路径必须零视觉调用（断言 vision call count == 0）。
- fail-closed：视觉/判定返回 null 一律判 FAIL，禁止 fail-open 假绿。
- 阈值单调性：eval 通过率阈值棘轮只升不降，降阈提交被 CI 拦截。
- 契约完备性：每个技能契约必含 pre + post + side_effects 三段，缺段即 lint FAIL。
- 可观测：eval 结果（通过率 / 当前阈值 / 失败项）落 CI 日志或产物文件。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 源为空，仅 area 源有值 -->
- [DIRTY-rebase] PR 与 main 冲突（DIRTY）必须路由 generator-fix 做 rebase，根除死等/判死（来源: area）
- [凭据不混用] 多人协作禁止混用授权凭据，操作他人账号资源须用其本人授权（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 仅有 planned 状态 ability，无 done/working 历史 -->
- （本 line 暂无已验收历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node 测试 runner + eval 命令）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 跑 eval + 4 条纯代码用例 + 阈值棘轮校验）
# 期望验收点（自然语言）：
#  1) 判定器在金标集 v0 上通过率可算出且 ≥ 入库阈值；
#  2) 提交下调阈值的改动时 CI 拦截为 FAIL；
#  3) 缓存命中二次判定的视觉调用计数 == 0；
#  4) 视觉返回 null 场景判定结果为 FAIL（fail-closed）；
#  5) 缺 pre/post/side_effects 任一段的技能契约触发 lint FAIL。
```

## journey_type: autonomous
## journey_type_reason: 判定器 eval 是纯后端/CI 质量闸，无 UI、无远端 agent，主体落 packages/brain 判官 + tests/gp/f1，按 if-elif 命中 packages/brain → autonomous。
## target_environment: local_api
## target_environment_reason: eval job 与 4 条纯代码用例走 node 测试 runner（本地 evaluator / CI ubuntu），无浏览器/真机/微信，命中"纯后端"→ local_api。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
