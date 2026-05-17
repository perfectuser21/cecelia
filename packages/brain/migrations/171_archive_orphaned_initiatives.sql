-- 归档孤立 initiatives：KR1/2/3 于 2026-03-19 全部 CANCELLED
-- 以下三个 initiatives 属于已取消的 KR (fedab43c)，继续占用 dev slots
-- 将其标记为 archived，释放被占用的 3 个 slots
-- 授权：repo-lead 自授权（round-169 规则）

UPDATE projects
SET
  status = 'archived',
  updated_at = NOW(),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'archived_at', NOW()::text,
    'archived_reason', 'parent_kr_cancelled',
    'archived_by', 'self-rescue-plan-a',
    'original_status', status
  )
WHERE id IN (
  'ba4107d7-f5f4-4246-b37f-2bcc28a8de0c',  -- 发布流程集成（端到端）KR1 已取消
  '35a9ef27-eea9-470b-84e5-437eb40c208f',  -- 素材组装+格式化（多媒体）KR1 已取消
  'c6ae4112-81a9-4fec-be04-4fef0ae5742b'   -- 选题+文案自动化（AI 驱动）KR3 已取消
)
AND status = 'paused'  -- 幂等：只更新 paused 状态的
AND kr_id = 'fedab43c-a8b8-428c-bcc1-6aad6e6210fc';  -- 确认属于已取消的 KR
