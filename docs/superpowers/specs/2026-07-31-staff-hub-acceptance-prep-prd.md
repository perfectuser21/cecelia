# PrepPRD：工厂·F0 提案拍板闭环 / ZenithJoy 运营中枢 — Staff Hub 验收页（终局：Notion 退场，直连 Brain）

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：Brain 侧新增内网验收端点(pending列表+GP历史+结果提交)与 schema 补列；Staff Hub 新增验收模块(矩阵总览+按Step分组答题+设备维度+历史页)
- [ ] 另立 Sprint（本次不做）：staffGuard 整体从"信任客户端header"升级为"服务端session解析身份"（另开安全加固 Issue，不卡本次）；飞书推送通知新单
- [ ] 待讨论：无

## Journey 当前状态
- 🔄 交付人工验收闭环（journey_features d7b8b3c6，属"工厂·F0 提案拍板闭环"，thin/working）— 名字带"Notion"字样已过时，本次改名+推进 thin→medium
- ✅ 员工工具中心 Staff Tools Hub（journey_features 16ac50db，属"ZenithJoy 运营中枢"，done）— 本次验收模块作为其新增页面挂载

## 本次要做的
Notion 验收方案已终局否决（决策 fc7b5dc0），验收+展示全部收回自家前端。Staff Hub 新增"验收"模块，员工登录后能看到待验收清单、按 Step/类别/设备分组填写判定结果，Brain 直接计算通过率与驳回，全程零 Notion、零同步层。

本 PrepPRD 是 cecelia + zenithjoy-workspace 两仓库的联合设计文档，落地为两个顺序 PR：本仓库（cecelia）负责 Brain 侧新增端点与 schema（对应 Brain task 885c437e）；zenithjoy-workspace 仓库负责 Staff Hub 前端模块（对应 task 473634a3，依赖本 PR 先行合并）。

## Golden Path

1. 员工登录 Staff Hub（飞书 SSO 已有） → 首页显示"N 条待验收"角标（团队共享总数，来自 Brain 新增的内网 pending 列表端点，不按人过滤）→ 点击进入验收列表
2. 员工点开某条验收单 → 系统展示矩阵总览（横轴 FR/NFR/Invariant/SOP，纵轴 Step 泳道，格子=该分组判定项数+完成度），单元格标注涉及的设备(device)
3. 员工点某个格子/切列表视图 → 系统按 Step 分组展示判定项行；已全部决出结果的分组默认折叠打勾，未完成的默认展开；每行显示：标题、所需设备(如有)、结果三选一(通过/不通过/无法验证)、意见输入框
4. 员工点某一行 → 系统展开该判定项的详细工作卡（操作步骤/预期结果/判定标准，来自 acceptance_checks.detail 新字段）
5. 员工可以随时只提交自己刚填的几行（不要求整单填完再交）→ 系统整批原子写入这次提交的判定项，同时记录 submitted_by（谁填的，用于留痕）→ Brain 用当前全部已决判定项重新计算 pass_rate 与 run 状态
6. 不同员工在不同时间、用不同设备，重复步骤3-5，逐步把同一个 run 填满
7. 全部判定项都"通过" → run 变 passed；出现"不通过" → Brain 自动开 [验收驳回] dev 任务（已有机制），Staff Hub 上能看到该 run 状态变化+关联任务链接；出现"无法验证" → run 永久停在 in_review（既定设计，不会误判为完成），前端明确展示为"待人工升级处理"，不与"已提交"混淆
8. 员工想回顾历史 → 进入"验收历史"页，按 GP 选择 → 看该 GP 历次验收单（按版本/时间排序）→ 点开某次可看当时判定项的结果与意见，供驳回重开时参照对比

补充异常场景：
- Brain/Tailscale 网络暂时不可达 → 读路径（列表/矩阵/详情）降级展示"验收系统暂时无法连接"，HTTP 仍 200；写路径（提交结果）必须明确失败（5xx），前端提示"提交失败，内容已保留在本地，请重试"，绝不能把失败伪装成成功
- 员工填到一半刷新/关标签页 → 前端本地（localStorage，按 run_id 命名空间隔离）保留未提交草稿，重新打开时先查 Brain 当前判定项状态（服务端为唯一真相源）再决定要不要恢复草稿

## 客户视角（内部工具，"客户"=员工）
员工打开 Staff Hub 就能看到"这次要验收什么、按什么标准判、哪几台设备要测"，不用再去 Notion 找表格、等 15 分钟同步；填完立刻知道这次交的这批东西通过率多少、有没有触发返工任务。

## 完成后用户能
1. 员工在 Staff Hub 一个地方完成验收全流程，不再依赖 Notion
2. 多个员工、多台设备可以在不同时间各自提交自己那部分判定结果，互不冲突
3. 能按 GP 查历史验收记录，追溯不同版本当年是怎么验收的

## 涉及的 Ability / Feature
- 交付人工验收闭环（journey_features d7b8b3c6）：改名去"Notion"字样，thin → medium
- product-map.yaml `ability_acceptance`（app_id=staff_app, line_id=line00）：status 由 deprecated 改回 active（zenithjoy-workspace 仓库那侧 PR 处理）

## 不包含
- staffGuard 鉴权模型整体升级（服务端 session 解析身份）——本次只做验收模块自己的 submitted_by 留痕，不做全局改造
- 飞书推送通知新验收单——本次只做角标，通知靠人工口头安排
- 按人分配判定项（assignee 锁定/归属校验）——本次团队共享池模式，任意员工可填任意判定项

## 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 验收单人员/设备分工模型 | run级单一assignee+403归属校验 / 团队共享池+submitted_by留痕 | 团队共享池+submitted_by留痕，device字段分组 | 用户拍板需多人多设备协作；Brain POST /acceptance/results本就按提交子集原子更新，天然支持增量多人提交 | 若强行assignee锁定会阻碍真实协作场景（已被用户当场纠正） |
| 待验收角标范围/通知方式 | 按人过滤+飞书推送 / 团队共享总数+人工口头分工 | 团队共享总数+人工口头分工 | 用户明确要求 | 轻，后续需要可加 |
| 验收历史记录页范围 | 不做 / 按gp_id查历史run按version排序 | 按gp_id查历史run按version排序，可展开看结果+意见 | 用户明确要求，参照07-29被删的HistoryPage概念 | 不做则驳回重开时无参照，历史归因困难 |
| "无法验证"结果的run状态归宿 | 视为完成(计入分母) / 永久停in_review需人工升级 | 永久停in_review（Brain现有status计算逻辑已如此，非本次新引入） | 现有代码：pending>0→in_review；fail>0→failed；pass===total→passed；否则in_review——"无法验证"落在最后分支 | 前端如果把"无法验证"展示成"已完成"会跟Brain真实状态脱节，用户会误以为验收已结束 |
| Staff Hub↔Brain 网络路径 | 走公网5223+Bearer Token(仿Notion Worker) / 走Tailscale私网直连内网5221 | Tailscale私网直连（Staff Hub在HK VPS 100.86.118.99，Brain在美国机100.71.151.105，两者同一tailnet，现有line-health等功能已验证此路径可用） | 已核实两地Tailscale互通，复用CECELIA_BRAIN_URL既有模式，无需新增公网暴露面 | 若走公网+token，等于把Notion Worker那套暴露面原样复制一份，违背"零同步层"终局初衷 |
| 内网+公网两条results端点并发写同一run的去重 | 应用层分布式锁 / 数据库partial unique index+23505转幂等 | partial unique index（[验收驳回]任务表按run_key+未终态状态唯一）+ 现有SELECT-INSERT遇冲突转幂等 | 成本最低，不拖慢正常写路径；当前Notion同步已暂停，理论竞态窗口很窄，但代码层面两条路径都存在，应堵上 | 不堵则极端情况可能对同一run重复开出两条[验收驳回]任务 |

已命中的铁律（自动 enforce，无需拍板）：
- Brain 是唯一算分/状态源，Staff Hub 零本地业务数据存储，只做投影（decision fc7b5dc0）
- E2E 测试走 windows_cloud（ZenithJoy UI 硬规矩，本仓库不涉及）
- feat 类 PR 必须带 smoke.sh + CI smoke job

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] Staff Hub 飞书 SSO — 已有，本次复用现有登录态，不新增鉴权体系（本仓库不涉及，供联动 PR 参考）

### API 与凭据
- [x] CECELIA_BRAIN_URL — zenithjoy-workspace 侧 apps/api 已有此环境变量与代理模式（staff-health.ts/line-health.ts 先例），本仓库无需新增凭据
- [x] Brain 内网 acceptance 路由 — 已在生产运行（v1.267.153，routes/acceptance.js），本次新增端点是在同一文件扩展

### E2E 测试账号
- [x] 本仓库改动为后端 API，测试用 supertest/pg 集成测试覆盖，不涉及浏览器 E2E

### 测试 Fixture
- [x] 判定项样本数据在测试里通过真实调用本仓库新增/既有的 POST /catalog、POST /runs 接口构造（参照 line04-passive-reception-v2.1.17 的11条判定项作为内容参考），不需要静态 fixture 文件

### 基础设施
- [x] Brain 5221 内网服务、Postgres 已就绪，本次改动为该服务同一代码库内的路由/迁移扩展

## 验收标准（Final E2E）
- [ ] migration 新增 acceptance_checks.detail(jsonb) + acceptance_checks.submitted_by(text) 列，向后兼容（nullable，不破坏既有行）
- [ ] 新增内网端点 GET /api/brain/acceptance/pending（团队共享待验收清单，返回非终态 run 及其判定项统计）
- [ ] 新增内网端点 GET /api/brain/acceptance/runs?gp_id=xxx（历史查询，按 version/created_at 排序）
- [ ] 新增内网端点 POST /api/brain/acceptance/results（复用与公网版共享的核心提交/算分/驳回开任务逻辑，接受任意子集 check_key 批量提交，写入 submitted_by）
- [ ] [验收驳回] 任务去重加 partial unique index 兜底，测试证明并发提交同一 run 的两个不同 check 分别触发 failed 转变沿时，只产生一条驳回任务
- [ ] 单元测试覆盖：detail 字段透传、submitted_by 写入、pending 列表过滤非终态、历史查询排序、驳回去重竞态（proven-to-fire：故意制造并发触发验证只开一条任务）
- [ ] CI 全绿，PR 带 smoke.sh（复用/扩展现有 acceptance-*-smoke.sh）
