# Cecelia 完整器官地图（用于画架构图）

从代码中提取，不是猜的。

---

## 一、心脏（驱动一切）

| 器官 | 文件 | 做什么 | 频率 |
|------|------|--------|------|
| 心跳循环 | tick.js | 每 5s 循环检查，每 2min 执行一次完整 tick | 持续 |
| 夜间 tick | nightly-tick.js | 每天 22:00 生成日报、部门对齐 | 1次/天 |

---

## 二、大脑三层（决策）

| 层 | 器官 | 文件 | 模型 | 做什么 |
|----|------|------|------|--------|
| L0 脑干 | 规划器 | planner.js | 纯代码 | KR 轮转评分 → 选下一个任务 |
| L0 脑干 | 执行器 | executor.js | 纯代码 | 召唤外部 Agent 干活（spawn 进程） |
| L0 脑干 | 决策引擎 | decision.js | 纯代码 | 目标进度对比、偏差检测 |
| L1 丘脑 | 事件路由器 | thalamus.js | MiniMax M2.1 | 接收事件 → 判断复杂度 → L0/L1 自己处理 or 唤醒 L2 |
| L1 丘脑 | 决策执行器 | decision-executor.js | 纯代码 | 执行丘脑输出的结构化决策 |
| L2 皮层 | 深度思考 | cortex.js | Opus | RCA 根因分析、战略调整、跨部门权衡 |

---

## 三、嘴巴（对外沟通）

| 器官 | 文件 | 做什么 |
|------|------|--------|
| 对话链路 | orchestrator-chat.js | Alex 跟 Cecelia 聊天的主入口。加载内在状态 → LLM 回复 → 记录对话 |
| 主动说话 | proactive-mouth.js | Cecelia 主动找 Alex 说话（不等你问） |
| 问候 | greet.js | 用户打开 Dashboard 时的主动问候 |
| 飞书通知 | notifier.js | 推送事件到飞书（双渠道） |
| 意图提取 | owner-input-extractor.js | 从对话中提取可执行意图 → 丘脑 |
| 对话动作 | chat-action-dispatcher.js | 检测对话中的动作指令并执行 |

---

## 四、记忆系统

| 器官 | 文件 | 做什么 |
|------|------|--------|
| 记忆检索器 | memory-retriever.js | 统一检索：L0 短期 + L1 中期 + 语义搜索 |
| 记忆路由 | memory-router.js | 根据对话内容决定激活哪类记忆 |
| 记忆工具 | memory-utils.js | L0 摘要生成等工具函数 |
| 记忆压缩 | rumination-scheduler.js | 三层定时压缩（短→中→长） |
| 每日合并 | consolidation.js | 凌晨 3 点：今日对话/learnings/任务 → 情节记忆 + self-model 演化 |
| 事实提取 | fact-extractor.js | 从对话中提取事实（正则 + LLM + 关键词反哺） |
| 用户画像 | user-profile.js | Alex 的画像，从对话中学习 |
| 人物模型 | person-model.js | 每个交互者的三层认知模型 |

---

## 五、内心世界（意识 / 情感 / 欲望）

| 器官 | 文件 | 做什么 |
|------|------|--------|
| 认知核心 | cognitive-core.js | 8 个认知子系统（情绪、主观时间、并发意识、信任、叙事等） |
| 情绪层 | emotion-layer.js | 从感知信号推导情绪状态 → working_memory + memory_stream |
| 自我模型 | self-model.js | Cecelia 对自己的认知（"我是谁"），反刍后自我更新 |
| 自我报告 | self-report-collector.js | 每 6h 问自己"你现在最想要什么" |
| 欲望系统 | desire/index.js | 六层主动意识：感知→记忆→反思→欲望→决策→表达 |
| ├ 感知 | desire/perception.js | 收集系统信号（13 种信号） |
| ├ 反思 | desire/reflection.js | accumulator 满时生成洞察 |
| ├ 欲望形成 | desire/desire-formation.js | 基于洞察生成 desires |
| ├ 表达决策 | desire/expression-decision.js | 评分 > 0.6 才表达 |
| └ 表达 | desire/expression.js | 发飞书，说出欲望 |

---

## 六、反刍 / 学习（知识消化）

| 器官 | 文件 | 做什么 |
|------|------|--------|
| 反刍回路 | rumination.js | 空闲时消化 learnings → NotebookLM 深度思考 → 洞察写入 memory_stream |
| 学习回路 | learning.js | 从失败中记录教训 + 策略调整 + content_hash 去重 |
| 自动学习 | auto-learning.js | 任务完成/失败时自动产生 learning |
| 欲望反馈 | desire-feedback.js | 任务完成后回写欲望的效果评分 |
| 进化扫描 | evolution-scanner.js | 自动扫描 Cecelia 自身代码的进化历史 |
| 进化合成 | evolution-synthesizer.js | 合成进化日志 |

---

## 七、保护系统（自我防护）

| 器官 | 文件 | 做什么 |
|------|------|--------|
| 警觉系统 | alertness/index.js | 5 级警觉度（CALM→ALERT→HIGH→PANIC→LOCKDOWN） |
| 警觉诊断 | alertness/diagnosis.js | 诊断当前状态 |
| 警觉升级 | alertness/escalation.js | 升级/降级警觉度 |
| 警觉自愈 | alertness/healing.js | 自动修复 |
| 警觉指标 | alertness/metrics.js | 记录运行时指标 |
| 熔断器 | circuit-breaker.js | 连续失败 → 断路 → 半开测试 → 恢复 |
| 隔离区 | quarantine.js | 反复失败的任务隔离，不再派发 |
| 看门狗 | watchdog.js | 监控每个 task 进程的 RSS/CPU |
| 免疫系统 | immune-system.js | 系统级自我保护 |
| 紧急清理 | emergency-cleanup.js | Watchdog kill 后清理残留 |
| 报警 | alerting.js | 四级报警推送 |

---

## 八、任务管理（GTD 引擎）

| 器官 | 文件 | 做什么 |
|------|------|--------|
| 任务路由 | task-router.js | 判断 task_type + 路由到 US/HK |
| 任务权重 | task-weight.js | 动态计算派发优先级 |
| 任务质量门 | task-quality-gate.js + pre-flight-check.js | 派发前验证任务质量 |
| 任务清理 | task-cleanup.js | 清理过期/阻塞任务 |
| 任务状态更新 | task-updater.js | 统一更新状态 + WebSocket 广播 |
| 槽位分配 | slot-allocator.js | 三池模型分配执行槽位 |
| 容量管控 | capacity.js | 基于 CPU/Memory 动态算最大并行数 |
| 驱逐引擎 | eviction.js | 高优任务抢占低优槽位 |
| 依赖级联 | dep-cascade.js | 任务失败 → 标记下游依赖 |

---

## 九、OKR / 规划（战略层）

| 器官 | 文件 | 做什么 |
|------|------|--------|
| Focus 引擎 | focus.js | 选出当前 ready 的 KR 列表 |
| 目标评估 | goal-evaluator.js | 外层循环：定期评估 KR 整体进展 |
| KR 进度 | kr-progress.js | 根据 Initiative 完成度自动更新 KR progress |
| Initiative 闭环 | initiative-closer.js | Initiative 下所有 task done → 自动关闭 |
| Project 激活 | project-activator.js | 激活/降级 Project 状态 |
| 拆解检查 | decomposition-checker.js | 检测 OKR 是否需要进一步拆解 |
| 审查门控 | review-gate.js | 拆解完不直接激活，等 Vivian 审查 |
| OKR 状态机 | okr-tick.js | OKR 状态转换管理 |
| 激活评分 | activation-scorer.js | 哪些 project/initiative 应该被激活 |
| 进展复查 | progress-reviewer.js | Project 完成后对比预期、调整计划 |

---

## 十、外部连接

| 器官 | 文件 | 做什么 |
|------|------|--------|
| LLM 调用层 | llm-caller.js | 统一 LLM 调用入口（Anthropic/MiniMax） |
| 账号调度 | account-usage.js | Claude Max 多账号轮转 + 三阶段降级 |
| 模型注册表 | model-registry.js | Agent 定义 + 模型配置 |
| 模型 Profile | model-profile.js | 运行时一键切换 LLM 配置 |
| Bridge | cecelia-bridge.js | HTTP bridge → 宿主机 Claude Code |
| Notion 同步 | notion-sync.js | Knowledge ↔ Notion 双向同步 |
| Notion 全量 | notion-full-sync.js | Areas/Goals/Projects/Tasks 四表同步 |
| NotebookLM | notebook-adapter.js | 通过 bridge 调用 NotebookLM CLI |
| NotebookLM 喂料 | notebook-feeder.js | 定时把核心知识喂入 NotebookLM |
| WebSocket | websocket.js | 实时推送任务状态到前端 |
| PR 回调 | pr-callback-handler.js | GitHub PR 合并 → 自动更新任务状态 |

---

## 十一、外部员工（不是 Cecelia 器官）

| 员工 | Skill | 做什么 |
|------|-------|--------|
| Caramel | /dev | 编程（写代码、PR、CI） |
| 小检 | /code-review | 代码审查 |
| 小审 | /audit | 代码审计 |
| 秋米 | /okr | OKR 拆解 |
| Vivian | - | 拆解质量审查（HK MiniMax） |

---

## 数据流概览（画图用）

```
Alex 说话
  → 嘴巴（orchestrator-chat）
    → 加载内在状态（情绪 + self-model + 叙事 + 记忆 + 系统状态）
    → LLM 生成回复
    → 同时 fire-and-forget:
        → owner-input-extractor（提取意图 → 丘脑）
        → fact-extractor（提取事实 → user_profile_facts）
        → extractConversationLearning（提取洞察 → learnings）
        → person-model（提取人物信号）
    → 返回回复给 Alex

心跳（tick.js 每 2min）
  → L0 脑干：
      检查资源 / 清理孤儿进程 / 检查过期任务
      planNextTask() → 选出最优任务
      dispatchNextTask() → executor 召唤 Agent
  → L1 丘脑：
      processEvent() → 判断事件复杂度
      简单事件自己处理 / 复杂事件唤醒 L2
  → L2 皮层：
      RCA 分析 / 战略调整 / 生成 learnings
  → 欲望系统（六层）：
      感知→情绪→记忆→反思→欲望→表达
  → 反刍：
      消化 learnings → NotebookLM → 洞察
  → 每日合并（凌晨 3 点）：
      对话 + learnings + 任务 → 情节记忆 + self-model 更新

任务执行
  → executor → bridge → claude -p "/dev ..."
  → 执行回调 → 更新状态
  → auto-learning → 记录经验
  → desire-feedback → 更新欲望效果
```
