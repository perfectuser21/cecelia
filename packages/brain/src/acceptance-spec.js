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

/**
 * CLI 默认路径：env 覆盖 > zenithjoy-workspace 默认位置。
 * 只给本机跑生成器用。服务端一律走 resolveServerSpecPath()，不许碰这个常量——
 * 见下方注释。
 */
export const DEFAULT_SPEC_PATH = process.env.ACCEPTANCE_SPEC_PATH
  || '/Users/administrator/perfect21/zenithjoy-workspace/acceptance-spec/line02-android.yaml';

/** 规程取不到时抛这个，调用方据此转 500 并给出可操作提示（而不是把 ENOENT 堆栈丢给客户端） */
export class SpecUnavailableError extends Error {
  constructor(message, { reason, spec_path = null } = {}) {
    super(message);
    this.name = 'SpecUnavailableError';
    this.reason = reason;
    this.spec_path = spec_path;
  }
}

/**
 * 服务端读规程的唯一入口：只认 ACCEPTANCE_SPEC_PATH，不回落到 DEFAULT_SPEC_PATH。
 *
 * 回落是这里最坏的降级：容器/CI 上那条本机绝对路径必然不存在，回落只是把「没配规程」
 * 翻译成一个看不懂的 ENOENT；而在本机上它恰好存在，服务端于是拿着一份可能与已发布规程
 * 不同的静态属性去判 reason——A4③ 的判据（某格是不是 human_only）就此静默错位。
 * 每次调用都重读 env，不做模块级快照：进程启动顺序与测试改 env 都不该影响结论。
 */
export function resolveServerSpecPath() {
  const specPath = process.env.ACCEPTANCE_SPEC_PATH;
  if (!specPath) {
    throw new SpecUnavailableError(
      'ACCEPTANCE_SPEC_PATH 未配置：服务端读不到验收规程 yaml，无法判定格的静态属性。'
      + '请把 Brain 进程的 ACCEPTANCE_SPEC_PATH 指向已发布的 acceptance-spec/line02-android.yaml',
      { reason: 'spec_path_not_configured' }
    );
  }
  if (!fs.existsSync(specPath)) {
    throw new SpecUnavailableError(
      `ACCEPTANCE_SPEC_PATH 指向的规程文件不存在：${specPath}`,
      { reason: 'spec_file_missing', spec_path: specPath }
    );
  }
  return specPath;
}

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
  // 结构先验一遍：doc.steps 不是数组时，下面那句 for...of 会抛 "doc.steps is not iterable"
  // 或者更坏——对字符串逐字符迭代，安静地产出 0 行，把「规程写坏了」变成「这一版没有格」。
  if (!doc || !Array.isArray(doc.steps)) {
    throw new Error('规程结构异常：doc.steps 必须是数组（yaml 顶层缺 steps 或写成了别的类型）');
  }
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
  // 格号重复只可能来自规程里 step.n 写重了，而它在下游全是静默的：建单端点逐行 INSERT
  // 撞 (run_id, check_key) 唯一约束，deriveSets 的 byKey Map 后写覆盖先写——两条路都不报错，
  // 只是少几行、或者某格的静态属性被同号的另一格顶掉。在这里就炸，别让它流到库里。
  const seen = new Set();
  const dupes = [...new Set(cells.filter((c) => {
    if (seen.has(c.check_key)) return true;
    seen.add(c.check_key);
    return false;
  }).map((c) => c.check_key))];
  if (dupes.length > 0) {
    throw new Error(`规程内格号重复：${dupes.join(', ')}（多半是 steps 里 n 写重了）——建单会塌行丢格`);
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
