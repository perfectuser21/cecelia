# 便宜闸读不到 Notion 指定的 Agent/Workflow — 设计

- Brain task: `a91700c2-4fd4-47fd-bbf6-b0ef81ce89ba`
- Decision: `522e9c8e`（bug-fix）
- 判定点: `0aa5d290`（停用 workflow 的回落）、`aae169cd`（agentRef 支路带电，主理人拍板）
- base: `origin/main` @ `745222ed8a`
- GP-Anchor: `none(infra)`（cecelia 无 product-map；`g5/compute_dispatch` 在中央 map 查无，已纠正）

---

## 1. 问题

主理人在 Notion 中文 GTD 表填的「执行 Agent / Workflow」被整条丢弃，每条非设备秋米任务都被迫去打 Jev 猜一遍。

**根因是规格分叉，不是笔误。**

| 位置 | 合同 |
|---|---|
| `docs/superpowers/plans/2026-09-23-qiumi-task-router-pr2.md:920` | 实现写 `agent_workflow_ids` |
| `docs/superpowers/plans/2026-09-23-qiumi-task-router-pr3.md:21/397` | 消费规格写 `relations:{agents,workflows,skills}` |

PR2 按前者实现（`notion-push-sync.js:411-416`），PR3 按后者消费（`routing/cheap-gates.js:42/50`）并照文档抄了测试。两份 plan 从一开始就是两份不同的合同。

**为什么没被任何守卫发现**：两头各自有绿测试，中间没有横跨两端的契约测试。

| 测试 | 钉住的形状 | 状态 |
|---|---|---|
| `__tests__/notion-push-sync-marked-ingest.test.js:66` | `agent_workflow_ids: ['wf-1']` | 绿 |
| `routing/__tests__/cheap-gates.test.js:11` | `relations: { workflows: [...] }`（生产从不产生） | 绿 |

**生产实证**：线上 7 条秋米任务，`agent_workflow_ids` 键 7/7 有，`relations` 键 0/7。真实 `qiumi_source` 键为
`['agent_workflow_ids','body','business_task_ids','channel','due_at','owner_ids','priority_raw','remark','skill_ids','title']`。

---

## 2. 架构

一份形状、两头 import。消费方不再有能力自造形状。

```
Notion 页
   ↓ parseZhPage()                       notion-gtd-sync.js:46
zh（已解析的扁平值）
   ↓ qiumiSourceFromNotion({title,zh,en,zhBody,enBody,dueAt})   ← 新，封回落逻辑
   ↓   内部调 buildQiumiSource(flat)                             ← 新，唯一真身
qiumi_source
   ↓ 落 tasks.payload.metadata
   ↓ cheapGates(task, pool, env)          routing/cheap-gates.js:36
路由决策
```

**模块位置**：`packages/brain/src/lib/qiumi-source.js`

依据 `lib/ssh-args.js:7-14` 的分层倒置理由——让 `routing/cheap-gates.js` 去 import `notion-push-sync.js`
会拖进整条 Notion API / DB pool 重依赖链。同域先例：`lib/qiumi-status-map.js`（"唯一真身：改状态语义只改这里"）。
正面支撑：invariant `76cb816c`「枚举语义常量只允许一份，落在被各消费方共同 import 的 service；手抄同值副本 = 隐形炸弹」。

**两层签名**（对抗审查缺陷 1）：

```js
// 扁平层——8 处测试与 2 个 smoke 用这个
buildQiumiSource({ title, remark, body, priorityRaw, dueAt, channel,
                   agentWorkflowIds, skillIds, businessTaskIds, ownerIds })

// Notion 层——notion-push-sync.js 用这个，封 zh?.x ?? en.y 回落
qiumiSourceFromNotion({ title, zh, en, zhBody, enBody, dueAt })
```

单层签名（只有 Notion 层）会逼测试和 smoke 伪造 `zh`/`en`，等于把漂移从 `qiumi_source` 挪到 `zh`，比手搓更糟。

---

## 3. 组件改动

### 3.1 `routing/cheap-gates.js:42-56`

读 `src.agent_workflow_ids`（Agent/Workflow 混合数组），**分两趟**匹配：先 workflows 池、后 agents 池。
删掉死形状 `src.relations`。`norm()` 去连字符逻辑不动。

**两趟不可合并为一趟**：`toMatchObject` 对数组是「长度必须相等 + 严格按序」（本仓 `@vitest/expect` 实跑确认，
子集与乱序均报错）。合成一趟会让 `matchedBy` 顺序随 id 顺序变，打破 `cheap-gates.test.js:33/38/46/86/90`
等与本 bug 无关的用例。两趟保证 `relation:workflow` 恒在 `relation:agent` 前。

**tie-break 改为用户顺序**：现状遍历的是池（`ORDER BY name`），用户在 Notion 选两个 workflow 时
赢的是字母序靠前的那个，不是先选的那个。改为在每一趟内遍历 `src.agent_workflow_ids`（用户顺序）取首个命中。
对照：text 分支已有显式 tie-break（取最长命中，`cheap-gates.js:66-73` + 用例 `:92-96`），relation 分支原本没有。

**一个 id 同时命中两池**：`ops_agents.notion_id`（`migrations/433:12`）与 `ops_workflows.notion_id`
（`migrations/436:16`）均为 `TEXT` 且无 UNIQUE，理论可能。定为**允许**——两趟各自独立设值，
`matchedBy` 可出现 `['relation:workflow','relation:agent']`。补用例钉住，不假装不会发生。

### 3.2 `notion-push-sync.js:411-416`

改为调用 `qiumiSourceFromNotion(...)`，返回值与抽取前逐字节等价。

**两个必须钉死的语义**（对抗审查缺陷 3）：

- `remark: zh?.remark ?? en.description` 用 `??` 不是 `||`。`plain()`（`notion-gtd-sync.js:34`）恒返回字符串，
  空时是 `''`。所以中文页存在但「备注」为空时 `remark=''`，**不回落**到 `en.description`。
- `body: zhBody || enBody` 用 `||`，空串**必须**回落。

相邻两行一个 `??` 一个 `||` 是刻意的，builder 里带注释，基线测试两种都钉。

`zh === null` 是真实路径（`notion-push-sync.js:384` 反查不到中文行），四个 `zh?.xxxIds ?? []` 的可选链不能丢。

### 3.3 `docs/superpowers/plans/` 错误合同

同 PR 改掉 `qiumi-task-router-pr3.md:21/397/416/559` 与 `pr2.md:19` 的 `relations{agents,workflows,skills}`。
这是唯一能防住「下一个照文档干活的 agent 把 `relations` 写回来」的动作。

### 3.4 自造形状收编

共 12 处消费方自己手搓 `qiumi_source`，分两类：

**甲类——死形状 `relations`（生产从不产生，必须删）**

| 文件 | 行 |
|---|---|
| `routing/__tests__/cheap-gates.test.js` | 11 / 32 / 37 / 45 |
| `routing/__tests__/qiumi-router.test.js` | 62 / 226 / 238 / 252 |

**乙类——手搓扁平子集（键名没错，但仍是各自一份，下次漂移照样发现不了）**

| 文件 | 行 | 手搓的键 |
|---|---|---|
| `scripts/smoke/qiumi-phone-agent-smoke.mjs` | 66-71 | `{title, remark, channel, body}` |
| `scripts/smoke/qiumi-routing-smoke.mjs` | 169 | 同上 |
| `__tests__/dispatcher-qiumi-routing.test.js` | 103 | `{title}` |
| `__tests__/openclaw-agent-executor.test.js` | 54 / 275 | `{title, remark, body}` / `{}` |

两类全部改从 `buildQiumiSource(flat)` 取（乙类的全部字段都有默认值，改后调用点更短）。

**`qiumi-router.test.js:236-248` 特殊处理**：它是 `agentRef:serial` 支路的唯一覆盖（见 3.5）。
处理方式是**改形状、保断言**——把它的 `relations` 换成 builder，但 `expect` 的断言语义一字不动。
不是「跳过不改」，也不是「随甲类一起删」。

smoke 技术上无障碍（`packages/brain/package.json:3` 是 `"type":"module"`，两个 `.mjs` 已在 import src）。
但注意 **CI 不跑 qiumi smoke**（`.github/workflows/*.yml` grep `qiumi` 零命中），它们由
`ci-smoke-glob-runner.yml:114` 的棘轮跑且需真 Postgres + `JEV_API_KEY`——改坏了不会当场红。

### 3.5 行为变化声明：`agentRef` 支路首次带电

`cheap.agentRef` 今天恒为 null（只有 relation:agent 分支写它，而该分支从未命中；text 分支只写
`department`，见 `cheap-gates.js:71-74`）。修好后首次带电，激活下游：

```
Notion 选中 Agent 行，名字含池内某序列号
   → qiumi-router.js:68-72  serialFromAgentRef 子串命中
   → qiumi-router.js:117-124  cheap.serial + isDevice=true + matchedBy 加 'agentRef:serial'
   → qiumi-router.js:166      直接定案设备，跳过 Jev
```

主理人已拍板**让它带电**（判定点 `aae169cd`），本 PR 补用例钉住该行为。

---

## 4. 错误路径

| 场景 | 行为 |
|---|---|
| `agent_workflow_ids` 缺失/空（旧任务） | `?? []` 兜底，回落文本匹配 + Jev，不崩 |
| 指定的 workflow `active=FALSE` | 不在池 → 不命中 → 回落 Jev，且 `matchedBy` **不得**出现 `relation:*`（判定点 `0aa5d290`，留痕给主理人看「指定了但没生效」） |
| 同一 id 命中两池 | 允许，两趟各自设值，`matchedBy` 两个标签都在 |
| 命中的 agent 名不在 `env.departments` | 落 `agentRef` 而非 `department`（现有分流不动） |
| `zh === null`（反查不到中文行） | 四个 id 数组取 `[]`，`remark` 回落 `en.description` |

---

## 5. 测试策略

| 档 | 内容 |
|---|---|
| **contract（本次核心）** | 三段串联 `parseZhPage → qiumiSourceFromNotion → cheapGates`，workflow 与 agent **两条都断言**。骨架照 `__tests__/notion-push-sync-marked-ingest.test.js:214-220` 的同值守卫。只断 workflow 一半挡不住「实现忘了喂 agents 池」 |
| **unit** | `lib/__tests__/qiumi-source.test.js`：基线字面量 `toEqual`（模板照 `lib/__tests__/ssh-args.test.js:17-30`），**并对 `JSON.parse(JSON.stringify(built))` 再断一次**——终点是 `jsonb`，JS 层 `toEqual` 忽略 undefined 键、与落库形状不是一回事。补 `zh: null` 用例 |
| **unit** | `cheap-gates.test.js`：多选 tie-break 取用户顺序、一 id 命中两池、`active=FALSE` 回落且 `matchedBy` 无 `relation:*` |
| **unit** | `qiumi-router.test.js`：`agentRef:serial` 支路带电行为（保留 `:236-248` 语义） |
| **integration** | 不新增。`lint-feature-has-smoke` 因 `fix:` 前缀 + 无 feature label 跳过（`scripts/lint-feature-has-smoke.sh:24-40`），不为 bugfix 硬造 smoke |

**变异测试（手工纪律，CI 无机械闸）**：把 builder 里的键名 `agent_workflow_ids` 改成别的 → `cheapGates`
读到 `undefined` → `?? []` → 不命中 → `expect(g.workflowRef).toBe(...)` 报 `expected null to be '...'`，
**断言红不是崩溃红**（前提：保留 `?? []` 兜底）。按 `scripts/smoke/qiumi-dispatch-smoke.mjs:15` 的既有做法
把变异点写成常量并实跑一次由绿转红。

---

## 6. CI 约束

| 闸 | 要求 |
|---|---|
| `lint-tdd-commit-order` | commit-1 只加 failing test（`+` 行须有非 `.skip` 的 `it(`），commit-2 才动 `packages/brain/src/**.js` |
| `lint-test-pairing` | 新文件 `src/lib/qiumi-source.js` 的测试必须落 `src/lib/__tests__/qiumi-source.test.js`（cand2） |
| `lint-feature-has-smoke` | commit 前缀 `fix:`、不打 feature label → 跳过 |
| `lint-no-fake-test` | 新增 test 不得全是弱断言（`toBeDefined/toBeNull/...`） |

---

## 7. 不包含

- 删掉 Jev 的 `engine` 格子、workflow 带 tier、Brain 按额度选账号——那是另外两刀（Brain task `d24d4b19` / `1a6656c8` / `f4d9a1d4`）
- `skill_ids` / `business_task_ids` / `owner_ids` 的消费（本次只修 `agent_workflow_ids` 这条链）
- `docs/runbooks/qiumi-cutover.md:90` 的硬编码 JSON 路径（只读 `body`，不受影响）
