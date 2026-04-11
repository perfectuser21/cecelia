# KR5 Dashboard 演示脚本 — 20 分钟完整路径

**目标**: 展示 Cecelia 自主运行平台 Dashboard 的 3 大核心模块
**受众**: 技术/产品评审
**总时长**: 约 20 分钟
**URL**: http://localhost:5211 (本地) / http://38.23.47.81:5211 (远程)

---

## 准备工作（演示前 5 分钟）

```bash
# 确认 Brain 运行
curl localhost:5221/api/brain/tick/status | jq '.alertness.levelName'

# 确认 Dashboard 可访问
curl -s http://localhost:5211/ -o /dev/null -w "%{http_code}"
```

确认数据：
- Brain 有 ≥1 个 in_progress 任务
- 有 ≥1 个 Harness Pipeline 记录（`/pipeline`）

---

## 模块 1: Live Monitor — 系统实时监控（5 分钟）

**路径**: System → Live Monitor (`/live-monitor`)

### 演示点

1. **左栏 — 基础设施状态**
   - INFRA：US Mac mini + HK VPS 运行状态（CPU/内存）
   - BRAIN：Brain 每日 Actions 数、警觉等级（NORMAL/ALERT）
   - AGENTS：活跃 Claude Code session 数量

2. **右栏 — OKR 总览**
   - Global OKR 进度树（当前 Cecelia KR5 = 58%）
   - Projects by Area（Notion 风格表格）

3. **自动刷新**（5 秒间隔）
   - 指出右下角"刷新倒计时"
   - 说明 Promise.allSettled 保护：任一 API 失败不影响其他面板

**话术**: "这是系统神经中枢视图 — Brain 每 5 秒感知全局状态，Dashboard 同步展示。"

---

## 模块 2: Harness Pipeline — GAN 对抗流水线（10 分钟）

**路径**: System → Harness Pipeline (`/pipeline`)

### 2a. Pipeline 列表（3 分钟）

1. 展示最近 5 条 Pipeline 记录
2. 解释 6 步流水线结构：
   ```
   Planner → Propose → Review → Generate → CI Watch → Report
   ```
3. 指出颜色系统：✅ 完成 / 🔄 进行中 / ❌ 失败 / ⏸ 暂停
4. 展示"已通过"的 Pipeline 卡片，展开看各阶段状态徽章

**话术**: "Harness 是 Cecelia 的代码生产线 — Generator 写代码，Evaluator 对抗审查，GAN 无上限轮次直到合格。"

### 2b. Pipeline 详情 — 三栏钻取（7 分钟）

1. 点击有 `planner_task_id` 的 Pipeline 右侧"详情 →"按钮
2. 进入 `/pipeline/:id` 详情页
3. 展示**阶段时间线概览**（横向进度条）
4. 展示**执行步骤列表**（按时间排序）
5. 点击某步骤展开**三栏视图**：

   | Input | Prompt | Output |
   |-------|--------|--------|
   | 任务描述/上下文 | 发送给模型的 Prompt | 模型返回的内容 |

6. 滚动对比 Propose R1 和 Review R1 的内容，展示 GAN 对抗
7. 点击 PR 链接（如有）跳转 GitHub PR

**话术**: "每一步都有完整的 Input/Prompt/Output 三栏审计 — 完全透明，可追溯。这是 AI 系统的黑盒变白盒。"

**推荐演示 Pipeline**: 找 verdict=completed 且 steps≥6 的 Pipeline

---

## 模块 3: Brain Models — 模型切换面板（5 分钟）

**路径**: System → Brain Models（侧边栏，直接点击导航子项 `/brain-models`）

### 演示点

1. 展示 **Profile 列表**（fast/standard/premium 三档配置）
2. 查看**当前激活 Profile**（绿色 ACTIVE 徽章）
3. 展开查看各器官配置：
   - 丘脑（Thalamus）— L1 事件路由
   - 皮层（Cortex）— L2 深度决策
   - 口（Mouth）— 回复生成
   - 记忆（Memory）— 记忆检索
4. 演示**切换模型**操作（点击 Edit → 选择模型 → Save）
5. Toast 反馈确认操作成功

**话术**: "Brain 是模块化的 — 每个器官可以独立配置模型。紧急节约成本时切到 fast profile，深度推理时切到 premium。"

---

## 收尾（1 分钟）

回到 Live Monitor，指出：
- Brain 今日 Actions 数（展示系统活跃度）
- 当前 KR5 进度（当前 58%，目标 80%+）
- "这 3 个模块已无阻断 bug，可以承接 20 分钟完整演示。"

---

## 已知限制（演示中如遇到，提前说明）

| 场景 | 说明 |
|------|------|
| Pipeline "详情"按钮不显示 | 该 Pipeline planner_task_id 为 null（旧数据），选有按钮的 Pipeline |
| Live Monitor 某面板显示空 | 部分依赖远程服务（HK VPS/Codex），本地开发无数据是正常的 |
| Brain Models 切换失败 | API 返回 400/500 时会显示 Toast 错误，不会崩溃 |

---

_生成时间: 2026-04-11 | 版本: v1.0_
