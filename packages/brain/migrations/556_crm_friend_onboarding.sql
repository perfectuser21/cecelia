-- Brain-first授权好友入档；不改555，Notion创建尝试不可重置为未发送。
BEGIN;
ALTER TABLE crm_sync_bindings ADD COLUMN IF NOT EXISTS config_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE crm_customers ALTER COLUMN source_page_id DROP NOT NULL;
ALTER TABLE crm_customers ALTER COLUMN source_edited_at DROP NOT NULL;
ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS origin_kind text NOT NULL DEFAULT 'notion';
ALTER TABLE crm_customers ADD COLUMN IF NOT EXISTS projection_checked_at timestamptz;
ALTER TABLE crm_customers ADD CONSTRAINT crm_customer_origin CHECK(origin_kind IN ('notion','wechat_friend'));
ALTER TABLE crm_customers ADD CONSTRAINT crm_customer_source_pair CHECK(
  (source_page_id IS NOT NULL AND source_edited_at IS NOT NULL) OR
  (origin_kind='wechat_friend' AND source_page_id IS NULL AND source_edited_at IS NULL)
);
CREATE TABLE crm_friend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  account_id text NOT NULL, event_id text NOT NULL, binding_id uuid NOT NULL,
  contact_id text NOT NULL, contact_link_id uuid NOT NULL, customer_id uuid NOT NULL,
  payload jsonb NOT NULL, payload_sha256 text NOT NULL, authorization_ref text NOT NULL,
  evidence_sha256 text NOT NULL, observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,account_id,event_id), UNIQUE(id,tenant_id,customer_id,binding_id),
  FOREIGN KEY(binding_id,tenant_id) REFERENCES crm_sync_bindings(id,tenant_id),
  FOREIGN KEY(contact_link_id,tenant_id,customer_id,account_id) REFERENCES crm_contact_links(id,tenant_id,customer_id,account_id)
);
CREATE TABLE crm_customer_page_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, binding_id uuid NOT NULL,
  customer_id uuid NOT NULL UNIQUE, receipt_id uuid NOT NULL,
  data_source_id text NOT NULL, name_property text NOT NULL, brain_id_property text NOT NULL,
  frozen_config jsonb NOT NULL, config_sha256 text NOT NULL, config_revision bigint NOT NULL,
  request_sha256 text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now(),
  confirmed_page_id text, confirmed_at timestamptz,
  FOREIGN KEY(receipt_id,tenant_id,customer_id,binding_id) REFERENCES crm_friend_events(id,tenant_id,customer_id,binding_id),
  FOREIGN KEY(customer_id,tenant_id) REFERENCES crm_customers(id,tenant_id)
);
INSERT INTO schema_version(version,description) VALUES('556','Brain-first好友入档及耐久一次性Notion创建fence') ON CONFLICT(version) DO NOTHING;
COMMIT;
