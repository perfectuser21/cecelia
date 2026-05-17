-- Migration 037: Capability Registry
-- 系统能力目录 + 执行记录 + 沉淀器

BEGIN;

-- 1) system_capabilities 表：系统能力定义（产品级对象）
-- 注意：不使用 capabilities 表名（已被 Migration 030 占用，用于能力驱动开发）
CREATE TABLE IF NOT EXISTS system_capabilities (
  capability_key text PRIMARY KEY,
  name text NOT NULL,
  intent_tags text[] NOT NULL DEFAULT '{}',
  definition jsonb NOT NULL,          -- 完整的能力合同
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_capabilities IS '系统能力注册表 - 统一入口的能力目录（产品级对象）';
COMMENT ON COLUMN system_capabilities.capability_key IS '能力唯一标识，如 retrieve.context';
COMMENT ON COLUMN system_capabilities.intent_tags IS '意图标签，用于快速匹配用户输入';
COMMENT ON COLUMN system_capabilities.definition IS '能力定义 JSON: input_contract, output_contract, dependencies, risk, executors, scoring';

-- 2) capability_runs 表：执行记录（证据 + 沉淀）
CREATE TABLE IF NOT EXISTS capability_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key text NOT NULL REFERENCES system_capabilities(capability_key),
  input_text text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,     -- memory/vector/availability/risk signals
  decision jsonb NOT NULL DEFAULT '{}'::jsonb,    -- selector 输出（分数、缺失上下文、gate）
  execution jsonb NOT NULL DEFAULT '{}'::jsonb,   -- executor 链执行细节
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,    -- 证据（run_events / artifacts / links）
  status text NOT NULL DEFAULT 'started',         -- started/succeeded/failed/gated
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

COMMENT ON TABLE capability_runs IS '能力执行记录 - 每次执行都沉淀证据';
COMMENT ON COLUMN capability_runs.context IS '执行上下文：memory（最近在做什么）、vector（相似历史）、availability（依赖是否满足）';
COMMENT ON COLUMN capability_runs.decision IS 'Selector 决策：selected_capability_key, confidence, gate, needs_fill';
COMMENT ON COLUMN capability_runs.evidence IS '执行证据：创建了什么实体、修改了什么、run_events';

CREATE INDEX IF NOT EXISTS idx_capability_runs_key_created
  ON capability_runs (capability_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_capability_runs_status
  ON capability_runs (status, created_at DESC);

-- 3) 插入初始能力：retrieve.context
INSERT INTO system_capabilities (capability_key, name, intent_tags, definition)
VALUES (
  'retrieve.context',
  '检索当前上下文',
  ARRAY['查询','状态','进展','现在','在做什么','当前'],
  '{
    "input_contract": {
      "needs_one_of": ["raw_text"]
    },
    "output_contract": {
      "returns": ["focus", "active_initiatives", "recent_tasks", "recent_conversation"]
    },
    "dependencies": {
      "requires": ["working_memory", "goals", "projects", "tasks"]
    },
    "risk": {
      "writes_db": false,
      "requires_gate": "none"
    },
    "executors": [
      {
        "type": "brain_api",
        "ref": "GET /api/brain/context"
      }
    ],
    "scoring": {
      "base": 0.3,
      "signals": {
        "rule": 0.4,
        "memory": 0.3,
        "vector": 0.2,
        "availability": 0.1
      }
    }
  }'::jsonb
)
ON CONFLICT (capability_key) DO UPDATE
SET name = EXCLUDED.name,
    intent_tags = EXCLUDED.intent_tags,
    definition = EXCLUDED.definition,
    updated_at = now();

-- 4) 插入初始能力：route.execute_task_or_plan
INSERT INTO system_capabilities (capability_key, name, intent_tags, definition)
VALUES (
  'route.execute_task_or_plan',
  '执行任务或规划',
  ARRAY['实现','开发','修复','bug','做','完成','添加','写','改'],
  '{
    "input_contract": {
      "needs_one_of": ["raw_text", "task_id", "initiative_id"],
      "optional": ["priority", "deadline"]
    },
    "output_contract": {
      "creates": ["task?", "initiative?"],
      "updates": ["goals.progress?", "projects.status?"],
      "emits_events": ["task.created", "plan.triggered"]
    },
    "dependencies": {
      "requires": ["okr_skill", "dev_skill", "tasks"],
      "optional": ["vector_search"]
    },
    "risk": {
      "writes_db": true,
      "requires_gate": "plan_gate"
    },
    "executors": [
      {
        "type": "selector_recursive",
        "conditions": [
          {
            "if": "has_initiative_id",
            "then": {
              "type": "skill",
              "ref": "/dev",
              "agent": "caramel"
            }
          },
          {
            "if": "needs_planning",
            "then": {
              "type": "skill",
              "ref": "/okr",
              "agent": "autumnrice"
            }
          },
          {
            "else": {
              "type": "brain_api",
              "ref": "POST /tasks"
            }
          }
        ]
      }
    ],
    "scoring": {
      "base": 0.4,
      "signals": {
        "rule": 0.25,
        "memory": 0.35,
        "vector": 0.25,
        "availability": 0.15
      }
    }
  }'::jsonb
)
ON CONFLICT (capability_key) DO UPDATE
SET name = EXCLUDED.name,
    intent_tags = EXCLUDED.intent_tags,
    definition = EXCLUDED.definition,
    updated_at = now();

-- 5) 更新 schema_version
INSERT INTO schema_version (version, description, applied_at)
VALUES (
  '037',
  'Capability Registry: system_capabilities + capability_runs tables',
  now()
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
