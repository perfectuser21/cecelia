/**
 * Staff & Skills Registry API Tests
 *
 * 测试 /api/brain/staff 和 /api/brain/skills-registry 端点
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock db.js（必须内联，不能用外部变量）──────────────────
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// ── Mock model-profile.js ────────────────────────────────────
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(),
  loadActiveProfile: vi.fn(),
  switchProfile: vi.fn(),
  listProfiles: vi.fn().mockResolvedValue([]),
  updateAgentModel: vi.fn(),
  batchUpdateAgentModels: vi.fn(),
  FALLBACK_PROFILE: {
    id: 'profile-minimax',
    name: 'MiniMax 主力',
    config: {
      thalamus: { provider: 'minimax', model: 'MiniMax-M2.1' },
      cortex: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
      executor: {
        default_provider: 'minimax',
        model_map: {
          dev: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          qa: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
          audit: { anthropic: null, minimax: 'MiniMax-M2.5-highspeed' },
        },
        fixed_provider: {},
      },
    },
  },
}));

// ── Mock fs ──────────────────────────────────────────────────
// importOriginal 确保 package.json 等真实读取不被拦截
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
    // readFileSync 默认透传真实实现，测试里再 mockImplementation 覆盖
    readFileSync: vi.fn().mockImplementation(actual.readFileSync),
    default: {
      ...actual,
      readdirSync: vi.fn(),
      existsSync: vi.fn(),
      readFileSync: vi.fn().mockImplementation(actual.readFileSync),
    },
  };
});

// Import after mocks
import * as modelProfile from '../model-profile.js';
import routes from '../routes.js';

// ── Test data ─────────────────────────────────────────────────

const MOCK_WORKERS_CONFIG = {
  version: '3.0.0',
  areas: {
    cecelia: { name: 'Cecelia', description: '管家系统', icon: 'Bot' },
    zenithjoy: { name: 'ZenithJoy', description: '媒体公司', icon: 'Building2' },
  },
  teams: [
    {
      id: 'core',
      name: '核心团队',
      area: 'cecelia',
      department: '核心团队',
      level: 1,
      icon: '🧠',
      description: '核心管理层',
      workers: [
        {
          id: 'caramel',
          name: 'Caramel',
          alias: null,
          icon: '💻',
          type: 'agent',
          role: '编程专家',
          skill: '/dev',
          description: '负责编程任务',
          abilities: ['coding', 'review'],
          gradient: 'linear-gradient(135deg, #f093fb, #f5576c)',
        },
        {
          id: 'xiaojian',
          name: '小检',
          alias: null,
          icon: '🔍',
          type: 'agent',
          role: 'QA 总控',
          skill: '/qa',
          description: '负责质量检查',
          abilities: ['testing', 'audit'],
          gradient: null,
        },
      ],
    },
  ],
};

const MOCK_SKILL_MD = `---
name: Dev Skill
version: 2.0.0
description: 编程专家 Skill
---

# Dev

This is the dev skill.
`;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', routes);
  return app;
}

// ── Tests: GET /api/brain/staff ───────────────────────────────

describe('GET /api/brain/staff', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createApp();

    // 设置 model profile
    modelProfile.getActiveProfile.mockReturnValue({
      id: 'profile-test',
      config: {
        executor: {
          model_map: {
            dev: { minimax: null, anthropic: 'claude-sonnet-4-20250514' },
            qa: { minimax: 'MiniMax-M2.5-highspeed', anthropic: null },
          },
        },
      },
    });

    // 设置 fs mock
    const fs = await import('fs');
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).includes('workers.config.json')) {
        return JSON.stringify(MOCK_WORKERS_CONFIG);
      }
      return '';
    });
  });

  it('返回 success:true 和 teams 数组', async () => {
    const res = await request(app).get('/api/brain/staff');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.teams)).toBe(true);
  });

  it('返回正确的 version 和 total_workers', async () => {
    const res = await request(app).get('/api/brain/staff');
    expect(res.body.version).toBe('3.0.0');
    expect(res.body.total_workers).toBe(2);
  });

  it('teams 中每个 team 包含 id, name, workers', async () => {
    const res = await request(app).get('/api/brain/staff');
    const team = res.body.teams[0];
    expect(team).toHaveProperty('id', 'core');
    expect(team).toHaveProperty('name', '核心团队');
    expect(Array.isArray(team.workers)).toBe(true);
    expect(team.workers.length).toBe(2);
  });

  it('worker skill=/dev 正确映射到 model_map.dev（anthropic）', async () => {
    const res = await request(app).get('/api/brain/staff');
    const workers = res.body.teams[0].workers;
    const caramel = workers.find(w => w.id === 'caramel');
    expect(caramel).toBeDefined();
    expect(caramel.model).toHaveProperty('provider', 'anthropic');
    expect(caramel.model).toHaveProperty('name', 'claude-sonnet-4-20250514');
    expect(caramel.model).toHaveProperty('full_map');
  });

  it('worker skill=/qa 正确映射到 model_map.qa（minimax）', async () => {
    const res = await request(app).get('/api/brain/staff');
    const workers = res.body.teams[0].workers;
    const xiaojian = workers.find(w => w.id === 'xiaojian');
    expect(xiaojian.model.provider).toBe('minimax');
    expect(xiaojian.model.name).toBe('MiniMax-M2.5-highspeed');
  });

  it('active profile 为 null 时 model.provider 和 model.name 均为 null', async () => {
    modelProfile.getActiveProfile.mockReturnValue(null);
    const res = await request(app).get('/api/brain/staff');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const worker = res.body.teams[0].workers[0];
    expect(worker.model.provider).toBeNull();
    expect(worker.model.name).toBeNull();
  });

  it('team 包含 area 和 department 字段', async () => {
    const res = await request(app).get('/api/brain/staff');
    const team = res.body.teams[0];
    expect(team).toHaveProperty('area', 'cecelia');
    expect(team).toHaveProperty('department', '核心团队');
  });

  it('response 包含 areas 对象', async () => {
    const res = await request(app).get('/api/brain/staff');
    expect(res.body).toHaveProperty('areas');
    expect(res.body.areas).toHaveProperty('cecelia');
    expect(res.body.areas.cecelia).toHaveProperty('name', 'Cecelia');
  });
});

// ── Tests: GET /api/brain/skills-registry ────────────────────

describe('GET /api/brain/skills-registry', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createApp();

    const fs = await import('fs');

    fs.readdirSync.mockImplementation((dir) => {
      const dirStr = String(dir);
      if (dirStr.includes('/skills')) {
        return [
          { name: 'dev', isDirectory: () => true, isSymbolicLink: () => false },
          { name: 'qa', isDirectory: () => true, isSymbolicLink: () => false },
          { name: 'not-a-skill', isDirectory: () => false, isSymbolicLink: () => false },
        ];
      }
      if (dirStr.includes('/agents')) {
        return [
          { name: 'cecelia', isDirectory: () => true, isSymbolicLink: () => false },
        ];
      }
      return [];
    });

    fs.existsSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.includes('/dev/SKILL.md')) return true;
      if (p.includes('/cecelia/SKILL.md')) return true;
      if (p.includes('/qa/SKILL.md')) return false;
      return false;
    });

    fs.readFileSync.mockImplementation(() => MOCK_SKILL_MD);
  });

  it('返回 success:true 和 skills/agents 数组', async () => {
    const res = await request(app).get('/api/brain/skills-registry');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(Array.isArray(res.body.agents)).toBe(true);
  });

  it('total 等于 skills + agents 数量之和', async () => {
    const res = await request(app).get('/api/brain/skills-registry');
    const { total, skills, agents } = res.body;
    expect(total).toBe(skills.length + agents.length);
  });

  it('只返回有 SKILL.md 的目录（qa 无 SKILL.md 应被过滤）', async () => {
    const res = await request(app).get('/api/brain/skills-registry');
    const skillIds = res.body.skills.map(s => s.id);
    expect(skillIds).toContain('dev');
    expect(skillIds).not.toContain('qa');
  });

  it('解析 SKILL.md frontmatter 中的 name/version/description', async () => {
    const res = await request(app).get('/api/brain/skills-registry');
    const devSkill = res.body.skills.find(s => s.id === 'dev');
    expect(devSkill).toBeDefined();
    expect(devSkill.name).toBe('Dev Skill');
    expect(devSkill.version).toBe('2.0.0');
    expect(devSkill.description).toBe('编程专家 Skill');
  });

  it('每个 skill 有 id, name, version, description, type=skill, path', async () => {
    const res = await request(app).get('/api/brain/skills-registry');
    const skill = res.body.skills[0];
    expect(skill).toHaveProperty('id');
    expect(skill).toHaveProperty('name');
    expect(skill).toHaveProperty('version');
    expect(skill).toHaveProperty('description');
    expect(skill.type).toBe('skill');
    expect(skill).toHaveProperty('path');
  });

  it('agents 的 type 为 agent', async () => {
    const res = await request(app).get('/api/brain/skills-registry');
    for (const agent of res.body.agents) {
      expect(agent.type).toBe('agent');
    }
  });
});
