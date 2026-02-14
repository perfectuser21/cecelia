-- Migration 030: Capability-Driven Development Framework
-- Adds capabilities registry + pr_plans capability binding + stage progression
--
-- Changes:
-- 1. capabilities table: 能力注册表（23 个种子数据）
-- 2. pr_plans: 加 capability_id, from_stage, to_stage, evidence_required
-- 3. chk_stage_progression: 表级约束确保 from_stage < to_stage

-- 1. Create capabilities table
CREATE TABLE IF NOT EXISTS capabilities (
  id VARCHAR(60) PRIMARY KEY,           -- 人可读 slug: autonomous-task-scheduling
  name VARCHAR(200) NOT NULL,           -- 自主任务调度与派发
  description TEXT,                     -- 系统能从 PostgreSQL 队列中...
  current_stage INTEGER DEFAULT 1       -- 当前成熟度 1-4
    CHECK (current_stage BETWEEN 1 AND 4),
  stage_definitions JSONB,              -- 每个 stage 的验收标准
  related_repos TEXT[],                 -- 关联仓库路径
  related_skills TEXT[],                -- 关联技能名
  key_tables TEXT[],                    -- 关键数据表名
  evidence TEXT,                        -- 当前 stage 的证据
  owner VARCHAR(100) DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Alter pr_plans table - add capability binding fields
ALTER TABLE pr_plans ADD COLUMN IF NOT EXISTS capability_id VARCHAR(60)
  REFERENCES capabilities(id) ON DELETE SET NULL;
ALTER TABLE pr_plans ADD COLUMN IF NOT EXISTS from_stage INTEGER
  CHECK (from_stage BETWEEN 1 AND 4);
ALTER TABLE pr_plans ADD COLUMN IF NOT EXISTS to_stage INTEGER
  CHECK (to_stage BETWEEN 1 AND 4);
ALTER TABLE pr_plans ADD COLUMN IF NOT EXISTS evidence_required TEXT;

-- 3. Add table-level CHECK constraint for stage progression
ALTER TABLE pr_plans ADD CONSTRAINT chk_stage_progression
  CHECK (from_stage IS NULL OR to_stage IS NULL OR from_stage < to_stage);

-- 4. Insert 23 seed capabilities (based on 2026-02-14 system scan)
INSERT INTO capabilities (id, name, description, current_stage, related_repos, related_skills, key_tables) VALUES

-- Cecelia Core 能力
('autonomous-task-scheduling', '自主任务调度与派发', '系统能从 PostgreSQL 队列中自动选择、评分、派发任务给外部 agent workers', 3, ARRAY['/home/xx/perfect21/cecelia/core'], ARRAY['dev', 'review', 'qa', 'audit'], ARRAY['tasks', 'task_runs', 'circuit_breaker_state']),
('three-layer-brain', '三层大脑决策架构', 'L0 脑干（纯代码调度）+ L1 丘脑（Sonnet 快速判断）+ L2 皮层（Opus 深度分析）', 3, ARRAY['/home/xx/perfect21/cecelia/core'], ARRAY['cecelia-brain'], ARRAY['thalamus_decisions', 'cortex_analyses']),
('self-healing-immunity', '自愈免疫系统', '自动识别异常模式、隔离失败任务、生成吸收策略、评估防御有效性', 2, ARRAY['/home/xx/perfect21/cecelia/core'], ARRAY['cecelia-brain'], ARRAY['absorption_policies', 'policy_effectiveness', 'immune_events']),
('three-pool-slot-allocation', '三池并发资源分配', '基于硬件自动计算并发槽位，分 Cecelia/User/TaskPool 三池动态调整', 3, ARRAY['/home/xx/perfect21/cecelia/core'], NULL, ARRAY['task_runs']),
('watchdog-resource-monitor', '看门狗资源监控', '实时采样 /proc，动态阈值，三级响应（warn/kill/crisis），两阶段 kill + 隔离', 3, ARRAY['/home/xx/perfect21/cecelia/core'], NULL, ARRAY['task_runs', 'quarantine']),
('circuit-breaker-protection', '熔断保护系统', '按服务熔断（cecelia-run），连续失败自动开启，exponential backoff 重试', 3, ARRAY['/home/xx/perfect21/cecelia/core'], NULL, ARRAY['circuit_breaker_state']),
('quarantine-review-system', '隔离区审查机制', '3 次失败自动隔离，分类（resource_hog/pattern_mismatch/critical），人工/LLM 审查后释放', 3, ARRAY['/home/xx/perfect21/cecelia/core'], NULL, ARRAY['quarantine', 'quarantine_reviews']),
('okr-six-layer-decomposition', '六层 OKR 分解', 'Global OKR → Area OKR → KR → Project → Initiative → Task', 3, ARRAY['/home/xx/perfect21/cecelia/core'], ARRAY['okr'], ARRAY['goals', 'projects', 'pr_plans', 'tasks']),
('pr-plan-engineering-layer', 'PR Plan 工程规划层', 'Initiative → PR Plans（含 DoD、files、sequence、depends_on）→ Tasks', 3, ARRAY['/home/xx/perfect21/cecelia/core'], ARRAY['dev'], ARRAY['pr_plans', 'tasks']),

-- Cecelia Workspace 能力
('cecelia-dashboard', 'Cecelia 仪表盘', '实时展示 Brain 状态、任务进度、系统健康度、OKR 进展', 2, ARRAY['/home/xx/perfect21/cecelia/workspace'], NULL, NULL),

-- ZenithJoy 能力
('zenithjoy-dashboard', 'ZenithJoy 公司仪表盘', '展示公司 OKR、项目进度、团队状态、内容发布统计', 2, ARRAY['/home/xx/perfect21/zenithjoy/workspace'], NULL, NULL),
('multi-platform-publishing', '多平台内容发布', '今日头条、抖音、飞书多平台自动发布，支持文章/视频/图文', 4, ARRAY['/home/xx/perfect21/zenithjoy/toutiao-publisher', '/home/xx/perfect21/zenithjoy/douyin-publisher'], ARRAY['toutiao-publisher', 'douyin-publisher'], NULL),

-- Infrastructure 能力
('vpn-service-management', 'VPN 服务管理', 'X-Ray Reality 双服务器（美国/香港）VPN 服务，订阅管理，Clash 配置生成', 3, ARRAY['/home/xx/perfect21/infrastructure'], NULL, NULL),
('cloudflare-tunnel-routing', 'Cloudflare Tunnel 路由', '域名路由到本地服务（autopilot/n8n），443 端口共用（VPN+网站）', 3, ARRAY['/home/xx/perfect21/infrastructure'], NULL, NULL),
('tailscale-internal-network', 'Tailscale 内网穿透', '美国 VPS ↔ 香港 VPS 内网互联，ssh hk 走 100.86.118.99', 3, ARRAY['/home/xx/perfect21/infrastructure'], NULL, NULL),
('postgresql-database-service', 'PostgreSQL 数据库服务', 'Cecelia Brain 数据存储，Migration 管理，TimescaleDB 时序数据', 3, ARRAY['/home/xx/perfect21/infrastructure'], NULL, NULL),
('nas-file-storage', 'NAS 文件存储', 'Samba 共享，Tailscale 访问，媒体文件统一存储', 2, ARRAY['/home/xx/perfect21/infrastructure'], NULL, NULL),

-- Cecelia Engine 能力
('dev-workflow', '/dev 统一开发工作流', 'PRD → DoD → Code → Test → Quality → PR → CI → Merge 全自动流程', 3, ARRAY['/home/xx/perfect21/cecelia/engine'], ARRAY['dev'], NULL),
('branch-protection-hooks', '分支保护 Hooks', 'PreToolUse Hook 阻止在 main/develop 写代码，强制 PRD/DoD', 3, ARRAY['/home/xx/perfect21/cecelia/engine'], NULL, NULL),
('ci-devgate-quality', 'CI DevGate 质量门禁', 'Version Check、Facts Consistency、DoD Mapping、RCI Coverage', 3, ARRAY['/home/xx/perfect21/cecelia/engine'], NULL, NULL),

-- Investment 能力
('ai-driven-trading', 'AI 驱动交易系统', 'IBKR 对接，Polygon.io 数据，Claude 分析，自动交易执行', 1, ARRAY['/home/xx/perfect21/investment/trading-system'], NULL, ARRAY['portfolio', 'trades', 'market_data']),

-- 跨系统能力
('notion-integration', 'Notion 集成', '任务同步、会话摘要、OKR 记录、Learning 文档化', 3, ARRAY['/home/xx/perfect21/cecelia/core', '/home/xx/.claude/skills'], NULL, NULL),
('credential-management', '凭据统一管理', '~/.credentials/ 存储，自动检测 API Token/Secret，skills/credentials 调用', 3, ARRAY['/home/xx/.claude/skills/credentials'], ARRAY['credentials'], NULL)

ON CONFLICT (id) DO NOTHING;

-- 5. Schema version
INSERT INTO schema_version (version, description)
VALUES ('030', 'Capability-Driven Development: capabilities table + pr_plans capability binding + stage progression constraint')
ON CONFLICT (version) DO NOTHING;
