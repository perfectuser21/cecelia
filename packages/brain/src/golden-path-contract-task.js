export const GP_HARNESS_BASE_REPO = 'https://github.com/perfectuser21/cecelia.git';
export const GP_HARNESS_TARGET_ENVIRONMENT = 'local_api';

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
