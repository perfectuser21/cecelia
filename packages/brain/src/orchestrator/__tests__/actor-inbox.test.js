import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { createActorInbox } from '../actor-inbox.js';

const validMessage = {
  schema: 'harness-actor-message/v1',
  message_id: randomUUID(),
  run_id: randomUUID(),
  sender_role: 'commander',
  recipient_role: 'planner',
  thread_id: randomUUID(),
  correlation_id: randomUUID(),
  source_attempt_id: null,
  event_cursor: 0,
  message_type: 'instruction',
  payload: { guidance: 'Inspect the approved constraints.' },
  evidence_refs: [],
  dedupe_key: 'commander:planner:1',
};

describe('Harness Actor Inbox boundaries', () => {
  it('rejects self-addressed and side-effect messages before opening a transaction', async () => {
    const pool = { connect: vi.fn() };
    const inbox = createActorInbox(pool);

    await expect(inbox.send({
      ...validMessage,
      recipient_role: 'commander',
    })).rejects.toThrow('actor_sender_recipient_must_differ');
    await expect(inbox.send({
      ...validMessage,
      payload: { command: 'gh pr merge 1' },
    })).rejects.toThrow('actor_side_effect_forbidden');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('does not import or query the global Capture Inbox', () => {
    const source = readFileSync(new URL('../actor-inbox.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/capture_atoms|conversation_captures|capture inbox/i);
  });
});
