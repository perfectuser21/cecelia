-- 437: ops_skills — skill 投影（运行舱刀5，task c2f6b4dd 延续）
-- skill 是最小执行单元：真正定义"怎么干"的那层（SKILL.md 含产出契约/metrics 键集/证据要求），
-- agent 只是承载它的容器。与 agent 多对多（实证 social-leadgen-workflow 被 4 个 agent 共用）。
CREATE TABLE IF NOT EXISTS ops_skills (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'openclaw',
  name TEXT NOT NULL,
  used_by JSONB NOT NULL DEFAULT '[]',   -- 哪些 agent 挂了它
  description TEXT,                      -- SKILL.md frontmatter description
  doc_excerpt TEXT,                      -- SKILL.md 正文摘要（白名单，截断）
  meta JSONB NOT NULL DEFAULT '{}',
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, name)
);
