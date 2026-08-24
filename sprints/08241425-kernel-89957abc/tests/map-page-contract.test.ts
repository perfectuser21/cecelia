import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// 冻结合同锚点（TDD Red）：本 sprint 把 /map 升级为 mind-elixir 三层脑图。
// 运行于仓库根 vitest（include sprints/**），node 环境，仅用 fs 读源码，
// 不依赖 dashboard 的 @features 别名 / happy-dom（那些由 dashboard vitest 覆盖）。
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, `file://${repoRoot}`), 'utf8');

describe('系统总图页 /map 现算脑图合同 [BEHAVIOR]', () => {
  it('mind-elixir 依赖已声明于 apps/dashboard/package.json（MIT 脑图库）', () => {
    const pkg = JSON.parse(read('apps/dashboard/package.json'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    // RED：当前无 mind-elixir；GREEN：generator 加入依赖后满足。
    expect(deps['mind-elixir']).toBeTypeOf('string');
  });

  it('MapPage 接入 mind-elixir 渲染脑图（不是纯列表/表格视图）', () => {
    const src = read('apps/api/features/planning/pages/MapPage.tsx');
    // RED：当前 MapPage 未引用 mind-elixir；GREEN：接入后源码含 mind-elixir 引用。
    expect(/mind-elixir/.test(src)).toBe(true);
  });

  it('/map 仅由 planning manifest 注册（system-hub 不注册，keep-green 不变量）', () => {
    const planning = read('apps/api/features/planning/index.ts');
    const systemHub = read('apps/api/features/system-hub/index.ts');
    // planning 注册 /map → component MapPage
    expect(/path:\s*'\/map'/.test(planning)).toBe(true);
    expect(/component:\s*'MapPage'/.test(planning)).toBe(true);
    // system-hub 不得出现独立的 '/map' 路由注册（'/system/feature-map' 等其它路径不算）
    expect(/path:\s*'\/map'/.test(systemHub)).toBe(false);
  });
});
