# 小改动 PrepPRD：T6 指挥台配套（battle-report 军师决策节 + 战斗室 Issues 面板 + claude+headed 派发解锁）

## 改什么
1. **battle-report 军师决策节**（packages/brain/src/battle-report.js）
   - buildBattleReportData 增加查询：24h 内 notes 表 `type='Decision'` 且 `title LIKE '军师决策[%'` 的记录
   - renderBattleReportMarkdown 增加 `## 军师决策（24h）` 节：按 Line 分组列出决策标题+摘要；无记录渲染"暂无"
2. **战斗室 Issues 面板**
   - Brain 新增 `GET /api/brain/issues`（支持 ?status=&journey_id=&limit=，默认 open 优先排序）——同时修复 line-strategist SKILL 调用该端点 404 的现存缺口
   - apps/dashboard WarRoomPage 总览增加 Issues 面板（拉新 API，展示 open issues：标题/优先级/所属 line）
3. **claude+headed 派发解锁**
   - packages/brain/src/routes/task-tasks.js B1 白名单：删除 claude+headed 400 拒绝
   - packages/brain/src/harness-skill-relay.js：删除 spawnSkillRelaySession 内部 claude+headed 防御；_spawnHeadedSession 泛化——executor=claude 时 tmux 命令改跑宿主 `scripts/claude-launch.sh --dangerously-skip-permissions "$(cat promptFile)"`，跳过 CODEX_RELAY_HOME 门禁与 codex trust preseed，orchestrator_host='skill-relay-claude-headed'
   - harness-relay-watchdog.js：tmux 收尾判断从等值 'skill-relay-codex-headed' 扩为两个 headed host 值

## 为什么改
07-08 主理人拍板路由条令：Claude=有头/Codex=无头；claude+headed 被 task-tasks.js 拒是已知待修缺口（routing-doctrine）。晨报缺军师决策节导致 T3 上线的 Line 军师产出无人消费聚合；战斗室无 Issues 全景。

## 关联上下文
- 任务：88e0b448（作战清单 T6，plan_seq=6，依赖 T3 已完成）
- Journey：Cecelia Harness Pipeline（bb8cc561）
- 相关决策：routing-doctrine-20260708（Claude有头/Codex无头）；T3 PR#3674 军师接线

## 影响范围
- battle-report 仅加节，不动现有 4 节
- 新 GET /issues 是纯新增只读端点
- claude+headed：解锁后新组合仅在显式 payload.mode='headed' 且 executor='claude' 时走新分支，存量 codex headed / headless 路径不动

## 验收标准
- [ ] [BEHAVIOR] battle-report 含军师决策节 Test: tests/ 单测断言渲染输出含"军师决策"节且聚合 notes 记录
- [ ] [BEHAVIOR] GET /api/brain/issues 返回 issues 列表 Test: tests/ 路由单测（status/journey_id 过滤）
- [ ] [BEHAVIOR] claude+headed 创建任务不再 400、spawn 走 claude tmux 分支 Test: tests/ task-tasks 白名单测试 + _spawnHeadedSession 注入 fake 断言命令串含 claude-launch.sh
- [ ] Dashboard WarRoomPage 显示 Issues 面板
- [ ] CI 全绿
