import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

it('生效staging服务配置隔离数据库并双重禁止任务调度，注释不算配置', () => {
  const compose = load(readFileSync(new URL('../../../../docker-compose.staging.yml', import.meta.url), 'utf8'));
  const service = compose.services['node-brain-staging'];
  const environment = Object.fromEntries(service.environment.map(entry => {
    const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)];
  }));
  expect(compose.name).toBe('cecelia-staging');
  expect(environment).toMatchObject({
    DB_NAME: 'cecelia_staging', BRAIN_PORT: '5222',
    CECELIA_TICK_HARD_OFF: '1', CECELIA_TICK_ENABLED: 'false',
  });
});
