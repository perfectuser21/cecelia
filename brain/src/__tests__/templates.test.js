/**
 * Templates Module Tests
 * Tests for PRD and TRD template rendering
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
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
  validatePrd,
  validateTrd,
  prdToJson,
  trdToJson,
  extractSection
} from '../templates.js';

describe('Templates Module', () => {
  describe('PRD_TYPE_MAP', () => {
    it('maps feature, bugfix, refactor to intent types', () => {
      expect(PRD_TYPE_MAP.feature).toBe('create_feature');
      expect(PRD_TYPE_MAP.bugfix).toBe('fix_bug');
      expect(PRD_TYPE_MAP.refactor).toBe('refactor');
    });

    it('has exactly 3 types', () => {
      expect(Object.keys(PRD_TYPE_MAP)).toHaveLength(3);
    });
  });

  describe('generatePrdFromTask', () => {
    it('generates PRD with title only', () => {
      const prd = generatePrdFromTask({ title: 'Add login page' });

      expect(prd).toContain('# PRD - Add login page');
      expect(prd).toContain('Add login page');
    });

    it('generates PRD with title and description', () => {
      const prd = generatePrdFromTask({
        title: 'User Auth',
        description: 'Implement user authentication with JWT'
      });

      expect(prd).toContain('# PRD - User Auth');
      expect(prd).toContain('Implement user authentication with JWT');
    });

    it('defaults to feature type', () => {
      const prd = generatePrdFromTask({ title: 'New Feature' });

      expect(prd).toContain('添加');
    });

    it('uses bugfix type correctly', () => {
      const prd = generatePrdFromTask({ title: 'Fix crash', type: 'bugfix' });

      expect(prd).toContain('修复');
    });

    it('uses refactor type correctly', () => {
      const prd = generatePrdFromTask({ title: 'Clean up code', type: 'refactor' });

      expect(prd).toContain('重构和优化');
    });

    it('uses title as originalInput when description is missing', () => {
      const prd = generatePrdFromTask({ title: 'My Task' });

      expect(prd).toContain('## 背景');
      expect(prd).toContain('My Task');
    });

    it('passes rendering options through', () => {
      const prd = generatePrdFromTask(
        { title: 'Test' },
        { includeFrontmatter: false }
      );

      expect(prd).not.toMatch(/^---/);
      expect(prd).toMatch(/^# PRD/);
    });
  });

  describe('PRD_TEMPLATE structure', () => {
    it('has correct name', () => {
      expect(PRD_TEMPLATE.name).toBe('prd');
    });

    it('has required sections', () => {
      const sectionIds = PRD_TEMPLATE.sections.map(s => s.id);
      expect(sectionIds).toContain('background');
      expect(sectionIds).toContain('objectives');
      expect(sectionIds).toContain('functional_requirements');
      expect(sectionIds).toContain('acceptance_criteria');
    });

    it('has 6 sections total', () => {
      expect(PRD_TEMPLATE.sections.length).toBe(6);
    });

    it('marks required sections correctly', () => {
      const required = PRD_TEMPLATE.sections.filter(s => s.required);
      expect(required.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('TRD_TEMPLATE structure', () => {
    it('has correct name', () => {
      expect(TRD_TEMPLATE.name).toBe('trd');
    });

    it('has required sections', () => {
      const sectionIds = TRD_TEMPLATE.sections.map(s => s.id);
      expect(sectionIds).toContain('technical_background');
      expect(sectionIds).toContain('architecture_design');
      expect(sectionIds).toContain('api_design');
      expect(sectionIds).toContain('data_model');
      expect(sectionIds).toContain('test_strategy');
    });

    it('has 5 sections total', () => {
      expect(TRD_TEMPLATE.sections.length).toBe(5);
    });
  });

  describe('generateFrontmatter', () => {
    it('generates valid YAML frontmatter', () => {
      const frontmatter = generateFrontmatter({ id: 'test-doc' });

      expect(frontmatter).toContain('---');
      expect(frontmatter).toContain('id: test-doc');
      expect(frontmatter).toContain('version: 1.0.0');
      expect(frontmatter).toContain('changelog:');
    });

    it('uses custom version when provided', () => {
      const frontmatter = generateFrontmatter({ id: 'test', version: '2.0.0' });

      expect(frontmatter).toContain('version: 2.0.0');
      expect(frontmatter).toContain('2.0.0: 初始版本');
    });

    it('uses current date by default', () => {
      const frontmatter = generateFrontmatter({ id: 'test' });
      const today = getCurrentDate();

      expect(frontmatter).toContain(`created: ${today}`);
      expect(frontmatter).toContain(`updated: ${today}`);
    });

    it('accepts custom dates', () => {
      const frontmatter = generateFrontmatter({
        id: 'test',
        created: '2025-01-01',
        updated: '2025-01-15'
      });

      expect(frontmatter).toContain('created: 2025-01-01');
      expect(frontmatter).toContain('updated: 2025-01-15');
    });
  });

  describe('renderPrd', () => {
    const mockParsedIntent = {
      projectName: 'test-project',
      intentType: 'create_project',
      tasks: [
        { title: 'Design architecture', description: 'Create system design', priority: 'P0' },
        { title: 'Implement API', description: 'Build backend API', priority: 'P0' }
      ],
      originalInput: '我想做一个测试项目',
      entities: {}
    };

    it('includes frontmatter by default', () => {
      const prd = renderPrd(mockParsedIntent);

      expect(prd).toMatch(/^---/);
      expect(prd).toContain('id: prd-test-project');
      expect(prd).toContain('version: 1.0.0');
    });

    it('can exclude frontmatter', () => {
      const prd = renderPrd(mockParsedIntent, { includeFrontmatter: false });

      expect(prd).not.toMatch(/^---/);
      expect(prd).toMatch(/^# PRD/);
    });

    it('includes all required sections', () => {
      const prd = renderPrd(mockParsedIntent);

      expect(prd).toContain('# PRD - test-project');
      expect(prd).toContain('## 背景');
      expect(prd).toContain('## 目标');
      expect(prd).toContain('## 功能需求');
      expect(prd).toContain('## 非功能需求');
      expect(prd).toContain('## 验收标准');
      expect(prd).toContain('## 里程碑');
    });

    it('includes original input in background', () => {
      const prd = renderPrd(mockParsedIntent);

      expect(prd).toContain('我想做一个测试项目');
    });

    it('lists tasks in functional requirements', () => {
      const prd = renderPrd(mockParsedIntent);

      expect(prd).toContain('### 1. Design architecture');
      expect(prd).toContain('Create system design');
      expect(prd).toContain('### 2. Implement API');
    });

    it('generates acceptance criteria from tasks', () => {
      const prd = renderPrd(mockParsedIntent);

      expect(prd).toContain('- [ ] Design architecture');
      expect(prd).toContain('- [ ] Implement API');
      expect(prd).toContain('- [ ] 所有测试通过');
    });

    it('handles empty tasks array', () => {
      const intent = { ...mockParsedIntent, tasks: [] };
      const prd = renderPrd(intent);

      expect(prd).toContain('待定义');
    });

    it('uses file path from entities when available', () => {
      const intent = {
        ...mockParsedIntent,
        entities: { filePath: 'src/custom/path.js' }
      };
      const prd = renderPrd(intent);

      expect(prd).toContain('- src/custom/path.js');
    });

    it('uses custom version', () => {
      const prd = renderPrd(mockParsedIntent, { version: '1.2.0' });

      expect(prd).toContain('version: 1.2.0');
    });
  });

  describe('renderTrd', () => {
    const mockParsedIntent = {
      projectName: 'api-service',
      intentType: 'create_project',
      tasks: [
        { title: 'Design database', description: 'Create data model', priority: 'P0' },
        { title: 'Build API', description: 'Implement endpoints', priority: 'P0' }
      ],
      originalInput: '创建一个 API 服务',
      entities: {}
    };

    it('includes frontmatter by default', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toMatch(/^---/);
      expect(trd).toContain('id: trd-api-service');
    });

    it('can exclude frontmatter', () => {
      const trd = renderTrd(mockParsedIntent, { includeFrontmatter: false });

      expect(trd).not.toMatch(/^---/);
      expect(trd).toMatch(/^# TRD/);
    });

    it('includes all required sections', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toContain('# TRD - api-service');
      expect(trd).toContain('## 技术背景');
      expect(trd).toContain('## 架构设计');
      expect(trd).toContain('## API 设计');
      expect(trd).toContain('## 数据模型');
      expect(trd).toContain('## 测试策略');
    });

    it('includes architecture diagram', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toContain('Client');
      expect(trd).toContain('Server');
      expect(trd).toContain('Database');
    });

    it('generates API table', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toContain('| 方法 | 路径 | 描述 |');
      expect(trd).toContain('GET');
      expect(trd).toContain('POST');
      expect(trd).toContain('/api/api-service');
    });

    it('uses entity apiEndpoint when available', () => {
      const intent = {
        ...mockParsedIntent,
        entities: { apiEndpoint: '/api/custom/endpoint' }
      };
      const trd = renderTrd(intent);

      expect(trd).toContain('/api/custom/endpoint');
    });

    it('generates SQL schema', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toContain('CREATE TABLE api_service');
      expect(trd).toContain('id UUID PRIMARY KEY');
      expect(trd).toContain('created_at TIMESTAMP');
    });

    it('lists test coverage items', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toContain('- [ ] Design database 测试');
      expect(trd).toContain('- [ ] Build API 测试');
    });

    it('includes implementation plan with tasks', () => {
      const trd = renderTrd(mockParsedIntent);

      expect(trd).toContain('1. **Design database** (P0)');
      expect(trd).toContain('2. **Build API** (P0)');
    });

    it('handles empty tasks', () => {
      const intent = { ...mockParsedIntent, tasks: [] };
      const trd = renderTrd(intent);

      expect(trd).toContain('- [ ] 核心功能测试');
      expect(trd).toContain('1. 需求分析');
    });

    it('uses module entity in component design', () => {
      const intent = {
        ...mockParsedIntent,
        entities: { module: 'user-auth' }
      };
      const trd = renderTrd(intent);

      expect(trd).toContain('- user-auth 模块');
    });
  });

  describe('generateTrdFromGoal', () => {
    it('generates TRD with title only', () => {
      const trd = generateTrdFromGoal({ title: 'Brain System v2' });

      expect(trd).toContain('# TRD - Brain System v2');
      expect(trd).toContain('## 技术背景');
      expect(trd).toContain('## 架构设计');
    });

    it('generates TRD with title and description', () => {
      const trd = generateTrdFromGoal({
        title: 'Task Intelligence',
        description: 'Build an intelligent task management system'
      });

      expect(trd).toContain('# TRD - Task Intelligence');
      expect(trd).toContain('Build an intelligent task management system');
    });

    it('includes milestones as tasks in implementation plan', () => {
      const trd = generateTrdFromGoal({
        title: 'My Goal',
        description: 'Goal description',
        milestones: [
          { title: 'Phase 1: Setup', description: 'Initial setup' },
          { title: 'Phase 2: Core', description: 'Core features' }
        ]
      });

      expect(trd).toContain('1. **Phase 1: Setup** (P0)');
      expect(trd).toContain('2. **Phase 2: Core** (P1)');
      expect(trd).toContain('- [ ] Phase 1: Setup 测试');
      expect(trd).toContain('- [ ] Phase 2: Core 测试');
    });

    it('handles empty milestones', () => {
      const trd = generateTrdFromGoal({ title: 'Simple Goal', milestones: [] });

      expect(trd).toContain('- [ ] 核心功能测试');
      expect(trd).toContain('1. 需求分析');
    });

    it('uses title as fallback for description', () => {
      const trd = generateTrdFromGoal({ title: 'My Goal' });

      expect(trd).toContain('My Goal');
    });

    it('passes rendering options through', () => {
      const trd = generateTrdFromGoal(
        { title: 'Test' },
        { includeFrontmatter: false }
      );

      expect(trd).not.toMatch(/^---/);
      expect(trd).toMatch(/^# TRD/);
    });
  });

  describe('getTemplate', () => {
    it('returns PRD template for "prd"', () => {
      const template = getTemplate('prd');
      expect(template).toBe(PRD_TEMPLATE);
    });

    it('returns TRD template for "trd"', () => {
      const template = getTemplate('trd');
      expect(template).toBe(TRD_TEMPLATE);
    });

    it('is case insensitive', () => {
      expect(getTemplate('PRD')).toBe(PRD_TEMPLATE);
      expect(getTemplate('TRD')).toBe(TRD_TEMPLATE);
    });

    it('returns null for unknown template', () => {
      expect(getTemplate('unknown')).toBeNull();
    });
  });

  describe('listTemplates', () => {
    it('returns list of available templates', () => {
      const templates = listTemplates();

      expect(templates.length).toBe(2);
      expect(templates).toContainEqual({ name: 'prd', sectionCount: 6 });
      expect(templates).toContainEqual({ name: 'trd', sectionCount: 5 });
    });
  });

  describe('getCurrentDate', () => {
    it('returns date in YYYY-MM-DD format', () => {
      const date = getCurrentDate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('generatePrdFromGoalKR', () => {
    it('generates full PRD with all Goal+KR+Project params', () => {
      const prd = generatePrdFromGoalKR({
        title: 'Implement TRD engine',
        description: 'Build TRD markdown generator from KR context',
        kr: { title: 'TRD 模板完整性', progress: 45, priority: 'P0' },
        project: { name: 'cecelia-workspace', repo_path: '/home/xx/dev/cecelia-workspace' }
      });

      expect(prd).toContain('---');
      expect(prd).toContain('id: prd-auto-');
      expect(prd).toContain('version: 1.0.0');
      expect(prd).toContain('# PRD - Implement TRD engine');
      expect(prd).toContain('KR: TRD 模板完整性 (progress: 45%, priority: P0)');
      expect(prd).toContain('Project: cecelia-workspace');
      expect(prd).toContain('Build TRD markdown generator from KR context');
      expect(prd).toContain('/home/xx/dev/cecelia-workspace');
      expect(prd).toContain('## 非目标');
    });

    it('generates generic PRD without kr/project params', () => {
      const prd = generatePrdFromGoalKR({
        title: 'Simple task',
        description: 'A simple task description'
      });

      expect(prd).toContain('# PRD - Simple task');
      expect(prd).toContain('Auto-generated task');
      expect(prd).not.toContain('KR:');
      expect(prd).toContain('A simple task description');
      expect(prd).toContain('TBD');
      expect(prd).toContain('## 非目标');
    });

    it('handles kr with missing fields gracefully', () => {
      const prd = generatePrdFromGoalKR({
        title: 'Partial KR task',
        description: 'Test partial KR',
        kr: { title: 'Some KR' }
      });

      expect(prd).toContain('KR: Some KR (progress: 0%, priority: P1)');
      expect(prd).toContain('## 非目标');
      expect(prd).not.toContain('undefined');
    });

    it('uses title as description fallback', () => {
      const prd = generatePrdFromGoalKR({ title: 'Fallback test' });

      expect(prd).toContain('## 功能描述');
      expect(prd).toContain('Fallback test');
    });
  });

  describe('validatePrd', () => {
    it('returns valid:true for a complete PRD', () => {
      const prd = generatePrdFromGoalKR({
        title: 'Test',
        description: 'Test desc',
        kr: { title: 'KR1', progress: 50, priority: 'P0' },
        project: { name: 'proj', repo_path: '/repo' }
      });
      const result = validatePrd(prd);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid:false when 需求来源 is missing', () => {
      const prd = '## 功能描述\nSomething\n## 成功标准\n- item';
      const result = validatePrd(prd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: 需求来源');
    });

    it('returns valid:false when 功能描述 is missing', () => {
      const prd = '## 需求来源\nSomething\n## 成功标准\n- item';
      const result = validatePrd(prd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: 功能描述');
    });

    it('returns valid:false when 成功标准 is missing', () => {
      const prd = '## 需求来源\nSomething\n## 功能描述\nSomething';
      const result = validatePrd(prd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: 成功标准');
    });

    it('returns valid:false for empty content', () => {
      const result = validatePrd('');
      expect(result.valid).toBe(false);
    });

    it('returns valid:false for null content', () => {
      const result = validatePrd(null);
      expect(result.valid).toBe(false);
    });

    it('warns when 非目标 is missing', () => {
      const prd = '## 需求来源\nX\n## 功能描述\nY\n## 成功标准\n- item\n## 涉及文件\nZ';
      const result = validatePrd(prd);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Missing recommended field: 非目标');
    });

    it('recognizes bold-style field markers', () => {
      const prd = '**需求来源**: X\n**功能描述**: Y\n**成功标准**:\n- item';
      const result = validatePrd(prd);
      expect(result.valid).toBe(true);
    });

    it('accepts renderPrd output as valid', () => {
      const prd = renderPrd({
        projectName: 'test',
        intentType: 'create_feature',
        tasks: [{ title: 'Task 1', description: 'Desc', priority: 'P0' }],
        originalInput: 'Test input',
        entities: {}
      });
      const result = validatePrd(prd);
      // renderPrd uses 背景/功能需求/验收标准 which map to our required fields
      expect(result.valid).toBe(true);
    });
  });

  describe('validateTrd', () => {
    it('returns valid:true for a complete TRD', () => {
      const trd = renderTrd({
        projectName: 'test',
        intentType: 'create_project',
        tasks: [],
        originalInput: 'Test',
        entities: {}
      });
      const result = validateTrd(trd);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid:false when required sections are missing', () => {
      const trd = '## 技术背景\nSomething\n## 架构设计\nSomething';
      const result = validateTrd(trd);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required section: API 设计');
      expect(result.errors).toContain('Missing required section: 数据模型');
      expect(result.errors).toContain('Missing required section: 测试策略');
    });

    it('returns valid:false for empty content', () => {
      const result = validateTrd('');
      expect(result.valid).toBe(false);
    });

    it('returns valid:false for null content', () => {
      const result = validateTrd(null);
      expect(result.valid).toBe(false);
    });

    it('warns when 实施计划 is missing', () => {
      const trd = '## 技术背景\nA\n## 架构设计\nB\n## API 设计\nC\n## 数据模型\nD\n## 测试策略\nE';
      const result = validateTrd(trd);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Missing recommended section: 实施计划');
    });

    it('accepts generateTrdFromGoal output as valid', () => {
      const trd = generateTrdFromGoal({ title: 'Test Goal', description: 'Desc' });
      const result = validateTrd(trd);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Integration: Document rendering flow', () => {
    it('generates consistent PRD structure', () => {
      const intent = {
        projectName: 'gmv-dashboard',
        intentType: 'create_project',
        tasks: [
          { title: '设计架构', description: '设计系统架构', priority: 'P0' },
          { title: '实现后端', description: '开发后端 API', priority: 'P0' },
          { title: '实现前端', description: '开发前端界面', priority: 'P1' }
        ],
        originalInput: '我想做一个 GMV Dashboard',
        entities: {}
      };

      const prd = renderPrd(intent);

      // Verify structure
      expect(prd).toContain('id: prd-gmv-dashboard');
      expect(prd).toContain('# PRD - gmv-dashboard');
      expect(prd).toContain('我想做一个 GMV Dashboard');
      expect(prd).toContain('创建并实现gmv-dashboard');
      expect(prd).toContain('### 1. 设计架构');
      expect(prd).toContain('- [ ] 设计架构');
      expect(prd).toContain('| M1 | 需求确认 | 待开始 |');
    });

    it('generates consistent TRD structure', () => {
      const intent = {
        projectName: 'user-service',
        intentType: 'create_feature',
        tasks: [
          { title: '设计 API', description: '定义接口规范', priority: 'P0' },
          { title: '实现功能', description: '编码实现', priority: 'P0' }
        ],
        originalInput: '给用户模块添加认证功能',
        entities: { module: 'user' }
      };

      const trd = renderTrd(intent);

      // Verify structure
      expect(trd).toContain('id: trd-user-service');
      expect(trd).toContain('# TRD - user-service');
      expect(trd).toContain('给用户模块添加认证功能');
      expect(trd).toContain('### 现有技术栈');
      expect(trd).toContain('CREATE TABLE user_service');
      expect(trd).toContain('- user 模块');
    });
  });

  describe('extractSection', () => {
    it('extracts section content by header', () => {
      const md = '## 背景\n\n这是背景内容\n\n## 目标\n\n- 目标1';
      expect(extractSection(md, '背景')).toBe('这是背景内容');
      expect(extractSection(md, '目标')).toBe('- 目标1');
    });

    it('returns null for missing section', () => {
      expect(extractSection('## 背景\n\n内容', '目标')).toBeNull();
    });
  });

  describe('validatePrd', () => {
    const validPrd = `# PRD - Test

## 背景

需求来源说明

## 目标

- 实现功能A
- 实现功能B

## 功能需求

This is a sufficiently long functional requirements description that includes detailed implementation specifics and concrete feature specifications to ensure it exceeds fifty characters in length.

## 验收标准

- [ ] 用户能点击登录按钮完成认证
- [ ] 系统显示成功提示消息
`;

    it('passes for valid PRD', () => {
      const result = validatePrd(validPrd);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when missing required fields', () => {
      const result = validatePrd('# PRD\n\n## 背景\n\n内容');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing required field'))).toBe(true);
    });

    it('fails when objectives lacks bullet points', () => {
      const prd = `# PRD

## 背景

内容

## 目标

这里没有列表

## 功能需求

${'这是一段足够长的功能需求描述内容'.repeat(5)}

## 验收标准

- [ ] 系统显示结果
`;
      const result = validatePrd(prd);
      expect(result.warnings.some(e => e.includes('bullet point'))).toBe(true);
    });

    it('warns when functional requirements too short', () => {
      const prd = `# PRD

## 背景

内容

## 目标

- 目标1

## 功能需求

短

## 验收标准

- [ ] 系统显示结果
`;
      const result = validatePrd(prd);
      expect(result.warnings.some(e => e.includes('50 characters'))).toBe(true);
    });

    it('warns when acceptance criteria lack action verbs', () => {
      const prd = `# PRD

## 背景

内容

## 目标

- 目标1

## 功能需求

${'这是一段足够长的功能需求描述'.repeat(5)}

## 验收标准

- [ ] 好的代码质量
- [ ] 优雅的架构
`;
      const result = validatePrd(prd);
      expect(result.warnings.some(e => e.includes('action verb'))).toBe(true);
    });
  });

  describe('validateTrd (enhanced)', () => {
    const validTrd = `# TRD - Test

## 技术背景

Node.js + Express 架构

## 架构设计

微服务架构设计方案

## API 设计

RESTful 接口

## 数据模型

PostgreSQL

## 测试策略

单元测试 + 集成测试
`;

    it('passes for valid TRD', () => {
      const result = validateTrd(validTrd);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when missing required sections', () => {
      const result = validateTrd('# TRD\n\n## API 设计\n\n内容');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('技术背景'))).toBe(true);
    });

    it('warns when required section is empty', () => {
      const trd = `# TRD

## 技术背景

## 架构设计

内容

## API 设计

内容

## 数据模型

内容

## 测试策略

内容
`;
      const result = validateTrd(trd);
      expect(result.warnings.some(e => e.includes('empty'))).toBe(true);
    });
  });

  describe('prdToJson', () => {
    it('parses PRD markdown into JSON', () => {
      const prd = `# PRD - 用户登录

## 背景

需要用户认证

## 目标

- 实现登录

## 功能需求

实现完整的登录流程

## 验收标准

- [ ] 登录成功
`;
      const result = prdToJson(prd);
      expect(result.title).toBe('用户登录');
      expect(result.sections.background).toContain('需要用户认证');
      expect(result.sections.objectives).toContain('实现登录');
      expect(result.sections.functional_requirements).toContain('登录流程');
      expect(result.sections.acceptance_criteria).toContain('登录成功');
    });

    it('returns empty strings for missing sections', () => {
      const result = prdToJson('# PRD - Test');
      expect(result.sections.background).toBe('');
      expect(result.sections.milestones).toBe('');
    });
  });

  describe('trdToJson', () => {
    it('parses TRD markdown into JSON', () => {
      const trd = `# TRD - 认证系统

## 技术背景

JWT 认证

## 架构设计

微服务

## API 设计

REST

## 数据模型

users 表

## 测试策略

vitest
`;
      const result = trdToJson(trd);
      expect(result.title).toBe('认证系统');
      expect(result.sections.technical_background).toContain('JWT');
      expect(result.sections.architecture_design).toContain('微服务');
      expect(result.sections.test_strategy).toContain('vitest');
    });
  });

  describe('generateTrdFromGoalKR', () => {
    it('generates TRD with full KR + project context', () => {
      const trd = generateTrdFromGoalKR({
        title: 'TRD Template Engine',
        description: 'Build TRD generator with KR context',
        kr: { title: 'TRD 模板完整性', progress: 45, priority: 'P0' },
        project: { name: 'cecelia-workspace', repo_path: '/home/xx/dev/cecelia-workspace' }
      });

      expect(trd).toContain('---');
      expect(trd).toContain('id: trd-auto-');
      expect(trd).toContain('version: 1.0.0');
      expect(trd).toContain('# TRD - TRD Template Engine');
      expect(trd).toContain('KR: TRD 模板完整性 (progress: 45%, priority: P0)');
      expect(trd).toContain('Project: cecelia-workspace');
      expect(trd).toContain('/home/xx/dev/cecelia-workspace');
      expect(trd).toContain('cecelia-workspace 核心模块');
    });

    it('generates valid TRD that passes validateTrd', () => {
      const trd = generateTrdFromGoalKR({
        title: 'Test TRD',
        kr: { title: 'KR1', progress: 50, priority: 'P0' },
        project: { name: 'proj', repo_path: '/repo' }
      });
      const result = validateTrd(trd);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('generates TRD without KR params', () => {
      const trd = generateTrdFromGoalKR({
        title: 'Simple TRD',
        description: 'No KR context'
      });

      expect(trd).toContain('# TRD - Simple TRD');
      expect(trd).toContain('No KR context');
      expect(trd).not.toContain('KR:');
      expect(trd).toContain('## 技术背景');
      expect(trd).toContain('## 架构设计');
      expect(trd).toContain('## API 设计');
      expect(trd).toContain('## 数据模型');
      expect(trd).toContain('## 测试策略');

      const result = validateTrd(trd);
      expect(result.valid).toBe(true);
    });

    it('generates TRD without project params', () => {
      const trd = generateTrdFromGoalKR({
        title: 'No Project TRD',
        kr: { title: 'Some KR' }
      });

      expect(trd).toContain('KR: Some KR (progress: 0%, priority: P1)');
      expect(trd).not.toContain('Project:');
      expect(trd).toContain('No Project TRD 核心模块');
    });

    it('maps milestones to implementation plan', () => {
      const trd = generateTrdFromGoalKR({
        title: 'Milestone TRD',
        milestones: [
          { title: 'Phase 1: Setup', description: 'Initial setup' },
          { title: 'Phase 2: Core', description: 'Core features' },
          { title: 'Phase 3: Polish' }
        ]
      });

      expect(trd).toContain('1. **Phase 1: Setup**');
      expect(trd).toContain('   - Initial setup');
      expect(trd).toContain('2. **Phase 2: Core**');
      expect(trd).toContain('3. **Phase 3: Polish**');
      expect(trd).toContain('- [ ] Phase 1: Setup 测试');
      expect(trd).toContain('- [ ] Phase 2: Core 测试');
    });

    it('handles empty milestones', () => {
      const trd = generateTrdFromGoalKR({ title: 'Empty Milestones', milestones: [] });

      expect(trd).toContain('- [ ] 核心功能测试');
      expect(trd).toContain('1. 需求分析');
    });

    it('handles kr with missing fields gracefully', () => {
      const trd = generateTrdFromGoalKR({
        title: 'Partial KR',
        kr: { title: 'Some KR' }
      });

      expect(trd).toContain('KR: Some KR (progress: 0%, priority: P1)');
      expect(trd).not.toContain('undefined');
    });
  });
});
