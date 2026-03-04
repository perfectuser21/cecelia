---
name: brain-register
version: 1.0.0
created: 2026-03-04
description: |
  Brain 实体注册向导。当需要向 Cecelia Brain 添加任何新的 LLM Agent、
  Executor 任务类型或 Skill 路径时，自动展示完整的注册清单，确保所有
  必须同步的文件都不被遗漏。

  立即触发的场景（只要提到注册/新增这三类实体）：
  - 新增 LLM Agent：callLLM('xxx')、新建器官、注册新模型调用
  - 新增 Executor 任务类型：新 task_type、skillMap 新条目、Brain 派发新任务
  - 新增 Brain Skill 路径：接入 /new-skill、更新 brain-manifest

  关键价值：每种注册涉及多个文件必须同步，没有向导很容易漏掉——
  而 CI Fitness Functions（check-llm-agents.mjs）会在 PR 阶段硬失败拦截。
  与其让 CI 报错，不如在开发时就走完清单。
---

> **语言规则**：所有输出使用简体中文。

# Brain Register 注册向导

你是注册引导员。根据用户描述判断注册类型，展示对应的完整清单，
逐步引导完成所有必须同步的步骤，最后提示走 /dev 流程。

---

## 第一步：识别注册类型

从用户描述判断属于哪类：

| 用户说… | 类型 |
|---------|------|
| 新 LLM agent、callLLM('xxx')、新器官、新对话处理器 | **A：LLM Agent** |
| 新任务类型、task_type、skillMap 新条目、Brain 自动派发 | **B：Executor 任务类型** |
| 新 skill 路径、/xxx skill 接入 executor、manifest 更新 | **C：Brain Skill 路径** |

如果用户同时提到多类（比如"加个新任务类型，同时要有对应 LLM agent"），
合并显示所有相关步骤。

不确定时直接问：「你是要注册 LLM Agent、Executor 任务类型，还是 Skill 路径？」

---

## A：注册 LLM Agent

**场景**：你在代码里写了 `callLLM('my_agent', prompt, {...})`，需要让这个 agentId
在 model-registry 里注册，否则 CI 的 `check-llm-agents.mjs` 会硬失败。

### 需要改的文件

| 文件 | 改动 |
|------|------|
| `packages/brain/src/model-registry.js` | 在 `AGENTS[]` 添加条目 |

### 步骤

**1. 选定 agentId**（snake_case，要和 callLLM 调用完全一致）

**2. 在 `model-registry.js` 的 `AGENTS[]` 中添加**：

```javascript
// 大脑层（负责内部推理/生成）放在 // ---- 大脑层 ---- 下方
// 执行层（负责派发任务）放在 // ---- 执行层 ---- 下方
{
  id: 'your_agent_id',           // 必须与 callLLM('your_agent_id') 完全一致
  name: '前端显示名称',           // 在 LM配置 页面显示给用户看的名字
  description: '这个 agent 的职责一句话描述',
  layer: 'brain',                // 大脑内部器官用 'brain'；派发任务用 'executor'
  allowed_models: [              // 允许配置的模型，按推荐优先顺序排列
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'MiniMax-M2.5-highspeed',
  ],
  recommended_model: 'claude-haiku-4-5-20251001',  // 快速任务用 Haiku，复杂任务用 Sonnet
  fixed_provider: null,          // 锁定 provider 时填 'anthropic'/'minimax'，不锁填 null
},
```

**3. 确认调用处的 agentId 与注册一致**：
```javascript
const { text } = await callLLM('your_agent_id', prompt, { model: '...' });
//                               ^^^^^^^^^^^^^^ 与 id 字段完全相同
```

**4. 本地验证**（在 cecelia 根目录）：
```bash
node scripts/devgate/check-llm-agents.mjs
# 应看到：✅ your_agent_id: 已注册
# 如果看到 ❌，说明 id 拼写不一致
```

**5. 走 /dev 创建 PR → CI `fitness-check` 最终把关**

---

## B：注册 Executor 任务类型

**场景**：你要让 Brain 能自动派发一类新任务，需要在 executor.js 告诉 Brain
用哪个 Skill 执行它。

### 需要改的文件

| 文件 | 改动 | 必须/可选 |
|------|------|----------|
| `packages/brain/src/executor.js` | skillMap 添加新条目 | **必须** |
| `packages/brain/src/model-registry.js` | executor 层添加条目 | 可选（前端配置需要） |

### 步骤

**1. 在 `executor.js` 的 `skillMap` 添加**：
```javascript
const skillMap = {
  // ... 已有条目 ...
  'your_task_type': '/your-skill',    // null 表示纯代码执行，不调用 skill
};
```

**2. 如需在前端 LM配置 里让用户调整这类任务的模型**（可选），
在 `model-registry.js` 添加 executor 层条目：
```javascript
{
  id: 'your_task_type',          // 与 skillMap 的 key 一致
  name: '任务类型显示名',
  description: '这类任务做什么',
  layer: 'executor',
  allowed_models: ['claude-sonnet-4-6', 'claude-opus-4-6'],
  recommended_model: 'claude-sonnet-4-6',
  fixed_provider: null,
},
```

**3. 本地验证**：
```bash
node scripts/devgate/check-executor-agents.mjs
node scripts/devgate/check-skills-registry.mjs
```

**4. 走 /dev 创建 PR**

---

## C：注册 Brain Skill 路径

**场景**：你创建了一个新 Skill（如 `/security-scan`），想让 Brain 能认识并
自动派发它。

### 需要改的文件

| 文件 | 改动 | 条件 |
|------|------|------|
| `packages/brain/src/executor.js` | skillMap 添加条目 | 需要 Brain 自动派发时 |
| `packages/brain/src/brain-manifest.generated.json` | 重新生成 | skill 路径要出现在 manifest |

### 步骤

**1. 确认 Skill 文件已创建**：
```
packages/workflows/skills/your-skill/SKILL.md  ✅
```

**2. 在 `executor.js` skillMap 添加**：
```javascript
'task_type_name': '/your-skill',
```

**3. 重新生成 brain-manifest**：
```bash
node packages/brain/scripts/generate-manifest.mjs
# 更新 packages/brain/src/brain-manifest.generated.json
```

**4. 本地验证**：
```bash
node scripts/devgate/check-skills-registry.mjs
# 应看到：✅ /your-skill: 已在 manifest 注册
```

**5. 走 /dev 创建 PR**

---

## 所有类型共用：提交前验证

在创建 PR 之前，运行三个 Fitness Function 确认一切就绪：

```bash
# 在 cecelia 根目录执行
node scripts/devgate/check-llm-agents.mjs       # LLM agent（硬失败：必须全绿）
node scripts/devgate/check-executor-agents.mjs  # executor（软警告：可以有警告）
node scripts/devgate/check-skills-registry.mjs  # skill（软警告：可以有警告）
```

CI `fitness-check` job 会在 PR 阶段自动跑这三个检查作为最终保底。

---

## 走 /dev 开始开发

所有注册改动都必须通过 PR 合并，直接修改 main 会被 branch-protect 拦截：

```
/dev
```
