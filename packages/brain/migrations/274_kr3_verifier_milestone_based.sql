-- Migration 274: KR3 verifier SQL 改为基于 milestone decisions 表
--
-- 问题：KR3 progress 被两个系统竞争写入，导致陈旧数据 25% 反复出现：
--   1. tick-runner.js → calculateKR3Progress() → key_results.progress = 60%（每 5min）
--   2. kr-verifier.js → okr_projects.progress 加权平均 → key_results.progress = 25%（每 60min）
--   verifier 频率低但会覆盖 calculator 的正确值，导致 SelfDrive 看到 25% 并持续派发 KR3 dev 任务。
--
-- 修复：将 KR3 verifier SQL 改为直接从 decisions 表读取里程碑状态，
--   与 kr3-progress-calculator.js 的逻辑完全一致：
--     BASE_PCT = 60（代码就绪，PR#2329-#2359 全量合并）
--     + 10  kr3_cloud_functions_deployed
--     + 5   kr3_internal_test_started
--     + 3   kr3_real_device_bugs_cleared
--     + 5   kr3_trial_version_submitted
--     + 12  kr3_audit_passed
--     + 5   kr3_wx_pay_configured
--     = 100（上线 100%）
--
--   threshold 保持 100，verifier 运行结果 = milestone calculator 结果，两者不再冲突。

UPDATE kr_verifiers
SET
  query = $$SELECT (60
  + COALESCE((SELECT 10 FROM decisions WHERE topic = 'kr3_cloud_functions_deployed'  AND status = 'active' LIMIT 1), 0)
  + COALESCE((SELECT 5  FROM decisions WHERE topic = 'kr3_internal_test_started'    AND status = 'active' LIMIT 1), 0)
  + COALESCE((SELECT 3  FROM decisions WHERE topic = 'kr3_real_device_bugs_cleared' AND status = 'active' LIMIT 1), 0)
  + COALESCE((SELECT 5  FROM decisions WHERE topic = 'kr3_trial_version_submitted'  AND status = 'active' LIMIT 1), 0)
  + COALESCE((SELECT 12 FROM decisions WHERE topic = 'kr3_audit_passed'             AND status = 'active' LIMIT 1), 0)
  + COALESCE((SELECT 5  FROM decisions WHERE topic = 'kr3_wx_pay_configured'        AND status = 'active' LIMIT 1), 0)
) AS count$$,
  threshold = 100,
  check_interval_minutes = 60,
  updated_at = NOW()
WHERE kr_id = 'f9d769b1-5083-4971-a2f3-19983f32ba38';

-- 立即更新 key_results.progress 到正确值（60%，代码就绪阶段）
-- 避免等下次 verifier 运行才生效（最长 60min 延迟）
DO $$
DECLARE
  v_progress INTEGER;
BEGIN
  SELECT (60
    + COALESCE((SELECT 10 FROM decisions WHERE topic = 'kr3_cloud_functions_deployed'  AND status = 'active' LIMIT 1), 0)
    + COALESCE((SELECT 5  FROM decisions WHERE topic = 'kr3_internal_test_started'    AND status = 'active' LIMIT 1), 0)
    + COALESCE((SELECT 3  FROM decisions WHERE topic = 'kr3_real_device_bugs_cleared' AND status = 'active' LIMIT 1), 0)
    + COALESCE((SELECT 5  FROM decisions WHERE topic = 'kr3_trial_version_submitted'  AND status = 'active' LIMIT 1), 0)
    + COALESCE((SELECT 12 FROM decisions WHERE topic = 'kr3_audit_passed'             AND status = 'active' LIMIT 1), 0)
    + COALESCE((SELECT 5  FROM decisions WHERE topic = 'kr3_wx_pay_configured'        AND status = 'active' LIMIT 1), 0)
  ) INTO v_progress;

  UPDATE key_results
  SET progress     = v_progress,
      progress_pct = v_progress,
      updated_at   = NOW()
  WHERE id = 'f9d769b1-5083-4971-a2f3-19983f32ba38';

  RAISE NOTICE 'KR3 progress 已更新为 %', v_progress;
END $$;

INSERT INTO schema_migrations (version, applied_at, description)
VALUES (274, NOW(), 'KR3 verifier SQL 改为里程碑 decisions 驱动，消除与 kr3-progress-calculator 的 25% 陈旧数据冲突')
ON CONFLICT (version) DO NOTHING;
