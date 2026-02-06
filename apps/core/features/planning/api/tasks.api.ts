/**
 * Tasks API - 个人任务面板
 *
 * 对接后端 /api/tasks 端点
 * 支持查询、勾选、新增任务
 */

import { apiClient } from './client';

// ========== 类型定义 ==========

export interface Task {
  id: string;
  title: string;
  due: string | null;
  done: boolean;
  url: string;
  assignee: string;
  priority: string | null;  // 高/中/低
  highlight: boolean;       // 每日亮点
  stage: string | null;     // 阶段
  notes: string | null;     // 备注
}

export interface TaskUser {
  id: string;
  name: string;
}

export type TaskRange = 'today' | 'week' | 'all';

export interface QueryTasksParams {
  name?: string;
  range?: TaskRange;
  includeDone?: boolean;
  includeNoDue?: boolean;
}

export interface CreateTaskData {
  title: string;
  due?: string; // YYYY-MM-DD
  assigneeName: string;
  priority?: '高' | '中' | '低';
  highlight?: boolean;
}

// ========== API 函数 ==========

/**
 * 查询任务列表
 */
export async function fetchTasks(params: QueryTasksParams = {}): Promise<Task[]> {
  try {
    const { data } = await apiClient.get<{ success: boolean; tasks: Task[]; error?: string }>(
      '/tasks/personal',
      {
        params: {
          name: params.name,
          range: params.range,
          includeDone: params.includeDone ? 'true' : undefined,
          includeNoDue: params.includeNoDue ? 'true' : undefined,
        },
        timeout: 8000,
      }
    );

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch tasks');
    }

    return data.tasks;
  } catch {
    return [];
  }
}

/**
 * 获取用户列表
 */
export async function fetchTaskUsers(): Promise<TaskUser[]> {
  const { data } = await apiClient.get<{ success: boolean; users: TaskUser[] }>('/tasks/users');

  if (!data.success) {
    throw new Error('Failed to fetch users');
  }

  return data.users;
}

/**
 * 更新任务完成状态
 */
export async function updateTaskStatus(taskId: string, done: boolean): Promise<Task> {
  const { data } = await apiClient.patch<{ success: boolean; task: Task; error?: string }>(
    `/tasks/${taskId}`,
    { done }
  );

  if (!data.success) {
    throw new Error(data.error || 'Failed to update task');
  }

  return data.task;
}

/**
 * 更新任务截止日期
 */
export async function updateTaskDue(taskId: string, due: string | null): Promise<Task> {
  const { data } = await apiClient.patch<{ success: boolean; task: Task; error?: string }>(
    `/tasks/${taskId}`,
    { due }
  );

  if (!data.success) {
    throw new Error(data.error || 'Failed to update task due date');
  }

  return data.task;
}

/**
 * 创建新任务
 */
export async function createTask(taskData: CreateTaskData): Promise<Task> {
  const { data } = await apiClient.post<{ success: boolean; task: Task; error?: string }>(
    '/tasks',
    taskData
  );

  if (!data.success) {
    throw new Error(data.error || 'Failed to create task');
  }

  return data.task;
}

// ========== 导出 ==========

export const tasksApi = {
  fetchTasks,
  fetchTaskUsers,
  updateTaskStatus,
  createTask,
};
