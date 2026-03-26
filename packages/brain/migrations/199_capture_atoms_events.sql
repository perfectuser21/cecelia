-- 199: Capture Atoms + Life Events tables
-- capture_atoms: AI 拆解后的原子事件，从 captures 拆出
-- life_events: 生活事件（旅行/聚餐/看病等），Digestion 的第6条路由线
-- 注：events 表已用于 Web 分析，生活事件用 life_events

CREATE TABLE IF NOT EXISTS capture_atoms (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capture_id       UUID REFERENCES captures(id) ON DELETE CASCADE,
    content          TEXT NOT NULL,
    target_type      VARCHAR(30) NOT NULL,  -- note/knowledge/content/task/decision/event
    target_subtype   VARCHAR(50),           -- project_note/daily_diary/operational/reference 等
    suggested_area_id UUID REFERENCES areas(id) ON DELETE SET NULL,
    suggested_project_id UUID,
    status           VARCHAR(30) NOT NULL DEFAULT 'pending_review',  -- pending_review/confirmed/dismissed
    routed_to_table  VARCHAR(50),           -- 确认后写入了哪张表
    routed_to_id     UUID,                  -- 写入了哪条记录
    confidence       NUMERIC(3,2) DEFAULT 0.00,  -- AI 置信度 0.00-1.00
    ai_reason        TEXT,                  -- AI 分类理由
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capture_atoms_capture_id ON capture_atoms(capture_id);
CREATE INDEX IF NOT EXISTS idx_capture_atoms_status ON capture_atoms(status);
CREATE INDEX IF NOT EXISTS idx_capture_atoms_target_type ON capture_atoms(target_type);

CREATE TABLE IF NOT EXISTS life_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(200) NOT NULL,
    date             DATE,
    event_type       VARCHAR(50),           -- meal/travel/health/social/family/work/finance
    location         VARCHAR(200),
    people           TEXT[],                -- 参与人
    description      TEXT,
    area_id          UUID REFERENCES areas(id) ON DELETE SET NULL,
    capture_atom_id  UUID REFERENCES capture_atoms(id) ON DELETE SET NULL,
    owner            VARCHAR(20) NOT NULL DEFAULT 'user',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_life_events_date ON life_events(date DESC);
CREATE INDEX IF NOT EXISTS idx_life_events_event_type ON life_events(event_type);
CREATE INDEX IF NOT EXISTS idx_life_events_area_id ON life_events(area_id);
