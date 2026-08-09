import { describe, expect, it } from 'vitest';
import { buildNotionProjectProperties, buildNotionTaskProperties, commandFromNotionTask } from '../projection/notion.js';

describe('Notion task/project projection mapping', () => {
  it('task 映射保留 Brain ID、状态、优先级和 Project relation', () => {
    const props = buildNotionTaskProperties({
      id: 'task-1', title: '修复主链', status: 'queued', priority: 'P0', task_type: 'dev',
    }, 'project-page-1');
    expect(props.Name.title[0].text.content).toBe('修复主链');
    expect(props['Brain ID'].rich_text[0].text.content).toBe('task-1');
    expect(props.Status.select.name).toBe('Waiting');
    expect(props.Project.relation).toEqual([{ id: 'project-page-1' }]);
    expect(props.Command.select.name).toBe('None');
    expect(props.Note.rich_text).toEqual([]);
  });

  it('project 使用独立数据库属性', () => {
    const props = buildNotionProjectProperties({ id: 'project-1', title: 'Workbench', status: 'active' });
    expect(props.Name.title[0].text.content).toBe('Workbench');
    expect(props['Brain ID'].rich_text[0].text.content).toBe('project-1');
  });

  it('Notion 把 Waiting 拖到 In Progress 只产生 start_requested', () => {
    expect(commandFromNotionTask({ notionStatus: 'In Progress', brainStatus: 'queued' })).toBe('start_requested');
    expect(commandFromNotionTask({ notionStatus: 'Done', brainStatus: 'queued' })).toBeNull();
  });
});
