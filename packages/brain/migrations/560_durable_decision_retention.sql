-- 决策是真身台账；保留既有清理调用合同，不再按年龄删账。
CREATE OR REPLACE FUNCTION public.cleanup_decisions(retain_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 0;
END;
$$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('560', '决策台账永久留存，周期清理不再按年龄删除', NOW())
ON CONFLICT (version) DO NOTHING;
