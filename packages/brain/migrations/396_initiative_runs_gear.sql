-- Migration 396: initiative_runs.gear（kernel 真读 harness gear，sprint 08091640）
-- kernel runtime（orchestrator/derive.js 纯函数状态机）此前完全不读 payload.gear，harness gear
-- 三档（default/hotfix/segmented）在 kernel 上形同虚设。本列把 relay 建 run 时 deriveGear(task)
-- 读出的档位落库，供 collectGroundTruth 每跳注入 observed.gear、derive 分叉。
--
-- 可空：NULL 是「default 语义」的载体——存量 192 条 run 一行都不回填，读回 NULL 时
-- collectGroundTruth 降级 'default'，derive 分叉对 default 是 no-op，行为零变化（零回归红线）。
-- 不建 CHECK 约束/ENUM：合法枚举由 relay 层 deriveGear（GEAR_VALUES 白名单，非法值 throw）
-- 与 derive 侧 fail-closed 双闸把关；档位清单跟着 harness 能力走，改动频率高于表结构。
-- 回滚脚本在 migrations/rollback/396_initiative_runs_gear.down.sql（不放本目录：
-- migrate.js 按文件名排序会让 *.down.sql 抢在 *.sql 之前执行）。

ALTER TABLE initiative_runs
  ADD COLUMN IF NOT EXISTS gear TEXT;
