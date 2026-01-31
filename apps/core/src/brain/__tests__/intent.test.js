/**
 * Intent Recognition Module Tests (KR1)
 * Tests for natural language → structured intent parsing
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import {
  INTENT_TYPES,
  classifyIntent,
  extractEntities,
  extractProjectName,
  generateTasks,
  generatePrdDraft,
  generateStandardPrd,
  generateTrdDraft,
  parseIntent,
  parseAndCreate
} from '../intent.js';

const { Pool } = pg;

// Use test database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

// Track created resources for cleanup
let createdProjectIds = [];
let createdTaskIds = [];

describe('Intent Recognition Module', () => {
  beforeAll(async () => {
    // Verify database connection
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup test data
    for (const taskId of createdTaskIds) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]).catch(() => {});
    }
    for (const projectId of createdProjectIds) {
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => {});
    }
    createdTaskIds = [];
    createdProjectIds = [];
  });

  describe('classifyIntent', () => {
    it('classifies create project intent correctly', () => {
      const result = classifyIntent('我想做一个 GMV Dashboard');

      expect(result.type).toBe(INTENT_TYPES.CREATE_PROJECT);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it('classifies create feature intent correctly', () => {
      const result = classifyIntent('给登录页面添加一个忘记密码功能');

      expect(result.type).toBe(INTENT_TYPES.CREATE_FEATURE);
      expect(result.keywords).toContain('添加');
    });

    it('classifies fix bug intent correctly', () => {
      const result = classifyIntent('修复购物车页面的价格显示问题');

      expect(result.type).toBe(INTENT_TYPES.FIX_BUG);
      expect(result.keywords).toContain('修复');
    });

    it('classifies refactor intent correctly', () => {
      const result = classifyIntent('重构用户模块的代码结构');

      expect(result.type).toBe(INTENT_TYPES.REFACTOR);
      expect(result.keywords).toContain('重构');
    });

    it('classifies explore intent correctly', () => {
      const result = classifyIntent('帮我看看这个 API 怎么用');

      expect(result.type).toBe(INTENT_TYPES.EXPLORE);
      expect(result.keywords).toContain('看看');
    });

    it('classifies question intent correctly', () => {
      const result = classifyIntent('为什么这里会报错？');

      expect(result.type).toBe(INTENT_TYPES.QUESTION);
      expect(result.keywords.some(k => k === '为什么' || k === '？')).toBe(true);
    });

    it('returns lower confidence for ambiguous input', () => {
      const result = classifyIntent('hello world');

      // Input without clear intent keywords should have low/zero confidence
      expect(result.confidence).toBeLessThanOrEqual(0.33);
    });

    it('handles English keywords', () => {
      const result = classifyIntent('I want to create a new project');

      expect(result.type).toBe(INTENT_TYPES.CREATE_PROJECT);
      expect(result.keywords).toContain('create');
    });
  });

  describe('extractEntities', () => {
    it('extracts module name from Chinese input', () => {
      const entities = extractEntities('给用户管理模块添加批量导入功能');

      expect(entities.module).toBeTruthy();
      expect(entities.module).toContain('用户管理');
    });

    it('extracts feature name from input', () => {
      const entities = extractEntities('添加批量导入功能');

      expect(entities.feature).toBeTruthy();
      expect(entities.feature).toContain('批量导入');
    });

    it('extracts file path from input', () => {
      const entities = extractEntities('修改 src/brain/intent.js 文件');

      expect(entities.filePath).toBe('src/brain/intent.js');
    });

    it('returns falsy values for missing entities', () => {
      const entities = extractEntities('hello world');

      expect(entities.module).toBeFalsy();
      expect(entities.feature).toBeFalsy();
      expect(entities.filePath).toBeFalsy();
    });
  });

  describe('extractProjectName', () => {
    it('extracts project name from Chinese input', () => {
      const name = extractProjectName('我想做一个 GMV Dashboard', INTENT_TYPES.CREATE_PROJECT);

      expect(name).toBe('gmv-dashboard');
    });

    it('removes common phrases', () => {
      const name = extractProjectName('请帮我创建一个用户系统', INTENT_TYPES.CREATE_PROJECT);

      // After removing 帮我 and 创建, should have: "请一个用户系统"
      expect(name).toContain('用户系统');
    });

    it('converts spaces to dashes', () => {
      const name = extractProjectName('做一个 user authentication system', INTENT_TYPES.CREATE_PROJECT);

      expect(name).toBe('user-authentication-system');
    });

    it('returns default name for empty input', () => {
      const name = extractProjectName('做一个', INTENT_TYPES.CREATE_PROJECT);

      expect(name).toBe('untitled-project');
    });
  });

  describe('generateTasks', () => {
    it('generates 5 tasks for create project intent', () => {
      const tasks = generateTasks('test-project', INTENT_TYPES.CREATE_PROJECT, 'test');

      expect(tasks.length).toBe(5);
      expect(tasks[0].priority).toBe('P0');
      expect(tasks[0].title).toContain('设计');
      expect(tasks[1].title).toContain('后端');
      expect(tasks[2].title).toContain('前端');
      expect(tasks[3].title).toContain('测试');
      expect(tasks[4].title).toContain('部署');
    });

    it('generates 3 tasks for fix bug intent', () => {
      const tasks = generateTasks('bug-fix', INTENT_TYPES.FIX_BUG, 'fix bug');

      expect(tasks.length).toBe(3);
      expect(tasks[0].title).toContain('分析');
      expect(tasks[1].title).toContain('修复');
      expect(tasks[2].title).toContain('回归');
    });

    it('generates 4 tasks for refactor intent', () => {
      const tasks = generateTasks('refactor', INTENT_TYPES.REFACTOR, 'refactor');

      expect(tasks.length).toBe(4);
    });

    it('generates 3 default tasks for unknown intent', () => {
      const tasks = generateTasks('unknown', INTENT_TYPES.UNKNOWN, 'something');

      expect(tasks.length).toBe(3);
    });
  });

  describe('generatePrdDraft', () => {
    it('generates valid PRD markdown', () => {
      const parsedIntent = {
        projectName: 'test-project',
        intentType: INTENT_TYPES.CREATE_PROJECT,
        tasks: [
          { title: 'Task 1', description: 'Desc 1', priority: 'P0' },
          { title: 'Task 2', description: 'Desc 2', priority: 'P1' }
        ],
        originalInput: 'Create a test project',
        entities: {}
      };

      const prd = generatePrdDraft(parsedIntent);

      expect(prd).toContain('# PRD - test-project');
      expect(prd).toContain('Create a test project');
      expect(prd).toContain('Task 1');
      expect(prd).toContain('Task 2');
    });

    it('does not include frontmatter (backward compatibility)', () => {
      const parsedIntent = {
        projectName: 'test-project',
        intentType: INTENT_TYPES.CREATE_PROJECT,
        tasks: [],
        originalInput: 'Test',
        entities: {}
      };

      const prd = generatePrdDraft(parsedIntent);

      expect(prd).not.toMatch(/^---/);
      expect(prd).toMatch(/^# PRD/);
    });
  });

  describe('generateStandardPrd', () => {
    const baseParsedIntent = {
      projectName: 'standard-project',
      intentType: INTENT_TYPES.CREATE_PROJECT,
      tasks: [
        { title: 'Design', description: 'Design the system', priority: 'P0' },
        { title: 'Implement', description: 'Build the system', priority: 'P0' }
      ],
      originalInput: '创建一个标准项目',
      entities: {}
    };

    it('includes frontmatter by default', () => {
      const prd = generateStandardPrd(baseParsedIntent);

      expect(prd).toMatch(/^---/);
      expect(prd).toContain('id: prd-standard-project');
      expect(prd).toContain('version: 1.0.0');
      expect(prd).toContain('changelog:');
    });

    it('includes all standard sections', () => {
      const prd = generateStandardPrd(baseParsedIntent);

      expect(prd).toContain('## 背景');
      expect(prd).toContain('## 目标');
      expect(prd).toContain('## 功能需求');
      expect(prd).toContain('## 非功能需求');
      expect(prd).toContain('## 验收标准');
      expect(prd).toContain('## 里程碑');
    });

    it('includes milestone table', () => {
      const prd = generateStandardPrd(baseParsedIntent);

      expect(prd).toContain('| 阶段 | 描述 | 状态 |');
      expect(prd).toContain('| M1 | 需求确认 | 待开始 |');
    });

    it('can exclude frontmatter', () => {
      const prd = generateStandardPrd(baseParsedIntent, { includeFrontmatter: false });

      expect(prd).not.toMatch(/^---/);
    });

    it('supports custom version', () => {
      const prd = generateStandardPrd(baseParsedIntent, { version: '2.0.0' });

      expect(prd).toContain('version: 2.0.0');
    });
  });

  describe('generateTrdDraft', () => {
    const baseParsedIntent = {
      projectName: 'api-service',
      intentType: INTENT_TYPES.CREATE_PROJECT,
      tasks: [
        { title: 'Design API', description: 'Define API spec', priority: 'P0' },
        { title: 'Implement', description: 'Build endpoints', priority: 'P0' }
      ],
      originalInput: '创建一个 API 服务',
      entities: {}
    };

    it('includes frontmatter by default', () => {
      const trd = generateTrdDraft(baseParsedIntent);

      expect(trd).toMatch(/^---/);
      expect(trd).toContain('id: trd-api-service');
      expect(trd).toContain('version: 1.0.0');
    });

    it('includes all TRD sections', () => {
      const trd = generateTrdDraft(baseParsedIntent);

      expect(trd).toContain('## 技术背景');
      expect(trd).toContain('## 架构设计');
      expect(trd).toContain('## API 设计');
      expect(trd).toContain('## 数据模型');
      expect(trd).toContain('## 测试策略');
    });

    it('includes architecture diagram', () => {
      const trd = generateTrdDraft(baseParsedIntent);

      expect(trd).toContain('Client');
      expect(trd).toContain('Server');
      expect(trd).toContain('Database');
    });

    it('includes API endpoint table', () => {
      const trd = generateTrdDraft(baseParsedIntent);

      expect(trd).toContain('| 方法 | 路径 | 描述 |');
      expect(trd).toContain('GET');
      expect(trd).toContain('POST');
    });

    it('includes SQL schema', () => {
      const trd = generateTrdDraft(baseParsedIntent);

      expect(trd).toContain('CREATE TABLE api_service');
      expect(trd).toContain('id UUID PRIMARY KEY');
    });

    it('includes test coverage checklist', () => {
      const trd = generateTrdDraft(baseParsedIntent);

      expect(trd).toContain('- [ ] Design API 测试');
      expect(trd).toContain('- [ ] Implement 测试');
    });

    it('can exclude frontmatter', () => {
      const trd = generateTrdDraft(baseParsedIntent, { includeFrontmatter: false });

      expect(trd).not.toMatch(/^---/);
      expect(trd).toMatch(/^# TRD/);
    });

    it('uses entity module in design', () => {
      const intent = {
        ...baseParsedIntent,
        entities: { module: 'user-auth' }
      };
      const trd = generateTrdDraft(intent);

      expect(trd).toContain('- user-auth 模块');
    });
  });

  describe('parseIntent', () => {
    it('parses complete intent structure', async () => {
      const result = await parseIntent('我想做一个 GMV Dashboard');

      expect(result.originalInput).toBe('我想做一个 GMV Dashboard');
      expect(result.intentType).toBe(INTENT_TYPES.CREATE_PROJECT);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.projectName).toBe('gmv-dashboard');
      expect(result.tasks.length).toBeGreaterThanOrEqual(3);
      expect(result.prdDraft).toContain('# PRD');
    });

    it('throws error for empty input', async () => {
      await expect(parseIntent('')).rejects.toThrow('Input is required');
    });

    it('throws error for non-string input', async () => {
      await expect(parseIntent(123)).rejects.toThrow('Input is required');
    });

    it('trims whitespace from input', async () => {
      const result = await parseIntent('  做一个测试项目  ');

      expect(result.originalInput).toBe('做一个测试项目');
    });
  });

  describe('parseAndCreate', () => {
    it('creates project and tasks in database', async () => {
      const result = await parseAndCreate('我想做一个测试项目 Test Project');

      expect(result.parsed).toBeDefined();
      expect(result.created.project).toBeDefined();
      expect(result.created.tasks.length).toBeGreaterThan(0);

      // Track for cleanup
      if (result.created.project?.id && result.created.project.created) {
        createdProjectIds.push(result.created.project.id);
      }
      for (const task of result.created.tasks) {
        createdTaskIds.push(task.id);
      }

      // Verify project was created
      const projectQuery = await pool.query(
        'SELECT * FROM projects WHERE id = $1',
        [result.created.project.id]
      );
      expect(projectQuery.rows.length).toBe(1);

      // Verify tasks were created
      for (const task of result.created.tasks) {
        const taskQuery = await pool.query(
          'SELECT * FROM tasks WHERE id = $1',
          [task.id]
        );
        expect(taskQuery.rows.length).toBe(1);
        expect(taskQuery.rows[0].status).toBe('queued');
      }
    });

    it('reuses existing project with similar name', async () => {
      // First create a project
      const firstResult = await parseAndCreate('做一个 Widget Dashboard');
      if (firstResult.created.project?.id && firstResult.created.project.created) {
        createdProjectIds.push(firstResult.created.project.id);
      }
      for (const task of firstResult.created.tasks) {
        createdTaskIds.push(task.id);
      }

      // Then try to create with similar name
      const secondResult = await parseAndCreate('做一个 Widget Dashboard 增强版', {
        createProject: true,
        createTasks: true
      });
      for (const task of secondResult.created.tasks) {
        createdTaskIds.push(task.id);
      }

      // Should reuse existing project
      expect(secondResult.created.project.created).toBe(false);
      expect(secondResult.created.project.message).toBe('Using existing project');
    });

    it('skips project creation when createProject is false', async () => {
      const result = await parseAndCreate('测试功能', {
        createProject: false,
        createTasks: false
      });

      expect(result.created.project).toBeNull();
      expect(result.created.tasks.length).toBe(0);
    });

    it('links tasks to specified goal', async () => {
      // Create a test goal first
      const goalResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING id`,
        ['Test Goal', 'objective', 'P1', 'pending']
      );
      const goalId = goalResult.rows[0].id;

      try {
        const result = await parseAndCreate('做一个关联目标的任务', {
          goalId,
          createProject: false
        });

        for (const task of result.created.tasks) {
          createdTaskIds.push(task.id);
          expect(task.goal_id).toBe(goalId);
        }
      } finally {
        // Cleanup goal
        await pool.query('DELETE FROM goals WHERE id = $1', [goalId]);
      }
    });
  });

  describe('classifyIntent - new phrase patterns', () => {
    it('matches "需要一个" for create project', () => {
      const result = classifyIntent('需要一个用户管理后台');
      expect(result.type).toBe(INTENT_TYPES.CREATE_PROJECT);
      expect(result.matchedPhrases.length).toBeGreaterThan(0);
    });

    it('matches "启动...项目" for create project', () => {
      const result = classifyIntent('启动用户增长项目');
      expect(result.type).toBe(INTENT_TYPES.CREATE_PROJECT);
    });

    it('matches "set up" for create project', () => {
      const result = classifyIntent('set up a monitoring dashboard');
      expect(result.type).toBe(INTENT_TYPES.CREATE_PROJECT);
    });

    it('matches "需要支持" for create feature', () => {
      const result = classifyIntent('系统需要支持批量导出功能');
      expect(result.type).toBe(INTENT_TYPES.CREATE_FEATURE);
    });

    it('matches "有问题" for fix bug', () => {
      const result = classifyIntent('登录页面有问题');
      expect(result.type).toBe(INTENT_TYPES.FIX_BUG);
    });

    it('matches "出错了" for fix bug', () => {
      const result = classifyIntent('支付接口出错了');
      expect(result.type).toBe(INTENT_TYPES.FIX_BUG);
    });
  });

  describe('classifyIntent - confidenceLevel', () => {
    it('returns confidenceLevel field', () => {
      const result = classifyIntent('我想做一个 GMV Dashboard');
      expect(result.confidenceLevel).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(result.confidenceLevel);
    });

    it('returns low for ambiguous input', () => {
      const result = classifyIntent('hello world');
      expect(result.confidenceLevel).toBe('low');
    });

    it('is consistent with numeric confidence', () => {
      const result = classifyIntent('修复购物车页面的价格显示问题');
      if (result.confidence >= 0.7) expect(result.confidenceLevel).toBe('high');
      else if (result.confidence >= 0.4) expect(result.confidenceLevel).toBe('medium');
      else expect(result.confidenceLevel).toBe('low');
    });
  });

  describe('extractEntities - priority', () => {
    it('extracts P0', () => {
      const entities = extractEntities('创建一个 P0 紧急任务');
      expect(entities.priority).toBe('P0');
    });

    it('normalizes "紧急" to P0', () => {
      const entities = extractEntities('这是一个紧急的修复');
      expect(entities.priority).toBe('P0');
    });

    it('normalizes "低优" to P2', () => {
      const entities = extractEntities('这是一个低优任务');
      expect(entities.priority).toBe('P2');
    });

    it('normalizes English "high priority" to P0', () => {
      const entities = extractEntities('This is a high priority task');
      expect(entities.priority).toBe('P0');
    });
  });

  describe('extractEntities - timeframe', () => {
    it('extracts "今天"', () => {
      const entities = extractEntities('今天需要完成这个任务');
      expect(entities.timeframe).toBe('今天');
    });

    it('extracts "下周"', () => {
      const entities = extractEntities('下周前完成用户模块重构');
      expect(entities.timeframe).toBe('下周');
    });

    it('extracts "尽快"', () => {
      const entities = extractEntities('需要尽快修复这个 bug');
      expect(entities.timeframe).toBe('尽快');
    });

    it('extracts English "next week"', () => {
      const entities = extractEntities('finish this by next week');
      expect(entities.timeframe).toBeTruthy();
    });
  });

  describe('extractEntities - dependency', () => {
    it('extracts "依赖" dependency', () => {
      const entities = extractEntities('这个任务依赖用户认证模块');
      expect(entities.dependency).toBeTruthy();
      expect(entities.dependency).toContain('用户认证');
    });

    it('extracts "depends on"', () => {
      const entities = extractEntities('this task depends on auth module');
      expect(entities.dependency).toBeTruthy();
    });

    it('extracts "blocked by"', () => {
      const entities = extractEntities('blocked by database migration');
      expect(entities.dependency).toBeTruthy();
    });
  });

  describe('parseIntent - enhanced fields', () => {
    it('includes confidenceLevel', async () => {
      const result = await parseIntent('我想做一个 GMV Dashboard');
      expect(result.confidenceLevel).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(result.confidenceLevel);
    });

    it('extracts new entity types', async () => {
      const result = await parseIntent('紧急修复用户模块的登录 bug，今天完成');
      expect(result.entities).toBeDefined();
      const hasNewEntity = result.entities.priority || result.entities.timeframe || result.entities.dependency;
      expect(hasNewEntity).toBeTruthy();
    });
  });

  describe('Integration: End-to-end intent parsing', () => {
    it('processes "我想做一个 GMV Dashboard" correctly', async () => {
      const result = await parseIntent('我想做一个 GMV Dashboard');

      expect(result.intentType).toBe('create_project');
      expect(result.projectName).toBe('gmv-dashboard');
      expect(result.tasks.length).toBeGreaterThanOrEqual(3);
      expect(result.tasks.length).toBeLessThanOrEqual(6);
      expect(result.prdDraft).toContain('GMV Dashboard');
      expect(result.prdDraft).toContain('验收标准');
      expect(result.prdDraft).toContain('功能需求');
    });
  });
});
