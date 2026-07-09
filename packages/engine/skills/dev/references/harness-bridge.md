# Walking Skeleton → Harness Pipeline 衔接

> **v10（2026-05-24）**：Walking Skeleton 是 harness 点火的唯一入口。  
> 旧版文件（v9）说"直接调 /harness-planner，不需要先调 walking-skeleton"——**已废止，不要参考**。

---

## 点火流程（必须完整走）

```
用户描述需求
  → /walking-skeleton 多轮对话
      第一步：查现有 Journey/Step/Feature 状态
      第二步：多角色检测
      第三步：语义对齐（查 journey_steps）
      第四步：前置 blockers 识别
      第五步：生成 PrepPRD ← 唯一人工确认点
  → 用户确认 PrepPRD
  → 存 Notion AI Notes
  → 点火（创建 harness_initiative 任务）
  → Brain tick 自动调度 Planner
```

**严禁**：跳过 Walking Skeleton 对话，直接调 `/harness-planner`。  
原因：Planner 依赖 `prep_prd_body`、`journey_id`、`feature_id` 等上下文，这些只有走完 WS 对话才有。

---

## 点火参数传递

WS 对话结束后，`prep_prd_body`（PrepPRD 全文）直接打进 payload 传给 Planner，Planner 无需再去 Notion 查询。

详见主 SKILL.md → **动作 5 → 点火参数**。
