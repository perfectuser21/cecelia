/**
 * Executor - Initiative prompt 测试
 *
 * DoD 覆盖: D2
 *
 * 验证 preparePrompt 对 initiative_plan 和 initiative_verify 类型生成正确的 prompt。
 */

import { describe, it, expect } from 'vitest';
import { preparePrompt } from '../executor.js';

describe('executor initiative prompts', () => {
  describe('initiative_plan prompt', () => {
    it('D2: includes initiative name and description', async () => {
      const task = {
        id: 'task-1',
        task_type: 'initiative_plan',
        title: 'Plan: Test Initiative',
        description: 'Build authentication system',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: {
          initiative_name: 'Test Initiative',
          initiative_description: 'Build authentication system',
          repo_path: '/home/xx/project',
          dod_content: ['API endpoint exists', 'Tests pass'],
        },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('Test Initiative');
      expect(prompt).toContain('Build authentication system');
      expect(prompt).toContain('init-1');
    });

    it('D2: includes DoD items', async () => {
      const task = {
        id: 'task-1',
        task_type: 'initiative_plan',
        title: 'Plan: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: {
          dod_content: ['API endpoint exists', 'Tests pass', 'Documentation updated'],
          repo_path: '/repo',
        },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('1. API endpoint exists');
      expect(prompt).toContain('2. Tests pass');
      expect(prompt).toContain('3. Documentation updated');
    });

    it('D2: includes repo_path', async () => {
      const task = {
        id: 'task-1',
        task_type: 'initiative_plan',
        title: 'Plan: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: {
          dod_content: [],
          repo_path: '/home/xx/perfect21/cecelia/core',
        },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('/home/xx/perfect21/cecelia/core');
    });

    it('D2: includes Brain API endpoint', async () => {
      const task = {
        id: 'task-1',
        task_type: 'initiative_plan',
        title: 'Plan: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: { dod_content: [] },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('http://localhost:5221');
    });

    it('D2: includes create task curl template with draft status', async () => {
      const task = {
        id: 'task-1',
        task_type: 'initiative_plan',
        title: 'Plan: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: { dod_content: [] },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('"status": "draft"');
      expect(prompt).toContain('target_files');
      expect(prompt).toContain('dod_refs');
    });

    it('D2: handles object DoD content', async () => {
      const task = {
        id: 'task-1',
        task_type: 'initiative_plan',
        title: 'Plan: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: {
          dod_content: [
            { criterion: 'API works', description: 'REST API returns 200' },
            { criterion: 'Tests pass' },
          ],
        },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('API works');
      expect(prompt).toContain('Tests pass');
    });
  });

  describe('initiative_verify prompt', () => {
    it('D2: includes initiative name and DoD', async () => {
      const task = {
        id: 'task-2',
        task_type: 'initiative_verify',
        title: 'Verify: Test Initiative',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: {
          initiative_name: 'Test Initiative',
          dod_content: ['API works', 'Tests pass'],
          dev_tasks: [
            { id: 't1', title: 'Implement API', status: 'completed' },
          ],
        },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('Test Initiative');
      expect(prompt).toContain('1. API works');
      expect(prompt).toContain('2. Tests pass');
    });

    it('D2: includes completed dev tasks list', async () => {
      const task = {
        id: 'task-2',
        task_type: 'initiative_verify',
        title: 'Verify: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: {
          dod_content: ['test'],
          dev_tasks: [
            { id: 't1', title: 'Dev Task 1', status: 'completed' },
            { id: 't2', title: 'Dev Task 2', status: 'completed' },
          ],
        },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('Dev Task 1');
      expect(prompt).toContain('Dev Task 2');
      expect(prompt).toContain('completed');
    });

    it('D2: includes verification output format', async () => {
      const task = {
        id: 'task-2',
        task_type: 'initiative_verify',
        title: 'Verify: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: { dod_content: [], dev_tasks: [] },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('all_dod_passed');
      expect(prompt).toContain('dod_results');
      expect(prompt).toContain('fix_suggestion');
    });

    it('D2: handles empty dev tasks', async () => {
      const task = {
        id: 'task-2',
        task_type: 'initiative_verify',
        title: 'Verify: Test',
        project_id: 'init-1',
        goal_id: 'kr-1',
        payload: { dod_content: ['test'] },
      };

      const prompt = await preparePrompt(task);
      expect(prompt).toContain('（无）');
    });
  });
});
