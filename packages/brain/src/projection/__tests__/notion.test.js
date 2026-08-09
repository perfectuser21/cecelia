import { describe, expect, it } from 'vitest';
import { buildNotionTaskProperties, commandFromNotionTask } from '../notion.js';

describe('Notion projection', () => {
  it('maps a queued Brain task and turns a Notion drag into a start request', () => {
    const properties = buildNotionTaskProperties({
      id: 'task-1', title: 'Workbench', status: 'queued', priority: 'P0', task_type: 'dev',
    }, 'project-page-1');

    expect(properties.Status.select.name).toBe('Waiting');
    expect(properties.Project.relation).toEqual([{ id: 'project-page-1' }]);
    expect(commandFromNotionTask({ notionStatus: 'In Progress', brainStatus: 'queued' })).toBe('start_requested');
  });
});
