// runner 纯函数：挑任务、起名、算总超时。
const EXTRA_TIMEOUT_MS = 10 * 60 * 1000;
const SUPPORTED_REPOS = new Set(['cecelia']);

// hourCycle h23：午夜是 00 而不是 24。
const SHANGHAI_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  hourCycle: 'h23',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const RUN_RESULT_KEYS = ['coding_workflow', 'runner', 'coding_workflow_runner'];

/** 开关三件套：task_type=data（不被 tick 派发、不被改道）+ headed_manual="true" + coding_workflow===true。 */
export function isSwitched(task) {
  return task?.task_type === 'data'
    && task.payload?.headed_manual === 'true'
    && task.payload?.coding_workflow === true;
}

/** Brain 里已有 runner/coding 链写过的结果（说明跑过，不能再当新任务认领）。 */
export function hasRunResult(task) {
  return RUN_RESULT_KEYS.some((key) => {
    const v = task?.result?.[key];
    return v !== null && v !== undefined && !(typeof v === 'object' && Object.keys(v).length === 0);
  });
}

/**
 * 候选任务：开关三件套、未被认领、repo 缺省或 cecelia；
 * 按 created_at 升序（最早的先做）。非数组输入返回 []。
 */
export function pickCandidates(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(isSwitched)
    .filter((t) => !t.claimed_by)
    .filter((t) => SUPPORTED_REPOS.has(t.payload.repo ?? 'cecelia'))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** 前置任务 id（payload.depends_on 里的非空字符串）；大改拆成的有序小任务靠它排队。 */
export function depsOf(task) {
  const deps = task?.payload?.depends_on;
  return Array.isArray(deps) ? deps.filter((d) => typeof d === 'string' && d) : [];
}

/** 上海时区 MMDDHHmm（与运行机器 TZ 无关）。 */
export function stampOf(date) {
  const p = Object.fromEntries(SHANGHAI_PARTS.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.month}${p.day}${p.hour}${p.minute}`;
}

/** 一次运行的各种名字：分支满足本机全局 pre-commit 钩子 ^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$。 */
export function taskNames(taskId, date = new Date()) {
  const short = String(taskId).toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 8);
  const stamp = stampOf(date);
  return {
    short,
    stamp,
    branch: `cp-${stamp}-cw-${short}`,
    sprintDir: `sprints/${stamp}-cw-${short}`,
    runTag: `cw-${short}-${stamp}`,
  };
}

/** 总超时 = Σ(活动 max_duration_s × max_attempts) + 10 分钟。 */
export function runTimeoutMs(contract) {
  const activities = Array.isArray(contract?.activities) ? contract.activities : [];
  const seconds = activities.reduce((sum, a) => {
    const budget = Number(a?.budget?.max_duration_s) || 0;
    const attempts = Number(a?.runtime?.max_attempts) || 1;
    return sum + budget * attempts;
  }, 0);
  return seconds * 1000 + EXTRA_TIMEOUT_MS;
}
