# PrepPRD：Cecelia Harness Pipeline — 无条件核心回归闸（B1）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 新增无条件 core-regression CI job（脱离路径门；PR 档跑 P0/P1 策展子集、push-main 档跑全集）
- [x] 干掉假绿灯 regression-smoke（ci.yml:716 扫不存在的 *.golden-smoke.test.ts 目录、静默 exit 0）
- [x] regression-contract.yaml 播种 ≥1 条真实 cecelia must-never-break golden path + 空契约守卫
- [ ] 另立 Sprint（本次不做）：A1 动态加载 / A3 自动 promotion / CS 客服专属 test（跨 ZenithJoy 仓库）

## Journey 当前状态
- ✅ Harness Pipeline 骨架
- 🔄 无条件核心回归闸 — 本次新增

## 本次要做的
现在 CI 有个洞：只有改了某目录才跑那目录的测试，别的目录（如 packages/brain）改动把它打坏时测试被跳过、绿灯照放（跨服务运行时耦合，路径门算不进）。本次新增一条"核心回归"检查，不管改了哪里都无条件跑一批"绝不能坏"的断言；同时删掉一个假装在跑、实则扫空目录永远绿的僵尸检查。

## Golden Path
1. 定义 regression-contract.yaml schema，对齐 packages/quality/contracts/regression-contract.template.yaml（triggers / test_command / must_never_break / priority 字段）
2. 往根目录 regression-contract.yaml 填 ≥1 条真实的、已有 committed 测试支撑的 must-never-break golden path（P0，选一条现有 Brain 契约/selfcheck 类测试）
3. 新增 scripts/ci/run-core-regression.sh：用 yq 解析 regression-contract.yaml，按档执行对应 test_command，任一失败 exit 1（引用文件不存在也 fail，不静默）
4. ci.yml 新增 core-regression job：无 workspace 路径门 if（永远跑）；PR 档跑 P0/P1 子集，push-main 档（复用 `|| github.ref=='refs/heads/main'` 先例）跑全集
5. 空契约守卫：release 全集为空 → job fail（防退化成假绿灯）
6. 删除或改造 regression-smoke（ci.yml:716）：删掉，或改成真正消费 regression-contract
7. core-regression 接入 ci-passed 汇总（因永远真跑不会是 skipped）

**错误路径**：yq 解析失败 → job fail 报错；test_command 引用文件不存在 → job fail（不静默 exit 0）

## 涉及的 Ability / Feature
- 无条件核心回归闸（新增 feature，kind=feature）

## 不包含
- A1 动态加载 line context（另 Sprint）
- A3 evaluator PASS 自动 promotion（另 Sprint）
- CS 客服专属 golden-path test（在 ZenithJoy autopilot 仓库，另 Sprint）
- 真机 tests/rog（P2）

## 前置工作（已逐项确认，无 TBD）
- [x] regression-contract.yaml 已存在（根目录，当前 core:[] golden_paths:[]）
- [x] packages/quality/contracts/regression-contract.template.yaml schema 参考已在仓库
- [x] yq 在 ubuntu-latest CI runner 可用（自带或 apt 装）

## 验收标准（Final E2E）
- [ ] regression-contract.yaml 含 ≥1 条真实 golden path，非空（node -e readFileSync grep 验证）
- [ ] scripts/ci/run-core-regression.sh 本地跑 exit 0
- [ ] ci.yml 的 core-regression job 无路径门 if、含 push-main 全集档（grep 验证不含 workspace== 门、含 refs/heads/main）
- [ ] 旧 regression-smoke 已删或已改造成真消费 contract（grep 验证不再扫空的 *.golden-smoke.test.ts）
- [ ] 空契约守卫存在（release 集为空则 fail）
- [ ] CI 全绿

**invariant 约束（必须遵守）**：真环境验证才算done；测试默认多租户；禁止写死环境假设值；端点鉴权。

**参考方案文档**：docs/current/harness-verify-redesign/B1-ci-unconditional-regression.md
