-- Migration 183: 修复 kr_verifiers → key_results 外键断裂
--
-- 背景：
--   migration 170 建表时 kr_verifiers.kr_id REFERENCES goals(id)
--   PR #1475 改 kr-verifier.js 为 JOIN key_results，但未同步更新 FK 和 kr_id 数据
--   导致：
--     - 7 个 verifier 指向 archived key_results（被过滤条件跳过）
--     - 8 个 verifier 指向 goals-only IDs（UPDATE key_results 匹配 0 行）
--     - 7 个活跃 key_results 无 verifier → progress 永久为 0%
--
-- 修复步骤：
--   1. 删除 8 个孤立 verifier（kr_id 只在 goals，不在 key_results）
--   2. DROP 旧 FK（→ goals）
--   3. UPDATE 7 个 archived verifier 重新指向对应 active key_results
--   4. ADD 新 FK（→ key_results）ON DELETE CASCADE
--   5. 立即回填 key_results.progress（从 kr_verifiers.current_value / threshold）

-- ============================================================
-- 1. 删除 8 个孤立 verifier（kr_id 不在 key_results 表中）
-- ============================================================
--
-- 这些 verifier 的 kr_id 指向 goals 表中的旧 OKR 条目，
-- 新 OKR 层级已迁移到独立 key_results 表，这些 verifier 无法与任何活跃 KR 关联。

DELETE FROM kr_verifiers
WHERE kr_id NOT IN (SELECT id FROM key_results);

-- ============================================================
-- 2. DROP 旧 FK 约束（REFERENCES goals）
-- ============================================================

ALTER TABLE kr_verifiers
  DROP CONSTRAINT IF EXISTS kr_verifiers_kr_id_fkey;

-- ============================================================
-- 3. 重新链接 7 个 verifier：archived key_results → active key_results
--
-- 映射根据标题前缀一致性确认（archived 和 active 各自都有独立记录）：
--   cf33b651 (管家闭环, archived) → 7ad8006a (管家闭环, active)
--   5729018a (算力全开, archived) → 90a2ae5e (算力全开, active)
--   52708eaf (系统稳定, archived) → a7527918 (系统稳定, active)
--   8a630be6 (内容生成, archived) → 65b4142d (内容生成, active)
--   be681c5e (数据闭环, archived) → ff1635d6 (数据闭环, active)
--   9a102e9a (Dashboard可用, archived) → d7304474 (Dashboard可用, active)
--   2d93b222 (自动发布, archived) → 4b4d2262 (自动发布, active)
-- ============================================================

UPDATE kr_verifiers SET kr_id = '7ad8006a-8b74-44fb-a288-52fdcdaed1d1', updated_at = NOW()
WHERE kr_id = 'cf33b651-00b6-4d49-b4b0-6f87e98ab91e';

UPDATE kr_verifiers SET kr_id = '90a2ae5e-26e0-4ea5-a1a4-9c881c58e6ec', updated_at = NOW()
WHERE kr_id = '5729018a-3e67-40f8-a65d-154c3af8d5c5';

UPDATE kr_verifiers SET kr_id = 'a7527918-1ab8-45f0-976a-c1384870727f', updated_at = NOW()
WHERE kr_id = '52708eaf-6d17-4135-8bc7-b9146ee887ca';

UPDATE kr_verifiers SET kr_id = '65b4142d-242b-457d-abfa-c0c38037f1e9', updated_at = NOW()
WHERE kr_id = '8a630be6-41a5-4ea7-9b1b-b66564140032';

UPDATE kr_verifiers SET kr_id = 'ff1635d6-ad02-4223-a6a9-f6c044e39c72', updated_at = NOW()
WHERE kr_id = 'be681c5e-a090-46d4-9f4c-ac4777a678f7';

UPDATE kr_verifiers SET kr_id = 'd7304474-2061-497b-ba85-5aecb02e5600', updated_at = NOW()
WHERE kr_id = '9a102e9a-a535-4850-b0c9-424c63532361';

UPDATE kr_verifiers SET kr_id = '4b4d2262-b250-4e7b-8044-00d02d2925a3', updated_at = NOW()
WHERE kr_id = '2d93b222-6cc8-49a7-b275-952a76c9ce60';

-- ============================================================
-- 4. 添加新 FK 约束（REFERENCES key_results）
-- ============================================================

ALTER TABLE kr_verifiers
  ADD CONSTRAINT kr_verifiers_kr_id_fkey
  FOREIGN KEY (kr_id) REFERENCES key_results(id) ON DELETE CASCADE;

-- ============================================================
-- 5. 立即回填 key_results.progress
--    公式：LEAST(100, ROUND(current_value / GREATEST(threshold, 1) * 100))
--    用 kr_verifiers 中已存储的 current_value（上次采集结果）
-- ============================================================

UPDATE key_results kr
SET
  progress    = LEAST(100, ROUND(v.current_value::numeric / GREATEST(v.threshold::numeric, 1) * 100)),
  metadata    = COALESCE(kr.metadata, '{}'::jsonb)
                || jsonb_build_object('metric_current', v.current_value::text),
  updated_at  = NOW()
FROM kr_verifiers v
WHERE v.kr_id = kr.id
  AND v.enabled = true;

-- ============================================================
-- 6. 数据验证（非阻断）
-- ============================================================

DO $$
DECLARE
  v_active_krs     bigint;
  v_linked_verifiers bigint;
  v_orphaned       bigint;
BEGIN
  SELECT COUNT(*) INTO v_active_krs
  FROM key_results WHERE status NOT IN ('archived', 'cancelled');

  SELECT COUNT(DISTINCT kr_id) INTO v_linked_verifiers
  FROM kr_verifiers WHERE enabled = true;

  SELECT COUNT(*) INTO v_orphaned
  FROM kr_verifiers v
  LEFT JOIN key_results kr ON kr.id = v.kr_id
  WHERE kr.id IS NULL;

  RAISE NOTICE '=== Migration 183 验证报告 ===';
  RAISE NOTICE '活跃 key_results: %', v_active_krs;
  RAISE NOTICE '已链接 verifier 的 KR 数: %', v_linked_verifiers;
  RAISE NOTICE '孤立 verifier（FK 断裂）: % — %',
    v_orphaned, CASE WHEN v_orphaned = 0 THEN 'PASS' ELSE 'WARN' END;
  RAISE NOTICE '=== 验证完成 ===';
END $$;

-- ============================================================
-- 7. schema_version
-- ============================================================

INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '183',
  'kr_verifiers FK 修复：旧 REFERENCES goals → 新 REFERENCES key_results；重链 7 个 archived verifier 到 active key_results；立即回填 key_results.progress',
  now()
)
ON CONFLICT (version) DO NOTHING;
