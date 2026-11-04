/** 调用真实 requeueTask；只隔离数据库、文件和外部执行边界。 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query } }));
vi.mock('child_process', () => ({
  spawn: vi.fn(() => { throw new Error('external spawn forbidden'); }),
  exec: vi.fn(() => { throw new Error('external exec forbidden'); }),
  execSync: vi.fn(() => ''),
  execFile: vi.fn((...args) => { const cb = args.at(-1); if (typeof cb === 'function') cb(null, '', ''); }),
}));
vi.mock('fs', async (original) => {
  const actual = await original();
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  const root = resolve(process.cwd(), '../..');
  return { ...actual,
    readFileSync: vi.fn((file, ...args) => {
      const target = file instanceof URL ? fileURLToPath(file) : resolve(String(file));
      if (!target.startsWith(`${root}/`) || target.includes('/.env') || target.includes('credential')) {
        throw new Error('non-repository filesystem read forbidden');
      }
      return actual.readFileSync(file, ...args);
    }),
    existsSync: vi.fn(() => false), readdirSync: vi.fn(() => []), unlinkSync: vi.fn(),
  };
});
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn(), access: vi.fn() }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn() }));
let resolveRepoPath;
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external network forbidden'); }));
  ({ resolveRepoPath } = await import('../executor.js'));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => query.mockReset());
describe('resolveRepoPath current projects contract', () => {
  it.each([null, undefined, ''])('空id %s不读数据库', async id => {
    expect(await resolveRepoPath(id)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['/fixture/direct', '/fixture/metadata'])('返回projects查询解析出的路径 %s', async path => {
    query.mockResolvedValue({rows: [{repo_path: path}]});
    expect(await resolveRepoPath('project-id')).toBe(path);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT COALESCE\(repo_path, metadata->>'repo_path'\) AS repo_path\s+FROM projects WHERE id = \$1/),
      ['project-id']);
  });
  it.each([{rows:[]}, {rows:[{repo_path:null}]}, {rows:[{repo_path:''}]}])('不存在或无路径返回null', async result => {
    query.mockResolvedValue(result);
    expect(await resolveRepoPath('missing-project')).toBeNull();
  });
  it('数据库异常保持可观察', async () => {
    query.mockResolvedValue({rows:[]});
    query.mockRejectedValueOnce(new Error('isolated DB unavailable'));
    await expect(resolveRepoPath('project-id')).rejects.toThrow('isolated DB unavailable');
  });
});
