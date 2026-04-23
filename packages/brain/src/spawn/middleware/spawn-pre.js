/**
 * spawn-pre middleware — Brain v2 Layer 3 外层（Koa 洋葱）的 prompt 准备步。
 * 见 docs/design/brain-orchestrator-v2.md §5.2。
 *
 * 职责：把 caller 传入的 prompt 写到宿主可读的文件（forensic / debug 用），
 * 生成 cidfile 路径供 docker --cidfile，清理残留 cidfile。
 *
 * v2 P2 PR 8（本 PR）：建立模块 + 单测，暂不接线 executeInDocker。
 * attempt-loop 整合 PR 会在 docker-run 之前调 preparePromptAndCidfile。
 *
 * @param {object} opts   { task, prompt }
 * @param {object} ctx    { promptDir?, cidfileDir?, fsDeps? } 注入 fs 便于测试
 * @returns {{ promptPath: string, cidfilePath: string }}
 */
import { writeFileSync as realWrite, mkdirSync as realMkdir, existsSync as realExists, unlinkSync as realUnlink } from 'fs';
import path from 'path';

const DEFAULT_PROMPT_DIR = process.env.CECELIA_PROMPT_DIR || '/tmp/cecelia-prompts';

export function preparePromptAndCidfile(opts, ctx = {}) {
  if (!opts?.task?.id) throw new Error('spawn-pre: opts.task.id required');
  if (typeof opts?.prompt !== 'string') throw new Error('spawn-pre: opts.prompt required');

  const fs = ctx.fsDeps || { writeFileSync: realWrite, mkdirSync: realMkdir, existsSync: realExists, unlinkSync: realUnlink };
  const promptDir = ctx.promptDir || DEFAULT_PROMPT_DIR;
  const cidfileDir = ctx.cidfileDir || promptDir;

  if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true });
  }
  const promptPath = path.join(promptDir, `${opts.task.id}.prompt.txt`);
  fs.writeFileSync(promptPath, opts.prompt, 'utf8');

  const cidfilePath = path.join(cidfileDir, `${opts.task.id}.cid`);
  if (fs.existsSync(cidfilePath)) {
    try { fs.unlinkSync(cidfilePath); } catch { /* ignore */ }
  }

  return { promptPath, cidfilePath };
}
