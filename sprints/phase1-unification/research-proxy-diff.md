# autonomous-research-proxy.md 改造 Diff（T4）

**目标文件**：`/Users/administrator/perfect21/cecelia/packages/engine/skills/dev/steps/autonomous-research-proxy.md`

**改造目的**：Phase 1 模式统一后，/dev 永远是 autonomous，research-proxy 应无条件加载（不再受 `autonomous_mode` 标志门控）。

---

## 现状扫描

全文扫描 "autonomous" 出现位置共 7 行：

| 行号 | 内容 | 性质 | 是否需要改 |
|------|------|------|-----------|
| 2 | `id: dev-step-autonomous-research-proxy` | 文件 id（skill 命名一部分） | ❌ 不动 |
| 9 | `# Autonomous Research Proxy — User 交互点替换清单` | 标题 | ❌ 不动 |
| **11** | **`> **autonomous_mode=true 时必须加载到系统 context**`** | **加载条件（本次改造焦点）** | ✅ **改** |
| 44 | `\| brainstorming "Offer visual companion" \| autonomous 永不启用 \|` | 功能描述（永不启用 visual companion） | ❌ 不动 |
| 104 | `\| medium \| 继续, 但 PR body 列为 "autonomous decision, review recommended" \|` | 行为说明（低置信度 PR 备注） | ❌ 不动 |
| 105 | `\| low \| 暂停 autonomous, 创 Brain task... \|` | 行为说明（暂停自主流程） | ❌ 不动 |
| 113 | `\| autonomous-research-proxy (本文件) \| 主 agent 的 interaction 替换规则 \| 新增 \|` | 自引用 | ❌ 不动 |
| 128 | `\| 2 \| brainstorming visual companion offer \|... \| Tier 3 "autonomous 永不启用" \|` | 审计矩阵条目 | ❌ 不动 |
| 134 | `\| 8 \| finishing-a-development-branch discard confirm \|... \| autonomous abort + Brain task \|` | 审计矩阵条目 | ❌ 不动 |

**唯一加载条件措辞**：第 11 行。其余 "autonomous" 均为功能/行为语义，模式统一后仍然成立，无需改动。

---

## Edit 指令

### Edit 1：开头触发条件（唯一必须改动）

**file_path**：`/Users/administrator/perfect21/cecelia/packages/engine/skills/dev/steps/autonomous-research-proxy.md`

**old_string**：
```
> **autonomous_mode=true 时必须加载到系统 context**
> POC 已验证可行（2026-04-15，.bak gitignore 任务，27s Subagent 调研给出高置信度结论+发现原任务冗余）
```

**new_string**：
```
> **/dev 默认必须加载到系统 context**（Phase 1 模式统一后唯一路径，不再区分 autonomous_mode）
> POC 已验证可行（2026-04-15，.bak gitignore 任务，27s Subagent 调研给出高置信度结论+发现原任务冗余）
```

**改动解释**：
- 删除 `autonomous_mode=true 时` 的前置条件
- 改为 "/dev 默认必须加载"，并括注 "Phase 1 模式统一后唯一路径，不再区分 autonomous_mode"，保留历史记忆同时声明新状态
- 其余说明文字保留（POC 验证结论仍然成立）

---

## 不改动项说明

以下 "autonomous" 出现位置**刻意保留**，因为它们描述的是 research-proxy 自身的行为语义，在 Phase 1 模式统一后仍然正确：

1. **文件 id / 标题**：`dev-step-autonomous-research-proxy` 是 skill 注册名，改动会导致下游引用全部断链（SKILL.md、registry、hooks）。文件名称作为历史沿革保留。

2. **Tier 3 "autonomous 永不启用"**（行 44、128）：描述 visual companion 在任何情况下都不启用。模式统一后该语义不变，仍然"永不启用"。

3. **Confidence Handling "autonomous decision" / "暂停 autonomous"**（行 104、105）：描述低置信度时的 PR 备注和暂停逻辑。模式统一后 /dev 本身即 autonomous，这些描述直接适用，无需改写。

4. **Superpowers 审计矩阵中 "autonomous abort"**（行 134）：引用 04-ship.md §4.3 的 abort 流程名，属于引用外部命名，不在本文件改造范围。

> T3 Agent 负责处理 SKILL.md 中对 `autonomous_mode` 触发条件的引用；本文件只管 autonomous-research-proxy.md 自身。

---

## Cross-reference 检查（SKILL.md 边界）

**本 Edit 不涉及 SKILL.md 改动**。只要 T3 同步修复 SKILL.md 里 "autonomous_mode=true 时加载 autonomous-research-proxy.md" 之类的条件引用（如有），research-proxy 本体改造即完成闭环。

---

## 改动后触发条件（最终状态）

```
/dev 默认必须加载到系统 context（Phase 1 模式统一后唯一路径，不再区分 autonomous_mode）
```

**含义**：
- 任何 /dev 调用都加载 autonomous-research-proxy.md
- 所有 Tier 1/2/3 替换规则无条件生效
- Research Subagent 是 /dev 唯一的 user 交互代理路径

---

## 迁移影响（副作用评估）

### 1. Standard 模式的 /dev（已废弃）

- Phase 1 之前：Standard 模式不加载 research-proxy，user 交互点由主 agent 直接 escalate
- Phase 1 之后：Standard 模式已整体删除，不存在"Standard + research-proxy 组合"这个新情况
- **结论**：不是 bug，是设计意图的自然后果

### 2. 所有 /dev 强制走 Tier 1/2/3 替换规则

- 行为变化：原本只在 autonomous_mode=true 时触发的替换规则（如 brainstorming HARD-GATE 自主批准、finishing-branch 默认 push+PR、worktree 固定路径）现在无条件生效
- 影响面：所有 /dev 调用都会派 Research Subagent 代 user 回答，不再有"主 agent 直接问 user"的分支
- **兼容性**：符合 Phase 1 "模式统一 = 全部 autonomous" 的设计原则

### 3. Confidence Handling 低置信度分支（行 105）

- "low 置信度 → 创 Brain task 等 Alex 异步回复" 仍然生效，是 autonomous 流程内的异步逃生通道
- Phase 1 统一后，这是唯一的"人类介入"入口，权重变得更重要
- **建议**：保留不动，无需改动

### 4. 引用该文件的下游

- SKILL.md 中 `autonomous_mode=true 时加载` 条件 → 交给 T3 处理
- registry（feature-registry.yml 等） → 仍以 skill id 引用，不受影响
- 其他 steps/*.md 的交叉引用 → 都以功能描述引用，不受加载条件改动影响

---

## 汇总

- **Edit 数**：1（仅第 11 行）
- **改动后触发条件**：`/dev 默认必须加载到系统 context（Phase 1 模式统一后唯一路径，不再区分 autonomous_mode）`
- **需要 T3 配合**：SKILL.md 中同步删除 `autonomous_mode=true 时加载 autonomous-research-proxy.md` 的条件引用
- **不涉及**：文件 id、标题、Tier 3 语义、Confidence Handling、审计矩阵（均为功能性描述，模式统一后仍然正确）
