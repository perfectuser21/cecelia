import { describe, expect, it } from 'vitest';

import * as intent from '../intent.js';

describe('Intent routing source identity', () => {
  it('uses an explicit source namespace without changing the legacy default', () => {
    expect(intent.buildIntentTaskSourceId).toBeTypeOf('function');
    expect(intent.buildIntentTaskSourceId({
      sourceIdPrefix: 'smoke:abc123',
      projectId: null,
      taskIndex: 2,
      taskTitle: '修复路由',
    })).toBe('smoke:abc123:2:修复路由');
    expect(intent.buildIntentTaskSourceId({
      projectId: null,
      taskIndex: 2,
      taskTitle: '修复路由',
    })).toBe('intent:unbound:2:修复路由');
    expect(intent.buildIntentTaskTitle({
      taskTitlePrefix: '[smoke-abc123]',
      taskTitle: '修复路由',
    })).toBe('[smoke-abc123] 修复路由');
    expect(intent.buildIntentTaskTitle({ taskTitle: '修复路由' })).toBe('修复路由');
  });
});
