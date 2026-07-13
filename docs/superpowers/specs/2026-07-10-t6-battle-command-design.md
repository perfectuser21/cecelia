# T6 指挥台配套设计：晨报军师决策节 + 战斗室 Issues 面板 + claude+headed 派发解锁

任务 88e0b448（作战清单 T6，plan_seq=6）。Research Subagent 已核实全部假设并 APPROVE（2026-07-10）。

## A. battle-report 军师决策节

**文件**：`packages/brain/src/battle-report.js`

- `buildBattleReportData` 新增一路查询（照 `warroom.js:404` 先例包 try/catch，表缺失/查询失败降级为空数组）：
  ```sql
  SELECT title, content, created_at FROM notes
   WHERE type='Decision' AND title LIKE '军师决策[%'
     AND created_at >= NOW() - interval '24 hours'
   ORDER BY created_at DESC LIMIT 50
  ```
- `renderBattleReportMarkdown` 新增第五节 `## 军师决策（24h）`：从标题 `军师决策[<Line名>]: <一句话>` 解析 Line 名分组渲染；无记录渲染"暂无"。
- 依据：line-strategist SKILL 明文写"标题前缀 `军师决策[` 是晨报的聚合过滤键"（SKILL.md:178）。

## B. GET /api/brain/issues + 战斗室 Issues 面板

**Brain**：`packages/brain/src/routes/journeys.js`（与现有 `POST /issues` 同文件，server.js 已挂 `/api/brain` 前缀，零挂载改动）
- `GET /issues`：查询参数 `status`（精确匹配，缺省不过滤）、`journey_id`、`limit`（缺省 20，钳制上限 100，照 journey_steps 先例）。返回 `{issues:[{id,title,priority,status,sub_area,journey_id,pr_url,created_at}]}`，排序 `priority ASC, created_at DESC`。
- 顺带修复现存缺口：line-strategist SKILL 正在调 `GET /api/brain/issues?status=open` 得 404。

**Dashboard**：`apps/dashboard/src/pages/warroom/` 
- `WarRoomPanels.tsx` 新增 `IssuesPanel`：克隆 `DecisionStream` 模式（`usePolled` 60s 轮询 + 导出纯行映射函数 `issueRows` 供单测 + 同款卡片样式），请求 `/api/brain/issues?limit=8`，展示标题/priority 徽标/status/sub_area。
- `WarRoomPage.tsx:1607` 总览 grid 从 `xl:grid-cols-2` 扩为放入第三个面板。

## C. claude+headed 派发解锁（接通 tmux 有头链路）

1. **task-tasks.js:113-118**：删除 claude+headed 400 拒绝（mode 枚举校验保留）。
2. **harness-skill-relay.js**：
   - 删 `spawnSkillRelaySession` 内部 claude+headed 防御（76-79 行）。
   - `_spawnHeadedSession` 泛化，按 `task.payload.executor` 参数化：
     - host 常量：codex→`skill-relay-codex-headed`（不变），claude→`skill-relay-claude-headed`；
     - tmux session 前缀：codex→`codex-relay-`（不变），claude→`claude-relay-`；
     - tmux 命令：claude 分支跑 `cd <worktree> && bash /Users/administrator/perfect21/cecelia/scripts/claude-launch.sh --dangerously-skip-permissions "$(cat promptFile)"`（launcher 自动补 --session-id，位置参数即交互初始 prompt，tmux 提供 TTY——youtou 首航实证）；宿主 repo 根经 `CECELIA_HOST_REPO` env 可覆盖（对齐 host-executor.js 先例）；若配置了 `HEADED_CLAUDE_CONFIG_DIR` env 则在命令前缀显式 `CLAUDE_CONFIG_DIR=` 注入，避免烧到用户 claude-switch 当前账号（未配置时沿用 launcher 默认行为，设计上可接受）；
     - claude 分支跳过 codex 专属段：CODEX_RELAY_HOME B6 门禁（314-328）、trust preseed 雷9（407-424）、`CODEX_HOME=` 注入；
     - 返回值 `mode`、initiative_runs 落行 `orchestrator_host`、tui.log 三处统一用参数化 host 常量（executor.js 雷8 是 `startsWith('skill-relay')` 前缀匹配，自动覆盖新值）。
3. **harness-relay-watchdog.js**：
   - 67 行 SQL `orchestrator_host = 'skill-relay-codex-headed'` → `IN ('skill-relay-codex-headed','skill-relay-claude-headed')`；
   - 115 行等值判断同样扩为两值；
   - 263/280 行 tmux session 前缀 `codex-relay-` 硬编码 → 按 orchestrator_host 映射前缀（codex→codex-relay-，claude→claude-relay-），否则 claude headed 的存活检测与收窗失效。
   - attempt cap / B8 收尸逻辑不动（研究员核实无需改）。

## 错误处理

- battle-report 新查询失败：try/catch 降级空数组，晨报其余节不受影响。
- GET /issues 查询失败：500 + error message（与同文件其他路由一致）。
- claude headed spawn 失败：沿用现有回滚（task 回 queued）与 loud 日志模式。

## 测试策略

档位：integration/unit（无 UI E2E——面板逻辑用纯函数单测覆盖，档位理由：改动为后端聚合/路由/派发分支+前端展示组件，行为可用单测+路由测断言）。

1. **battle-report**（unit）：注入 fake pool，断言渲染输出含 `## 军师决策（24h）` 节、按 Line 分组、空时"暂无"、查询抛错时降级。
2. **GET /issues**（route unit）：status/journey_id/limit 过滤与钳制、排序、空表。
3. **task-tasks.js**（route unit）：claude+headed 创建返回 2xx（原 400 用例反转）；codex+headed、claude+headless 不回归。
4. **_spawnHeadedSession**（unit，注入 execFn/sshSpawnFn fake）：executor=claude 时命令串含 `claude-launch.sh` 且不含 `CODEX_HOME`/codex；tmux session 名 `claude-relay-`；initiative_runs 落 `skill-relay-claude-headed`；codex 路径不回归。
5. **watchdog**（unit）：claude headed run 被扫描且用 `claude-relay-` 前缀收窗。
6. **IssuesPanel**（unit）：`issueRows` 纯函数映射测试。

注意：涉及真实 postgres 的测试放 `src/__tests__/integration/`（T3 教训：放错目录 ECONNREFUSED）。
