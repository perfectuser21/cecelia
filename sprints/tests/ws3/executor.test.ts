import { describe, it, expect } from 'vitest';

describe('WS3 — executor.js / initiativeRunEvents.js [BEHAVIOR]', () => {
  it('initiativeRunEvents.js 导出 writeInitiativeRunEvent 函数', async () => {
    const mod = await import('../../../../packages/brain/src/events/initiativeRunEvents.js');
    expect(typeof mod.writeInitiativeRunEvent).toBe('function');
  });

  it('writeInitiativeRunEvent 以合法参数调用不抛出（写入 DB 行）', async () => {
    const { writeInitiativeRunEvent } = await import(
      '../../../../packages/brain/src/events/initiativeRunEvents.js'
    );
    await expect(
      writeInitiativeRunEvent({
        initiativeId: 'cccccccc-dddd-eeee-ffff-aa0000000099',
        node: 'proposer',
        label: 'Proposer',
        attempt: 1,
      })
    ).resolves.not.toThrow();
  });
});
