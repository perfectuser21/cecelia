# 小改动 PrepPRD：T1 harness orchestrator DB migration（312）

> Brain task: 3a9d18f6-b514-4fe8-99ce-8fc02146ca16
> Initiative: harness-orchestration-redesign（docs/current/harness-orchestration-redesign/architecture.md）
> 主理人已对整个 initiative 给出 standing approval（2026-07-04），本 PrepPRD 按该授权直接执行。

## 改什么

新增 migration `packages/brain/migrations/312_orchestrator_runs_state.sql`（编号 312：309 被未合并分支 cp-06301637 占用，310/311 已在 main）：

**A. initiative_runs 增列（全 additive）**
- `round` INT NOT NULL DEFAULT 0 — GAN/fix 轮次
- `pr_url` TEXT — 仅 orchestrator_version='v2' 语义（一 run 一 sprint 一 PR），注释写死
- `evaluate_verdict` TEXT CHECK (IN ('PASS','FAIL','FIXED'))（NULL 允许；FIXED 是 evaluator 前科，接受为 PASS 语义由代码层处理）
- `judge_verdict` TEXT CHECK (IN ('PASS','FAIL'))（NULL 允许）
- `orchestrator_version` TEXT NOT NULL DEFAULT 'v1' — D7 双轨 flag（v1=LangGraph 存量，v2=新 orchestrator）
- `orchestrator_heartbeat_at` TIMESTAMPTZ — D8 心跳（命名避开 292 tasks.driver_heartbeat_at）
- `orchestrator_host` TEXT / `orchestrator_pid` INT — watchdog 重拉需要 host+pid 才可用（跨主机 pid 无意义）
- ❌ 不加 contract_branch：initiative_contracts.propose_branch 是唯一存储（双账本消灭）

**B. phase CHECK 扩枚举**
- DROP 旧 CHECK → ADD 新 CHECK：`('A_planning','A_contract','B_task_loop','C_final_e2e','done','failed','planning','gan','generate','evaluate')`
- ⚠️ 必须含 `A_planning`（watchdog/patrol 认它为存量合法值，漏掉则有存量行的库 ADD CONSTRAINT 全表校验直接失败）

**C. orchestrator_decision_log 表（append-only 决策日志，DoD F7）**
- id BIGSERIAL PK / run_id UUID NOT NULL REFERENCES initiative_runs(id) / hop INT NOT NULL / observed JSONB NOT NULL / derived_phase TEXT NOT NULL / gate_verdict TEXT / action TEXT NOT NULL / detail JSONB / created_at TIMESTAMPTZ DEFAULT NOW()
- UNIQUE(run_id, hop)（orchestrator 崩溃重跑同 hop 不双写）
- CREATE INDEX IF NOT EXISTS idx_orchestrator_decision_log_run ON ...(run_id)（命名对齐 idx_<表>_<列> 惯例）
- 完整 append-only trigger（CREATE FUNCTION + TRIGGER 禁 UPDATE/DELETE，raise exception）——硬门禁在代码，不是注释承诺
- 留存策略注释：run 完成 90 天后可由 janitor 清理（清理实现不在本 PR）

**D. selfcheck.js**
- EXPECTED_SCHEMA_VERSION bump 到 '312'（同 PR：migration 与依赖它的版本预警一起落）

**E. 文档**
- docs/current/harness-orchestration-redesign/{architecture.md,initiative-dod.md} 随本 PR 入库（当前未 commit）

## 为什么改
architecture.md §2.2：去 LangGraph checkpoint，状态改为"从外部真相可重推导"的轻量字段 + append-only 决策日志（可审计/debug）+ 心跳（D8 watchdog 重拉）。

## 关联上下文
- Journey: Cecelia Harness Pipeline（bb8cc561）
- 决策: architecture.md D1-D10（主理人 2026-07-04 review 通过）
- Schema challenger 审查（2026-07-04）：10 issues 全部吸收，2 个 P0（A_planning 枚举遗漏 / watchdog 盲区）已解

## 影响范围
- 全 additive + 旧枚举保留 → 现有 LangGraph 路径、dashboard（phase 当展示字符串）、watchdog 均不受影响
- ⚠️ 硬顺序依赖：新 phase 值（planning/gan/generate/evaluate）在 T4（watchdog 覆盖 v2）合并前不得在生产出现——orchestrator_version 默认 'v1'，v2 run 只能由 T2+ 的 orchestrator 创建，天然满足
- 生产部署：hk-vps + mmv 两台各跑一次 brain-deploy.sh（migration additive，两台任意顺序安全）
- migrate.js 按文件名记 schema_version，310/311 起不手写 INSERT INTO schema_version，312 同样不写

## 验收标准
- [ ] migration 在干净库和带存量数据（含 phase='A_planning' 行）的库上都能成功执行（测试覆盖）
- [ ] orchestrator_decision_log 的 UPDATE/DELETE 被 trigger 拒绝（测试覆盖，proven-to-fire：亲眼看它报错）
- [ ] UNIQUE(run_id,hop) 重复插入被拒（测试覆盖）
- [ ] 旧枚举值 + 新枚举值均可写入 phase；枚举外值被拒（测试覆盖）
- [ ] selfcheck EXPECTED_SCHEMA_VERSION='312'
- [ ] CI 全绿
