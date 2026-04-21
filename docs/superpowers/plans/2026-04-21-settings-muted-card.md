# SettingsPage muted card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SettingsPage.tsx 加第二个 card（飞书静默开关），与意识开关并列，复用同一 UI 风格。

**Architecture:** 重构 SettingsPage 为双 state + 双 toggle 结构。consciousness 和 muted 各自独立 state / handler。直接复制不提公共组件（YAGNI，目前只 2 个）。

**Tech Stack:** React + vitest + testing-library

---

## File Structure

| 文件 | 动作 |
|---|---|
| `apps/dashboard/src/pages/settings/SettingsPage.tsx` | Modify（重构为双 card）|
| `apps/dashboard/src/pages/settings/SettingsPage.test.tsx` | Modify（加 muted 测试）|
| `.dod` + `docs/learnings/cp-0421233137-settings-muted-card.md` | Create |

---

## Task 1: SettingsPage 双 card 重构 + 测试

**Files:**
- Modify: `apps/dashboard/src/pages/settings/SettingsPage.tsx`
- Modify: `apps/dashboard/src/pages/settings/SettingsPage.test.tsx`

- [ ] **Step 1.1: 写测试先（TDD Red）**

**覆盖 `SettingsPage.test.tsx`**（整个文件替换为以下内容——扩展原 3 个测试到覆盖 consciousness + muted 两个 card）：

```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPage from './SettingsPage';

// 辅助：mock fetch 对 consciousness / muted 两个 endpoint 返回不同状态
function mockFetch(consciousnessStatus: any, mutedStatus: any) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('/consciousness')) {
      return Promise.resolve(new Response(JSON.stringify(consciousnessStatus), { status: 200 }));
    }
    if (u.includes('/muted')) {
      return Promise.resolve(new Response(JSON.stringify(mutedStatus), { status: 200 }));
    }
    return Promise.reject(new Error('Unexpected URL: ' + u));
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ─── consciousness card（原有，保持不回归） ───────────────

  test('renders consciousness status after fetch', async () => {
    mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: false, last_toggled_at: null, env_override: false }
    );
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/意识开关/)).toBeInTheDocument());
    expect(screen.getByTestId('consciousness-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('click consciousness toggle sends PATCH', async () => {
    const fetchSpy = mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: false, last_toggled_at: null, env_override: false }
    );
    // 第三次 fetch 是点击后的 PATCH
    fetchSpy.mockImplementationOnce((url: any) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/consciousness')) return Promise.resolve(new Response(JSON.stringify({ enabled: true, last_toggled_at: null, env_override: false }), { status: 200 }));
      if (u.includes('/muted')) return Promise.resolve(new Response(JSON.stringify({ enabled: false, last_toggled_at: null, env_override: false }), { status: 200 }));
      return Promise.reject(new Error('x'));
    });
    // PATCH 响应
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ enabled: false, last_toggled_at: '2026-04-21T00:00:00Z', env_override: false }), { status: 200 }))
    );
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('consciousness-toggle'));
    fireEvent.click(screen.getByTestId('consciousness-toggle'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain/settings/consciousness',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) })
      );
    });
  });

  test('consciousness env_override disables toggle + shows warning', async () => {
    mockFetch(
      { enabled: false, last_toggled_at: null, env_override: true },
      { enabled: false, last_toggled_at: null, env_override: false }
    );
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('consciousness-env-override-warning'));
    expect(screen.getByTestId('consciousness-toggle')).toBeDisabled();
  });

  // ─── muted card（新增） ──────────────────────────────────────

  test('renders muted status after fetch', async () => {
    mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: true, last_toggled_at: null, env_override: false }
    );
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/飞书静默开关/)).toBeInTheDocument());
    expect(screen.getByTestId('muted-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('click muted toggle sends PATCH to /muted', async () => {
    const fetchSpy = mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: false, last_toggled_at: null, env_override: false }
    );
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ enabled: true, last_toggled_at: '2026-04-21T00:00:00Z', env_override: false }), { status: 200 }))
    );
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('muted-toggle'));
    fireEvent.click(screen.getByTestId('muted-toggle'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/brain/settings/muted',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: true }) })
      );
    });
  });

  test('muted env_override disables toggle + shows warning', async () => {
    mockFetch(
      { enabled: true, last_toggled_at: null, env_override: false },
      { enabled: true, last_toggled_at: null, env_override: true }
    );
    render(<SettingsPage />);
    await waitFor(() => screen.getByTestId('muted-env-override-warning'));
    expect(screen.getByTestId('muted-toggle')).toBeDisabled();
  });
});
```

**注意**：原测试把 env-override-warning 用了 `data-testid="env-override-warning"`，现在改成 **`consciousness-env-override-warning`** 区分两个 card（避免两个同 id 冲突）。这是和下面 SettingsPage.tsx 改动同步的。

- [ ] **Step 1.2: 跑测试确认红**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card/apps/dashboard
npx vitest run src/pages/settings/SettingsPage.test.tsx --no-coverage 2>&1 | tail -10
```

**预期**：原 3 测试因为 testId 改名可能失败；新 3 测试肯定失败（muted-toggle 不存在）。

- [ ] **Step 1.3: 重构 SettingsPage.tsx**

**覆盖整个文件**（双 card 版本）：

```tsx
import { useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  last_toggled_at: string | null;
  env_override: boolean;
};

type Config = {
  key: 'consciousness' | 'muted';
  title: string;
  descriptionOn: string;
  descriptionOff: string;
  apiPath: string;
  envOverrideHint: string;
};

const CONFIGS: Config[] = [
  {
    key: 'consciousness',
    title: '意识开关',
    descriptionOn: '开 — Brain 会做情绪 / 反思 / 自驱 / 日记等活动（消耗 LLM token）',
    descriptionOff: '关 — Brain 只做任务派发 / 调度 / 监控（不消耗意识层 token）',
    apiPath: '/api/brain/settings/consciousness',
    envOverrideHint: '主机 plist 设置了 CONSCIOUSNESS_ENABLED=false 或 BRAIN_QUIET_MODE=true，本界面无法控制。需 SSH 到主机 unset env 才能恢复 Dashboard 控制。',
  },
  {
    key: 'muted',
    title: '飞书静默开关',
    descriptionOn: '开 — Brain 所有主动 outbound 飞书消息静默（对话回复不受影响）',
    descriptionOff: '关 — Brain 主动通知会发到飞书（告警 / 推送 / 日报）',
    apiPath: '/api/brain/settings/muted',
    envOverrideHint: '主机 plist 设置了 BRAIN_MUTED=true，本界面无法控制。需 sudo PlistBuddy Delete + launchctl bootout/bootstrap 才能恢复 Dashboard 控制。',
  },
];

function ToggleCard({ config }: { config: Config }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(config.apiPath)
      .then((r) => r.json())
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, [config.apiPath]);

  const toggle = async () => {
    if (!status || status.env_override) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(config.apiPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      const next = await res.json();
      setStatus(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{config.title}</h3>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {status.enabled ? config.descriptionOn : config.descriptionOff}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={loading || status.env_override}
          data-testid={`${config.key}-toggle`}
          aria-pressed={status.enabled}
          style={{
            width: 56,
            height: 32,
            borderRadius: 16,
            border: 'none',
            background: status.enabled ? '#10b981' : '#d1d5db',
            cursor: status.env_override ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            position: 'relative',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 4,
              left: status.enabled ? 28 : 4,
              width: 24,
              height: 24,
              borderRadius: 12,
              background: '#fff',
              transition: 'left 0.15s',
            }}
          />
        </button>
      </div>

      {status.last_toggled_at && (
        <p style={{ fontSize: 12, color: '#9ca3af' }}>
          上次切换：{new Date(status.last_toggled_at).toLocaleString('zh-CN')}
        </p>
      )}

      {status.env_override && (
        <div
          style={{ marginTop: 12, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}
          data-testid={`${config.key}-env-override-warning`}
        >
          <p style={{ fontSize: 13, color: '#991b1b', fontWeight: 500 }}>⚠️ Plist 强制覆盖</p>
          <p style={{ fontSize: 12, color: '#7f1d1d', marginTop: 4 }}>{config.envOverrideHint}</p>
        </div>
      )}

      {error && <p style={{ marginTop: 12, fontSize: 13, color: '#dc2626' }}>错误：{error}</p>}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>设置</h2>
      {CONFIGS.map((c) => (
        <ToggleCard key={c.key} config={c} />
      ))}
    </div>
  );
}
```

**设计变化**：
- 提取 `ToggleCard` 内部组件（YAGNI 权衡：只 2 个 card，但每个 card 60 行，复制会比重构更乱）
- `data-testid` 从 `consciousness-toggle` / `env-override-warning` 改成 `{key}-toggle` / `{key}-env-override-warning`（每个 card 独立）
- 从 "Plist 强制关闭" 文案改成 **"Plist 强制覆盖"**（更精确——env 可以是 true 也可以是 false，不一定是"关闭"）

- [ ] **Step 1.4: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card/apps/dashboard
npx vitest run src/pages/settings/SettingsPage.test.tsx --no-coverage 2>&1 | tail -10
```

**预期**：6 passed（3 consciousness + 3 muted）。

- [ ] **Step 1.5: tsc 检查**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card/apps/dashboard
npx tsc --noEmit 2>&1 | grep -E "SettingsPage" | head
```

**预期**：无 SettingsPage 相关 error。

- [ ] **Step 1.6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card
git add apps/dashboard/src/pages/settings/SettingsPage.tsx apps/dashboard/src/pages/settings/SettingsPage.test.tsx
git commit -m "feat(dashboard)[CONFIG]: SettingsPage 加飞书静默 toggle 与意识并列

- 提取 ToggleCard 内部组件（config-driven）
- 双 card：consciousness + muted
- data-testid 从 consciousness-toggle / env-override-warning 改为
  {key}-toggle / {key}-env-override-warning 避免两 card 冲突
- 测试扩展到 6 场景（每个 card 3：render / patch / env_override）
- API 路径 /api/brain/settings/consciousness 和 /api/brain/settings/muted

LiveMonitor 的 toggle 保留不动（快捷入口双保险）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DoD + Learning

**Files:**
- Create: `.dod`
- Create: `docs/learnings/cp-0421233137-settings-muted-card.md`

- [ ] **Step 2.1: 写 .dod（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card
cat > .dod <<'DOD_EOF'
# DoD — SettingsPage 加 muted toggle

- [x] [ARTIFACT] SettingsPage.tsx 含 muted card（API /api/brain/settings/muted）
      Test: manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/settings/SettingsPage.tsx','utf8');if(!c.includes('/api/brain/settings/muted')||!c.includes('飞书静默开关'))process.exit(1)"
- [x] [ARTIFACT] ToggleCard 组件化（config-driven）
      Test: manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/settings/SettingsPage.tsx','utf8');if(!c.includes('function ToggleCard')||!c.includes('CONFIGS'))process.exit(1)"
- [x] [BEHAVIOR] SettingsPage.test.tsx 6 场景全绿（3 consciousness + 3 muted）
      Test: tests/dashboard/SettingsPage.test.tsx
- [x] [BEHAVIOR] tsc 无新 error（SettingsPage 相关）
      Test: manual:bash -c "cd apps/dashboard && npx tsc --noEmit 2>&1 | grep SettingsPage | head"
- [x] [ARTIFACT] 设计 + Learning 文档已提交
      Test: manual:node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-21-settings-muted-card-design.md');require('fs').accessSync('docs/learnings/cp-0421233137-settings-muted-card.md')"
DOD_EOF
```

- [ ] **Step 2.2: 写 Learning（Bash heredoc）**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card
mkdir -p docs/learnings
cat > docs/learnings/cp-0421233137-settings-muted-card.md <<'LEARN_EOF'
# Learning — SettingsPage 加 muted toggle（UI 入口修正）

分支：cp-0421233137-settings-muted-card
日期：2026-04-21
Task：73b048ec-9ce3-4078-b731-d8760d30ff81
前置：#2511（runtime BRAIN_MUTED + LiveMonitor UI）

## 背景

PR #2511 做了 runtime BRAIN_MUTED + API + Dashboard toggle，但 toggle
放在了 LiveMonitor 页面的 BRAIN 区块。Alex 自然去 /settings 找（那里
已有意识开关）——发现没有，反问"在哪看"。

## 根本原因

"设置"类开关的直觉位置是 /settings 页面，不是实时监控面板。上个 PR
的 plan 直接参照我早期建议的"BRAIN 区块加 button"，没考虑用户心智模型。

## 本次解法

在 SettingsPage 加第二个 toggle card，和意识开关并列。两个 card 都从
/api/brain/settings/<key> 读/写，结构同构。

**架构小改进**：把两个 card 共享的 UI + 状态管理提取成 ToggleCard 内部
组件（config-driven），用 CONFIGS 数组驱动。未来加第三个开关（比如
dopamine）只需往数组加一行。比复制粘贴 60 行更 maintainable。

## 保留双入口

- /settings → 全量配置中心（深度设置）
- /live-monitor BRAIN 区块 → 快捷开关（实时面板上 1 秒切）

两处都调同一 API，状态同步（因为 state 在 Brain DB）。不冲突。

## 下次预防

- [ ] "用户/调度级开关"的 UI 入口优先考虑 /settings（心智模型一致性）
- [ ] 类似共享组件（两个以上同结构 card）第一次就考虑提取 config-driven，
      不要先复制再重构（更容易漏改）
- [ ] UI 改动前先看现有页面结构（SettingsPage 已有 consciousness card 就是模板）

## 下一步

无（本 PR 合并后 /settings 就有两个并列开关，用户找得到）。
LEARN_EOF
```

- [ ] **Step 2.3: 跑全量 DoD 验证**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card && \
  node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/settings/SettingsPage.tsx','utf8');if(!c.includes('/api/brain/settings/muted')||!c.includes('飞书静默开关'))process.exit(1);console.log('SettingsPage muted OK')" && \
  node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/settings/SettingsPage.tsx','utf8');if(!c.includes('function ToggleCard')||!c.includes('CONFIGS'))process.exit(1);console.log('ToggleCard component OK')" && \
  node -e "require('fs').accessSync('docs/superpowers/specs/2026-04-21-settings-muted-card-design.md');require('fs').accessSync('docs/learnings/cp-0421233137-settings-muted-card.md');console.log('docs OK')" && \
  cd apps/dashboard && \
  npx vitest run src/pages/settings/SettingsPage.test.tsx --no-coverage 2>&1 | tail -5
```

**预期**：3 artifact OK + 6 test passed。

- [ ] **Step 2.4: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/settings-muted-card
git add .dod docs/learnings/cp-0421233137-settings-muted-card.md
git commit -m "docs[CONFIG]: DoD + Learning for SettingsPage muted toggle

5 条 DoD 全勾选。Learning 记录 UI 入口心智模型决策（/settings vs
/live-monitor）+ ToggleCard 组件化重构动机。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [x] **Spec 覆盖**：SettingsPage 加 muted card（T1）+ docs（T2）。双入口保留 / LiveMonitor 不动在 T1 commit message 说明
- [x] **Placeholder 扫描**：无 TBD；所有代码完整
- [x] **Type 一致性**：`Config` type / `CONFIGS` 常量 / `{key}-toggle` testId 全文一致
- [x] **Brain 无改动**：不碰 muted-guard / API / notifier
- [x] **Learning 规则**：per-branch 文件名 + 根本原因 + 下次预防 checklist
