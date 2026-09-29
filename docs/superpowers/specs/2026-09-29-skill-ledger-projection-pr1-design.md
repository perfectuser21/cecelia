# Skill 台账投影 PR1 设计：三平台扫描入账 + Notion 新列推送

- Brain task：47def5bb；F5 指挥舱 feature：f20ec1cb
- 决策：19391396（与 Tasks 同构）/ 4b1f4230（正文投影）/ 4b1da4ca（三 PR 分期）
- 判定点：11af333b 同名即同一 skill / e22aab26 下线判定 / 24736022 人改识别（三方基线）/ bc98dda7 原件取哪份 / 84972cc1 Codex 口径
- 本文件覆盖 PR1，因 CI 限制单个 PR 新增 ≤3000 行，PR1 再拆成两个：
  - **PR1a（本分支）：扫描入账**，含 §4.1 迁移、§4.2–4.4 采集/归并/扫描任务、§4.6 A6、§4.7 路由修补
  - **PR1b：推送**，含 §4.5 推送任务、摘掉旧的 pushSkillRegistry（其回归用例迁到新模块）、孤儿页清理
- PR2（页面正文）和 PR3（Notion→Brain 回拉）另起 PR。

## 1. 目标

合并 PR1 并部署后，主理人打开 Notion「Skill Registry」库能看到：
- 行数与三平台真实 skill 对上：已删的 53 行在 24 小时后标「已下线」，缺的 20 个补进来，没有 `openclaw/` 前缀。
- 新增 13 列。机器维护的：已装平台、存在性、最后扫描、原件路径、分配 Agent、评测分、不一致副本数。人维护的：目标平台、转OpenClaw难度、业务线、负责人、分类、备注。
- 删列、改列名、改列类型都不会让同步报错，也不会重复建页。
- 在人管列里填的值不会被推送盖掉。拉回 Brain 是 PR3 的事，PR1 先保证不丢。

## 2. 现状（origin/main 64b348a45）

- `skill_registry`（迁移 283、470）：
  - `name` UNIQUE；`status` 的 CHECK 只允许 active / deprecated / planned；`metadata` JSONB。
  - `task_types` 和 `dispatch_command` 是派发时实际读取的数据（`lib/skill-binding-registry.js`，默认命令为 `'/' || name`）。
- `pushSkillRegistry`（`notion-push-sync.js:1062`）：
  - 挂在 `legacy-notion-push-scheduler` 上，生产已开 `NOTION_LEGACY_PUSH_ENABLED=true`；用 setInterval 每 5 分钟跑，没有防重入。
  - 线上已因此重复建了 3 组页：run-verify / skill-distill / skill-explore 各 2 页，建于 09-28 10:03 和 10:04。
  - 只推 4 列；catch 分支里的 `isWrongDatabaseError` 会清掉 notion_id，导致重复建页。
- 投影注册表（迁移 450）把 Skill Registry 登记为 `face=mirror, direction=push`，因此：
  - A8 会把人改当成篡改；
  - notion-mirror-labels 会在库描述上贴「🔒只读镜子」；
  - A10 按 mirror+push 对账行数。
- A6（`promise-map-nightly.js:201`）只比 `skill_registry(openclaw)` 和 `ops_skills(openclaw)` 两个行数。
- `POST /api/brain/skills` 遇到同名时，会整体覆盖 notion_id、status、location、metadata、area_id；`PATCH` 会整块替换 metadata。
- 采集先例是 `skill-dist-drift.js`：Brain 经 host-exec 用 `ssh mmv` 执行 base64 送过去的脚本，读回 JSON；ssh 失败算未核对，不当成 0 个。
- 容器里只拷贝了 `src/`（以及 `/app/scripts/skill-manifest.sh`）。src 下新增的文件必须被 import（island-gate）。

## 3. 方案选择

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A（采用）** | Brain 定时经 ssh 到 mmv 执行一段自包含的 node 采集程序，读回 JSON 再入库 | 与 skill-dist-drift、ops-collector 同一模式，符合 us-vps 零执行；新增宿主侧部署物为零 |
| B | mmv 上装 launchd，定时采集后 POST 给 Brain | 多一个宿主部署物（plist 加脚本分发），脚本版本会和 Brain 版本脱节 |
| C | 扫描放进 ops-collector | ops-collector 已有 5 分钟节奏和多路来源，塞进去会让单轮变慢，失败也会互相牵连 |

## 4. 组件

### 4.1 迁移 `491_skill_registry_ledger_columns.sql`（附 rollback）

用 `ADD COLUMN IF NOT EXISTS` 新增以下列：

| 列 | 类型 | 归属 | 说明 |
|---|---|---|---|
| platforms_installed | TEXT[] NOT NULL DEFAULT '{}' | 机器 | 取值 `claude-code` / `openclaw` / `codex` |
| presence | TEXT NOT NULL DEFAULT 'unknown'，CHECK 取 unknown/present/broken/gone | 机器 | |
| absent_since | TIMESTAMPTZ | 机器 | 首次在「完整扫描」里缺席的时间 |
| last_seen_at | TIMESTAMPTZ | 机器 | 最近一次被扫到的时间 |
| last_scanned_at | TIMESTAMPTZ | 机器 | 最近一次参与扫描的时间 |
| source_path | TEXT | 机器 | 原件路径 |
| source_kind | TEXT | 机器 | `repo` / `openclaw-workspace` / `openclaw-managed` / `agents-personal` / `claude-local` |
| assigned_agents | TEXT[] NOT NULL DEFAULT '{}' | 机器 | 真正「分到」该 skill 的 OpenClaw agent：该 agent 配置了 `skills` 白名单且名单里有它；或者该 skill 来自这个 agent 自己的 workspace。共享目录里「所有 agent 都能看到」的不算分配 |
| content_md | TEXT | 机器 | 原件 SKILL.md 全文，PR2 用 |
| content_digest | TEXT | 机器 | 原件 sha256 |
| copies | JSONB NOT NULL DEFAULT '[]' | 机器 | 每项 {platform, path, digest, lines, agent?} |
| drift_copies | INT NOT NULL DEFAULT 0 | 机器 | 与原件不一致的副本数 |
| files | TEXT[] NOT NULL DEFAULT '{}' | 机器 | 原件同目录的文件相对路径，最多 200 个 |
| tier_suggested | TEXT，CHECK 取 A/B/C 或 NULL | 机器 | |
| platforms_target | TEXT[] NOT NULL DEFAULT '{}' | 人 | |
| openclaw_tier | TEXT，CHECK 取 A/B/C 或 NULL | 人 | |
| business_line | TEXT | 人 | |
| owner | TEXT | 人 | |
| category | TEXT | 人 | 从 `metadata->>'category'` 回填 |
| note | TEXT | 人 | |
| notion_baseline | JSONB NOT NULL DEFAULT '{}' | 系统 | 各人管列上次与 Notion 对齐时的值（三方合并用） |
| notion_push_attempts | INT NOT NULL DEFAULT 0 | 系统 | |
| notion_next_retry_at | TIMESTAMPTZ | 系统 | 失败退避 |

- **eval_score 不新建列。** 生产里 48 行大多是自由文本，转数值会导致迁移失败、Brain 起不来。继续放在 metadata，推送到 Notion 时按原文写。
- **openclaw/ 前缀就地改名（零撞名，已实测）：**
  1. 先对 `task_types <> '{}' AND dispatch_command IS NULL` 且名字带前缀的行，写入 `dispatch_command = '/' || name`，把原派发命令固定下来。
  2. 再执行 `UPDATE name = substring(name from 10)`，只改没有撞名的行，并在 `metadata.renamed_from` 里记原名。
  3. notion_id 保持不变。
- 投影注册表 Skill Registry 那一行改为：`face='inlet', direction='both', vessel='skill-registry-projection + (PR3) ingest'`。notes 写明「列级分权：机器列 Brain 单向，人管列三方合并」。这样 A8 和镜子标签都会跳过它，A10 也不再对它对账，改由 A6 接住（见 4.6）。
- 文件末尾写 `schema_version '491'`。

### 4.2 采集程序 `src/lib/skill-inventory-remote.js`

- 导出一个**自包含**的 `async function collectSkillInventory(opts)`：
  - 函数体内部用 `process.getBuiltinModule('node:fs')` 等方式取依赖（Node ≥20.16；容器 20.20、CI 22、mmv 26 都满足），**不写 import()**：vitest 会把 import() 改写成 `__vite_ssr_dynamic_import__`，toString() 送到远端后会报错。另加一条单测断言 toString() 里不含 `__vite_ssr`、`__vi_`。
  - 不引用模块作用域的任何东西。
  - 这样既能被 `toString()` 送到远端执行，也能在单测里直接调用。
- 导出 `buildRemoteProgram(opts)`，拼成 `(<fn>)(opts).then(输出 JSON)`。
- 远端执行命令：`export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; echo <b64> | (base64 -d || base64 -D) | node -`。

采集内容（每个来源独立返回 `{status: ok|fail, error?, items}`）：

| 来源 | 读取位置 | 结果 |
|---|---|---|
| `claude` | `~/.claude/skills/*`（跟随软链） | 有 SKILL.md 算 ok；悬空软链算 broken |
| `openclaw` | 读 `~/.openclaw/openclaw.json` 的 `agents.entries` 拿 agent 清单，对每个 agent 执行 `openclaw skills list --agent <id> --json`（4 路并发，单个 45s 超时） | 只收 source 为 `openclaw-workspace` / `openclaw-managed` / `openclaw-workshop` / `agents-skills-personal` 的；bundled / custodian / extra 属于上游，不入账。**任一 agent 失败，openclaw 整个来源判 fail**，不给出部分结果 |
| `agents` | `~/.agents/skills` | 这里的 skill 在 mmv 上对 Codex 和 OpenClaw 都可见 |
| `repo` | `~/perfect21/zenithjoy-skills/*/SKILL.md`（只看根目录一层） | 用于判断原件在哪 |

每个 skill 的原件路径、sha256、行数、全文、同目录文件清单都由采集程序在远端算好。全文每份上限 512KB，超出截断并标 `truncated`。

预算：远端总预算 150s，单个 agent 45s，超出预算后剩下的 agent 记为 fail，openclaw 来源整体判 fail；Brain 侧 exec 显式传 `timeoutMs: 170_000`（默认只有 20s）；job 超时设 200s。base64 后的程序不超过 90KB（Linux 单个参数上限 128KB），用单测断言。

### 4.3 归并与判定 `src/lib/skill-inventory-reconcile.js`（纯函数）

- `normalizeName`：去掉 `openclaw/` 前缀。
- `buildRecords(inventory, codexRunnerState)`：按名字归并各来源，产出 {name, platforms_installed, presence, source_path, source_kind, content, digest, copies, drift_copies, files, assigned_agents, description（取 frontmatter）, tier_suggested}。
  - **原件优先级**：repo 根目录 > OpenClaw 实际加载的那份（标「未进仓库」）> `~/.agents/skills` > `~/.claude/skills` 自带目录。
  - **跑场机补充「在」**：`skill_manifest_drift` 里跑场机 `claude` 目录的 extra 清单中出现的名字（例如只在 xian-m4 上有的 review、repo-lead），视为「在」，平台记为 claude-code，原件记为「仅跑场机」。只有 mmv 和所有跑场机都没有，才进入缺席判定。
  - **Codex 平台**：若任一跑场机的 `codex-gwremote` 目录状态为 ok 或 drift，且该 skill 不在它的 missing 清单里，或来源是 `agents`，就标 codex。`missing_total > 30` 时清单被截断，这台机器按「未知」处理，不标。
  - **tier_suggested**：已装 openclaw 的不给建议；名字属于研发链（`dev`、`engine-*`、`harness-*`、`capability*`、`decomp*`、`plan`、`code-review-gate`），或正文里有 Skill 工具链式调用、`claude -p` 的，给 C；有 `.claude/` 路径、Agent 或 Task 子代理、`mcp__` 的，给 B；其余给 A。
- `decidePresence(row, seen, sourceOk, now, breaker)`：
  - 扫到 → present，`absent_since` 清空。
  - 只是悬空软链 → broken。
  - 行所属来源本轮不是 ok，或熔断 → 保持原状。
  - 所有相关来源都 ok 且没扫到：`absent_since` 为空就写当前时间；已缺席满 24 小时 → gone。
- `breaker`：本轮某来源的条目数比上一轮成功扫描少了 10% 以上，该来源本轮不做任何「缺席」判定，并记警告。

### 4.4 扫描任务 `src/skill-inventory-sync.js`

- scheduler job 名为 `skill-inventory-sync`，超时 180s，每 2 小时跑一次（自己判间隔）。
- **开跑时**就把 `started_at` 写进 working_memory `skill_inventory_state`，防止超时后被重入。并发靠 `pg_try_advisory_lock`（专用连接）互斥。
- 流程：exec（buildHostCmd + ssh mmv）→ 解析 → 读 working_memory `skill_manifest_drift` → `buildRecords` → 在一个事务里 upsert：
  - 新 skill：INSERT，status='active'，location=source_kind。
  - 已有 skill：只更新机器列，带 `WHERE (机器列…) IS DISTINCT FROM (新值…)`，没变化就不写，`updated_at` 也不动。
  - 没扫到的行：按 `decidePresence` 更新 presence 和 absent_since。
  - **人管列和 status 一律不碰。**
- ssh 或整体失败：只写 state.error，不动任何行。

### 4.5 推送任务 `src/skill-registry-projection.js`

- 【PR1b】新建 scheduler job `skill-registry-projection`，每 5 分钟一轮，超时 120s。同时从 `runNotionPushSync` 里摘掉 `pushSkillRegistry`（连同旧函数一起删），不再挂在 legacy setInterval 上。
- **每轮第 1 步：拿库结构。** GET `/databases/{id}` 取 properties（列 id、名称、类型）。
- **列账（逐列引导）：** 用 working_memory `skill_registry_notion_columns` 记录 {字段键: {id, name, type, created_at, deleted_at?}}。
  - 字段键在账里从没出现过 → PATCH 建这一列并记账。
  - 账里有，但当前库里已找不到这个 id → 视为人删了，记 `deleted_at`，**以后不再补建**。
  - 已有列按 **列 id + 类型** 对应：人改了列名不受影响；类型不符就跳过这一列，并在 `notion_sync_log` 记一条。
  - 原有的 Name / Description / Status / Source 按名称认领 id 后入账。
- **选出本轮要推的行（上限 25 行）：**
  - 行的机器指纹与 `metadata.pushed_digest` 不同；或 `notion_id` 为空；或有人管列与基线不同。
  - 并且 `notion_next_retry_at` 为空或已到期。
  - 排序：从没失败过的优先，再按 `updated_at DESC`。
- **机器列（每次都覆盖）：** Name、Description、Source（写 source_kind）、已装平台、存在性、最后扫描（只写日期）、原件路径、分配Agent、评测分（原文，截到 200 字）、不一致副本数。指纹只算这些列，不含时间戳（最后扫描只到日）。
- **人管列（三方合并）：** Status、目标平台、转OpenClaw难度、业务线、分类、备注。负责人在 PR1 只建列，不写值。
  - Brain 值等于基线 → 不发。
  - Brain 值不等于基线 → 先 GET 页面读 Notion 当前值：
    - Notion 值等于基线 → PATCH，并把基线更新为 Brain 值；
    - Notion 值不等于基线（人改过）→ 不发，这条留给 PR3 回拉。
  - 迁移后的首轮：Status 的基线视为 Brain 当前 status（旧推送写过）；新列基线为空。
  - 转OpenClaw难度：Brain 的 openclaw_tier 为空时，用 tier_suggested 作为要推的值。
- **建页：**
  - 建之前先按 Name 在库里查一次：查到一页未绑定的，就认领；查到多页，认领最早的那页，其余归档。
  - 建页时同时写入全部列，基线等于写入值。
- **失败处理：**
  - 404 或页面在回收站 → 清 notion_id 和指纹，下一轮重建。人删页的语义在 PR3 定义，PR1 先保持现有行为。
  - **去掉 isWrongDatabaseError 解绑。** 本库 id 固定，不存在建错库的情况。
  - 其它错误 → `notion_push_attempts+1`，按 5min × 2^n 退避，最长 24h；连续 5 次失败记 `notion_sync_log`。
- **孤儿页清理（每天一次）：** 分页列出库内全部页面，notion_id 不在 Brain 里、且由 bot 创建的页面 → archive。人建的页不动。
- **整轮保护：** 整个函数包在 try 里；用 advisory lock 保证不会有两轮同时跑。

### 4.6 守夜 A6 改口径（`promise-map-nightly.js`）

A6 由以下三项组成，全部满足才算 ok：
- ① `ops_skills(openclaw)` 的名字集合 ⊆ skill_registry 里 presence=present 的名字（去前缀后比）。
- ② task_types 非空的行，presence 不能是 gone 或 broken（否则派发会指向不存在的 skill）。
- ③ Notion 库未归档页数 == skill_registry 里 notion_id 非空的行数。这一项接住 A10 让出的行数对账。

落账沿用 skill_drift_alerts：**只要 A6 红，就始终 upsert 一条 `__skill_ledger_count__` 汇总行**（ssot_version=缺口摘要，snapshot_version=计数），名单明细只写进 detail 文本，不额外落行，避免 cleanup 漏删。

降级：③ 在无 token 或 Notion 不可达时，与 A7~A10 同一惯例，记 ok:true + degraded。PR1a 阶段推送还没切过来，③ 先按 degraded 处理，PR1b 再接上。

回归守卫只能迁，不能删：集成测试⑥和 `skill-ledger-reconcile-smoke.sh` 第 2 段，改成用 ①（ops_skills 有、registry 不是 present）和 ②（带 task_types 的行 presence=gone）各造一次报红。

预期：A6 上线后仍会红，这是真问题暴露，不是误报。例如 zenithjoy-ai-office 的白名单指向一个不存在的 skill；另有 5 个派发绑定行在 mmv 上是悬空软链。

### 4.7 `routes/skills.js` 修补

- POST 遇到同名：
  - notion_id、status、location、area_id、人管列一律 `COALESCE(EXCLUDED.x, skill_registry.x)`，即请求没传就保留原值；
  - status 只有请求里显式传了才覆盖；
  - metadata 用 `skill_registry.metadata || EXCLUDED.metadata` 合并，并剔除系统键 `pushed_digest`。
- PATCH：metadata 同样改为合并。

## 5. 数据流

```
每 2h  skill-inventory-sync ──ssh mmv──▶ collectSkillInventory ──JSON──▶ reconcile ──▶ skill_registry（机器列、presence）
每 5min skill-registry-projection ──▶ 列账 / 结构 ──▶ 推 25 行（机器列覆盖 + 人管列三方合并）──▶ Notion
每日   promise-map-nightly A6 ──▶ 名单包含 / 派发行健康 / 行数对账
```

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| ssh 不通、超时、输出不合法 | 扫描本轮不动任何行，记 state.error |
| 某个来源 fail | 这个来源相关的行不参与缺席判定 |
| 某来源条目数骤降 >10% | 熔断：本轮不判缺席，记警告 |
| Notion 429 或 5xx | 行级失败退避，不影响其它行 |
| 列被删 | 列账标记已删，以后不补建，也不再写这一列 |
| 列被改名 | 按 id 继续写 |
| 列被改类型 | 跳过这一列并记日志，行照常推 |
| 两轮推送重叠 | advisory lock 拿不到锁的那轮直接跳过 |
| 迁移失败 | 迁移中没有任何可能出错的类型转换；新列都有默认值；改名只动不撞名的行 |

## 7. 测试策略

- **unit（vitest）：**
  - reconcile：原件优先级、Codex 口径、tier 规则、presence 状态机（含 24h、熔断、来源 fail）。
  - 推送：属性构建、列账（删列、改名、改类型）、三方合并、退避排序、建页前查重认领。
  - routes/skills：COALESCE 和 metadata 合并。
  - A6：三项分别断言。
- **integration（pg，cecelia_test）：**
  - 迁移 491：列存在；改名；dispatch_command 被固定；注册表那一行改了 face；幂等重跑。
  - 扫描 upsert：没变化时不写 `updated_at`；人管列不受影响。
- **远端程序实跑：** 在临时 HOME 下造 fixture 目录，放一个假的 `openclaw` 可执行文件，用 `node -` 实际跑 `buildRemoteProgram`，验证函数确实自包含。
- **smoke：** `packages/brain/scripts/smoke/skill-inventory-smoke.sh`，只放 CI（real-env-smoke，全新 cecelia_test 库、无 ssh）能跑通的检查：
  - 491 的列、CHECK、注册表那一行的 face 和 direction；
  - 在临时 HOME 造 fixture 并放一个假的 openclaw，用 `node -` 实跑 buildRemoteProgram；
  - reconcile 加 upsert 在测试库上跑一轮，断言人管列和 updated_at 不动。
  - 拒绝在非 _test / _scratch 库上运行。
  - 「扫描 ok、present>0」属于部署后验收，放在 §8，不进 smoke。
- scheduler：新 job 插在 `scheduler-liveness` 之前；`runSchedulerJobsOnce` 那个用例要 vi.mock 新模块。

## 8. 验收（部署后，真 Notion）

1. psql 查 `skill_registry`：present 行数 == 最近一次扫描的全集数；53 条历史残留在 24 小时后变为 gone 或 broken。
2. Notion API 查库：未归档页数 == Brain notion_id 非空行数；没有带 `openclaw/` 的标题；Source 列里没有路径值；3 组重复页只剩一页。
3. 在 Notion 删一列、改一列名，下一轮推送无报错、页数不变、改名那一列照常更新。
4. 在 Notion 手工填一格「备注」，之后 3 轮推送都没有把它盖掉。
5. CI 全绿，smoke 通过。

## 9. 不包含

页面正文（PR2）、Notion→Brain 回拉（PR3）、正文打码（PR2）、人删页的语义（PR3）、AI-CHARTER 文档更新（PR3 合并后改本机文件）。
