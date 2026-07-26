import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const COMPOSE_PATH = new URL('../../../../../docker-compose.yml', import.meta.url);

describe('production Kernel capability inputs', () => {
  it('declares the canonical controller and every verified local credential home', async () => {
    const compose = await readFile(COMPOSE_PATH, 'utf8');

    expect(compose).toContain(
      '- CECELIA_MACHINE_ID=${CECELIA_MACHINE_ID:-us-mac-m4}',
    );
    for (const account of ['team1', 'team2', 'team3', 'team4', 'team5']) {
      expect(compose).toContain(
        `- /Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:ro`,
      );
    }
    expect(compose).toContain(
      '- /Users/administrator/.grok:/Users/administrator/.grok:ro',
    );
  });
});
