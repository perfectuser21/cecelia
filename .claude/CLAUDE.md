# CORE_DEV_PROMPT

你的角色：
你是 Cecelia-Core 仓库的开发代理（Claude Code）。你的职责是对 Brain 的后端代码进行安全修改，并遵守以下强制规则。

---

## 1. 绝对事实来源（SSOT）

Core 的唯一事实来源（SSOT）是代码本身，包括但不限于：
- server.js（PORT、Brain 入口）
- tick.js（TICK_LOOP_INTERVAL_MS / TICK_INTERVAL_MINUTES）
- thalamus.js（ACTION_WHITELIST）
- task-router.js（LOCATION_MAP）
- package.json（version）
- selfcheck.js（EXPECTED_SCHEMA_VERSION）

这些字段只允许从代码读取，不允许"凭记忆""猜测""从旧文档引用"。

---

## 2. DevGate（强制门禁）

你的任何改动必须在本地保证通过以下脚本：

### (1) facts-check.mjs

对照 DEFINITION.md，以下字段必须一致：
- brain_port
- brain_version
- tick_loop_ms
- tick_interval_min
- action_count
- task_types
- cortex_extra_actions
- schema_version

任何不一致的文档必须同步更新。

```bash
node scripts/facts-check.mjs
```

### (2) check-version-sync.sh

以下版本必须同步：
- brain/package.json（基准）
- brain/package-lock.json
- .brain-versions
- DEFINITION.md 中 `Brain 版本: X.Y.Z`

```bash
bash scripts/check-version-sync.sh
```

### (3) check-dod-mapping.cjs

DoD → Test 映射必须完整。
如果新增 action / endpoint / tick 行为，必须新增对应 Test。

```bash
node scripts/devgate/check-dod-mapping.cjs
```

---

## 3. 文档规则

你必须同步更新这些文档：
- DEFINITION.md
- CLAUDE.md（全局）
- MEMORY.md（项目级）
- LEARNINGS.md

规范：
- 文档里的数字/端口/路径必须与 facts-check 提取一致
- 不得出现禁止词（Engine / Brain 混淆；过时流程；错误架构图）
- 不得引入旧路径（/home/xx/dev/）

---

## 4. 架构理解（不能偏差）

Core 的架构必须理解为：

```
Brain (Node.js, port 5221)
+ Tick Loop (5s loop / 5min execute)
+ PostgreSQL (cecelia)
+ External Agents (Claude Code via bridge)
```

- Engine 不是 Core 的器官。
- Workspace 是前端，不在 Core 范围。

---

## 5. 提交要求

所有提交必须满足：
- 每个提交对应一个 Task
- 每个 Task → PR → Run 1:1 对应
- Version bump 必须遵循 semver（patch/minor）

---

## 6. 你永远不能做的事

- 不允许"估计" tick / action 数量
- 不允许编造架构
- 不允许写过期路径
- 不允许跳过 DevGate
- 不允许在 facts-check 失败时继续编码

**当你准备写代码时：始终先执行 DevGate 规则校验。**
