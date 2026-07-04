# Spec：harness orchestrator DB migration（312）

> Initiative: harness-orchestration-redesign（docs/current/harness-orchestration-redesign/architecture.md §2.2）
> Brain task: 3a9d18f6 (T1)。PrepPRD: sprints/07041024-orchestrator-db-migration/prep-prd.md
> 设计已过 schema challenger 对抗审查（10 issues 全吸收，含 2 个 P0）。

## 目标

为去 LangGraph 化的独立 orchestrator 提供 DB 结构：可从外部真相重推导的轻量状态字段（非 checkpoint 快照）、append-only 决策日志（可审计）、心跳（watchdog 重拉依据）、双轨 flag。

## 方案（已定，二选一的比选结论）

- ✅ **扩展 initiative_runs**（run 是编排单位；migration 300 方向是 harness 脱离 tasks 表）
- ❌ 新建 orchestrator_runs 表（与 initiative_runs 90% 重合，第二账本）

## 变更清单

### 1. `packages/brain/migrations/312_orchestrator_runs_state.sql`

**A. initiative_runs 增列（全部 `ADD COLUMN IF NOT EXISTS`）**

| 列 | 类型 | 约束/默认 | 说明 |
|---|---|---|---|
| round | INT | NOT NULL DEFAULT 0 | GAN/fix 轮次 |
| pr_url | TEXT | NULL | 仅 orchestrator_version='v2' 语义（一 run 一 PR），SQL 注释写死 |
| evaluate_verdict | TEXT | CHECK (evaluate_verdict IN ('PASS','FAIL','FIXED')) | NULL 允许；FIXED=evaluator 前科，语义归一由代码层做 |
| judge_verdict | TEXT | CHECK (judge_verdict IN ('PASS','FAIL')) | NULL 允许 |
| orchestrator_version | TEXT | NOT NULL DEFAULT 'v1' CHECK (IN ('v1','v2')) | D7 双轨 flag |
| orchestrator_heartbeat_at | TIMESTAMPTZ | NULL | D8；命名避开 292 tasks.driver_heartbeat_at |
| orchestrator_host | TEXT | NULL | watchdog 重拉需 host+pid（跨主机裸 pid 无意义） |
| orchestrator_pid | INT | NULL | 同上 |

不加 contract_branch：`initiative_contracts.propose_branch` 唯一存储（消灭双账本）。

**B. phase CHECK 扩枚举**

```sql
ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_phase_check;
ALTER TABLE initiative_runs ADD CONSTRAINT initiative_runs_phase_check
  CHECK (phase IN ('A_planning','A_contract','B_task_loop','C_final_e2e',
                   'done','failed','planning','gan','generate','evaluate'));
```

必含 `A_planning`（watchdog/patrol 认可的存量值；漏掉 → 有存量行的库 ADD CONSTRAINT 全表校验失败，两台生产 schema 分叉）。

**C. orchestrator_decision_log（append-only）**

```sql
CREATE TABLE IF NOT EXISTS orchestrator_decision_log (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  hop INT NOT NULL,
  observed JSONB NOT NULL,        -- 观测快照（git/PR/DB 摘要）
  derived_phase TEXT NOT NULL,    -- 纯函数推导出的 phase
  gate_verdict TEXT,              -- 门禁判定（如有）
  action TEXT NOT NULL,           -- 派了谁/干了什么
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_orchestrator_decision_log_run_hop UNIQUE (run_id, hop)
);
CREATE INDEX IF NOT EXISTS idx_orchestrator_decision_log_run
  ON orchestrator_decision_log(run_id);
```

append-only 硬约束（完整 SQL，非注释承诺）：

```sql
CREATE OR REPLACE FUNCTION orchestrator_decision_log_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'orchestrator_decision_log is append-only (% blocked)', TG_OP;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orchestrator_decision_log_append_only ON orchestrator_decision_log;
CREATE TRIGGER trg_orchestrator_decision_log_append_only
  BEFORE UPDATE OR DELETE ON orchestrator_decision_log
  FOR EACH ROW EXECUTE FUNCTION orchestrator_decision_log_append_only();
```

留存策略：SQL 注释注明"run 完成 90 天后可由 janitor 清理（TRUNCATE/分区不受 row trigger 限制），清理实现不在本 PR"。

### 2. `packages/brain/src/selfcheck.js`

`EXPECTED_SCHEMA_VERSION` → `'312'`（orchestrator 后续代码强依赖新列；同 PR bump 让旧库跑新代码时 selfcheck 报警）。

### 3. 文档入库

`docs/current/harness-orchestration-redesign/{architecture.md,initiative-dod.md}` + `sprints/07041024-orchestrator-db-migration/prep-prd.md` 随本 PR 提交。

## 错误处理

- migration 幂等：全部 IF NOT EXISTS / DROP…IF EXISTS，重复执行安全
- 存量数据兼容：新 CHECK 覆盖全部历史 phase 值（含 A_planning）
- migrate.js 按文件名记 schema_version（310/311 起不手写 INSERT）

## 测试策略

档位：**integration（DB 层）**——migration 的行为面是真实 Postgres 的约束/触发器行为，unit mock 无意义；不需要 E2E（无用户可见面）。

新增 `packages/brain/src/__tests__/migration-312-orchestrator.test.js`（vitest，走仓库现有 DB 测试模式）：

1. **存量兼容（P0 回归）**：先插一行 `phase='A_planning'` 的 initiative_runs，再执行 312 → 成功（证明 CHECK 不打爆存量）
2. **枚举**：新值 planning/gan/generate/evaluate 可写；`phase='bogus'` 被拒
3. **append-only proven-to-fire**：INSERT 决策日志一行成功 → UPDATE 被 trigger 拒（断言报错信息含 append-only）→ DELETE 同样被拒（哨兵死规矩：亲眼看它报红）
4. **UNIQUE(run_id,hop)**：同 (run_id,hop) 二次 INSERT 被拒
5. **verdict CHECK**：evaluate_verdict='FIXED' 可写、'MAYBE' 被拒
6. **幂等**：312 连跑两遍不报错
7. **selfcheck**：断言 EXPECTED_SCHEMA_VERSION === '312'

TDD 纪律：commit-1 = failing tests（migration 文件尚不存在 → 全红），commit-2 = migration + selfcheck bump（全绿）。

## 影响范围 / 部署

- 全 additive + 旧枚举保留 → LangGraph 现路径、dashboard（phase 仅展示）、现 watchdog 不受影响
- 硬顺序依赖：新 phase 值在 T4（watchdog 覆盖 v2）合并前不得在生产出现——orchestrator_version 默认 'v1' 天然满足
- 生产：hk-vps + mmv 两台各跑 brain-deploy.sh（additive，任意顺序安全）
