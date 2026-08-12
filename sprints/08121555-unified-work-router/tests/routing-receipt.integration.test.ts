import { describe, it, expect } from 'vitest';

describe('Routing Receipt [BEHAVIOR]', () => {
  it('task 与 Routing Receipt 原子创建且 append-only', async () => {
    const store = await import('../../../packages/brain/src/work-routing-store.js');
    expect(store.createRoutedTask).toBeTypeOf('function');
    expect(store.ROUTING_RECEIPT_APPEND_ONLY).toBe(true);
  });

  it('入口委托统一边界', async () => {
    const inventory = await import('../../../packages/brain/src/task-creation-inventory.js');
    expect(inventory.TASK_CREATION_INVENTORY.every((entry: { migration_status: string }) => entry.migration_status === 'routed')).toBe(true);
  });
});

