#!/usr/bin/env bash
# 刀1b — 初始化独立 zenithjoy 库骨架
#
# 在独立 zenithjoy 数据库内创建 zenithjoy schema + 5 张 ZenithJoy Auth 核心表骨架。
# 此脚本只建结构，不导数据。数据迁移由后续刀（刀2）完成。
#
# 前提：zenithjoy DB 已存在（CREATE DATABASE zenithjoy 已由 DBA/运维完成）
#
# 用法：
#   DB_HOST=host.docker.internal DB_USER=cecelia bash packages/brain/scripts/setup-zenithjoy-db.sh
#   # 或直接用 DATABASE_URL：
#   ZJ_DB_URL=postgresql://cecelia:cecelia@host.docker.internal:5432/zenithjoy bash ...
#
# 幂等：所有语句均用 IF NOT EXISTS / ON CONFLICT DO NOTHING，重复执行安全。

set -euo pipefail

ZJ_DB_URL="${ZJ_DB_URL:-postgresql://${DB_USER:-cecelia}:${DB_PASSWORD:-cecelia}@${DB_HOST:-host.docker.internal}:${DB_PORT:-5432}/zenithjoy}"

echo "[setup-zenithjoy-db] 目标: $ZJ_DB_URL"
echo "[setup-zenithjoy-db] 刀1b — 创建 zenithjoy schema + 5 张 auth 表骨架"

psql "$ZJ_DB_URL" <<'SQL'

-- ① schema
CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ② search_path（zenithjoy DB 内默认找 zenithjoy schema）
ALTER DATABASE zenithjoy SET search_path = zenithjoy, public;

-- ③ user 表（Better Auth 主表）
CREATE TABLE IF NOT EXISTS zenithjoy."user" (
  id            text        NOT NULL,
  name          text        NOT NULL,
  email         text        NOT NULL,
  "emailVerified" boolean   NOT NULL,
  image         text,
  "createdAt"   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE (email)
);

-- ④ session 表（Better Auth 会话）
CREATE TABLE IF NOT EXISTS zenithjoy.session (
  id          text        NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  token       text        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId"    text        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (token),
  FOREIGN KEY ("userId") REFERENCES zenithjoy."user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_userId_idx ON zenithjoy.session ("userId");

-- ⑤ account 表（Better Auth OAuth provider）
CREATE TABLE IF NOT EXISTS zenithjoy.account (
  id                     text        NOT NULL,
  "accountId"            text        NOT NULL,
  "providerId"           text        NOT NULL,
  "userId"               text        NOT NULL,
  "accessToken"          text,
  "refreshToken"         text,
  "idToken"              text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope                  text,
  password               text,
  "createdAt"            timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            timestamptz NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY ("userId") REFERENCES zenithjoy."user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS account_userId_idx ON zenithjoy.account ("userId");

-- ⑥ verification 表（Better Auth 邮件验证 / 魔法链接）
CREATE TABLE IF NOT EXISTS zenithjoy.verification (
  id          text        NOT NULL,
  identifier  text        NOT NULL,
  value       text        NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON zenithjoy.verification (identifier);

-- ⑦ operator_sessions 表（ZenithJoy 平台凭据状态）
CREATE SEQUENCE IF NOT EXISTS zenithjoy.operator_sessions_id_seq;

CREATE TABLE IF NOT EXISTS zenithjoy.operator_sessions (
  id              bigint      NOT NULL DEFAULT nextval('zenithjoy.operator_sessions_id_seq'),
  platform        text        NOT NULL,
  secret_name     text        NOT NULL,
  status          text        NOT NULL DEFAULT 'missing',
  last_checked_at timestamptz,
  last_valid_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (platform),
  CONSTRAINT check_operator_session_status CHECK (status IN ('active', 'expired', 'missing'))
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_platform ON zenithjoy.operator_sessions (platform);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_status  ON zenithjoy.operator_sessions (status);

-- ⑧ schema_version 表（为将来的 zenithjoy DB 迁移做准备）
CREATE TABLE IF NOT EXISTS zenithjoy.schema_version (
  version     varchar(10) NOT NULL,
  description text,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version)
);

INSERT INTO zenithjoy.schema_version (version, description)
VALUES ('1', '刀1b — zenithjoy DB 骨架初始化 (user/session/account/verification/operator_sessions)')
ON CONFLICT (version) DO NOTHING;

SQL

echo "[setup-zenithjoy-db] ✅ 完成 — zenithjoy DB 骨架已就绪"
echo "[setup-zenithjoy-db] 验证："
psql "$ZJ_DB_URL" -c "SELECT version, description FROM zenithjoy.schema_version;"
psql "$ZJ_DB_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='zenithjoy' ORDER BY table_name;"
