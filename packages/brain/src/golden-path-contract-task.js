// GP 行的 base_repo / target_environment 为 NULL 时沿用这两个常量（migration 393）。
// 不删常量：存量 GP 全是 NULL，删了等于强制所有 GP 立刻回填。
export const GP_HARNESS_BASE_REPO = 'https://github.com/perfectuser21/cecelia.git';
export const GP_HARNESS_TARGET_ENVIRONMENT = 'local_api';

// 合法 target_environment 全集。与 migration 393 的 CHECK 逐字一致
// （migration-393-gp-harness-glue.test.js 盯着两边不漂）。
// SSOT 是 harness-contract-proposer SKILL 的 target_environment 枚举行。
export const GP_HARNESS_TARGET_ENVIRONMENTS = [
  'local_api',
  'mac_web',
  'windows_cloud',
  'windows_wechat',
  'linux_server',
  'playground',
  'android_realmachine',
];

function stampMMDDHHNN(now) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function slugifyGoldenPath(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'gp';
}

export function createGoldenPathSprintDir(title, goldenPathId, now = new Date()) {
  const shortId = String(goldenPathId).replace(/-/g, '').slice(0, 8);
  return `sprints/${stampMMDDHHNN(now)}-${slugifyGoldenPath(title)}-${shortId}`;
}
