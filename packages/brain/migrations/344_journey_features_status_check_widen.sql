-- Migration 344: journey_features status CHECK 拓宽（修 343 窄枚举）
-- 背景：343 的 CHECK 只列 planned/building/done/deprecated/live，漏了生产真实在用的
-- working（28 行）与 broken（3 行）→ 生产 apply 343 时 23514 部署失败。
-- 343 原文已同步修正（未 apply 的库直接得到宽版）；本迁移兜住已 apply 窄版的库
-- （staging / preview 环境）。幂等：drop + 重建。
ALTER TABLE journey_features DROP CONSTRAINT IF EXISTS journey_features_status_check;
ALTER TABLE journey_features ADD CONSTRAINT journey_features_status_check
  CHECK (status IN ('planned','building','working','done','broken','deprecated','live'));
