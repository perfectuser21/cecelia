#!/usr/bin/env node
/**
 * MiniMax Executor - 调用 MiniMax API 执行任务
 * 部署在 HK VPS，处理 talk/research/automation 类型任务
 *
 * v2: 支持加载 Skills（从 ~/.claude/skills/ 目录）
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.MINIMAX_PORT || 5226;

// Skills 目录
const SKILLS_DIR = process.env.SKILLS_DIR || path.join(process.env.HOME, '.claude', 'skills');

// 读取 API Key
function getApiKey() {
  const credPath = process.env.MINIMAX_CREDENTIALS ||
    path.join(process.env.HOME, '.credentials', 'minimax.json');

  if (fs.existsSync(credPath)) {
    const cred = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    return cred.api_key;
  }
  return process.env.MINIMAX_API_KEY;
}

const API_KEY = getApiKey();
const API_URL = 'https://api.minimax.chat/v1/text/chatcompletion_v2';

/**
 * 加载 Skill 内容
 * @param {string} skillName - Skill 名称（目录名）
 * @returns {string|null} - Skill 内容或 null
 */
function loadSkill(skillName) {
  if (!skillName) return null;

  // 尝试多种路径
  const possiblePaths = [
    path.join(SKILLS_DIR, skillName, 'SKILL.md'),
    path.join(SKILLS_DIR, skillName, 'skill.md'),
    path.join(SKILLS_DIR, `${skillName}.md`),
  ];

  for (const skillPath of possiblePaths) {
    if (fs.existsSync(skillPath)) {
      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        console.log(`[MiniMax] Loaded skill: ${skillName} from ${skillPath}`);
        return content;
      } catch (err) {
        console.error(`[MiniMax] Failed to read skill: ${err.message}`);
      }
    }
  }

  console.log(`[MiniMax] Skill not found: ${skillName}`);
  return null;
}

/**
 * 获取可用的 Skills 列表
 */
function listSkills() {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      return [];
    }
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          skills.push(entry.name);
        }
      }
    }
    return skills;
  } catch {
    return [];
  }
}

// 调用 MiniMax API
async function callMiniMax(messages, tools = null) {
  const body = {
    model: 'MiniMax-Text-01',
    messages,
    temperature: 0.7,
    max_tokens: 4096,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  return new Promise((resolve, reject) => {
    const url = new URL(API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Task type → Skill 映射
const TASK_TYPE_SKILL_MAP = {
  'talk': 'talk',
  'research': null,  // 纯研究不需要特定 skill
  'automation': 'nobel',
  'repo-lead': 'repo-lead',
};

// 执行任务
async function executeTask(task) {
  const { id, title, description, task_type, skill } = task;

  console.log(`[MiniMax] Executing task: ${title} (type: ${task_type})`);

  // 确定要加载的 skill
  const skillName = skill || TASK_TYPE_SKILL_MAP[task_type];
  const skillContent = loadSkill(skillName);

  // 构建 prompt
  let systemPrompt = getSystemPrompt(task_type);

  // 注入 skill 内容
  if (skillContent) {
    systemPrompt = `${systemPrompt}

---

# Skill: ${skillName}

以下是你需要遵循的 Skill 指令：

${skillContent}

---
`;
  }

  const userPrompt = `
任务ID: ${id}
任务标题: ${title}
任务描述: ${description || '无'}

请根据上述 Skill 指令完成这个任务。
`.trim();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const response = await callMiniMax(messages);

    if (response.base_resp?.status_code !== 0) {
      throw new Error(response.base_resp?.status_msg || 'API error');
    }

    const content = response.choices?.[0]?.message?.content || '';

    return {
      success: true,
      task_id: id,
      result: content,
      usage: response.usage,
      skill_loaded: skillName || null,
    };
  } catch (error) {
    console.error(`[MiniMax] Error: ${error.message}`);
    return {
      success: false,
      task_id: id,
      error: error.message,
    };
  }
}

// 根据任务类型获取系统 prompt
function getSystemPrompt(taskType) {
  switch (taskType) {
    case 'talk':
      return `你是 Cecelia 的对话助手，负责与用户进行自然对话。
你的特点：
- 简洁不废话
- 理解用户意图
- 适当提问以获取更多信息
- 记录重要信息供后续使用`;

    case 'research':
      return `你是 Cecelia 的研究助手，负责分析和研究任务。
你的特点：
- 深入分析问题
- 提供有理有据的结论
- 列出关键发现
- 给出可行建议`;

    case 'automation':
      return `你是 Cecelia 的自动化助手，负责设计和规划自动化流程。
你的特点：
- 分析自动化需求
- 设计工作流步骤
- 识别所需工具和 API
- 提供实施方案`;

    case 'repo-lead':
      return `你是仓库主管 (Repo Lead)，负责管理特定仓库的开发工作。
你的职责：
- 承接新部门，建 OKR
- 日常运营，拆 Tasks，派活，写日报
- 验收产出
- 向上汇报`;

    default:
      return `你是 Cecelia 的 AI 助手，帮助完成各种任务。`;
  }
}

// HTTP 服务器
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    const skills = listSkills();
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      service: 'minimax-executor',
      version: '2.0.0',
      hasApiKey: !!API_KEY,
      skillsDir: SKILLS_DIR,
      skillsAvailable: skills.length,
    }));
    return;
  }

  // List skills
  if (req.url === '/skills' && req.method === 'GET') {
    const skills = listSkills();
    res.writeHead(200);
    res.end(JSON.stringify({
      skills,
      skillsDir: SKILLS_DIR,
    }));
    return;
  }

  // Test endpoint
  if (req.url === '/test' && req.method === 'GET') {
    try {
      const response = await callMiniMax([
        { role: 'user', content: '你好，请用一句话介绍自己。' }
      ]);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        response: response.choices?.[0]?.message?.content,
        usage: response.usage,
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }

  // Test skill loading
  if (req.url.startsWith('/test-skill/') && req.method === 'GET') {
    const skillName = req.url.replace('/test-skill/', '');
    const skillContent = loadSkill(skillName);
    if (skillContent) {
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        skill: skillName,
        contentLength: skillContent.length,
        preview: skillContent.slice(0, 500) + '...',
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: 'Skill not found' }));
    }
    return;
  }

  // Execute task
  if (req.url === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const task = JSON.parse(body);
        const result = await executeTask(task);
        res.writeHead(result.success ? 200 : 500);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  const skills = listSkills();
  console.log(`[MiniMax Executor] v2.0.0 - Listening on port ${PORT}`);
  console.log(`[MiniMax Executor] API Key: ${API_KEY ? 'configured' : 'MISSING!'}`);
  console.log(`[MiniMax Executor] Skills Dir: ${SKILLS_DIR}`);
  console.log(`[MiniMax Executor] Skills Available: ${skills.length} (${skills.slice(0, 5).join(', ')}${skills.length > 5 ? '...' : ''})`);
});
