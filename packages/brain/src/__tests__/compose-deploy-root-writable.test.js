/**
 * 回归（任务 ddee8737，09-28 事故）：部署根守卫在 brain 容器内对部署根跑 git checkout -f / reset --hard。
 * docker-compose 曾在部署根内同路径叠挂 packages/workflows:ro，于是任何改到该目录的提交（#5618 改 KERNEL_CONTEXT.md）
 * 都让容器内 git 报 "unable to unlink ... Read-only file system"，Gate3 连续 4 次失败、1.335.2 与迁移 480/481 卡在生产之外。
 * 规则：部署根以可写方式挂进容器时，根内不得再有同路径的只读子挂载。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url);
const CASES = [
  { file: 'docker-compose.us-vps.yml', deployRoot: '/root/cecelia' },
  { file: 'docker-compose.staging.yml', deployRoot: '/home/xx/perfect21/cecelia' },
  { file: 'docker-compose.yml', deployRoot: '/Users/administrator/perfect21/cecelia' },
];

function volumes(yml) {
  return yml.split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => /^-\s+["']?\/\S*:\/\S*/.test(l))
    .map((l) => l.replace(/^-\s+/, '').replace(/^["']|["']$/g, ''))
    .map((v) => { const [src, dest, mode] = v.split(':'); return { src, dest, mode: mode || 'rw' }; });
}

describe('部署根在容器内必须整体可写（git reset 不被只读子挂载卡住）', () => {
  for (const { file, deployRoot } of CASES) {
    it(`${file}：${deployRoot} 内无只读子挂载`, () => {
      const vols = volumes(readFileSync(new URL(file, ROOT), 'utf8'));
      const rootMounted = vols.some((v) => v.dest === deployRoot && v.mode !== 'ro');
      if (!rootMounted) return; // 该 compose 不把部署根整体挂进容器，不适用
      const bad = vols.filter((v) => v.mode === 'ro' && v.dest.startsWith(`${deployRoot}/`));
      expect(bad.map((v) => `${v.src}:${v.dest}:ro`)).toEqual([]);
    });
  }
});
