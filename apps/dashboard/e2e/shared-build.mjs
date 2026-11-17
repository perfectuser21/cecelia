import { accessSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardRoot = fileURLToPath(new URL('../', import.meta.url));

// CI共享一次构建；原有独立脚本仍消费各自的固定版本和目录。
export function dashboardBuild(defaultDirectory, defaultVersion, env = process.env) {
  const root = resolve(dashboardRoot, env.DASHBOARD_E2E_DIST || defaultDirectory);
  const version = env.EXPECTED_BUILD_VERSION || defaultVersion;
  accessSync(resolve(root, 'index.html'));
  const info = JSON.parse(readFileSync(resolve(root, 'build-info.json'), 'utf8'));
  if (info.git_sha !== version) {
    throw new Error(`浏览器验收预期构建 ${version}，实际产物 ${info.git_sha}`);
  }
  return { root, version };
}
