# Sprint PRD — 金标集 v0 + LLM判定器 eval 通过率棘轮进 CI

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（给 LLM 判定器加金标集回归闸，判读质量可度量、只升不降）

## 背景

Crystal 第 5 件：LLM 判定器（`harness-judge.js` 视觉判读路径）目前无回归基准，判读质量无法度量、易悄悄退化。本 sprint 建金标集 v0，把判定器在金标集上的通过率做成 CI 闸，阈值棘轮只许升；并加 4 条纯代码用例锁死关键不变量（序列/成本/fail-closed/契约完备性）。前轮死于 validation_clock_required —— 本轮 E2E 必须是真跑出通过率的可执行时钟，非静态断言。

## Golden Path（核心场景）

系统从 [CI 触发] → 经过 [判定器判读金标集 + 棘轮比阈值 + 4 条纯代码用例] → 到达 [eval job 全绿或阻断合并]

具体：
1. CI（push/PR）触发 eval job，加载金标集 v0：A/B 实验截图按五类标注（用户列表页=true；桌面=false、计算器=false、搜索历史=false、联想页=false）
2. LLM 判定器对金标集逐条判读，产出每条 pass/fail 与整体通过率
3. 通过率与棘轮阈值比较：≥ 当前阈值则 PASS；若本次通过率更高则写回抬高阈值（棘轮只许升，禁止下调）
4. 并行跑 4 条纯代码用例：序列固化断言 / 缓存命中零视觉调用（防成本回归）/ 视觉 null 必 fail-closed / 契约完备性 lint（每技能必有 pre+post+side_effects）
5. 全部通过 → CI 绿；任一 fail → CI 红，阻断合并

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 视觉判定返回 null / 超时 → 必须 fail-closed（判 fail，不得当 pass 放行）
- 缓存命中场景不得再发起视觉 API 调用 → 断言视觉调用计数 == 0（成本回归防护）
- 本次通过率低于历史棘轮阈值 → CI fail（棘轮不许降）
- 金标集为空 → job fail（防空集假绿）
- 某技能契约缺 pre / post / side_effects 任一 → 契约完备性 lint fail

## 范围限定

**在范围内**：金标集 v0 fixtures（5 类标注）、eval 脚本、棘轮阈值持久化、CI eval job、4 条纯代码用例。
**不在范围内**：扩充金标集到 v1、替换判定器模型、Dashboard 展示 eval 结果。

## 假设

- [ASSUMPTION: Unified Map 未配置 map_repo（payload 仅有 map_scope=["F1"]，environment 无关），scope 锚定按 payload.anchor（gp/step/journey）执行]
- [ASSUMPTION: 「判定器」= packages/brain/src/harness-judge.js 的视觉判读路径；金标集 fixtures + eval 脚本落 packages/quality/ 下]
- [ASSUMPTION: 棘轮阈值以受版本控制的文件持久化（如 packages/quality 下 JSON），CI 读并只上调]
- [ASSUMPTION: eval job 实际在 CI Linux（GitHub Actions ubuntu）运行；验收以 local_api 用 node/vitest 本地复现真实通过率]

## 预期受影响文件

- `packages/quality/`（fixtures + eval 脚本 + 棘轮阈值文件）：金标集 v0 与通过率闸主体
- `.github/workflows/`：新增/扩展 eval job，接棘轮阈值
- `packages/brain/src/harness-judge.js`：视觉 null fail-closed + 缓存命中零调用行为
- `packages/brain/src/golden-path-contract-schema.js`：契约完备性（pre+post+side_effects）lint 依据
- `packages/brain/src/__tests__/`（或 packages/quality/tests）：4 条纯代码用例落地并入 CI 常驻

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空）；以下为 PrepPRD 显式值 -->
- 成本: 缓存命中必须零视觉 API 调用（防成本回归，PrepPRD 显式）
- fail-closed: 视觉判定 null/超时 一律判 fail（PrepPRD 显式）
- 棘轮: 通过率阈值单调只升，禁止下调（PrepPRD 显式）
- 可观测: eval 通过率 / 当前阈值 / 失败项必须在 CI 日志可见
- 超时/频控/版本: 待定（PrepPRD 未指定，decisions 无对应 NFR）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级共 90 条；step/journey_feature 级为空。下列为系统级铁律 + 本 sprint（TDD/CI/判定器）直接相关铁律 -->
- [真环境done] 真环境验证才算 done，不得凭"测试通过"空泛收尾（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [多租户测试] 测试默认多租户（来源: area）
- [租户隔离] 租户隔离（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [凭据安全] 凭据安全，不提交进 git（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [Red精确add] Red commit 只 git add 精确 *.test 路径，禁止 git add .（来源: area）
- [验证实跑] 合同验证命令必须实跑确认 exit code 语义，不假设（来源: area）
- [禁自merge] generator/judge 禁止自行 merge PR，merge 由 CI 兜底（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 现有 golden-path 均为 planned 状态，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node/vitest + curl/psql），并且必须是真跑出通过率的验证时钟（前轮死于 validation_clock_required，本轮不得用静态断言充数）。

```bash
# 占位：proposer 将按 local_api 填入真实脚本（node eval + npx vitest + 断言）
# 期望验收点（自然语言）：
# 1. 跑 eval：判定器对金标集 v0 全部逐条判读 → 打印真实通过率 + 当前棘轮阈值
# 2. 通过率 ≥ 阈值 → exit 0；低于阈值 → exit 非 0（棘轮不许降，需实测 exit code）
# 3. 4 条纯代码用例全绿：序列固化 / 缓存命中零视觉调用（调用计数==0）/ 视觉 null → fail-closed / 契约完备性 lint（缺 pre|post|side_effects 即 fail）
# 4. 空金标集 → job fail（防假绿）
# 5. .github/workflows 中 eval job 已接线（grep 确认 job 存在且执行上述脚本）
```

## journey_type: autonomous
## journey_type_reason: 纯后端/CI 判定器 eval 基础设施，不涉 apps/dashboard 或远端 agent 协议
## target_environment: local_api
## target_environment_reason: eval 以 node/vitest 本地复现真实通过率 + psql/文件核对棘轮阈值（CI 实跑在 GitHub Actions ubuntu，验收在本地 evaluator）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
