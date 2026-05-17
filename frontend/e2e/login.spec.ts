import { test, expect } from '@playwright/test';

// 拦截飞书 SDK CDN，注入 mock 实现（避免 CI 依赖外部网络）
const FEISHU_SDK_URL = '**/LarkSSOSDKWebQRCode**';
const MOCK_SDK_BODY = `
window.QRLogin = function(cfg) {
  var el = document.getElementById(cfg.id);
  if (el) {
    var f = document.createElement('iframe');
    f.src = 'about:blank';
    f.setAttribute('width', String(cfg.width));
    f.setAttribute('height', String(cfg.height));
    el.appendChild(f);
  }
  return {
    matchOrigin: function() { return false; },
    matchData: function() { return false; }
  };
};
`;

test('访问 /login → 5 秒内 #feishu-qr-container iframe 出现', async ({ page }) => {
  await page.route(FEISHU_SDK_URL, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: MOCK_SDK_BODY })
  );

  await page.goto('/login');

  const container = page.locator('#feishu-qr-container');
  await expect(container).toBeVisible({ timeout: 5000 });

  // SDK 初始化后必须在容器内注入 iframe（证明 APP_ID 已配置、SDK 已执行）
  await expect(container.locator('iframe')).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: 'test-results/login-qr.png' });
});

test('mock 登录成功 → 进入 dashboard → 侧栏渲染', async ({ page }) => {
  // 拦截飞书登录后端接口，返回 mock 用户
  await page.route('/api/feishu-login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        user: {
          id: 'test_user_id',
          name: '测试用户',
          feishu_user_id: 'test_feishu_id',
          access_token: 'mock_access_token',
        },
      }),
    })
  );

  // 携带 code 参数访问 /login 触发回调流程
  await page.goto('/login?code=mock_code');

  // 登录成功后跳转出 /login，等待最长 5 秒
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 5000 });

  // 已认证布局：侧栏必须可见
  await expect(page.locator('aside')).toBeVisible({ timeout: 5000 });
});
