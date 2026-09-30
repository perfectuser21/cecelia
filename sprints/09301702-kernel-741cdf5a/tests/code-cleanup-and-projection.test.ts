/**
 * 冻结结构测试 — golden_path* 代码残留清理 + steps/enablers Notion 投影 wiring。
 * 扫描 packages/brain/src（排除 __tests__/注释）与迁移。退役+改名+投影落地前应 RED。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../../../packages/brain/src/', import.meta.url));
const migDir = fileURLToPath(new URL('../../../packages/brain/migrations/', import.meta.url));

function activeSrcConcat(): string {
  let out = '';
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
        walk(dir + ent.name + '/');
      } else if (ent.name.endsWith('.js')) {
        // 去掉行注释与块注释首字符行，避免注释里的表名误判
        const raw = readFileSync(dir + ent.name, 'utf8');
        const stripped = raw
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*)/.test(l))
          .join('\n');
        out += '\n' + stripped;
      }
    }
  };
  walk(srcDir);
  return out;
}

const active = activeSrcConcat();

function migConcat(): string {
  return readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(migDir + f, 'utf8'))
    .join('\n');
}

describe('golden_path* 清理 + steps/enablers 投影', () => {
  it('活跃 src 无 golden_paths SQL 残留（FROM/INTO/UPDATE/JOIN 三表）', () => {
    expect(active).not.toMatch(/(FROM|INTO|UPDATE|JOIN)\s+golden_paths?[^_a-z]/);
    expect(active).not.toMatch(/golden_path_contract_versions/);
  });

  it('notion-probe-projection 引用 probes 非 step_probes（改名随动）', () => {
    const p = fileURLToPath(
      new URL('../../../packages/brain/src/notion-probe-projection.js', import.meta.url),
    );
    const c = readFileSync(p, 'utf8');
    expect(c).not.toMatch(/\bstep_probes\b/);
    expect(c).toMatch(/target_type/);
  });

  it('notion_projection_map 注册 steps enablers 两投影目标', () => {
    const mig = migConcat();
    // 新迁移向 notion_projection_map 灌入 steps 与 enablers 投影目标行
    expect(mig).toMatch(/notion_projection_map[\s\S]*'steps'/);
    expect(mig).toMatch(/notion_projection_map[\s\S]*'enablers'/);
  });
});
