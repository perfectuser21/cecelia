-- Migration 007: OKR 三层架构优化
-- 创建 businesses 和 departments 表，增强 goals 表支持三层 OKR

-- 1. 创建 businesses 表（业务管理）
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  owner VARCHAR(100),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 创建 departments 表（部门管理）
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  lead VARCHAR(100),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 增强 goals 表
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS scope VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cycle VARCHAR(20),
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_start_date DATE,
  ADD COLUMN IF NOT EXISTS expected_end_date DATE,
  ADD COLUMN IF NOT EXISTS actual_start_date DATE,
  ADD COLUMN IF NOT EXISTS actual_end_date DATE;

-- 4. 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_goals_scope ON goals(scope);
CREATE INDEX IF NOT EXISTS idx_goals_business_id ON goals(business_id);
CREATE INDEX IF NOT EXISTS idx_goals_department_id ON goals(department_id);
CREATE INDEX IF NOT EXISTS idx_goals_area_id ON goals(area_id);
CREATE INDEX IF NOT EXISTS idx_departments_business_id ON departments(business_id);

-- 5. 添加注释
COMMENT ON TABLE businesses IS '业务表：管理业务实体（Stock, ZenithJoy 等）';
COMMENT ON TABLE departments IS '部门表：管理部门实体（Content Team, Tech Team 等）';
COMMENT ON COLUMN goals.scope IS 'OKR 层级：personal（个人3个月）, business（业务1个月）, department（部门2周）';
COMMENT ON COLUMN goals.cycle IS '周期标记：3months, 1month, 2weeks';
COMMENT ON COLUMN goals.expected_start_date IS '预期开始日期';
COMMENT ON COLUMN goals.expected_end_date IS '预期结束日期';
COMMENT ON COLUMN goals.actual_start_date IS '实际开始日期';
COMMENT ON COLUMN goals.actual_end_date IS '实际结束日期';
