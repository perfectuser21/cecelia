# SettingsPage 加飞书静默 toggle（与 consciousness 并列）

日期：2026-04-21
分支：cp-0421233145-settings-muted-card
Brain Task：73b048ec-9ce3-4078-b731-d8760d30ff81
前置 PR：#2509（env gate）+ #2511（runtime toggle + API + LiveMonitor UI）

## 问题

`/settings` 页面已有意识开关（consciousness），但**缺飞书静默开关**。上一 PR 把 muted toggle 放在 LiveMonitor 的 BRAIN 区块。"设置"类开关用户下意识去 /settings 找，应该和意识开关并列。

## 设计

在 `SettingsPage.tsx` 复制一份 consciousness card 的代码，改成 muted——API 路径 `/consciousness` → `/muted`，文案改成"飞书静默开关"。

保持两处入口（settings 深度 + LiveMonitor 快捷），不删 LiveMonitor 的。

## 变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `apps/dashboard/src/pages/settings/SettingsPage.tsx` | Modify | 加第二个 card（~40 行），复制 consciousness 模式 |
| `apps/dashboard/src/pages/settings/SettingsPage.test.tsx` | Modify | 加 muted 相关测试用例 |

## UI 结构

```
设置页
┌──────────────────────────────────────────┐
│ 意识开关                                  │
│ 开/关按钮 + 描述 + last_toggled_at        │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│ 飞书静默开关（新增）                      │
│ 开/关按钮 + 描述 + last_toggled_at        │
└──────────────────────────────────────────┘
```

文案：
- 标题：`飞书静默开关`
- enabled=false 描述：`关 — Brain 主动通知会发到飞书（告警 / 推送 / 日报）`
- enabled=true 描述：`开 — Brain 所有主动 outbound 飞书消息静默（对话回复不受影响）`

env_override=true 时 button disabled + tooltip `env BRAIN_MUTED=true 强制静默，改 plist 并重启 daemon 才能切换`。

## 测试策略

SettingsPage.test.tsx 加 3 场景：
1. 初始加载同时 GET 两个 API（/consciousness 和 /muted），显示两个 card
2. 点击 muted toggle → PATCH /muted → UI 刷新为新状态
3. env_override=true 时 button disabled

mock 两个 API：
```typescript
global.fetch = vi.fn((url) => {
  if (url.includes('/consciousness')) return Promise.resolve({ ok: true, json: async () => ({ enabled: true, env_override: false, last_toggled_at: null }) });
  if (url.includes('/muted')) return Promise.resolve({ ok: true, json: async () => ({ enabled: false, env_override: false, last_toggled_at: null }) });
});
```

## 不做

- 不改 muted-guard.js / notifier.js / API（上个 PR 都做好了）
- 不删 LiveMonitor 的 toggle（双入口保留）
- 不改 SettingsPage 整体布局

## 验收

- [ARTIFACT] SettingsPage.tsx 含 muted card（fetch /api/brain/settings/muted）
- [ARTIFACT] SettingsPage.test.tsx 有 muted 测试
- [BEHAVIOR] 现有 consciousness 测试无回归
- [BEHAVIOR] 访问 http://localhost:5211/settings 能看到两个并列开关
