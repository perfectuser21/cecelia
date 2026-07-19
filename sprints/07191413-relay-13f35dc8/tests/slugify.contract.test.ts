import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import path from 'node:path';

// 先解析测试文件真实路径，再回溯三级目录到 repo root：
// tests/ -> 07191413-relay-13f35dc8/ -> sprints/ -> repo root
const testFileRealPath = realpathSync(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(path.dirname(testFileRealPath), '../../..');
const scriptPath = path.join(workspaceRoot, 'scripts/relay-demo/slugify.mjs');

function runSlugify(input: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [scriptPath, input], { encoding: 'utf8' });
    return { stdout: stdout.replace(/\n$/, ''), status: 0 };
  } catch (err: any) {
    return { stdout: String(err.stdout ?? ''), status: err.status ?? 1 };
  }
}

describe('slugify.mjs [BEHAVIOR]', () => {
  it('空字符串输入返回空字符串', () => {
    const { stdout, status } = runSlugify('');
    expect(status).toBe(0);
    expect(stdout).toBe('');
  });

  it('普通短语转换为小写连字符 slug', () => {
    const { stdout, status } = runSlugify('Hello, World!');
    expect(status).toBe(0);
    expect(stdout).toBe('hello-world');
  });

  it('连续分隔符与非 ASCII 字符折叠为单个连字符', () => {
    const { stdout, status } = runSlugify('  Hello   世界---World  ');
    expect(status).toBe(0);
    expect(stdout).toBe('hello-world');
  });
});
