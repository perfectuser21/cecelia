#!/usr/bin/env node
/**
 * 临时脚本：为 Initiative「PR 执行流水线稳定化」创建下一个 dev 任务
 */

import pool from './src/db.js';

async function createTask() {
  const title = '实现 PR 合并后自动回调任务状态更新机制';
  const description = `## 背景

当前 PR 执行流水线存在严重的状态同步问题：dev 任务创建 PR 并成功合并后，Brain 无法自动感知完成状态，导致任务永远停留在 in_progress，无法统计端到端成功率。

## 具体需求

### 1. GitHub Webhook 监听 PR 合并事件

在 Brain 中实现 \`/api/brain/webhooks/github\` 端点：
- 监听 \`pull_request.closed\` 事件
- 验证 PR 是否 merged（不是直接 closed）
- 从 PR body 或 branch name 提取 task_id

### 2. 自动更新任务状态

当检测到 PR 合并时：
- 查询 tasks 表中对应的任务（通过 task_id）
- 更新状态为 completed
- 记录完成时间（completed_at）
- 在 metadata 中记录 PR 链接和合并信息

### 3. 分支命名规范强制

确保所有 /dev 创建的分支包含 task_id：
- 格式：\`cp-YYYYMMDD-<task_id>\`
- 在 /dev skill 中强制使用此格式
- webhook 解析时优先从分支名提取 task_id

### 4. 安全性

- 验证 GitHub webhook signature（HMAC SHA-256）
- 仅处理来自已知仓库的事件
- 记录所有 webhook 调用日志

## 成功标准

- ✅ Brain 能接收 GitHub webhook 并验证签名
- ✅ PR 合并后 3 秒内自动更新任务状态为 completed
- ✅ 在 cecelia-core 仓库测试端到端流程：创建任务 → /dev 执行 → PR 合并 → 状态自动更新
- ✅ webhook 调用失败时有明确的错误日志
- ✅ 不影响现有任务派发和执行流程

## 技术要点

- Brain API 路由：packages/brain/src/routes/webhooks.js
- 任务状态更新：复用现有 updateTaskStatus() 函数
- 日志：使用 Brain logger，记录到 webhook_logs 表
- 测试：创建一个真实 PR 并合并，观察任务状态变化`;

  const projectId = 'f1431b18-660b-4b53-8065-e79e1dac4a4c'; // PR 执行流水线稳定化
  const goalId = 'e5ec0510-d7b2-4ee7-99f6-314aac55b3f6'; // 所属 KR
  const priority = 'P1';
  const taskType = 'dev';

  try {
    // 去重检查
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, [title, goalId, projectId]);

    if (dedupResult.rows.length > 0) {
      const existing = dedupResult.rows[0];
      console.log(`任务已存在：${existing.id} (状态: ${existing.status})`);
      await pool.end();
      return existing;
    }

    // 创建任务
    const result = await pool.query(`
      INSERT INTO tasks (
        title,
        description,
        priority,
        project_id,
        goal_id,
        task_type,
        status,
        trigger_source
      ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', 'initiative_plan')
      RETURNING *
    `, [title, description, priority, projectId, goalId, taskType]);

    const task = result.rows[0];
    console.log(`✅ 任务创建成功！`);
    console.log(`ID: ${task.id}`);
    console.log(`标题: ${task.title}`);
    console.log(`状态: ${task.status}`);
    console.log(`优先级: ${task.priority}`);
    console.log(`类型: ${task.task_type}`);

    await pool.end();
    return task;
  } catch (error) {
    console.error('创建任务失败:', error.message);
    await pool.end();
    throw error;
  }
}

createTask().catch(console.error);
