# Walking Skeleton 概念深入 — Journey vs Feature 详细案例库

读这个文件的时机：
- 用户犹豫某件事是 Journey 还是 Feature
- 用户问"我这个产品该有几条 Journey"
- 拆 thin Feature 时不确定颗粒度

---

## 一、Journey vs Feature 边界 — 决策树

```
有人提出"我想做 X"
    ↓
问自己：用户走完 X 涉及的所有动作后，能不能拿到一个完整可感知的价值？
    ↓
  能 ──→ 这是一条 Journey 候选
    ↓
  问：这个价值跟现有 Journey 是同一个"为什么"吗？
    ↓
   是 ──→ X 不是新 Journey，是现有 Journey 的扩展（更大概率是 Feature）
   不是 ──→ X 是新 Journey，建一条
    ↓
  不能（用户拿不到完整价值）──→ X 是 Feature，挂到某 Journey 的某一步
```

---

## 二、产品视角：每个 Area 通常有几条 Journey？

**经验值**：1-4 条业务 Journey + 0-2 条基建 Journey + 0-1 条管理员 Journey = **2-7 条**。

少于 2 条：可能漏了基建或管理员视角
多于 7 条：90% 概率你把 Feature 当成 Journey 了，需要合并

### ZenithJoy 例子（4 条）
1. `Path 1` 客户首次成功（user_facing）
2. `Path 2` 客户日常发布（user_facing）  
3. `Path 3` 管理员运营（user_facing，但角色不同）
4. `Path 0` 基建 commit→客户用上（dev_pipeline）

### Cecelia 例子（候选）
1. Brain 自动决策→派任务→收结果（autonomous）
2. 主理人在 Dashboard 看系统状态（user_facing）
3. 远程 Codex worker 接受任务并完成（agent_remote）
4. CI/CD 自动部署（dev_pipeline）

---

## 三、Thin Feature 的"丑"边界 — 多丑算合格？

**4 条 thin 标准**之外，给出可量化指南：

| 维度 | 合格 thin（允许） | 不合格（已经在做 medium 了） |
|---|---|---|
| UI | 临时表单，无样式 / 复用其它页面布局 | 自定义组件，单独排版 |
| 错误处理 | 无（错了就崩，但 happy path 能跑） | try/catch、用户友好提示、重试 |
| 数据来源 | mock / 硬编码 / localStorage | 真 API、DB schema、迁移脚本 |
| 多场景 | 只支持 1 种最简单输入 | 多类型分支、配置开关 |
| 测试 | 1 个 happy path smoke | unit test + edge case + e2e |
| 文档 | smoke 脚本注释就够 | API 文档、用户文档 |

**心理诀窍**：写 thin Feature 时如果你有"想多写一点让它更完整"的冲动，请抑制 — 那个"多写的部分"应该作为 medium 升级时再加，不是现在。

---

## 四、何时建一条新 Journey vs 加到已有 Journey

**新 Journey 的判断标准**：
- 用户角色不同（如 admin vs end user）
- 价值闭环不同（如"产出内容" vs "回顾内容"）
- 入口/出口完全不同（不能复用现有 Journey 的中间步骤）

**加到已有 Journey 的判断标准**：
- 是同一角色的同一价值闭环里的一步
- 是某一步的另一种实现方式（如用 AI 替代人工）
- 是某一步的加厚（thin → medium → thick）

### 案例
- "AI 自动生成内容" → 不是新 Journey，是 user_facing Path 第 5 步的 Feature
- "AI 全自动代运营" → 是新 Journey（角色变成"开关用户"，不再是逐条确认用户）
- "批量发布到 8 平台" → 不是新 Journey，是 user_facing Path 第 6 步的 thicken
- "管理员后台" → 是新 Journey（角色不同）

---

## 五、Maturity 升级的"反例"教训

### 反例 1：跳级幻觉
团队做了 3 个 thick Feature，宣称 Journey 是 production。但：
- 第 1 步、第 4 步、第 7 步还是 not_started（没 Feature）
- E2E smoke 从来没通过过

→ 这个 Journey 实际还在 `not_started`，不是 production。**Maturity 永远取决于最弱的一步**。

### 反例 2：单 Feature 完美但 Journey 死亡
画像表单做到了 mature（10 字段、AI 推荐、A/B 测试），但 Journey 第 5 步（AI 生成）压根没做。

→ 浪费。永远不应该让单 Feature 升级超过 Journey 整体进度太多。

**纪律**：单 Feature 的 Thickness 不允许超过 Journey Maturity 对应的"上限"：
- Journey not_started → Feature 最多 thin
- Journey skeleton → Feature 最多 medium
- Journey mvp → Feature 最多 thick
- Journey production → Feature 可达 mature

---

## 六、什么不应该作为 Journey/Feature 进 Notion

**这些进 backlog 或别的地方，不进 Journey/Feature DB**：
- 内部代码重构（不直接产生用户价值）
- 性能优化（除非进 mature 阶段的 Feature）
- 修小 bug（不是 thicken，是日常维护）
- 工具脚本（除非它本身是 dev_pipeline Journey 的一部分）
- 文档更新（除非它是 thicken 的一部分）

**判断标准**：这件事如果做完了，能不能在 Journey 维度的 demo 里被看到？不能 → 不该进 Journey/Feature。
