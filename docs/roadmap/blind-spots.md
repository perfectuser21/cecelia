# 共同盲点清单

> 今天 Explore agent 战略分析提取的 5 个"两边都没解决"的盲点。
> 每条格式：症状 + 为什么官方也没解决 + 我们该不该做 + 工时。

---

## 盲点 1：运行时观测

- **症状**：Skill/hook 出错只能回看日志，无法实时看"当前第 N 个 agent 正在做什么、卡在哪一步"。出问题后 10-30 分钟才发现。
- **为什么两边都没解决**：Superpowers 把 skill 当作纯 prompt，不管"正在运行"状态；Cecelia Brain 有 tick log 但无活体视图。两边都默认 skill 是原子黑盒。
- **我们应不应该做**：应该。Cecelia 的 Brain 已有 task/dev-record 表，加一层"当前活跃 step + 进入时间"字段即可产出 Dashboard 热力图。
- **工时**：8h（Brain schema + tick 写入 + Dashboard 页面）

---

## 盲点 2：失败模式库

- **症状**：同样的 skill 失败（例如 CI 超时 / DoD 字段写错 / bump-version 漏文件）在不同 agent 反复发生，知识不沉淀。Learning 文件分散在 docs/learnings/ 无法查询。
- **为什么两边都没解决**：Superpowers 靠 skill 自身 prompt 给错误对策；Cecelia 靠 Learning 文件但无索引。两边都没"上次失败 → 本次预防"的可查结构。
- **我们应不应该做**：应该。Brain 已存 dev-record，新增 `failure_modes` 表 + 每次 CI 失败自动归类 tag，查询时按 tag 反查历史方案。
- **工时**：6h（新表 + CI failure parser + 查询 API）

---

## 盲点 3：并行 agent 冲突

- **症状**：Brain 可能把同任务派给多 agent，或两个 agent 改同一文件导致 merge conflict；当前靠人工"自己的 PR 落后就关 PR"兜底。
- **为什么两边都没解决**：Superpowers 单 agent 模型不考虑并行；Cecelia 有多 worktree 但无冲突探测机制（仅靠 dev-lock 防同分支重入）。
- **我们应不应该做**：应该做但优先级低。先做文件粒度 advisory lock（改前在 Brain 登记，冲突时警告），不做强制锁。
- **工时**：5h（Brain 文件锁表 + /dev skill 进入时登记 + 冲突时告警）

---

## 盲点 4：Skill 版本 migration

- **症状**：Engine 14.x 升级后若发现 skill 行为回退，无一键回退机制。当前只能 git revert 整个 PR。
- **为什么两边都没解决**：Superpowers 靠 plugin marketplace 版本管理但不做 skill 粒度；Cecelia engine 有 feature-registry 但无回退 action。
- **我们应不应该做**：应该。feature-registry 已有每 skill 的版本，加一个 `skill rollback <name> <version>` CLI 即可（复用 git checkout）。
- **工时**：3h（CLI + 测试 + SKILL.md 文档）

---

## 盲点 5：Token 成本观测

- **症状**：不知道每个 agent / 每个 skill / 每次 /dev 花了多少 token，无法优化高成本任务。当前只有月末看账单。
- **为什么两边都没解决**：Superpowers 不介入成本；Cecelia 虽有 LLM 调用但未采集 usage 回 Brain。
- **我们应不应该做**：应该。Epic E 的 E1 就是这个，预算 4h（见 EPICS.md）。
- **工时**：4h（LLM wrapper 回写 usage + Brain 表 + Dashboard 饼图）

---

## 累计工时估算

| 盲点 | 工时 |
|------|------|
| 1. 运行时观测 | 8h |
| 2. 失败模式库 | 6h |
| 3. 并行 agent 冲突 | 5h |
| 4. Skill 版本 migration | 3h |
| 5. Token 成本观测 | 4h |
| **合计** | **26h** |

> 这些盲点是"战略补强"，不进当前季度 Now 列，按 Epic E 节奏排进度。
