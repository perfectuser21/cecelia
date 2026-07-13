-- Migration 341: 刀1a — ZenithJoy 裸表归位 zenithjoy schema
--
-- 背景：user/session/account/verification/operator_sessions 这 5 张表是 Better Auth
-- 在 ZenithJoy 早期建的，因 DATABASE_URL 指向 cecelia 库，建在了 public schema。
-- 现在 zenithjoy schema 已存在（内含 works/publish_logs 等 ZJ 产品表），
-- 把这 5 张表迁入 zenithjoy schema，消除与未来 Cecelia 表的撞名风险。
--
-- ⚠️ P0 事故修复（2026-07-13）：原版此处还有一条数据库级别全局 search_path
-- 变更语句（把 cecelia 库的默认 search_path 设成 zenithjoy 优先于 public），
-- 该语句导致 Brain 自己裸写的 tasks(goal_id) 优先
-- 解析到 ZenithJoy 同名但结构不同的 zenithjoy.tasks 表，Brain 容器 crash-loop。
-- 两个 App 共享一个物理库时禁止用数据库级别语句改全局 search_path。
-- ZenithJoy 侧改为在自己的 pg.Pool 连接配置里加
--   `options: '-c search_path=zenithjoy,public'`
-- 这是连接级别设置，只影响 ZenithJoy 自己发起的连接，不影响 Brain。
-- 见 zenithjoy 仓库 apps/api/src/db/connection.ts。
--
-- 方案：
--   ALTER TABLE ... SET SCHEMA zenithjoy（FK 约束按 OID 追踪，自动更新，数据原地保留）
--
-- 幂等：用 DO $$ ... $$ 块判断表是否已在 zenithjoy schema，避免重复执行报错。
-- 执行顺序：user 最后移（account/session 有 FK 指向它，先移 FK 源，再移被引用表）

-- 确保 zenithjoy schema 存在（通常已有，此处兜底）
CREATE SCHEMA IF NOT EXISTS zenithjoy;

DO $$
BEGIN
  -- operator_sessions（无外键）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'operator_sessions') THEN
    ALTER TABLE public.operator_sessions SET SCHEMA zenithjoy;
  END IF;

  -- verification（无外键）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'verification') THEN
    ALTER TABLE public.verification SET SCHEMA zenithjoy;
  END IF;

  -- account（FK → user，先移 account 再移 user，FK 按 OID 追踪）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'account') THEN
    ALTER TABLE public.account SET SCHEMA zenithjoy;
  END IF;

  -- session（FK → user）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'session') THEN
    ALTER TABLE public.session SET SCHEMA zenithjoy;
  END IF;

  -- user（被 account/session 引用，最后移）
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'user') THEN
    ALTER TABLE public."user" SET SCHEMA zenithjoy;
  END IF;
END $$;
