/** crystal.test.js — 判官路由面配对测试(lint-test-pairing):四端点挂载齐全 */
import { describe, it, expect } from 'vitest';
import crystalRouter from '../crystal.js';

function routesOf(router) {
  return router.stack
    .filter((l) => l.route)
    .flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));
}

describe('crystal 路由挂载', () => {
  it('四端点齐:POST /run, GET /report, POST /locator, POST /evidence/validate', () => {
    const rs = routesOf(crystalRouter);
    expect(rs).toContain('POST /run');
    expect(rs).toContain('GET /report');
    expect(rs).toContain('POST /locator');
    expect(rs).toContain('POST /evidence/validate');
  });
});
