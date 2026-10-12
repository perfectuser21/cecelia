import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileTool } from '../lib/codex-files.mjs';

describe('Codex 无 shell 规格活动的只读文件工具', () => {
  it('读取和列举真实文件，不提供写入或执行工具', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-files-'));
    fs.writeFileSync(path.join(root, 'code.mjs'), 'export const answer = 42;');
    expect(fileTool(root, 'read_file', { path: 'code.mjs' })).toContain('answer = 42');
    expect(fileTool(root, 'list_files', {})).toContain('code.mjs');
    expect(() => fileTool(root, 'execute', { command: 'echo bad' })).toThrow(/unknown_tool/);
    expect(() => fileTool(root, 'write_file', { path: 'code.mjs' })).toThrow(/unknown_tool/);
  });
  it('拒绝越界、指向外部的符号链接与凭据文件', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-files-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-outside-'));
    fs.writeFileSync(path.join(outside, 'secret'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'link'));
    fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret');
    expect(() => fileTool(root, 'read_file', { path: '../secret' })).toThrow(/outside/);
    expect(() => fileTool(root, 'read_file', { path: 'link' })).toThrow(/outside/);
    expect(() => fileTool(root, 'read_file', { path: '.env' })).toThrow(/denied/);
  });
});
