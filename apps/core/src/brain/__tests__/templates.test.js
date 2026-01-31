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
  getTemplate,
  listTemplates,
  getCurrentDate
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
});
