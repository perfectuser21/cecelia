# Sprint PRD — Dashboard 首页 Harness 工厂线贯通状态标识

## OKR 对齐

- **对应 KR**：KR-Harness Pipeline（harness 内部线 staging→production 端到端贯通）
- **当前进度**：未知（Brain context 当前不可达，按 walking skeleton 推进）
- **本次推进预期**：完成 staging→promote 接缝后的端到端真验（generator 写码 → CI → 合 main → staging:5223 → staging E2E → 自动 promote 到 live:5211）

## 背景

harness 内部线 staging→production 这条流水线刚打通接缝（见近期 #3433-#3437）。本 sprint 用一个最小、可见、可验证的 dashboard 改动，端到端验证这条工厂线真正从代码走到生产，而不是单测假绿。

## Golden Path（核心场景）

主理人打开 Cecelia Dashboard 首页 → 在首页可见处看到一行固定状态标识文字 "Cecelia Harness 工厂线已贯通"。

具体：
1. [入口] 主理人在浏览器打开 live dashboard（:5211）首页。
2. [系统处理] 首页加载，渲染固定状态标识区。
3. [出口/可观测结果] 首页可见处出现固定文字 "Cecelia Harness 工厂线已贯通"。

## 边界情况

- 文字为固定静态标识，不依赖任何接口数据，接口异常/空状态不影响其显示。
- 暗色/亮色主题下均需可见。

## 范围限定

**在范围内**：
- 在 Cecelia Dashboard 首页可见处新增一行固定文字 "Cecelia Harness 工厂线已贯通"。
- 端到端验证 staging→promote→live 流水线贯通。

**不在范围内**：
- 任何复杂 UI / 交互 / 动态数据绑定。
- 流水线脚本本身的改动（本次只消费已打通的流水线）。

## 假设

- [ASSUMPTION: "首页"指 dashboard 默认路由/根布局可见区，文字放在首屏常驻位置即可，无需新建页面]
- [ASSUMPTION: 文字内容逐字为 "Cecelia Harness 工厂线已贯通"，不做同义改写]

## 预期受影响文件

- `apps/dashboard/src/App.tsx`：首页常驻布局壳，是放置固定状态标识最自然的位置（具体落点由 generator 定，须保证首页可见）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ PrepPRD（未显式指定 NFR）；均无值 → 待定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 无

## E2E 验收

> 本区块为 Planner 初稿占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=mac_web 产出（Playwright 打开 dashboard 首页断言文字），并补 staging:5223 / live:5211 HTTP 200 与 CI 全绿的链路校验。

```bash
# 占位：proposer 将按 target_environment=mac_web 填入 Playwright 脚本 + 流水线校验
# 期望验收点（自然语言）：
#   1. staging dashboard（:5223）HTTP 200 可访问、可构建。
#   2. promote 后 live dashboard（:5211）首页 HTTP 200。
#   3. live 首页可见处出现固定文字 "Cecelia Harness 工厂线已贯通"。
#   4. CI 全绿。
```

## journey_type: user_facing
## journey_type_reason: 改动落在 apps/dashboard/，产出为主理人首页可见的 UI 状态标识。
## target_environment: mac_web
## target_environment_reason: Cecelia 内网 Dashboard Web UI，本机 Playwright 打开首页断言可见文字（localhost:5174，并校验 staging:5223 / live:5211）。
## journey_id: Line-唯一（Harness Pipeline）；task.payload.journey_id 未注入，按 PrepPRD 锚定 harness 内部线
## step_id: harness-staging-to-production-walking-skeleton
