# Sprint PRD — Cecelia Dashboard 首页固定状态标识文字

## OKR 对齐

- **对应 KR**：Cecelia harness pipeline 内部线 staging→production 端到端贯通验证
- **当前进度**：待 Brain API 采集（本次 Brain 不可达）
- **本次推进预期**：验证 harness 完整链路可驱动 UI 变更并被 E2E 确认

## 背景

harness 内部线（staging→production）是否贯通需要一个可观察的端到端信号。本 sprint 以最小 UI 变更（在 Cecelia Dashboard 首页插入固定状态文字）作为 harness 产出物，由 E2E 验证该文字在真实浏览器中可见，证明 harness 链路从 plan→generate→review→merge 走通。

## Golden Path（核心场景）

用户从 [打开 localhost:5174] → 经过 [登录 Dashboard，首屏渲染] → 到达 [页面上可见文字 'Cecelia Harness 工厂线已贯通']

具体：
1. 浏览器访问 localhost:5174，完成认证
2. Dashboard 首页渲染完成
3. 页面上存在文字元素，内容精确为 `Cecelia Harness 工厂线已贯通`，用户无需滚动即可看到

## 边界情况

- 文字在 light 模式和 dark 模式下均可见（对比度足够）
- 文字为静态硬编码，无需数据请求，不受网络状态影响
- 不影响现有导航、页面内容、路由功能

## 范围限定

**在范围内**：在 `apps/dashboard/src/App.tsx` 或首页渲染路径中添加一行静态状态文字
**不在范围内**：动态数据、后端 API 变更、多语言、动画效果、其他页面

## 假设

- [ASSUMPTION: "首页" 指用户登录 Dashboard 后默认看到的界面，实现位置为 App.tsx 的 authenticated 布局区域（header 内或 main 区域顶部），使其在 localhost:5174 首次渲染时无需导航即可见]
- [ASSUMPTION: Dashboard 开发服务器在 localhost:5174 可启动，Playwright E2E 在本机运行]

## 预期受影响文件

- `apps/dashboard/src/App.tsx`: 在首页可见区域插入静态文字元素

## NFR 约束

<!-- 来源: decisions 表 category=nfr，本次 Brain API 不可达，副源为空；PrepPRD 未指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不适用（纯静态 UI）
- 版本要求: 无
- 可观测: E2E 截图 + 文字断言必须通过

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=mac_web 填入 Playwright 脚本
# 期望验收点（自然语言）：
#   1. 启动 Dashboard dev server（localhost:5174）
#   2. Playwright 打开浏览器，访问 localhost:5174
#   3. 完成登录流程（或绕过认证，视 dev 环境配置）
#   4. 断言页面中存在文字 'Cecelia Harness 工厂线已贯通'（精确匹配）
#   5. 截图留证
# 执行位置: 本机 Playwright（mac_web）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端页面，用户在浏览器中可见
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard 是内网产品，E2E 用本机 Playwright 访问 localhost:5174
## journey_id: <待补：Cecelia Harness Pipeline journey UUID，Brain API 不可达时 proposer 从 /api/brain/harness/runs 补全>
## step_id: <待补：PrepPRD 未提供，proposer 从 journey 查询补全>
