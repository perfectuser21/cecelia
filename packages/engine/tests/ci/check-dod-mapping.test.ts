import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 使用字面量路径以便覆盖率门禁静态分析能识别 import 关系
const { detectFakeTest } = require('../../scripts/devgate/check-dod-mapping.cjs');
const scriptPath = resolve(__dirname, '../../scripts/devgate/check-dod-mapping.cjs');

describe('check-dod-mapping - P2 Test Field Strength', () => {
  it('P2-001: detectFakeTest 导出可用', () => {
    expect(typeof detectFakeTest).toBe('function');
  });

  it('P2-002: 弱命令（纯列目录）返回 valid:false', () => {
    const result = detectFakeTest('ls src/');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('弱测试');
  });

  it('P2-003: 弱命令（纯读文件）返回 valid:false', () => {
    const result = detectFakeTest('cat package.json');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('弱测试');
  });

  it('P2-004: 恒真命令（true）返回 valid:false', () => {
    const result = detectFakeTest('true');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('永远成功');
  });

  it('P2-005: 恒真命令（exit 0）返回 valid:false', () => {
    const result = detectFakeTest('exit 0');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('永远成功');
  });

  it('P2-006: curl localhost 作为顶层命令返回 valid:false 并提示 CI 无服务器', () => {
    const result = detectFakeTest('curl localhost:5221/api/health');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('CI');
  });

  it('P2-007: curl 127.0.0.1 作为顶层命令返回 valid:false', () => {
    const result = detectFakeTest('curl 127.0.0.1:5221/api/brain/tasks');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('CI');
  });

  it('P2-008: 合规 node -e 命令通过检查', () => {
    const result = detectFakeTest(
      "node -e \"const c=require('fs').readFileSync('file','utf8');if(!c.includes('X'))process.exit(1)\""
    );
    expect(result.valid).toBe(true);
  });

  it('P2-009: curl 外部地址通过检查', () => {
    const result = detectFakeTest('curl -sf https://api.example.com/health');
    expect(result.valid).toBe(true);
  });

  it('P2-013: node -e 内含 curl localhost 字符串不被误拦截', () => {
    // node 命令内部的字符串引用不应触发 curl-to-localhost 检测
    const result = detectFakeTest(
      "node -e \"const m=require('./check.cjs');if(m.detectFakeTest('curl localhost:5221/').valid!==false)process.exit(1)\""
    );
    expect(result.valid).toBe(true);
  });

  it('P2-010: 脚本包含 P2-weak-inline 标记', () => {
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('P2-weak-inline');
  });

  it('P2-011: 脚本包含 curl-to-localhost 标记', () => {
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('curl-to-localhost');
  });

  it('P2-012: detectFakeTest 已导出（module.exports 包含）', () => {
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('detectFakeTest');
    // 验证已加入 module.exports
    expect(content).toMatch(/module\.exports\s*=.*detectFakeTest/);
  });
});
