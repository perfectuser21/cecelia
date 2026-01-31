/**
 * Document Templates Module
 *
 * Provides standardized templates for PRD (Product Requirements Document)
 * and TRD (Technical Requirements Document) generation.
 */

/**
 * Get current date in YYYY-MM-DD format
 * @returns {string} Current date
 */
function getCurrentDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Generate frontmatter for documents
 * @param {Object} options - Frontmatter options
 * @param {string} options.id - Document ID
 * @param {string} options.version - Document version (default: 1.0.0)
 * @param {string} options.created - Created date (default: today)
 * @param {string} options.updated - Updated date (default: today)
 * @returns {string} Frontmatter string
 */
function generateFrontmatter(options) {
  const {
    id,
    version = '1.0.0',
    created = getCurrentDate(),
    updated = getCurrentDate()
  } = options;

  return `---
id: ${id}
version: ${version}
created: ${created}
updated: ${updated}
changelog:
  - ${version}: 初始版本
---`;
}

/**
 * Standard PRD Template Structure
 */
const PRD_TEMPLATE = {
  name: 'prd',
  sections: [
    {
      id: 'background',
      title: '背景',
      description: '项目背景和需求来源',
      required: true
    },
    {
      id: 'objectives',
      title: '目标',
      description: '项目目标和预期成果',
      required: true
    },
    {
      id: 'functional_requirements',
      title: '功能需求',
      description: '核心功能描述',
      required: true
    },
    {
      id: 'non_functional_requirements',
      title: '非功能需求',
      description: '性能、安全、可用性等要求',
      required: false
    },
    {
      id: 'acceptance_criteria',
      title: '验收标准',
      description: '功能验收检查清单',
      required: true
    },
    {
      id: 'milestones',
      title: '里程碑',
      description: '项目阶段划分',
      required: false
    }
  ]
};

/**
 * Standard TRD Template Structure
 */
const TRD_TEMPLATE = {
  name: 'trd',
  sections: [
    {
      id: 'technical_background',
      title: '技术背景',
      description: '技术栈和现有架构说明',
      required: true
    },
    {
      id: 'architecture_design',
      title: '架构设计',
      description: '系统架构和组件设计',
      required: true
    },
    {
      id: 'api_design',
      title: 'API 设计',
      description: '接口定义和数据格式',
      required: true
    },
    {
      id: 'data_model',
      title: '数据模型',
      description: '数据库设计和数据结构',
      required: true
    },
    {
      id: 'test_strategy',
      title: '测试策略',
      description: '测试方案和覆盖范围',
      required: true
    }
  ]
};

/**
 * Render PRD document from parsed intent
 * @param {Object} parsedIntent - Parsed intent object
 * @param {Object} options - Rendering options
 * @returns {string} Rendered PRD markdown
 */
function renderPrd(parsedIntent, options = {}) {
  const {
    projectName,
    intentType,
    tasks = [],
    originalInput,
    entities = {}
  } = parsedIntent;

  const {
    includeFrontmatter = true,
    version = '1.0.0'
  } = options;

  const docId = `prd-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const today = getCurrentDate();

  let prd = '';

  // Frontmatter
  if (includeFrontmatter) {
    prd += generateFrontmatter({ id: docId, version, created: today, updated: today });
    prd += '\n\n';
  }

  // Title
  prd += `# PRD - ${projectName}\n\n`;

  // Background
  prd += `## 背景\n\n`;
  prd += `${originalInput}\n\n`;

  // Objectives
  prd += `## 目标\n\n`;
  const objectiveVerb = getIntentVerb(intentType);
  prd += `${objectiveVerb}${projectName}，满足用户需求。\n\n`;

  // Functional Requirements
  prd += `## 功能需求\n\n`;
  if (tasks.length > 0) {
    tasks.forEach((task, index) => {
      prd += `### ${index + 1}. ${task.title}\n\n`;
      prd += `${task.description}\n\n`;
    });
  } else {
    prd += `待定义。\n\n`;
  }

  // Non-functional Requirements
  prd += `## 非功能需求\n\n`;
  prd += `- 性能：响应时间 < 500ms\n`;
  prd += `- 安全：符合安全编码规范\n`;
  prd += `- 可用性：支持错误恢复\n\n`;

  // Acceptance Criteria
  prd += `## 验收标准\n\n`;
  if (tasks.length > 0) {
    tasks.forEach(task => {
      prd += `- [ ] ${task.title}\n`;
    });
    prd += `- [ ] 所有测试通过\n`;
    prd += `- [ ] 代码审查完成\n\n`;
  } else {
    prd += `待定义。\n\n`;
  }

  // Milestones
  prd += `## 里程碑\n\n`;
  prd += `| 阶段 | 描述 | 状态 |\n`;
  prd += `|------|------|------|\n`;
  prd += `| M1 | 需求确认 | 待开始 |\n`;
  prd += `| M2 | 开发完成 | 待开始 |\n`;
  prd += `| M3 | 测试验收 | 待开始 |\n\n`;

  // Involved files (if entities provide info)
  prd += `## 涉及文件\n\n`;
  if (entities.filePath) {
    prd += `- ${entities.filePath}\n`;
  } else {
    prd += `- src/${projectName}/ (源代码)\n`;
    prd += `- tests/${projectName}/ (测试文件)\n`;
  }
  prd += '\n';

  // Footer
  prd += `---\n*此 PRD 由 Intent Parser 自动生成，请根据实际需求进行调整。*\n`;

  return prd;
}

/**
 * Render TRD document from parsed intent
 * @param {Object} parsedIntent - Parsed intent object
 * @param {Object} options - Rendering options
 * @returns {string} Rendered TRD markdown
 */
function renderTrd(parsedIntent, options = {}) {
  const {
    projectName,
    intentType,
    tasks = [],
    originalInput,
    entities = {}
  } = parsedIntent;

  const {
    includeFrontmatter = true,
    version = '1.0.0'
  } = options;

  const docId = `trd-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const today = getCurrentDate();

  let trd = '';

  // Frontmatter
  if (includeFrontmatter) {
    trd += generateFrontmatter({ id: docId, version, created: today, updated: today });
    trd += '\n\n';
  }

  // Title
  trd += `# TRD - ${projectName}\n\n`;

  // Technical Background
  trd += `## 技术背景\n\n`;
  trd += `### 需求来源\n\n`;
  trd += `${originalInput}\n\n`;
  trd += `### 现有技术栈\n\n`;
  trd += `- 后端：Node.js / Express\n`;
  trd += `- 前端：React / TypeScript\n`;
  trd += `- 数据库：PostgreSQL\n`;
  trd += `- 测试：Vitest\n\n`;

  // Architecture Design
  trd += `## 架构设计\n\n`;
  trd += `### 系统架构\n\n`;
  trd += '```\n';
  trd += `┌─────────────┐    ┌─────────────┐    ┌─────────────┐\n`;
  trd += `│   Client    │───▶│   Server    │───▶│  Database   │\n`;
  trd += `└─────────────┘    └─────────────┘    └─────────────┘\n`;
  trd += '```\n\n';
  trd += `### 组件设计\n\n`;
  if (entities.module) {
    trd += `- ${entities.module} 模块\n`;
  }
  if (entities.component) {
    trd += `- ${entities.component} 组件\n`;
  }
  if (!entities.module && !entities.component) {
    trd += `- ${projectName} 核心模块\n`;
  }
  trd += '\n';

  // API Design
  trd += `## API 设计\n\n`;
  trd += `### 接口列表\n\n`;
  trd += `| 方法 | 路径 | 描述 |\n`;
  trd += `|------|------|------|\n`;
  if (entities.apiEndpoint) {
    trd += `| GET | ${entities.apiEndpoint} | 获取数据 |\n`;
  } else {
    trd += `| GET | /api/${projectName} | 获取列表 |\n`;
    trd += `| POST | /api/${projectName} | 创建记录 |\n`;
    trd += `| PUT | /api/${projectName}/:id | 更新记录 |\n`;
    trd += `| DELETE | /api/${projectName}/:id | 删除记录 |\n`;
  }
  trd += '\n';

  trd += `### 请求/响应格式\n\n`;
  trd += '```json\n';
  trd += `// 请求示例\n`;
  trd += `{\n`;
  trd += `  "name": "example",\n`;
  trd += `  "data": {}\n`;
  trd += `}\n\n`;
  trd += `// 响应示例\n`;
  trd += `{\n`;
  trd += `  "success": true,\n`;
  trd += `  "data": {},\n`;
  trd += `  "message": "操作成功"\n`;
  trd += `}\n`;
  trd += '```\n\n';

  // Data Model
  trd += `## 数据模型\n\n`;
  trd += `### 主要实体\n\n`;
  trd += '```sql\n';
  trd += `-- ${projectName} 主表\n`;
  trd += `CREATE TABLE ${projectName.replace(/-/g, '_')} (\n`;
  trd += `  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
  trd += `  name VARCHAR(255) NOT NULL,\n`;
  trd += `  status VARCHAR(50) DEFAULT 'pending',\n`;
  trd += `  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n`;
  trd += `  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n`;
  trd += `);\n`;
  trd += '```\n\n';

  // Test Strategy
  trd += `## 测试策略\n\n`;
  trd += `### 测试类型\n\n`;
  trd += `- **单元测试**：覆盖核心业务逻辑\n`;
  trd += `- **集成测试**：验证 API 接口\n`;
  trd += `- **端到端测试**：关键用户流程\n\n`;
  trd += `### 测试覆盖\n\n`;
  if (tasks.length > 0) {
    tasks.forEach(task => {
      trd += `- [ ] ${task.title} 测试\n`;
    });
  } else {
    trd += `- [ ] 核心功能测试\n`;
    trd += `- [ ] 边界条件测试\n`;
    trd += `- [ ] 错误处理测试\n`;
  }
  trd += '\n';

  // Implementation Plan
  trd += `## 实施计划\n\n`;
  trd += `### 任务分解\n\n`;
  if (tasks.length > 0) {
    tasks.forEach((task, index) => {
      trd += `${index + 1}. **${task.title}** (${task.priority})\n`;
      trd += `   - ${task.description}\n`;
    });
  } else {
    trd += `1. 需求分析\n`;
    trd += `2. 技术设计\n`;
    trd += `3. 编码实现\n`;
    trd += `4. 测试验证\n`;
  }
  trd += '\n';

  // Footer
  trd += `---\n*此 TRD 由 Intent Parser 自动生成，请根据实际需求进行调整。*\n`;

  return trd;
}

/**
 * Get verb based on intent type
 * @param {string} intentType - Intent type
 * @returns {string} Action verb
 */
function getIntentVerb(intentType) {
  const verbs = {
    'create_project': '创建并实现',
    'create_feature': '添加',
    'fix_bug': '修复',
    'refactor': '重构和优化',
    'explore': '探索和分析',
    'question': '解答关于',
    'unknown': '处理'
  };
  return verbs[intentType] || '实现';
}

/**
 * PRD type to intent type mapping
 */
const PRD_TYPE_MAP = {
  feature: 'create_feature',
  bugfix: 'fix_bug',
  refactor: 'refactor'
};

/**
 * Generate a PRD from a task description
 * @param {Object} params - Generation parameters
 * @param {string} params.title - Task title (required)
 * @param {string} params.description - Task description
 * @param {string} params.type - PRD type: feature | bugfix | refactor (default: feature)
 * @param {Object} options - Rendering options
 * @returns {string} Generated PRD markdown
 */
function generatePrdFromTask(params, options = {}) {
  const { title, description = '', type = 'feature' } = params;
  const intentType = PRD_TYPE_MAP[type] || 'create_feature';

  const parsedIntent = {
    projectName: title,
    intentType,
    tasks: [],
    originalInput: description || title,
    entities: {}
  };

  return renderPrd(parsedIntent, options);
}

/**
 * Generate a TRD from a goal description
 * @param {Object} params - Generation parameters
 * @param {string} params.title - Goal title (required)
 * @param {string} params.description - Goal description
 * @param {Array<{title: string, description?: string}>} params.milestones - Optional milestones
 * @param {Object} options - Rendering options
 * @returns {string} Generated TRD markdown
 */
function generateTrdFromGoal(params, options = {}) {
  const { title, description = '', milestones = [] } = params;

  const tasks = milestones.map((m, i) => ({
    title: m.title || `Milestone ${i + 1}`,
    description: m.description || m.title || '',
    priority: `P${Math.min(i, 2)}`
  }));

  const parsedIntent = {
    projectName: title,
    intentType: 'create_project',
    tasks,
    originalInput: description || title,
    entities: {}
  };

  return renderTrd(parsedIntent, options);
}

/**
 * Get template by name
 * @param {string} templateName - Template name ('prd' or 'trd')
 * @returns {Object|null} Template object
 */
function getTemplate(templateName) {
  const templates = {
    prd: PRD_TEMPLATE,
    trd: TRD_TEMPLATE
  };
  return templates[templateName.toLowerCase()] || null;
}

/**
 * List all available templates
 * @returns {Array<{name: string, sectionCount: number}>}
 */
function listTemplates() {
  return [
    { name: 'prd', sectionCount: PRD_TEMPLATE.sections.length },
    { name: 'trd', sectionCount: TRD_TEMPLATE.sections.length }
  ];
}

export {
  PRD_TEMPLATE,
  TRD_TEMPLATE,
  PRD_TYPE_MAP,
  generateFrontmatter,
  renderPrd,
  renderTrd,
  generatePrdFromTask,
  generateTrdFromGoal,
  getTemplate,
  listTemplates,
  getCurrentDate
};
