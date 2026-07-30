# PrepPRD：工厂 · F1 开发闭环 — GP锚定闭环 刀4（Brain层锚校验+机械judge核对）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：`executor.js` drive-time gp_anchor 硬校验（仿 orchestrator/gear 先例）+ `harness-judge.js` 机械闸 GP-Anchor 一致性核对（file-existence gated）
- [ ] 另立 Sprint（本次不做）：刀5（patrol棘轮+历史无锚PR归户）
- [ ] 待讨论：无——本轮研究已把原设计文档①⑤两层的落点修正清楚

## 关键架构修正（本轮研究发现，覆盖刀1时的原始设计假设）

刀1设计文档写"①tasks注册API必填gp_anchor(无锚创建400)"和"⑤harness-evaluator PASS判据"，当时误以为Brain只服务ZenithJoy。实际查证：

1. **Brain(cecelia)是跨项目共享基建**：`packages/brain/src/routes/task-tasks.js`的POST `/`创建接口服务cecelia自己(113条)、zenithjoy-workspace(50条)、zenithjoy-skills(5条)、infrastructure(1条)等**所有**项目的harness_initiative任务。若无差别要求`gp_anchor`字段，会把cecelia自己的kernel任务创建也拦死。
2. **已有同类先例可复用**：`executor.js`的`_driveHarnessInitiative`函数里，`orchestrator`和`gear`字段的硬校验都不是在POST创建时拦（创建时只做warn），而是在任务**真正被驱动执行时**用`markInitiativeTerminalFailed`判terminal failed。这是本仓库处理"harness_initiative专属硬约束"的标准手法，gp_anchor应该照抄。
3. **"harness-evaluator PASS判据"实际归属**：`harness-evaluator`是纯prompt skill（跑在zenithjoy-skills，非Brain代码）。真正的独立机械验证层是`harness-judge.js`的`runMechanicalGate`/`runMechanicalPreflightChecks`（"运动员-摄像头-裁判"三权分立架构，裁判层）。GP-Anchor一致性检查应该加在这里，而不是只在evaluator skill提示词里加一句话。
4. **"report回写PR↔GP关联"不需要新Brain代码**：`journey_features`已有通用`workflow_ref`字段+`PATCH /journey_features/:id`端点，harness-report skill调用现成端点即可存PR URL，无需为此新增Brain API。**本刀不做**。

## Journey 当前状态
- Journey：工厂 · F1 开发闭环（`e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，maturity=mvp）
- ✅ GP锚定校验（97400e37...）— feature/thin，刀1(product-map SSOT)+刀2(CI硬闸)+刀3(skill层三处接线)已交付
- 🔄 本次刀4推进同一Ability：把锚定检查焊进Brain执行链路本身（跨仓库共享的执行层，与刀2 CI硬闸互为纵深防御）

## 本次要做的

### 分支A：`executor.js` drive-time 硬校验（仿 orchestrator/gear 先例，同一函数体相邻位置）
1. 任务被`_driveHarnessInitiative`真正驱动执行时，若`task_type==='harness_initiative'`且`String(payload.base_repo||'').includes('zenithjoy-workspace')`（大小写不敏感）→ 校验`payload.gp_anchor`存在且格式合法（三形态之一：`<line>/<gp>#stepN`、`<line>/<gp> keep-green`、`none(infra|docs|config|backlog)`）
2. 缺失/格式不合法 → `markInitiativeTerminalFailed(dbPool, task.id, 'missing_gp_anchor', message)`，返回`{ok:false, error:'missing_gp_anchor', terminal:true}`，不继续spawn skill-relay session
3. base_repo不含zenithjoy-workspace（cecelia自己的任务、zenithjoy-skills等）→ 完全跳过本项校验，行为不变（零回归）

### 分支B：`harness-judge.js` 机械闸 GP-Anchor 一致性核对（file-existence gated，与刀3 skill层同一哲学）
4. `runMechanicalGate(ctx, deps)`内，检查`ctx.worktreePath`下是否存在`product-map/generated/product-map.json`
5. 存在 → 读`contract-draft.md`（复用已有的`readFileFn`+已有的contract-dod.md/contract-draft.md双读fallback模式），检查是否含`## GP-Anchor`段（三形态之一）或显式`gp-anchor: skipped`行；两者都没有 → reasons.push（机械闸FAIL）
6. 含推进形态声明（`#stepN`）→ 解析出`<line>/<gp>`，用JSON.parse读product-map.json核对该组合真实存在于`golden_paths[]`；不存在 → reasons.push
7. 不存在product-map.json（非zenithjoy-workspace项目的sprint）→ 完全跳过本项检查，行为不变（零回归，与刀3 skill层的file-existence gated完全对齐）

### 错误路径
- `payload.base_repo`缺失/为空 → 视为不含zenithjoy-workspace，跳过分支A校验（宽松默认，不误杀）
- `ctx.worktreePath`不存在/不可读 → 分支B的product-map.json存在性探测走readFileFn的catch分支，视为不存在，跳过（不因环境异常连带FAIL，与目前`testCount`扫描失败时的容错模式一致）
- gp_anchor格式声明了`none(backlog)`但没带issue id token → 本刀**不**在Brain层重复校验这条（已经是刀2 lint-gp-anchor.sh CI层的职责，Brain层只做in/存在性+id真实性两层，避免同一规则两处维护容易失步）

## 客户视角
无终端客户可感知变化（dev_pipeline内部机制，同刀1-3）。"客户"是Brain驱动的harness_initiative任务本身（防止孤儿任务被驱动执行/防止judge漏判）。

## 完成后开发者/AI能
1. 即使绕过了刀2的CI硬闸（比如未走PR而是直接派发task、或PR描述被篡改），只要任务被Brain驱动执行且目标是zenithjoy-workspace，drive-time校验依然会拦住无锚任务——纵深防御，不单点依赖CI
2. 即使某个环节的LLM (proposer/generator) 因为漂移没有正确处理GP-Anchor，独立的机械judge层会在验收阶段发现并FAIL，不靠"运动员自证"

## 涉及的 Ability / Feature
- GP锚定校验（GP-Anchor Enforcement，97400e37...）— 推进，thin

## GP-Anchor 声明（本sprint自身）
GP-Anchor: line00/gp_anchor_enforcement#step4

## 不包含
- tasks POST创建端点本身的400拦截（沿用orchestrator/gear先例，只做drive-time校验，不做创建时硬拦，避免对生产环境task创建行为产生额外破坏性变更）
- report回写PR↔GP关联的新Brain API（已有`workflow_ref`字段+现成PATCH端点可用，无需新增，是skill层职责）
- none(backlog)的Brain issue id真实性校验（刀2 CI层职责，本刀不重复做）
- 刀5（patrol棘轮+历史无锚PR归户）

## 判定点登记表
（本任务无接缝判定点，N/A——纯代码逻辑校验，无对真实世界模糊状态的判断假设）

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] 不涉及

### API 与凭据
- [x] 不涉及外部API（本刀改动不涉及DeepSeek judge调用路径，只加机械层检查）

### 测试 Fixture
- [x] 复用`harness-orchestrator-lockdown.test.js`的完整mock框架（vi.mock db.js/task-updater.js/harness-skill-relay.js等），仿其SC-2xx编号写gp_anchor的SC-4xx测试
- [x] `harness-judge.js`已有的`runMechanicalGate`测试文件（需先find定位）作为mock ctx结构的参照

### 基础设施
- [x] cecelia仓库worktree已建：`/Users/administrator/perfect21/cecelia/.worktrees/gp-anchor-cut4-brain`（分支`cp-07290917-gp-anchor-cut4-brain`）
- [x] Brain API `localhost:5221`已确认可用

## 验收标准（Final E2E）
- [ ] `executor.js`：`payload.base_repo`含"zenithjoy-workspace"且`payload.gp_anchor`缺失 → `_driveHarnessInitiative`返回`{ok:false,error:'missing_gp_anchor',terminal:true}`，DB标terminal failed（proven-to-fire测试）
- [ ] `executor.js`：`payload.base_repo`含"zenithjoy-workspace"且`payload.gp_anchor`合法（三形态各一例）→ 正常调用`spawnSkillRelaySession`，行为不变
- [ ] `executor.js`：`payload.base_repo`不含"zenithjoy-workspace"（如cecelia自己）且`payload.gp_anchor`缺失 → 不受影响，正常调用`spawnSkillRelaySession`（零回归验证）
- [ ] `harness-judge.js`：`ctx.worktreePath`含product-map.json但contract-draft.md无`## GP-Anchor`段且无`gp-anchor: skipped`行 → `runMechanicalGate`的reasons含对应FAIL理由
- [ ] `harness-judge.js`：contract声明推进某GP但id在product-map.json里查无 → reasons含FAIL理由
- [ ] `harness-judge.js`：`ctx.worktreePath`不含product-map.json（非zenithjoy项目）→ 完全跳过，reasons不新增任何GP-Anchor相关项（零回归验证）
- [ ] 全部既有测试（harness-orchestrator-lockdown.test.js等）仍通过，未产生回归
- [ ] CI全绿
