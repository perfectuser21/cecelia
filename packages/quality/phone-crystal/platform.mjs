// platform.mjs —— 工具链的跨平台接缝：临时目录 + 截图缩放
//
// 收编进 repo 前这套东西只跑在 macOS，两处硬绑死了平台：
//   TMP = '/tmp/ab'          → Windows 上没有这个路径
//   sips -Z 760              → sips 是 macOS 专有命令
// 抽到这里是为了能被测试覆盖，也为了让 xian-rog(Windows) 直接跑起来开并行。

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveTmpRoot(env = process.env) {
  return env.AB_TMP || join(tmpdir(), 'ab');
}

/**
 * 模块自身所在目录。
 *
 * 必须走 fileURLToPath，不能拿 URL 的 pathname 当路径用：
 * 后者在 Windows 上返回 `/C:/Users/...`（带前导斜杠），join 之后拼成
 * `C:\C:\...` 双盘符。09-07 在 xian-rog 上实测炸过一次。
 * 有一条源码静态守卫盯着这个写法不许回潮（见 step1-phone-crystal-module-dir 测试）。
 */
export function moduleDir(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}

// 缩放器探测链：按顺序试，谁能用用谁。
// 不引 sharp/jimp 这类原生依赖——截图缩放只是为了省 vision token，不是核心逻辑，
// 为它引入编译链会让这套纯脚本工具在 Windows 上更脆。
const SCALERS = [
  (raw, out) => `sips -Z 760 "${raw}" --out "${out}"`,
  (raw, out) => `ffmpeg -y -i "${raw}" -vf "scale=760:-1" "${out}"`,
  (raw, out) => `magick "${raw}" -resize 760x "${out}"`,
];

/**
 * 把截图缩到长边 760，省 vision token。
 *
 * 契约：**返回的路径一定真实存在**。
 * 旧实现把 sips 的失败用 `>/dev/null 2>&1` 吞掉后照样返回 out，
 * 在没有 sips 的机器上调用方拿到的是幽灵路径，等到读文件时才炸、且离现场很远。
 * 这里逐个试缩放器，每次都验文件真落地；全都不成就退回原图——
 * 原图能用，只是费点 token，比返回一个不存在的路径强。
 */
export function scaleDown(raw, out, deps = {}) {
  const run = deps.run ?? ((cmd) => execSync(cmd, { stdio: 'ignore' }));
  const exists = deps.exists ?? existsSync;

  for (const build of SCALERS) {
    try {
      run(build(raw, out));
      // 退出码 0 不等于文件落地：sips 在某些权限/格式下就会这样。
      if (exists(out)) return out;
    } catch {
      // 这个缩放器没装或跑挂了，试下一个
    }
  }
  return raw;
}
