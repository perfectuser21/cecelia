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
 * Generate a PRD from Goal + KR context
 * @param {Object} params - Generation parameters
 * @param {string} params.title - Task/feature title (required)
 * @param {string} [params.description] - Task description
 * @param {Object} [params.kr] - Key Result context
 * @param {Object} [params.project] - Project context
 * @returns {string} Generated PRD markdown with frontmatter
 */
function generatePrdFromGoalKR(params) {
  const { title, description = '', kr, project } = params;

  const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').slice(0, 60);
  const today = getCurrentDate();

  const frontmatter = generateFrontmatter({
    id: `prd-auto-${slug}`,
    version: '1.0.0',
    created: today,
    updated: today
  });

  let prd = frontmatter + '\n\n';
  prd += `# PRD - ${title}\n\n`;

  prd += `## 需求来源\n\n`;
  if (kr) {
    prd += `KR: ${kr.title || 'N/A'} (progress: ${kr.progress ?? 0}%, priority: ${kr.priority || 'P1'})\n`;
    if (project) {
      prd += `Project: ${project.name || 'N/A'} (${project.repo_path || 'no repo'})\n`;
    }
    prd += `Auto-generated by Planner V3\n\n`;
  } else {
    prd += `Auto-generated task\n\n`;
  }

  prd += `## 功能描述\n\n${description || title}\n\n`;

  prd += `## 涉及文件\n\n`;
  if (project && project.repo_path) {
    prd += `- Project: ${project.repo_path}\n\n`;
  } else {
    prd += `- TBD\n\n`;
  }

  prd += `## 成功标准\n\n`;
  prd += `- [ ] 任务完成并标记为 completed\n`;
  prd += `- [ ] 代码提交并通过 CI\n`;
  prd += `- [ ] 无回归问题\n\n`;

  prd += `## 非目标\n\n`;
  prd += `- 不修改无关模块\n`;
  prd += `- 不引入破坏性变更\n`;

  return prd;
}

/**
 * Generate a TRD from Goal + KR context
 * @param {Object} params - Generation parameters
 * @param {string} params.title - TRD title (required)
 * @param {string} [params.description] - Description
 * @param {Array<{title: string, description?: string}>} [params.milestones] - Milestones
 * @param {Object} [params.kr] - Key Result context
 * @param {Object} [params.project] - Project context
 * @returns {string} Generated TRD markdown with frontmatter
 */
function generateTrdFromGoalKR(params) {
  const { title, description = '', milestones = [], kr, project } = params;

  const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').slice(0, 60);
  const today = getCurrentDate();

  const frontmatter = generateFrontmatter({
    id: `trd-auto-${slug}`,
    version: '1.0.0',
    created: today,
    updated: today
  });

  let trd = frontmatter + '\n\n';
  trd += `# TRD - ${title}\n\n`;

  // 技术背景
  trd += `## 技术背景\n\n`;
  trd += `### 需求来源\n\n`;
  if (kr) {
    trd += `KR: ${kr.title || 'N/A'} (progress: ${kr.progress ?? 0}%, priority: ${kr.priority || 'P1'})\n`;
    if (project) {
      trd += `Project: ${project.name || 'N/A'} (${project.repo_path || 'no repo'})\n`;
    }
    trd += `Auto-generated by Planner V3\n\n`;
  } else {
    trd += `${description || title}\n\n`;
  }
  trd += `### 现有技术栈\n\n`;
  trd += `- 后端：Node.js / Express\n`;
  trd += `- 前端：React / TypeScript\n`;
  trd += `- 数据库：PostgreSQL\n`;
  trd += `- 测试：Vitest\n\n`;

  // 架构设计
  trd += `## 架构设计\n\n`;
  trd += `### 系统架构\n\n`;
  trd += '```\n';
  trd += `┌─────────────┐    ┌─────────────┐    ┌─────────────┐\n`;
  trd += `│   Client    │───▶│   Server    │───▶│  Database   │\n`;
  trd += `└─────────────┘    └─────────────┘    └─────────────┘\n`;
  trd += '```\n\n';
  trd += `### 组件设计\n\n`;
  if (project && project.name) {
    trd += `- ${project.name} 核心模块\n`;
  } else {
    trd += `- ${title} 核心模块\n`;
  }
  trd += '\n';

  // API 设计
  const apiName = (project && project.name) || title;
  const apiSlug = apiName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  trd += `## API 设计\n\n`;
  trd += `### 接口列表\n\n`;
  trd += `| 方法 | 路径 | 描述 |\n`;
  trd += `|------|------|------|\n`;
  trd += `| GET | /api/${apiSlug} | 获取列表 |\n`;
  trd += `| POST | /api/${apiSlug} | 创建记录 |\n\n`;

  // 数据模型
  const tableName = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  trd += `## 数据模型\n\n`;
  trd += `### 主要实体\n\n`;
  trd += '```sql\n';
  trd += `CREATE TABLE ${tableName} (\n`;
  trd += `  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
  trd += `  name VARCHAR(255) NOT NULL,\n`;
  trd += `  status VARCHAR(50) DEFAULT 'pending',\n`;
  trd += `  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n`;
  trd += `);\n`;
  trd += '```\n\n';

  // 测试策略
  trd += `## 测试策略\n\n`;
  trd += `### 测试覆盖\n\n`;
  if (milestones.length > 0) {
    milestones.forEach(m => {
      trd += `- [ ] ${m.title} 测试\n`;
    });
  } else {
    trd += `- [ ] 核心功能测试\n`;
    trd += `- [ ] 边界条件测试\n`;
    trd += `- [ ] 错误处理测试\n`;
  }
  trd += '\n';

  // 实施计划
  trd += `## 实施计划\n\n`;
  trd += `### 任务分解\n\n`;
  if (milestones.length > 0) {
    milestones.forEach((m, i) => {
      trd += `${i + 1}. **${m.title}**\n`;
      if (m.description) {
        trd += `   - ${m.description}\n`;
      }
    });
  } else {
    trd += `1. 需求分析\n`;
    trd += `2. 技术设计\n`;
    trd += `3. 编码实现\n`;
    trd += `4. 测试验证\n`;
  }
  trd += '\n';

  return trd;
}

/**
 * Common action verbs for acceptance criteria validation
 */
const ACTION_VERBS = [
  '显示', '返回', '创建', '检查', '支持', '调用', '发送', '接收',
  '验证', '生成', '删除', '更新', '修改', '添加', '移除', '触发',
  '启动', '停止', '重启', '加载', '保存', '导出', '导入', '解析',
  '渲染', '跳转', '提交', '取消', '确认', '拒绝', '通过', '失败',
  '运行', '执行', '完成', '响应', '处理', '过滤', '排序', '搜索',
  '输入', '输出', '点击', '选择', '切换', '展开', '折叠', '刷新',
  'display', 'return', 'create', 'check', 'support', 'call', 'send',
  'receive', 'validate', 'generate', 'delete', 'update', 'modify',
  'add', 'remove', 'trigger', 'start', 'stop', 'load', 'save',
  'export', 'import', 'parse', 'render', 'submit', 'cancel', 'run',
  'execute', 'respond', 'filter', 'sort', 'search', 'click', 'select'
];

/**
 * Extract section content from markdown by header
 * @param {string} content - Markdown content
 * @param {string} header - Section header text
 * @returns {string|null} Section content or null
 */
function extractSection(content, header) {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^##\\s+${escapedHeader}\\s*$`, 'm');
  const match = content.search(regex);
  if (match === -1) return null;

  const afterHeader = content.slice(match);
  const lines = afterHeader.split('\n');
  const bodyLines = lines.slice(1);
  const endIdx = bodyLines.findIndex(line => /^##\s/.test(line));
  const sectionLines = endIdx === -1 ? bodyLines : bodyLines.slice(0, endIdx);
  return sectionLines.join('\n').trim();
}

/**
 * Validate PRD content quality (structure + content checks)
 * @param {string} prdContent - PRD markdown content
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePrd(prdContent) {
  const errors = [];
  const warnings = [];

  if (!prdContent || typeof prdContent !== 'string') {
    return { valid: false, errors: ['PRD content is empty or not a string'], warnings: [] };
  }

  // Structure checks
  const requiredFields = [
    { pattern: /##\s*需求来源|##\s*背景|需求来源\s*[:：]|\*\*需求来源\*\*/, label: '需求来源' },
    { pattern: /##\s*功能描述|功能描述\s*[:：]|\*\*功能描述\*\*|##\s*功能需求/, label: '功能描述' },
    { pattern: /##\s*成功标准|成功标准\s*[:：]|\*\*成功标准\*\*|##\s*验收标准/, label: '成功标准' }
  ];

  for (const field of requiredFields) {
    if (!field.pattern.test(prdContent)) {
      errors.push(`Missing required field: ${field.label}`);
    }
  }

  if (!/##\s*非目标|非目标\s*[:：]|\*\*非目标\*\*/.test(prdContent)) {
    warnings.push('Missing recommended field: 非目标');
  }

  if (!/##\s*涉及文件|涉及文件\s*[:：]|\*\*涉及文件\*\*/.test(prdContent)) {
    warnings.push('Missing recommended field: 涉及文件');
  }

  // Content quality - objectives bullet points
  const objectives = extractSection(prdContent, '目标');
  if (objectives !== null && !/^[-*]\s/m.test(objectives)) {
    warnings.push('目标 section should contain at least 1 bullet point');
  }

  // Content quality - functional requirements length
  const funcReq = extractSection(prdContent, '功能需求') || extractSection(prdContent, '功能描述');
  if (funcReq !== null && funcReq.length < 50) {
    warnings.push('功能需求 section should be at least 50 characters');
  }

  // Content quality - acceptance criteria
  const successMatch = prdContent.match(/(?:##\s*(?:成功标准|验收标准)|\*\*成功标准\*\*)([\s\S]*?)(?=\n##|\n\*\*[^*]|\n---|\n$)/);
  if (successMatch) {
    const section = successMatch[1];
    if (!/[-*]\s|^\d+\./m.test(section)) {
      warnings.push('成功标准 section has no list items');
    }
    const bullets = section.split('\n').filter(line => /^[-*]\s|\[.\]/.test(line.trim()));
    for (const bullet of bullets) {
      const hasVerb = ACTION_VERBS.some(verb => bullet.includes(verb));
      if (!hasVerb) {
        warnings.push(`Acceptance criterion lacks action verb: "${bullet.trim().slice(0, 60)}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate TRD content quality (structure + content checks)
 * @param {string} trdContent - TRD markdown content
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateTrd(trdContent) {
  const errors = [];
  const warnings = [];

  if (!trdContent || typeof trdContent !== 'string') {
    return { valid: false, errors: ['TRD content is empty or not a string'], warnings: [] };
  }

  const requiredSections = [
    { pattern: /##\s*技术背景/, label: '技术背景' },
    { pattern: /##\s*架构设计/, label: '架构设计' },
    { pattern: /##\s*API\s*设计/, label: 'API 设计' },
    { pattern: /##\s*数据模型/, label: '数据模型' },
    { pattern: /##\s*测试策略/, label: '测试策略' }
  ];

  for (const section of requiredSections) {
    if (!section.pattern.test(trdContent)) {
      errors.push(`Missing required section: ${section.label}`);
    }
  }

  // Content non-empty checks for key sections
  const keyHeaders = ['技术背景', '架构设计', '测试策略'];
  for (const header of keyHeaders) {
    const content = extractSection(trdContent, header);
    if (content !== null && content.trim().length === 0) {
      warnings.push(`Section is empty: ${header}`);
    }
  }

  if (!/##\s*实施计划/.test(trdContent)) {
    warnings.push('Missing recommended section: 实施计划');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Parse PRD markdown into structured JSON
 * @param {string} prdContent - PRD markdown content
 * @returns {Object} Structured PRD object
 */
function prdToJson(prdContent) {
  const titleMatch = prdContent.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].replace(/^PRD\s*-\s*/, '') : '';

  const sections = {};
  for (const section of PRD_TEMPLATE.sections) {
    sections[section.id] = extractSection(prdContent, section.title) || '';
  }

  return { title, sections };
}

/**
 * Parse TRD markdown into structured JSON
 * @param {string} trdContent - TRD markdown content
 * @returns {Object} Structured TRD object
 */
function trdToJson(trdContent) {
  const titleMatch = trdContent.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].replace(/^TRD\s*-\s*/, '') : '';

  const sections = {};
  for (const section of TRD_TEMPLATE.sections) {
    sections[section.id] = extractSection(trdContent, section.title) || '';
  }

  return { title, sections };
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
  generatePrdFromGoalKR,
  generateTrdFromGoal,
  generateTrdFromGoalKR,
  validatePrd,
  validateTrd,
  getTemplate,
  listTemplates,
  getCurrentDate,
  prdToJson,
  trdToJson,
  extractSection
};
