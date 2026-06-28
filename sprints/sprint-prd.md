# Sprint PRD — Cecelia Dashboard 首页加固定状态标识文字 "Cecelia Harness 工厂线已贯通"

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 端到端贯通验证
- **当前进度**：待确认（Brain API 暂无响应）
- **本次推进预期**：完成 harness 内部线 staging→production 贯通标识，可视化验证

## 背景

在 Cecelia Dashboard 首页加入一行固定状态标识文字，作为 harness 内部线 staging→production 贯通的端到端可视化验证锚点。文字内容固定为 "Cecelia Harness 工厂线已贯通"，不依赖运行时数据。

## Golden Path（核心场景）

用户从 [打开 Cecelia Dashboard 首页] → 经过 [页面渲染完成] → 到达 [可见固定文字 "Cecelia Harness 工厂线已贯通"]

具体：
1. 用户访问 `localhost:5174`（或 Dashboard 根路径）
2. Dashboard 首页渲染完成
3. 页面中可见文字 "Cecelia Harness 工厂线已贯通"（固定显示，不依赖登录状态或数据加载）

## 边界情况

- 文字在页面刷新后仍然存在（静态渲染，无动态依赖）
- 文字在浅色/深色主题切换后均可见
- 不影响现有首页其他元素的布局

## 范围限定

**在范围内**：
- `apps/dashboard/` 首页组件加入一行静态文字
- Playwright E2E 验证文字可见性

**不在范围内**：
- 动态状态读取（不查 Brain API 状态）
- 多语言/国际化
- 样式主题深度适配（基本可见即可）

## 假设

- [ASSUMPTION: "首页" = Dashboard 打开后默认可见的主页面（根路径对应组件，推测为 /canvas 路由对应页面或 App 主布局区域）]
- [ASSUMPTION: 文字位置为首页顶部或主要内容区可见位置，具体坐标由 Generator 决定]
- [ASSUMPTION: 静态硬编码文字，不从 API 读取]

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不适用
- 版本要求: 无
- 可观测: Playwright 截图可确认文字存在

## 预期受影响文件

- `apps/dashboard/src/pages/` 中首页对应组件（或 `App.tsx` 主布局区域）：添加静态文字行

## E2E 验收

> 最终可执行 E2E 脚本由 Proposer 在 GAN 阶段产出（target_environment=mac_web → Playwright）。

```bash
# 占位：proposer 将按 target_environment=mac_web 填入 Playwright 脚本
# 期望验收点（自然语言）：
# 1. 启动 Dashboard（localhost:5174）
# 2. 打开首页
# 3. 页面中存在文字 "Cecelia Harness 工厂线已贯通"（text assertion）
# 4. 截图留档（可视化确认）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端页面，需浏览器渲染验证
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 是内网产品，Playwright 跑 localhost:5174，走本机 mac_web 环境
## journey_id: （来源 task.payload.journey_id，本次 Brain API 未响应，待 Proposer 补填）
## step_id: （来源 PrepPRD Golden Path 锚定结果，PrepPRD 未提供，待 Proposer 补填）
