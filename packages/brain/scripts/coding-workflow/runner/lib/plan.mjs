// runner 纯函数：挑任务、起名、算总超时。
const EXTRA_TIMEOUT_MS = 10 * 60 * 1000;
const SUPPORTED_REPOS = new Set(['cecelia']);

const pad = (n) => String(n).padStart(2, '0');

/**
 * 候选任务：payload.coding_workflow 严格为 true、未被认领、repo 缺省或 cecelia；
 * 按 created_at 升序（最早的先做）。非数组输入返回 []。
 */
export function pickCandidates(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => t && t.payload && t.payload.coding_workflow === true)
    .filter((t) => !t.claimed_by)
    .filter((t) => SUPPORTED_REPOS.has(t.payload.repo ?? 'cecelia'))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** 本地时间 MMDDHHmm。 */
export function stampOf(date) {
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
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
