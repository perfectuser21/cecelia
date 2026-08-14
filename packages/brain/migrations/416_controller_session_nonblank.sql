-- Migration 416: Controller ownership 统一非空白语义
--
-- migration 415 的 TEXT 列允许历史/直接 SQL 写入空串或纯空白；
-- 应用滚动期间先将存量异常值归一为 NULL（无主），再用数据库
-- CHECK 阻止新的空白 ownership。NOT VALID + VALIDATE 明确分离新写入栅栏
-- 与存量扫描，最终保证约束已验证。

CREATE OR REPLACE FUNCTION cecelia_controller_session_is_blank(session_value text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT session_value ~ U&'^[[:space:]\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'
$$;

UPDATE initiative_runs
 SET controller_session_id = NULL
 WHERE controller_session_id IS NOT NULL
   AND cecelia_controller_session_is_blank(controller_session_id);

ALTER TABLE initiative_runs
  ADD CONSTRAINT initiative_runs_controller_session_nonblank_check
  CHECK (controller_session_id IS NULL OR NOT cecelia_controller_session_is_blank(controller_session_id))
  NOT VALID;

ALTER TABLE initiative_runs
  VALIDATE CONSTRAINT initiative_runs_controller_session_nonblank_check;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('416', 'normalize and reject blank Controller ownership sessions', NOW())
ON CONFLICT (version) DO NOTHING;
