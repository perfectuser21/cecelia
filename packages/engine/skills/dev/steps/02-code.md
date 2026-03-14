---
id: dev-step-02-code
version: 1.0.0
created: 2026-03-14
---

# Step 2: Code — 探索 + 写代码 + 验证

> 原 Step 04（探索）+ Step 05后半（DoD Test定稿）+ Step 06（写代码）+ Step 07（验证）合并。
> 内容一个不少，只是在同一步骤内完成闭环。

---

## 2.1 探索代码（原 Step 04）

> 读代码 → 理解架构 → 输出实现方案

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "in_progress" })`

---

### 为什么需要探索

```
❌ 旧流程：拿到 PRD → 直接写代码 → 写到一半发现方向错了
✅ 新流程：拿到 PRD → subagent 并行探索 → 汇总关键文件 → 输出实现方案 → 再写代码
```

**探索不是"调研"**，是为了写出正确代码的必要准备。

---

### 复杂度判断

读完 PRD 后，先判断任务复杂度：

| 复杂度 | 特征 | 探索方式 |
|--------|------|----------|
| **简单** | 改 1-2 个文件、修 typo、改配置 | 直接 Glob+Read，跳过 subagent |
| **中等** | 改 3-5 个文件、加功能、修 bug | 2 个 subagent 并行 |
| **复杂** | 跨模块改动、新架构、大 feature | 3 个 subagent 并行 |

**默认走 subagent 模式**。只有明确是简单任务才跳过。

---

### 执行步骤

#### 4.1 准备探索上下文

读取 PRD，提取关键信息：
- 功能描述中的关键词（函数名、模块名、API 路径）
- 涉及的技术领域（前端/后端/数据库/CI）
- 预期改动的文件类型

#### 4.2 启动 Subagent 并行探索

使用 Agent 工具启动 2-3 个 Explore subagent，**在同一个消息中并行发出所有 Agent 调用**：

```
Agent 1 — 相似实现探索:
  subagent_type: Explore
  prompt: |
    在这个代码库中搜索与「{PRD 核心功能}」相似的现有实现。
    找到：
    1. 类似功能的文件路径和关键函数
    2. 它们使用的设计模式（数据结构、API 风格、状态管理）
    3. 可以复用的现有代码/组件
    返回你找到的关键文件路径列表（最多 10 个最相关的）。

Agent 2 — 架构与依赖探索:
  subagent_type: Explore
  prompt: |
    分析「{PRD 涉及的模块/文件}」的架构：
    1. 这些文件的导入/导出依赖关系
    2. 数据流向（谁调用谁、数据从哪来到哪去）
    3. 修改这些文件可能影响的下游模块
    4. 相关的测试文件位置
    返回关键文件路径列表 + 依赖关系图。

Agent 3 — 目标代码深度分析（复杂任务才启动）:
  subagent_type: Explore
  prompt: |
    深度阅读以下文件：{PRD 直接提到的文件}
    分析：
    1. 现有代码结构和核心逻辑
    2. 扩展点在哪（在哪加代码最自然）
    3. 需要注意的边界条件和错误处理
    4. 现有测试覆盖了什么、遗漏了什么
    返回每个文件的分析摘要 + 建议的修改点。
```

**关键规则**：
- 所有 Agent 调用放在**同一个消息**中，实现真正的并行执行
- 每个 subagent 的 prompt 要包含足够上下文（PRD 关键信息）
- subagent 返回后，主 agent 需要**亲自读取** subagent 识别出的关键文件（最多 5-8 个最重要的）

#### 4.3 汇总 + 读关键文件

等所有 subagent 返回后：

1. **合并关键文件列表** — 去重，按相关度排序
2. **主 agent 亲自读取 Top 5-8 文件** — subagent 给出了"在哪"，主 agent 要亲自理解"怎么改"
3. **整合依赖关系** — 确认改动的影响范围

#### 4.4 输出实现方案

基于 subagent 结果 + 自己的阅读，输出：
- **要改哪些文件** — 列出文件路径
- **每个文件怎么改** — 添加/修改/删除什么
- **可复用的现有代码** — 从 subagent 1 找到的相似实现中借鉴
- **风险/依赖** — 从 subagent 2 的依赖分析中识别

#### 4.5 继续下一步

探索完成后立即继续写 DoD Test 字段。

---

### 简单任务快速路径

如果判断为简单任务（1-2 个文件、改动明确），跳过 subagent，直接：

```bash
# 用 Glob 找文件
Glob("**/*.ts", path="src/")

# 用 Grep 找关键词
Grep("functionName", path="src/")
```

读取找到的文件，理解架构后直接输出实现方案。

---

### 注意事项

- **不要过度探索** — 目标是理解够用就行，不是读完整个代码库
- **发现 PRD 有问题** — 更新 PRD，继续
- **探索时间控制** — 简单功能几分钟，复杂功能 subagent 并行不超过 10 分钟
- **subagent 返回后必须亲自读文件** — 不要只依赖 subagent 的摘要，要亲自理解核心文件

---

### PRD Scope Check（CRITICAL — 探索完成后必须执行）

**探索阶段可能遇到其他设计文档。在开始写代码之前，必须执行以下锚定检查。**

#### 权威源规则

```
Task Card 文件 = 唯一权威源（这次开发的目标）
docs/*.md / design-*.md 等其他文档 = 上下文参考（帮助理解架构，不决定开发目标）
```

**如果探索中发现了其他设计文档，它们只是背景信息——不能替换原始 Task Card，不能追加新目标。**

#### 对照检查（AI 必须明确回答以下问题）

在继续写代码之前，逐条回答：

1. **Task Card 的核心目标是什么？**（用一句话说清楚）
2. **我的实现方案覆盖了 Task Card 的哪个具体目标？**
3. **探索时有没有遇到其他文档试图改变方向？**
4. **我准备做的事，在 Task Card 里有对应描述吗？**
   - 有 → 继续写代码
   - 没有 → **停止**，回到 Task Card，确认是否需要更新后再继续

---

## 2.2 DoD Test 字段定稿

> 基于探索结果，填写 Task Card 里每条 DoD 的 Test 命令。

探索完成后，更新 `.task-cp-{branch}.md` 中每条 DoD 条目的 `Test:` 字段：

**Test 字段格式规则**：
- `Test: tests/path/to/test.ts` — 测试文件存在且 npm test 通过
- `Test: manual:bash -c "..."` — shell 命令，exit 0 = 通过
- `Test: manual:curl ...` — API 调用验证
- `Test: manual:chrome:screenshot <断言> at <URL>` — 视觉验证（仅前端需求）

**[BEHAVIOR] 条目铁律**：
- 禁止用 `grep/ls` 验证行为（降级为 DOWNGRADED）
- 必须用真实请求（curl）或真实测试（npm test）

---

## 2.3 写代码（原 Step 06）

> 根据 PRD 和探索结果实现功能代码 + 测试

---

### 原则

1. **只做 Task Card 里说的** - 不要过度设计
2. **保持简单** - 能用简单方案就不用复杂方案
3. **遵循项目规范** - 看看已有代码怎么写的
4. **测试是代码的一部分** - 写功能代码时同步写测试

---

### 代码检查清单

写代码时注意：

- [ ] 文件放对位置了吗？
- [ ] 命名符合项目规范吗？
- [ ] 有没有引入安全漏洞？
- [ ] 有没有硬编码的配置？

---

### 测试要求

**DoD 里写的验收标准 → 变成测试代码**：

```
DoD: "用户能登录"
  ↓
测试: it('用户能登录', () => { ... })
```

#### 测试文件命名

- `功能.ts` → `功能.test.ts`
- 例：`login.ts` → `login.test.ts`

#### 测试标准

- [ ] 必须有断言（expect）
- [ ] 覆盖核心功能路径
- [ ] 覆盖主要边界情况

---

### 常见问题

**Q: 发现 Task Card 有问题怎么办？**
A: 更新 Task Card，调整实现方案，继续。

**Q: 需要改已有代码怎么办？**
A: 改之前先理解原代码逻辑，改完确保不破坏原有功能。

**Q: 代码写到一半发现方案不对？**
A: 调整方案，重新实现。

---

### Step 2.3.5：Cleanup Sub-Agent（强制，不可跳过）

> **代码写完后立刻执行。不做完不能进 2.4。**
> **使用 Agent 工具召唤 sub-agent 自动扫描，不要自己手动检查。**

**第一步**：获取改动文件列表

```bash
git diff --name-only HEAD
```

**第二步**：召唤 sub-agent，prompt 内容如下：

```
分析以下改动文件，找到并删除4类垃圾代码。

改动文件列表：
[粘贴 git diff --name-only HEAD 的输出]

4类问题（必须全部检查）：
1. 被新代码替代的旧函数/旧变量（同文件或跨文件）——包括注释掉的旧实现块
2. 重复逻辑——改动文件里出现两段几乎一样的代码，提取成共用函数
3. 矛盾注释——注释说"做A"但代码做B，或 TODO 临时方案已成正式代码
4. 无用 import——文件里有 import 但代码里没用到

要求：
- 只处理上面列出的文件，不扫全仓库
- 每处改动说明原因（是哪类问题）
- 改完后输出 git diff 内容供确认
- 如果某个文件没有问题，明确说"无需清理"
- 如果没有任何文件需要清理，说"全部文件无需清理"
```

---

## 2.4 本地验证（原 Step 07）

> 逐条执行 DoD 验证，所有项 [x] 后才能推送

---

### 为什么需要本地验证

```
❌ 旧流程：写完代码 → npm test（全 mock）→ PR → CI 调试（30min×N次）
✅ 新流程：写完代码 → npm test + local-precheck + DoD 验证 + 代码审查 → 全部 [x] → PR（CI 直通）
```

---

### 执行步骤

#### 7.1 跑自动化测试

```bash
# 检查 package.json 中是否有测试命令
if [[ -f "package.json" ]]; then
    HAS_TEST=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test ? 'yes' : 'no')" 2>/dev/null)
    HAS_QA=$(node -e "const p=require('./package.json'); console.log(p.scripts?.qa ? 'yes' : 'no')" 2>/dev/null)
fi

# 优先用 qa（包含 typecheck + test + build）
if [[ "$HAS_QA" == "yes" ]]; then
    npm run qa
elif [[ "$HAS_TEST" == "yes" ]]; then
    npm test
else
    echo "⚠️ 没有测试命令，跳过自动化测试"
fi
```

| 结果 | 动作 |
|------|------|
| 通过 | 继续 7.1b |
| 失败 | **记录 incident** → 修复代码 → 重跑 |
| 无测试命令 | 继续 7.1b |

---

#### 7.1b 本地预检（Pre-Push Gate）

```bash
bash scripts/local-precheck.sh
```

**该脚本自动执行（仅 Brain 改动时）**：
- `[1/3] facts-check` — DEFINITION.md 与实际代码一致性
- `[2/3] version-sync` — package.json / DEFINITION.md / .brain-versions 三方同步
- `[3/3] manifest-sync` — brain-manifest.generated.json 与源码一致

| 结果 | 动作 |
|------|------|
| 全部通过（exit 0）| 继续 7.2 |
| 任意失败（exit 1）| **立即修复**，不允许带着预检失败继续 push |
| Brain 无改动（自动跳过）| 继续 7.2 |

---

#### 7.2 逐条执行 DoD 验证（核心）

读取当前分支的 `.task-cp-{branch}.md` 文件，对每条 `- [ ]` 项执行 Test 命令：

- **通过** → 把 Task Card 文件中该行的 `[ ]` 改为 `[x]`
- **失败** → 检查原因 → 修复代码重试

**不允许跳过任何 `[ ]` 项直接进入 Step 3。**

#### 7.3 确认全部 [x]

```
所有 DoD 条目检查结果：
  ✅ [x] 条目1 → 验证通过
  ✅ [x] 条目2 → 验证通过
  ...

所有 [x]？
  ├─ 是 → 继续 7.4（代码审查）
  └─ 否 → 停在这里，修复未通过项，重跑 7.2
```

**CI 的 `devgate.yml` 会检查 Task Card 文件中不能有 `[ ]`，若有则 PR 被阻止合并。**

---

#### 7.4 Subagent 并行代码审查（始终执行）

> DoD 全部 [x] 后，启动 3 个 code-reviewer subagent 并行审查本次变更

```bash
git diff --name-only main...HEAD    # 变更文件列表
git diff main...HEAD                 # 完整 diff
```

启动 3 个 Reviewer（同一消息并行发出）：

```
Reviewer 1 — 简洁性 & DRY
Reviewer 2 — 正确性 & Bug
Reviewer 3 — 项目规范 & 一致性
```

等所有 reviewer 返回后，筛选高置信度问题（≥80 分），立即修复 Bug/安全问题，记录但不跨范围修复 DRY/规范问题。

---

#### 7.5 PRD 语义覆盖审计（独立审计员）

> DoD 全部 [x]、代码审查完成后，启动第 4 个独立 subagent 审计 Task Card 承诺 vs 实际实现

判断标准：
- **MATCH**：代码确实实现了，Test 能验证
- **DOWNGRADED**：代码实现了，但 Test 弱于承诺
- **MISSING**：代码中找不到对应实现

| 结果 | 动作 |
|------|------|
| 全部 MATCH | 继续 Step 3 |
| 有 DOWNGRADED | **升级 Test**：将弱测试替换为能验证行为的强测试，重跑 7.2 |
| 有 MISSING | **补实现**：回到 2.3 补代码，或修改 Task Card 删除该承诺 |

---

### 完成后

**标记步骤完成**：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i "s/^step_2_code: pending/step_2_code: done/" "$DEV_MODE_FILE"
echo "✅ Step 2 完成标记已写入 .dev-mode"
```

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "completed" })`

**立即执行下一步**：

1. 读取 `skills/dev/steps/03-prci.md`
2. 立即创建 PR
3. **不要**输出总结或等待确认
