---
name: dev
version: 19.3.0
updated: 2026-05-30
description: 统一开发点火入口。查 12 张 Brain DB 表拿上下文 → 判断类型（bug / 小改动 / 大功能）→ 生成 PrepPRD → 用户确认 → 路由执行。
trigger: /dev, --task-id <id>, 我想做, 有个 bug, 改一下, 出问题了, walking skeleton, harness, journey, feature
---

> **CRITICAL LANGUAGE RULE**: 所有输出简体中文。

---

## 第零步：查 12 张表 + 判断类型（每次都要做，不跳过）

用户说任何话后，**先查 Brain DB 12 张表拿上下文，再判断类型**。

```bash
curl -s "localhost:5221/api/brain/journeys"
curl -s "localhost:5221/api/brain/journey_steps"
curl -s "localhost:5221/api/brain/journey_features?limit=50"
curl -s "localhost:5221/api/brain/issues?limit=20"
curl -s -X POST "localhost:5221/api/brain/decisions/match" \
  -H "Content-Type: application/json" -d "{\"query\": \"<用户描述关键词>\"}"
curl -s "localhost:5221/api/brain/skills?limit=50"
curl -s "localhost:5221/api/brain/registry?type=api&limit=20"
curl -s "localhost:5221/api/brain/registry?type=db_schema&limit=20"
curl -s "localhost:5221/api/brain/registry?type=test&limit=20"
curl -s "localhost:5221/api/brain/okr/tree"
```

**12 张表：**

| # | 本地 DB | Notion | 作用 |
|---|---------|--------|------|
| 1 | `journeys` | AI Journey | 顶层用户路径 |
| 2 | `journey_steps` | AI Steps | 可复用步骤 |
| 3 | `journey_step_links` | Journey-Step 连接表 | Journey × Step 顺序 |
| 4 | `journey_features` | AI Feature | 每步功能脚本 |
| 5 | `skill_registry` | Skill Registry | AI 技能清单 |
| 6 | `api_registry` | Sprint State — API Registry | 接口注册 |
| 7 | `db_schema_registry` | Sprint State — DB Schema Registry | 表结构注册 |
| 8 | `test_registry` | Sprint State — Tests Registry | 测试文件注册 |
| 9 | `issues` | Issues | 已知问题记录 |
| 10 | `decisions` | AI Notes (Type=Decision) | 用户决策记录 |
| 11 | `objectives` | Goals (`29ec40c2-ba63-8301-99c1-8110bfd84d9b`) | 每条 Line 的 North Star — O 层目标 |
| 12 | `key_results` | Key Results (`684c40c2-ba63-83a7-b6ba-8161f110a18c`) | 每个 O 下的 KR — Roadmap 里程碑 |

判断类型：

```
用户描述
  ├── 有 bug / 出问题 / 不对 / 报错    → 【路径 A：Bug】
  ├── 改一个字段 / 加个配置 / 小改动   → 【路径 B：小改动】（单 WS）
  └── 想做 X / 新功能 / 贯穿 Journey   → 【路径 C：大功能】（多 WS，Harness）
```

---

## PrepPRD（三种格式，用户说"对"/"走"后才执行）

**PrepPRD 是唯一的人工确认点。**

### ⚠️ 大功能必做：写 PrepPRD 之前先提炼 Golden Path

在生成大功能 PrepPRD 之前，必须先做这一步：

**从用户描述里提炼 Golden Path，补全隐含步骤，展示给用户确认后再继续。**

格式（逐步写，不跳过）：
```
[首次使用]
Step 1: [谁] [做了什么操作] → 系统 [响应] → [下一状态]
Step 2: ...

[日常使用]
Step 1: ...

[出错/掉线后]
Step 1: [用户如何知道出错了] → Step 2: [用户如何恢复]
```

提炼规则：
- 写"用户操作"，不写"系统组件"
  - ❌ "建 check-health.js，配置 GitHub Secrets"
  - ✅ "管理员打开 Dashboard → 点'抖音登录' → 本地弹出 Chrome 到 creator 页"
- 补全用户没说出口但一定存在的步骤（如"登录后自动抓 cookie 并同步"）
- 必须覆盖**异常场景**：掉线了 → 用户怎么知道 → 用户怎么恢复
- 用户描述里的每个隐含动作都要显式写出来

**Golden Path 用户确认后，才能继续写 PrepPRD。**

### Bug PrepPRD

```markdown
# Bug PrepPRD：[问题描述一句话]

## 症状
[用户看到了什么]

## 根因假设
[基于 10 张表上下文 + 代码推断]

## 关联上下文
- 相关 Journey/Step：[如有]
- 相关 Issue：[Issue ID，如有]
- 相关历史决策：[decisions 里有没有相关记录]

## 修法
[具体改哪个文件，改什么逻辑]

## Regression Test 计划
[一个能复现 bug 的 failing test，修完永久留 CI]

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿
```

### 小改动 PrepPRD

```markdown
# 小改动 PrepPRD：[改动描述一句话]

## 改什么
[具体改哪个文件/字段/逻辑]

## 为什么改
[业务或技术原因]

## 关联上下文
- 相关 Journey/Step/Feature：[如有]
- 相关历史决策：[decisions 里有没有相关记录]

## 影响范围
[会不会影响其他地方]

## 验收标准
- [ ] [可验证的条件]
- [ ] CI 全绿
```

### 大功能 PrepPRD（Harness）

```markdown
# PrepPRD：[Journey 名] — [本次目标一句话]

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：[列出本次做的事]
- [ ] 另立 Sprint（本次不做）：[列出聊过但本次跳过的事]
- [ ] 待讨论：[列出还不确定的事]

## Journey 当前状态
- ✅ [Step 名] — [thin/medium/done]
- 🔄 [Step 名] — [进行中]
- ⬜ [Step 名] — [planned]

## 本次要做的
[用用户语言描述]

## Golden Path（用户操作流程，逐步，不跳过）

> 这是唯一决定"做什么"的锚点。合同、WS 拆分、E2E 全部从这里派生。

### 首次使用
1. [谁] [做了什么] → 系统 [响应] → [状态]
2. ...

### 日常使用
1. ...

### 出错/掉线后
1. [用户如何发现问题] → [用户做什么] → 系统 [恢复动作]

## 客户视角（用户打开产品能感知到什么）
[不写技术细节，只写客户会看到/感受到的变化]

## 完成后用户能
[用户可感知的变化，列举 1-3 条]

## 涉及的脚本（Feature）
- [脚本名]（新增 / 加厚 thin→medium）

## 不包含
- [本次不做的事]

## 前置工作（实现开始前必须到位）

### 账号与登录
- [ ] 需要登录：[平台/账号]

### API 与凭据
- [ ] 需要：[API key / secret / token / 环境变量名]

### E2E 测试账号（Harness Final E2E 必填）
- [ ] 测试账号邮箱：[email]
- [ ] 测试账号密码：[password 或 GHA secrets 名称]
- [ ] 超管权限：[邮箱在 VITE_SUPER_ADMIN_EMAILS / 还是普通用户]
- [ ] 登录方式：邮箱密码（better-auth）/ 其他

### 基础设施
- [ ] 需要：[服务/端口/环境变量/GHA secrets 名称]

## 用户确认的成功标准
- [可验证的条件]
```

---

## 三条执行路径

### 路径 A：Bug

PrepPRD 确认后，**立即执行**这条 bash 命令写 decision（不要生成 JSON、不要描述，直接 Bash 运行）：

```bash
# 把方括号内容换成实际值后执行
curl -s -X POST localhost:5221/api/brain/decisions \
  -H "Content-Type: application/json" \
  -d "{\"decision\":\"[修法摘要，如：修复 DOUYIN_COOKIES storageState 格式兼容]\",\"reason\":\"[根因，如：addCookies 期望数组但收到 storageState 对象]\",\"made_by\":\"user\",\"author\":\"user\",\"category\":\"bug-fix\"}"
```

> 必填字段：`decision`（修法）、`reason`（根因）、`made_by="user"`、`category="bug-fix"`。
> Brain API 不可用时跳过，继续执行。

然后 **下一 tool call 必须是**：
```
Skill({"skill":"superpowers:systematic-debugging"})
```

systematic-debugging → engine-worktree → Superpowers autonomous 接力链 → fix PR → engine-ship → engine-pr-watchdog

---

### 路径 B：小改动

PrepPRD 确认后，**立即执行**这条 bash 命令写 decision（不要生成 JSON、不要描述，直接 Bash 运行）：

```bash
# 把方括号内容换成实际值后执行
curl -s -X POST localhost:5221/api/brain/decisions \
  -H "Content-Type: application/json" \
  -d "{\"decision\":\"[改动摘要，如：给 journey_features 加 priority 字段 P0/P1/P2 默认 P1]\",\"reason\":\"[原因，如：harness 需要按优先级筛选 feature]\",\"made_by\":\"user\",\"author\":\"user\",\"category\":\"small-change\"}"
```

> 必填字段：`decision`（做什么）、`reason`（为什么）、`made_by="user"`、`category="small-change"`。
> Brain API 不可用时跳过，继续执行。

然后 **下一 tool call 必须是**：
```
Skill({"skill":"engine-worktree"})
```

Superpowers autonomous 接力链：
brainstorming → writing-plans → subagent-driven-development → finishing（Option 2 push+PR）→ engine-ship → engine-pr-watchdog

**Autonomous 规则（必遵守）：**

绝不停下问用户，所有交互点 → Research Subagent 代答。

Tier 1 固定默认：
- brainstorming design approval → Research Subagent APPROVE（除非发现硬阻碍）
- brainstorming clarifying question → Research Subagent 查代码 + `curl localhost:5221/api/brain/decisions/match` + `docs/learnings/` 回答
- brainstorming 启动前 → Research Subagent 跑 `bash packages/engine/skills/dev/scripts/enrich-decide.sh .raw-prd-<branch>.md` 判 thin
- brainstorming spec 必须含「测试策略」段（E2E / integration / unit / trivial 四档，缺则 reject）
- writing-plans → subagent-driven
- subagent prompt 必须 inline TDD iron law：
  - "NO PRODUCTION CODE WITHOUT FAILING TEST FIRST"
  - "Throwaway prototype 才 skip — 你不是写 prototype"
  - "每 plan task commit 顺序：commit-1 fail test / commit-2 impl"
  - "controller 会 verify commit 顺序，不符合让你重做"
- finishing → Option 2 (push+PR)
- finishing 完成 → 下一 tool call 必须 `Skill({"skill":"engine-ship"})` → engine-ship 完成后自动调 `engine-pr-watchdog`
- BLOCKED 第 3 次 → `superpowers:dispatching-parallel-agents`

**smoke.sh 强制（feat: + 改 brain/src/ 的 PR）：**
- 必须有 `packages/brain/scripts/smoke/<feature>-smoke.sh`
- CI `real-env-smoke` 必须通过才能 merge

---

### 路径 C：大功能（Harness）

PrepPRD 确认后，**立即执行**这条 bash 命令写 decision（不要生成 JSON、不要描述，直接 Bash 运行）：

```bash
# 把方括号内容换成实际值后执行
curl -s -X POST localhost:5221/api/brain/decisions \
  -H "Content-Type: application/json" \
  -d "{\"decision\":\"[功能方向摘要，如：立项快手图文+视频发布功能，2 WS dryrun 优先]\",\"reason\":\"[为什么做，如：快手 handler 只支持 image，video 无 dryrun 路径，与抖音对称设计]\",\"made_by\":\"user\",\"author\":\"user\",\"category\":\"feature\"}"
```

> 必填字段：`decision`（功能方向）、`reason`（动机）、`made_by="user"`、`category="feature"`。
> Brain API 不可用时跳过，继续执行。

在 Notion 注册 Feature（如还没有）：
```bash
node ~/.claude/skills/dev/scripts/add-feature.js \
  --name "<feature_name>" --journey-id "<notion_journey_id>" \
  --thickness "thin" --area "<area>"
```

点火：
```bash
curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d "{
    \"task_type\": \"harness_initiative\",
    \"title\": \"<feature_name>\",
    \"description\": \"<thin_prd>\",
    \"priority\": \"P1\",
    \"payload\": {
      \"sprint_dir\": \"<sprint_dir>\",
      \"thin_prd\": \"<thin_prd>\",
      \"prep_prd_body\": \"<PrepPRD全文Markdown>\",
      \"journey_id\": \"<notion_journey_id>\",
      \"feature_id\": \"<notion_feature_id>\",
      \"base_repo\": \"<见下方规则>\",
      \"target_environment\": \"<windows_cloud|mac_web|local_api>\"
    }
  }"
```

**`base_repo` 规则：**

| target_environment | base_repo 格式 |
|---|---|
| `windows_cloud` / `mac_web` | **必须 GitHub URL**（Generator 跑在 Actions runner，访问不到本地路径）|
| `local_api` | 本地路径或 GitHub URL 均可 |

> ❌ 错误：`windows_cloud` + `base_repo=/Users/administrator/...` → Harness 入队失败
> ✅ 正确：`windows_cloud` + `base_repo=https://github.com/perfectuser21/zenithjoy-workspace.git`

Brain tick 自动 pick up，`curl localhost:5221/api/brain/tasks/<task_id>` 查进度。

---

## Walking Skeleton 概念（路径 C 参考）

### 四层结构

```
Journey — 端到端价值闭环
  └── Phase — 概念分组，不进 DB
  └── Step  — 可追踪用户能力单元（journey_steps 表）
        └── Feature — 一个可独立运行的自动化脚本（journey_features 表）
```

Step 判断：能对客户说"我们现在支持 [Step名] 了"吗？
- "我们支持抖音发布了" ✅ → Step
- "我们支持视频格式了" ❌ → 太细，是 Feature
- "我们支持发布了" ❌ → 太粗，是 Phase

每条 Journey 5-20 个 Step。Step 可跨 Journey 共享。

### Journey Type

| Type | 场景 |
|---|---|
| `user_facing` | 终端客户用的路径 |
| `autonomous` | 系统自己跑、客户无感 |
| `dev_pipeline` | CI/CD/部署等开发者路径 |
| `agent_remote` | 远程 agent 跑的路径 |

### Feature 厚度

thin → medium → thick → mature

**加厚纪律 — 先减肥再增肌（两段式 commit）：**
1. `remove old <thickness> implementation`
2. `implement <new-thickness>`

升级标准：
- thin → medium：真实数据替代 mock + 基本错误处理
- medium → thick：核心场景完整 + UI 可面客户
- thick → mature：边界覆盖 + 监控告警就位

### 5 个管理动作

```bash
# init journey
node ~/.claude/skills/dev/scripts/init-journey.js \
  --name "客户首次成功路径" --area "ZenithJoy" --type "user_facing" \
  --description "..." --e2e-path "..." --steps "注册|画像|发布"

# add feature（默认 thin，执行前语义查重）
node ~/.claude/skills/dev/scripts/add-feature.js \
  --name "<feature_name>" --journey-id "<id>" --thickness "thin" --area "<area>"

# thicken（必填 replaces_old_thin）
node ~/.claude/skills/dev/scripts/thicken.js \
  --feature-id "<id>" --to "medium" --reason "..." \
  --replaces-old-thin "path/to/old/mock.ts"

# status
node ~/.claude/skills/dev/scripts/status.js --area "ZenithJoy"
```

### 6 条铁律

1. 任何"加 feature"必须先回答"挂哪条 Journey"
2. 新 Feature 默认 thin，不允许跳级
3. Maturity 不允许跳级（skeleton 没到不能升 mvp）
4. Journey 第一刀只贯穿不加厚
5. 加厚要靠真实反馈
6. 加厚必须先减肥再增肌

---

## Harness Pipeline 定义

### Run 固定结构

```
点火 → GAN → Planner（拆 WS）→ Generator（2-5 WS）→ Evaluator → Final E2E → Sync+Report
```

- 1 Workstream = 1 /dev session = 1 PR
- 1 Run 目标 2-5 WS（甜点区）
- PRD 只写 What，不写 How

### Sizing Check

| 预估 WS | 处理 |
|---|---|
| 1 个 | 走路径 B |
| 2-5 个 | 正常 Harness |
| 6 个以上 | 提醒拆成两次 Run |

### 多角色检测

发现"客户端 + 管理端"混合 → 提示拆成两条 Journey。

### 语义查重

用户提到 Step 名 → 先查 `journey_steps`，语义相近必须问用户确认，不直接新建。

### Planner 决策逻辑

```
骨架未通 → 补全 thin Features（横向贯穿优先）
骨架已通 → 选优先级最高的 Feature 升厚
需横向扩展 → 新建下一个 Step 的 thin 骨架
```

PRD 里的 Steps 必须来自 `journey_steps` 表，引用 step_id，禁止凭空创造。

### Run 验收标准

1. Final E2E PASS
2. 所有 WS PR merged
3. Brain journey_features thickness 已回写
4. Notion 已同步

---

## Notion DB ID 速查

| 表 | Notion DB ID |
|---|---|
| AI Journey | `358c40c2-ba63-8148-bde7-e313d789931a` |
| AI Steps | `369c40c2-ba63-812c-9f35-e7e43db25014` |
| Journey-Step 连接表 | `369c40c2-ba63-81e2-b95a-e5e3d0592676` |
| AI Feature | `358c40c2-ba63-81e3-96c5-d762b3d34dff` |
| Skill Registry | `353c40c2-ba63-81bf-ae3e-f0e6fa3753d7` |
| API Registry | `365c40c2-ba63-81a3-9060-fcef565e5291` |
| DB Schema Registry | `365c40c2-ba63-8181-9a57-ed760fd68ba3` |
| Tests Registry | `365c40c2-ba63-8164-8037-eb72e713809e` |
| Issues | `a17c40c2-ba63-82fb-9888-8152cefe29ec` |
| AI Notes（Decision）| `185c40c2-ba63-828c-973f-81a9c4582cd6`（Type=Decision）|
| Goals（Objectives）| `29ec40c2-ba63-8301-99c1-8110bfd84d9b` |
| Key Results | `684c40c2-ba63-83a7-b6ba-8161f110a18c` |

凭据：`source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN && NOTION_KEY=$(op item get "Notion" --vault CS --fields credential --reveal | tr -d '"')`
