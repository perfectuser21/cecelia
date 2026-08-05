import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const COMPOSE_PATH = new URL('../../../../../docker-compose.yml', import.meta.url);
const DEPLOY_PATH = new URL('../../../../../scripts/brain-deploy.sh', import.meta.url);
const SIDECAR_PATH = new URL('../../../../../scripts/lib/bluegreen-sidecar.sh', import.meta.url);
const ENV_EXAMPLE_PATH = new URL('../../../../../.env.docker.example', import.meta.url);

describe('production Kernel capability inputs', () => {
  it('declares the canonical controller and every verified local credential home', async () => {
    const compose = await readFile(COMPOSE_PATH, 'utf8');

    expect(compose).toContain(
      '- CECELIA_MACHINE_ID=${CECELIA_MACHINE_ID:-us-mac-m4}',
    );
    // codex 0.146 起 CODEX_HOME 必须可写（cache/sessions/locks），:ro 挂载启动即死（决策 c62c423a）
    for (const account of ['team1', 'team2', 'team3', 'team4', 'team5']) {
      expect(compose).toContain(
        `- /Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:rw`,
      );
      expect(compose).not.toContain(
        `- /Users/administrator/.codex-${account}:/Users/administrator/.codex-${account}:ro`,
      );
    }
    expect(compose).toContain(
      '- /Users/administrator/.grok:/Users/administrator/.grok:ro',
    );
  });

  it('wires the unified Fleet Worker transport fail-closed for production', async () => {
    const [compose, deploy, sidecar, envExample] = await Promise.all([
      readFile(COMPOSE_PATH, 'utf8'),
      readFile(DEPLOY_PATH, 'utf8'),
      readFile(SIDECAR_PATH, 'utf8'),
      readFile(ENV_EXAMPLE_PATH, 'utf8'),
    ]);

    expect(compose).toContain(
      '- KERNEL_FLEET_REMOTE_ENABLED=${KERNEL_FLEET_REMOTE_ENABLED:-true}',
    );
    expect(compose).toContain(
      '- KERNEL_FLEET_BRIDGE_TOKEN=${KERNEL_FLEET_BRIDGE_TOKEN:-}',
    );
    expect(compose).toContain(
      '- KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL=${KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL:-http://100.71.151.105:5221}',
    );
    expect(deploy).toMatch(
      /docker compose --env-file "\$ROOT_DIR\/\.env\.docker" \\\s+-f "\$ROOT_DIR\/docker-compose\.yml" up -d/,
    );
    const sidecarComposeCalls = sidecar.match(
      /docker compose --env-file "\$DEPLOY_ROOT\/\.env\.docker" \\\s+-f "\$DEPLOY_ROOT\/docker-compose\.yml" up -d node-brain/g,
    );
    expect(sidecarComposeCalls).toHaveLength(2);
    expect(envExample).toContain('KERNEL_FLEET_BRIDGE_TOKEN=replace-with-worker-bearer-token');
  });
});
