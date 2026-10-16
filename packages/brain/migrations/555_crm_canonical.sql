-- 独立 CRM 真身；Notion 是受限录入/展示面。默认关闭，无生产自动注册。
BEGIN;
CREATE TABLE IF NOT EXISTS crm_sync_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  data_source_id text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT false,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb, cursor text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS crm_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  binding_id uuid NOT NULL, source_page_id text NOT NULL UNIQUE,
  external_customer_id text, display_name text NOT NULL,
  manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_markdown text NOT NULL DEFAULT '', profile_managed boolean NOT NULL DEFAULT false,
  source_edited_at timestamptz NOT NULL,
  source_archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  projection_pending boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,tenant_id), UNIQUE(binding_id,source_page_id),
  FOREIGN KEY(binding_id,tenant_id) REFERENCES crm_sync_bindings(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS crm_wechat_accounts (
  tenant_id uuid NOT NULL, account_id text NOT NULL UNIQUE, agent_id text,
  persona jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,account_id)
);
CREATE TABLE IF NOT EXISTS crm_contact_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  account_id text NOT NULL, contact_id text NOT NULL, customer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,account_id,contact_id), UNIQUE(id,tenant_id,customer_id,account_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES crm_wechat_accounts(tenant_id,account_id),
  FOREIGN KEY(customer_id,tenant_id) REFERENCES crm_customers(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS crm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL, contact_link_id uuid NOT NULL, account_id text NOT NULL,
  message_id text NOT NULL, direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
  text text NOT NULL, occurred_at timestamptz NOT NULL,
  time_precision text NOT NULL CHECK(time_precision IN ('exact','minute','day','unknown')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  projection_pending boolean NOT NULL DEFAULT true, notion_page_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,account_id,contact_link_id,message_id), UNIQUE(id,tenant_id,customer_id),
  FOREIGN KEY(contact_link_id,tenant_id,customer_id,account_id) REFERENCES crm_contact_links(id,tenant_id,customer_id,account_id)
);
CREATE TABLE IF NOT EXISTS crm_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, customer_id uuid NOT NULL,
  type text NOT NULL CHECK(type IN ('daily','weekly','monthly')),
  period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>=period_start),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), markdown text NOT NULL,
  projection_pending boolean NOT NULL DEFAULT true, notion_page_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,customer_id,type,period_start,period_end,version), UNIQUE(id,tenant_id,customer_id),
  FOREIGN KEY(customer_id,tenant_id) REFERENCES crm_customers(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS crm_report_messages (
  report_id uuid NOT NULL, message_id uuid NOT NULL, tenant_id uuid NOT NULL, customer_id uuid NOT NULL,
  PRIMARY KEY(report_id,message_id),
  FOREIGN KEY(report_id,tenant_id,customer_id) REFERENCES crm_reports(id,tenant_id,customer_id),
  FOREIGN KEY(message_id,tenant_id,customer_id) REFERENCES crm_messages(id,tenant_id,customer_id)
);
CREATE TABLE IF NOT EXISTS crm_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, customer_id uuid NOT NULL,
  actor text NOT NULL, action text NOT NULL, old_value jsonb, new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(customer_id,tenant_id) REFERENCES crm_customers(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS crm_customers_pending ON crm_customers(tenant_id,updated_at) WHERE projection_pending;
CREATE INDEX IF NOT EXISTS crm_messages_customer ON crm_messages(tenant_id,customer_id,occurred_at);
CREATE INDEX IF NOT EXISTS crm_reports_customer ON crm_reports(tenant_id,customer_id,period_start);
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_notion_page ON crm_messages(notion_page_id) WHERE notion_page_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_reports_notion_page ON crm_reports(notion_page_id) WHERE notion_page_id IS NOT NULL;
INSERT INTO schema_version(version,description) VALUES('555','独立CRM租户主档、账号联系人、原文报告与受限Notion绑定') ON CONFLICT(version) DO NOTHING;
COMMIT;
