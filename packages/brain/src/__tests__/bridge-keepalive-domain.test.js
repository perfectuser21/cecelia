/**
 * 回归测试：bridge-keepalive-check.sh 用 gui domain kickstart 一个 LaunchDaemon
 *
 * 背景：com.cecelia.bridge 定义在 /Library/LaunchDaemons/com.cecelia.bridge.plist
 * （LaunchDaemon，跑在 system domain，UserName=administrator 只是运行身份，
 * 不改变它所属的 launchd domain）。keepalive 脚本却用
 * `launchctl kickstart gui/${USER_ID}/com.cecelia.bridge` 去救它——gui domain
 * 里根本找不到这个服务，kickstart 必然失败，自愈机制名存实亡。
 *
 * 实测（2026-07-11，宿主机）：
 *   launchctl print system/com.cecelia.bridge → 存在，state=disabled
 *   launchctl print gui/501/com.cecelia.bridge → "Could not find service"
 *   sudo launchctl enable system/com.cecelia.bridge + bootstrap → 恢复运行
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '../../../../scripts/ops/bridge-keepalive-check.sh');
const SRC = readFileSync(SCRIPT_PATH, 'utf8');

describe('bridge-keepalive-check.sh — launchctl domain 修复', () => {
  it('kickstart 目标用 system domain（LaunchDaemon 归属）', () => {
    expect(SRC).toContain('system/${BRIDGE_PLIST_LABEL}');
  });

  it('不再用 gui/${USER_ID} domain 去 kickstart LaunchDaemon', () => {
    expect(SRC).not.toContain('gui/${USER_ID}/${BRIDGE_PLIST_LABEL}');
  });
});
