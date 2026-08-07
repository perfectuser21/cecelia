/**
 * acceptance-spec.js — 规程 yaml 解析与静态属性派生（D1）
 *
 * 一条全局取数纪律：所有涉及「AI 可判格数」的数字一律从这里解析取数，
 * 代码里不出现 36/19/17/5/{S13-c4} 这些常量。Gate B 第 4 条落档 3 时 S4-c2 转
 * human_only，全表数字整体位移（human_only 18 / machine_db 18 / 阈值 ≥9 /
 * mandatory ∩ machine_db 缩为 4）；硬编码等于在回落发生时静默算错。
 *
 * 落点在 src/ 而不是 scripts/：单元 ④/⑥ 的服务端校验也要读同一批静态属性，
 * 路由 import src/ 是正常方向，反过来 import scripts/ 不是。
 * scripts/acceptance/build-checks-from-spec.mjs 只是本模块的 CLI 外壳。
 */
import fs from 'fs';
import { createHash } from 'crypto';
import yaml from 'js-yaml';

/** 规程文件路径：env 覆盖 > zenithjoy-workspace 默认位置 */
export const DEFAULT_SPEC_PATH = process.env.ACCEPTANCE_SPEC_PATH
  || '/Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml';

/** 对 yaml 文件的原始字节取 sha256——不是解析后重序列化（那会随 js-yaml 版本漂移） */
export function computeSpecSha(rawBuffer) {
  return createHash('sha256').update(rawBuffer).digest('hex');
}

export function loadSpec(filePath = DEFAULT_SPEC_PATH) {
  const raw = fs.readFileSync(filePath);
  const doc = yaml.load(raw.toString('utf-8'));
  return { raw, doc, spec_sha: computeSpecSha(raw), version: doc.version };
}

/**
 * 排除集（J10-B，逐条机械）：
 *   - 排除 cells[cX].na === true 的格；
 *   - 排除 step.fixedNa === true 步骤下的全部四格（含该步 c1 那个有 t 和 verifiable_by
 *     的格——fixedNa 优先级高于单格属性）。
 * 对 line02-android.yaml 恰得 36 行。
 */
export function buildCells(doc) {
  const cells = [];
  for (const step of doc.steps) {
    if (step.fixedNa === true) continue;
    for (const ck of ['c1', 'c2', 'c3', 'c4']) {
      const cell = step.cells?.[ck];
      if (!cell || cell.na === true) continue;
      cells.push({
        check_key: `S${step.n}-${ck}`,
        kind: cell.kind,
        name: cell.t,
        verifiable_by: cell.verifiable_by,
        scenario_class: cell.scenario_class || null,
        hard: cell.hard === true,
        step_n: step.n,
        step_name: step.name,
        fails: cell.fails || [],
      });
    }
  }
  return cells;
}

/** v7-final 四个占位符（:human_only_list / :unverifiable_list / :mandatory_scenario_codes / :mandatory_machine_db_list）共用这一处派生 */
export function deriveSets(cells) {
  const pick = (fn) => cells.filter(fn).map((c) => c.check_key);
  return {
    humanOnlyList: pick((c) => c.verifiable_by === 'human_only'),
    machineDbList: pick((c) => c.verifiable_by === 'machine_db'),
    hardList: pick((c) => c.hard),
    unverifiableList: pick((c) => c.scenario_class === 'unverifiable_this_version'),
    mandatoryScenarioCodes: pick((c) => c.scenario_class === 'mandatory'),
    mandatoryMachineDbList: pick((c) => c.scenario_class === 'mandatory' && c.verifiable_by === 'machine_db'),
    byKey: new Map(cells.map((c) => [c.check_key, c])),
  };
}
