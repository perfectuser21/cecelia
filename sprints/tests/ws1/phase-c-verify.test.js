import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';

// B41 Phase C 验证：playground/tests/echo.test.js 必须已更新为正确 schema
// TDD Red：当前文件仍含 {echo: "hello"} 期望 → 本测试全失败
// TDD Green：WS1 修复后，playground/tests/echo.test.js 改为 {msg: "hello"} → 通过
const content = readFileSync('playground/tests/echo.test.js', 'utf8');

describe('B41 Phase C 验证 — playground/tests/echo.test.js schema 合规 [BEHAVIOR]', () => {
  test('不得期望 {echo: "hello"} 作为 response 字段（禁用 key 验证）', () => {
    expect(content).not.toMatch(/toEqual\(\s*\{\s*echo:/);
  });

  test('必须期望 {msg: "hello"} 作为 response 字段（PRD 规定 key）', () => {
    expect(content).toMatch(/toEqual\(\s*\{\s*msg:/);
  });

  test('keys assertion 必须是 ["msg"] 不是 ["echo"]', () => {
    expect(content).not.toMatch(/toEqual\(\s*\[['"]echo['"]\]\)/);
    expect(content).toMatch(/toEqual\(\s*\[['"]msg['"]\]\)/);
  });
});
