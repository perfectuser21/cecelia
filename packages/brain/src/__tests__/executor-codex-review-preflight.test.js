/** 容器Codex安装/挂载配置；缺binary的执行拒绝由prepare-prompt-refactor验证。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const executorSrc = readFileSync(
  join(__dirname, '../executor.js'),
  'utf8'
);

describe('triggerCodexReview: codex binary 存在性预检', () => {
  it('CODEX_BIN env 优先于硬编码默认值（容器路径 vs host 路径）', () => {
    expect(executorSrc).toContain('process.env.CODEX_BIN');
    // host fallback 仍是 /opt/homebrew/bin/codex（兼容本机开发）
    expect(executorSrc).toContain('/opt/homebrew/bin/codex');
  });
});

describe('Dockerfile / docker-compose 配置闭环', () => {
  const dockerfileSrc = readFileSync(
    join(__dirname, '../../Dockerfile'),
    'utf8'
  );
  const composeSrc = readFileSync(
    join(__dirname, '../../../../docker-compose.yml'),
    'utf8'
  );

  it('Dockerfile Stage 2 安装 @openai/codex', () => {
    expect(dockerfileSrc).toMatch(/npm install -g @openai\/codex/);
  });

  it('docker-compose.yml mount /Users/administrator/.codex-team1 可写（codex 0.146 起启动需写 cache/sessions，决策 c62c423a）', () => {
    expect(composeSrc).toContain('/Users/administrator/.codex-team1:/Users/administrator/.codex-team1:rw');
    expect(composeSrc).not.toContain('/Users/administrator/.codex-team1:/Users/administrator/.codex-team1:ro');
  });

  it('docker-compose.yml 设置 CODEX_BIN env 指向容器内路径', () => {
    expect(composeSrc).toContain('CODEX_BIN=/usr/local/bin/codex');
  });

  it('docker-compose.yml 设置 CODEX_HOME env', () => {
    expect(composeSrc).toContain('CODEX_HOME=/Users/administrator/.codex-team1');
  });
});
