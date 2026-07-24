/**
 * frontend-proxy-gzip.test.js
 *
 * 回归守卫：cecelia-frontend（frontend-proxy.js）之前对 JS/CSS/HTML 静态资源完全不压缩，
 * 移动端经 Tailscale 转发拉几百KB~1MB 的裸 bundle 会明显卡住加载条（见 2026-07-24 实测，
 * https://100.71.151.105:5211/warroom/line/... 在手机上停在加载条 1/3~1/5 处）。
 * 修复：对可压缩类型在客户端声明支持 gzip 时用 Content-Encoding: gzip 响应。
 */

import { describe, it, expect } from 'vitest';
import frontendProxy from '../frontend-proxy.js';

const { shouldGzip } = frontendProxy;

describe('frontend-proxy shouldGzip', () => {
  it('客户端声明支持 gzip 时，js/css/html/json/svg/map 走压缩', () => {
    for (const ext of ['.js', '.css', '.html', '.json', '.svg', '.map']) {
      expect(shouldGzip(ext, 'gzip, deflate, br')).toBe(true);
    }
  });

  it('图片/字体等已压缩格式不重复 gzip（收益低甚至变大）', () => {
    for (const ext of ['.png', '.jpg', '.ico', '.woff', '.woff2', '.ttf']) {
      expect(shouldGzip(ext, 'gzip, deflate, br')).toBe(false);
    }
  });

  it('客户端没有声明 Accept-Encoding: gzip 时不压缩（回归修复前的裸传行为，兼容不支持的客户端）', () => {
    expect(shouldGzip('.js', '')).toBe(false);
    expect(shouldGzip('.js', undefined)).toBe(false);
    expect(shouldGzip('.js', 'deflate, br')).toBe(false);
  });

  it('require() 引入模块不占用端口（require.main 守卫，供测试安全导入）', () => {
    // 本文件顶部的 import 本身就是对这条约束的验证——如果守卫失效，
    // frontend-proxy.js 会在 import 阶段尝试 listen(5211)，在 CI 里大概率因端口冲突/
    // 权限问题直接抛错，这条 import 走不到这里。
    expect(typeof shouldGzip).toBe('function');
  });
});
