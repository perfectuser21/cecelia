# Sprint PRD：Cecelia 承诺地图归位

**Sprint Dir**: `sprints/08101234-cecelia-map-reorg`
**Task ID**: `f491a8dd-b0e3-4352-a5e0-6cb85df73d80`
**决策锚点**: `decisions.id = 4bc109e9-3b70-4b17-a1b4-bcd01bfae776`
**当前分支**: `cp-08101910-ws-f491a8dd`
**生成时间**: 2026-08-10
**Brain URL**: `http://host.docker.internal:5221`

---

## 一、背景与目标

### 1.1 决策摘要（4bc109e9）

用户已拍板的完整结构定义：

- **2 条价值流**（journeys 表，`type='value_stream'`）：
  - 工厂（感知者=待造软件，DevOps 全环）
  - 管家（感知者=主理人本人，DevOps 之上的指挥层）
- **11 个 Capability**（工厂 6 个 + 管家 5 个）：
  - 工厂：F0 提案打磨 / F1 开发闭环 / F2 部署闭环 / F3 夜间体检 / F4 故障自愈 / MJ5 承诺地图
  - 管家：G1 指挥舱（原 F5）/ G2 收件箱（原 F6）/ G3 晨报感知（新立）/ G4 记忆知识（原 F7）/ G5 战略 OKR（新立）
- **2 条边界声明**：
  - F0↔G1：提案备好呈报=F0 终点，拍板动作归 G1
  - F3↔G3：体检报告落账本=F3 终点，主理人一屏消费=G3 终点
- **横切件池 7 项**（不计入 Capability 数）：
  - 心跳传送带 / 凭据链 / 执行资源池 / skill 分发链 → 主管 F1
  - 告警链 → 主管 F4
  - 数据库 / 网络（地基先行型）→ 主管 F1
- **西安机群**：infrastructure 独立区取消，并入工厂线降级为 F8 执行资源池横切件

### 1.2 当前实测状态（非推测）

**journeys 表（active 行）**：
| 名称 | ID 前缀 | home | biz_area |
|------|---------|------|----------|
| 工厂·F0 提案拍板闭环 | 743f0e7c | factory | (待验) |
| 工厂·F1 开发闭环 | e6f803f2 | factory | (待验) |
| 工厂·F2 部署闭环 | 2fa4d085 | factory | (待验) |
| 工厂·F3 夜间体检 | ec4eb591 | factory | (待验) |
| 工厂·F4 故障自愈 | 91c17939 | factory | (待验) |
| 工厂·F5 指挥舱 | 8bb8252f | factory | (待验) |
| 工厂·F6 收件箱归位 | 824ee0f5 | factory | (待验) |
| 工厂·F7 记忆与知识 | a824b567 | factory | (待验) |
| 工厂·MJ5 承诺地图闭环 | 51754939 | factory | (待验) |
| 西安机群 CI/RPA 基础设施 | 0c1f70f1 | NULL | infrastructure |

**结构性问题**：
1. journeys 表无 `parent_journey_id` 或 `type` 字段——无法区分"价值流"与"Capability"
2. golden_paths（capabilities_registry）是提案审批流水表，不是权威 Capability 登记表
3. `journey_features` 表 23 行 `journey_id=NULL`（历史孤儿）
4. F5/F6/F7 命名挂在"工厂"下，但决策将其归入"管家"价值流（需更名+归位）
5. G3 晨报感知 / G5 战略 OKR 是新立 Capability（journeys 表无此行）
6. MJ1/[v1] 系列退役 journey 上滞留约 11 个 journey_features 无人搬家

**in_progress 任务**（当前 2 条，PrepPRD 描述 5 条，以实测为准）：
- `61f7a4dd` janitor 归位 Cecelia DevOps（sprint_dir=sprints/08101632-janitor-devops-homecoming）
- `f491a8dd` 本任务自身

---

## 二、功能需求（FR）

### FR-1：schema 扩展——价值流 vs Capability 一等实体化

**方案 A（推荐）：journeys 表自引用 + type 字段**
- 新增 `journeys.type TEXT CHECK (type IN ('value_stream','capability'))`
- 新增 `journeys.parent_journey_id UUID REFERENCES journeys(id)`（Capability 指向价值流）
- 新增 `journeys.capability_code TEXT`（F0-F7/MJ5/G1-G5 等短码，唯一约束）

**方案 B 对比（新建 capabilities 表）**
- 对 journey_features / journey_steps / golden_paths 的 FK 影响面：需要把所有 journey_id FK 在功能层面重映射到 capability_id，改动面达 3 张表
- 判定：影响面过大，且现有 journeys 行即是 Capability，自引用方案零数据搬运

**采用方案 A**。

### FR-2：数据迁移——建 2 条价值流行

- INSERT 工厂价值流（name='工厂', type='value_stream', biz_area='cecelia'）
- INSERT 管家价值流（name='管家', type='value_stream', biz_area='cecelia'）

### FR-3：数据迁移——现有 F0-F7/MJ5 降级为 Capability

- UPDATE journeys SET type='capability', parent_journey_id=<工厂 ID>, capability_code=... WHERE name LIKE '工厂·F%' OR name LIKE '工厂·MJ5%'
- F5/F6/F7 三行重新挂载到管家价值流：UPDATE parent_journey_id=<管家 ID>，同时更新 code 为 G1/G2/G4，更新 name

### FR-4：数据迁移——新立 G3/G5 Capability

- INSERT G3 晨报感知（type='capability', parent_journey_id=<管家 ID>, capability_code='G3'）
- INSERT G5 战略 OKR（type='capability', parent_journey_id=<管家 ID>, capability_code='G5'）

### FR-5：数据迁移——西安机群并入横切件

- UPDATE journeys SET status='deprecated', type='capability' WHERE id='0c1f70f1...'（先以 deprecated 收场，横切件登记在 FR-7 处理）
- biz_area 已为 infrastructure，保留不变

### FR-6：孤儿 journey_features 归位/归档

**分拣规则（机器可核查）**：
1. 孤儿行（journey_id=NULL）：按 feature 名称关键字匹配归位——
   - 含 ZenithJoy / 智能客服 / 发布 / 视频 → 归对应 ZenithJoy journey
   - 含 deploy / 部署 / CI → 归 F2 部署闭环
   - 含 watch / 夜检 / nightly → 归 F3 夜间体检
   - 含 heal / 故障 / incident → 归 F4 故障自愈
   - 其余 → 打 `status='deprecated'`（留档，不物理删除）
2. MJ1/[v1] 滞留挂片（约 11 条）：
   - 功能仍在用者：按上述关键字归位
   - 其余：打 `status='deprecated'`
3. F1 名下 ZenithJoy 挂片（约 10 条）：按关键字分拣 → 迁到对应 ZenithJoy journey

**可核查性**：迁移脚本生成 `migration_audit.json`，记录每行的 before/after journey_id + 分拣规则命中哪条

### FR-7：横切件池登记

最小化方案：在 `working_memory` 表（Brain 已有）写 7 条记录，key=`xcut::<name>`，value JSON 含 `{ owner_capability_code, guardian_status, description }`。

7 项登记内容：
| 横切件 | 主管 | 短码 |
|--------|------|------|
| 心跳传送带 | F1 | xcut::heartbeat |
| 凭据链 | F1 | xcut::credential_chain |
| 执行资源池（含西安机群） | F1 | xcut::executor_pool |
| skill 分发链 | F1 | xcut::skill_dispatch |
| 告警链 | F4 | xcut::alert_chain |
| 数据库 | F1 | xcut::database |
| 网络 | F1 | xcut::network |

### FR-8：in_progress 任务锚点保护

**迁移脚本前置验证**：
1. 读取所有 in_progress 任务的 `journey_id` 字段和 `payload.GP_ANCHOR`
2. 记录迁移前的 journey_id → journey.name 映射快照
3. 迁移 **不修改任务表**，仅改 journeys 表行的 parent_journey_id/type/capability_code
4. 迁移后验证：原 journey_id 仍可在 journeys 表中查到（行未删除），GP_ANCHOR 解析路径不变
5. 迁移脚本输出验证报告，含每条 in_progress 任务的锚点状态

---

## 三、非功能需求（NFR）

| ID | 类别 | 要求 |
|----|------|------|
| NFR-1 | 安全性 | 全部 schema 变更走 migration 文件（397 号起），禁止手工 ALTER 生产 DB |
| NFR-2 | 可回滚性 | 每个 migration 有对应 rollback SQL |
| NFR-3 | 可观测性 | 迁移后必须运行验收查询并输出结构化报告 |
| NFR-4 | 锚点不破坏 | in_progress 任务的 journey_id 引用必须在迁移后仍可解析 |
| NFR-5 | 孤儿不删除 | `journey_features.status='deprecated'` 留档，禁止 DELETE |
| NFR-6 | CI 全绿 | 迁移合入后 CI 管道所有 check 通过 |
| NFR-7 | 审计可查 | 分拣决策（feature 归位原因）持久化到 migration_audit 记录 |

---

## 四、技术方案（实现路径）

### 4.1 Migration 文件规划

| 文件 | 内容 |
|------|------|
| `397_journey_capability_hierarchy.sql` | 新增 `journeys.type` / `parent_journey_id` / `capability_code` 字段 + 索引 |
| `398_value_stream_seed.sql` | INSERT 工厂+管家价值流；UPDATE F0-F7/MJ5 挂 parent_journey_id；重命名 F5→G1/F6→G2/F7→G4；INSERT G3/G5；西安机群 deprecated |
| `399_orphan_features_triage.sql` | 孤儿 journey_features 按规则归位或打 deprecated；MJ1/[v1] 滞留挂片处理；F1 ZenithJoy 挂片迁移 |
| `400_xcut_pool_register.sql` | working_memory 写入横切件池 7 项登记记录 |

### 4.2 验收查询（集成进迁移脚本末尾）

```sql
-- 验收 1：2 条价值流
SELECT COUNT(*) AS value_stream_count
FROM journeys WHERE type='value_stream' AND status='active';
-- 期望：2

-- 验收 2：11 个 Capability
SELECT j.name AS value_stream, COUNT(c.id) AS cap_count
FROM journeys j
JOIN journeys c ON c.parent_journey_id=j.id
WHERE j.type='value_stream' AND c.type='capability' AND c.status='active'
GROUP BY j.name;
-- 期望：工厂=6, 管家=5

-- 验收 3：孤儿清零
SELECT COUNT(*) AS null_journey_features
FROM journey_features WHERE journey_id IS NULL AND status != 'deprecated';
-- 期望：0

-- 验收 4：横切件池 7 项
SELECT COUNT(*) AS xcut_count
FROM working_memory WHERE key LIKE 'xcut::%';
-- 期望：7

-- 验收 5：in_progress 任务锚点
SELECT t.id, t.title, j.id AS journey_id, j.name AS journey_name
FROM tasks t
LEFT JOIN journeys j ON j.id=t.journey_id
WHERE t.status='in_progress';
-- 期望：所有行 journey_name 非 NULL（或 journey_id 本就为 NULL 的任务不受影响）
```

### 4.3 实施顺序（强制序列）

1. 先跑 DevGate（`node scripts/facts-check.mjs` + `bash scripts/check-version-sync.sh`）
2. 创建 migration 397（纯 schema，无数据变更）→ 应用 → 验证列存在
3. 创建 migration 398（数据种子）→ 应用前备份 in_progress 任务锚点快照 → 应用 → 运行验收查询 1+2+5
4. 创建 migration 399（孤儿分拣）→ 应用 → 运行验收查询 3
5. 创建 migration 400（横切件登记）→ 应用 → 运行验收查询 4
6. 更新 EXPECTED_SCHEMA_VERSION 到 400
7. CI 全绿验证

---

## 五、合同 DoD（铁律，全部必须通过）

| # | 验收项 | 验证方式 |
|---|--------|----------|
| DOD-1 | 查询返回 2 条 active 价值流（工厂+管家） | SQL 验收查询 1，结果=2 |
| DOD-2 | 工厂 6 个 Capability + 管家 5 个 Capability，total=11 | SQL 验收查询 2，两行分别=6/5 |
| DOD-3 | 迁移前 in_progress 任务 GP_ANCHOR/journey_id 迁移后仍可解析 | SQL 验收查询 5，journey_name 可返回 |
| DOD-4 | journey_features 孤儿（journey_id=NULL 且非 deprecated）清零 | SQL 验收查询 3，结果=0 |
| DOD-5 | 横切件池 7 项有 working_memory 登记记录 | SQL 验收查询 4，结果=7 |
| DOD-6 | F1 分拣后 ZenithJoy 挂片已迁回，分拣记录在 migration_audit.json | 脚本运行后检查 audit 文件 |
| DOD-7 | 全部变更走 migration 文件（397-400），非手工 ALTER | git diff 查看 migrations/ 新增文件 |
| DOD-8 | selfcheck.js EXPECTED_SCHEMA_VERSION 更新至 400 | grep 验证 |
| DOD-9 | CI 全绿 | PR checks 全通过 |

---

## 六、边界与 Out-of-Scope

**本 Sprint 内**：
- journeys 表结构扩展（type/parent_journey_id/capability_code）
- 2 条价值流 + 11 个 Capability 数据落库
- 孤儿 features 归位/归档
- 横切件池 7 项 working_memory 登记
- in_progress 任务锚点保护验证

**Out-of-Scope（本 Sprint 不做）**：
- Dashboard UI 展示 2 条价值流（独立任务）
- F1 内 46 个 journey_features 的逐一手工分拣确认（由脚本生成候选清单，人工最终确认后在 migration 399 中固化）
- ZenithJoy 仓库侧的 journey 结构调整

---

## 七、风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| selfcheck 版本号 mismatch 导致 Brain 启动失败 | 高 | 高 | 先更新 selfcheck.js，本地 npm test 再 push |
| F1 ZenithJoy 挂片关键字规则误判 | 中 | 中 | audit.json 人工复核，migration 399 留 2 次机会修正 |
| 西安机群 deprecated 后某任务仍引用 journey_id | 低 | 中 | 迁移前锚点快照检查覆盖 infrastructure journey |
| G3/G5 新立 Capability 与已有 journey_features 语义冲突 | 低 | 低 | 新建行，不影响存量 |

---

## 八、附录——关键 ID 速查

| 资源 | ID/标识 |
|------|---------|
| 决策依据 | `decisions.id = 4bc109e9-3b70-4b17-a1b4-bcd01bfae776` |
| 本任务 | `tasks.id = f491a8dd-b0e3-4352-a5e0-6cb85df73d80` |
| F1 journey | `journeys.id = e6f803f2-...` |
| MJ5 journey | `journeys.id = 51754939-...` |
| 西安机群 journey | `journeys.id = 0c1f70f1-...` |
| 当前 schema 版本 | 395（selfcheck.js EXPECTED_SCHEMA_VERSION） |
| 下一个 migration 号 | 397（396 已被 initiative_runs_gear 占用） |

---

## 九、Invariant 约束

以下约束是全链不可违背的红线，proposer/generator/evaluator 必须全部覆盖：

| ID | 约束 |
|----|------|
| INV-1 | 迁移期间任何已有 journey 行不得 DELETE（只允许 status 变更） |
| INV-2 | in_progress 任务的 journey_id FK 迁移后必须仍可解析（行还在，不受 parent_journey_id 新增影响） |
| INV-3 | 全部 schema 变更必须走 migration 文件（397-400），禁止手工 ALTER |
| INV-4 | 23 个 journey_id=NULL 孤儿必须归位或打 status=deprecated，禁止 DELETE |
| INV-5 | migration 必须有 rollback SQL（up/down 对称） |
| INV-6 | selfcheck.js EXPECTED_SCHEMA_VERSION 必须随 migration 400 同步更新到 400 |
| INV-7 | F1 挂片分拣规则必须机器可核查（migration_audit 记录），禁止"人工判断"静默过关 |
| INV-8 | 横切件池 7 项必须有可查询登记记录（主管 Capability + 守卫现状） |
| INV-9 | CI 全绿（facts-check + version-sync + brain-ci 全部通过） |

journey_type: capability_hierarchy
target_environment: local_api
