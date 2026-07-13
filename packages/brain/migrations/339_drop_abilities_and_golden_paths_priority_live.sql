-- Migration 339: 两条低风险 schema 清理/增强（decision 13013a49，能力轴新定义）
--   M1: DROP 死表 abilities（migration 294 建，已被 journey_features 取代，全仓零活引用）
--   M3: golden_paths(334) 加 priority + status 扩 'live'（已上线）态
-- 只动 schema，向后兼容，不破坏现有行。

-- ─────────────────────────────────────────────────────────────
-- M1: DROP 死表 abilities
-- 唯一入站 FK（golden_path.ability_id）早在 migration 303 DROP TABLE ... CASCADE 清掉；
-- routes/abilities.js 虽名叫 abilities，全程操作 journey_features，无活引用。
-- 幂等：IF EXISTS 守卫，重复执行安全。
-- ⚠️ DROP 前已人工自检本库 abilities 行数（无数据方可删）。
DROP TABLE IF EXISTS abilities;

-- ─────────────────────────────────────────────────────────────
-- M3: golden_paths 加 priority（主理人排序）+ status 扩 'live'（已上线）态
-- priority：主理人排序用，默认 NULL（未排）。
ALTER TABLE golden_paths ADD COLUMN IF NOT EXISTS priority INTEGER;
COMMENT ON COLUMN golden_paths.priority IS '主理人排序权重（NULL=未排，越小越靠前）——GP 生命周期主理人 priority 排序';

-- status CHECK 扩一个 'live'（已上线，在 delivered 之后）。
-- 沿用仓库既有幂等范式（见 302/334）：先 DROP 旧同名约束再 ADD，保证重复执行一致。
DO $$
BEGIN
  -- golden_paths(334) 的 status CHECK 为表内联匿名约束，pg 自动命名 golden_paths_status_check。
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golden_paths_status_check') THEN
    ALTER TABLE golden_paths DROP CONSTRAINT golden_paths_status_check;
  END IF;
  ALTER TABLE golden_paths ADD CONSTRAINT golden_paths_status_check
    CHECK (status IN ('candidate','proposed','converged','approved','in_dev',
                      'delivered','live','expired','rejected','blocked_gate','superseded'));
END $$;

COMMENT ON COLUMN golden_paths.status IS 'GP 11 态生命周期：candidate→proposed→converged→approved→in_dev→delivered→live（已上线）；旁支 expired/rejected/blocked_gate/superseded';
