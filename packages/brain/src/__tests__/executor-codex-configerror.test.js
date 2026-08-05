import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(path.join(__dirname, '..', 'executor.js'), 'utf8');

// 守卫：codex 环境级致命错误必须走 configError 安全回队，不得烧任务（决策 e9cf7877）
describe('triggerCodexReview configError 接线', () => {
  it('收集 stderr（旧实现只收 stdout，环境错误原文进不了分类）', () => {
    expect(executorSrc).toMatch(/child\.stderr\?\.on\('data'/);
  });

  it('exit handler 调用 classifyCodexFailure 分类', () => {
    expect(executorSrc).toMatch(/classifyCodexFailure\(/);
    expect(executorSrc).toMatch(/from '\.\/lib\/codex-fatal-patterns\.js'/);
  });

  it('命中时带状态守卫回队（防迟到竞态）', () => {
    expect(executorSrc).toMatch(/status IN \('in_progress','dispatched'\)/);
  });

  it('回队计数上限（防快速空转风暴）', () => {
    expect(executorSrc).toMatch(/codex_config_error_count/);
  });

  it('响亮告警 codex_config_error（P1 回队 / P0 封顶）', () => {
    expect(executorSrc).toMatch(/raise\('P1',\s*'codex_config_error'/);
    expect(executorSrc).toMatch(/raise\('P0',\s*'codex_config_error'/);
  });
});
