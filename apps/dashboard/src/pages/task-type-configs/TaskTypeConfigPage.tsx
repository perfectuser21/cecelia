/**
 * TaskTypeConfigPage — 任务类型路由（ABCD 框架）
 * 路由：/task-type-configs
 *
 * A类：锁机器（美国M4）+ 锁模型（Claude Code）→ 只有 dev
 * B类：锁机器（美国M4），模型不锁（Claude Code 或 Codex 均可）
 * C类：Codex，不锁机器（美国M4 或 西安M4 均可），动态任务可编辑
 * D类：香港VPS，纯脚本/轻量，无大模型
 */

import { useState, useEffect, useCallback } from 'react';

interface TaskTypeConfig {
  task_type: string;
  location: 'us' | 'hk' | 'xian';
  executor: string;
  skill: string | null;
  description: string | null;
  is_dynamic: boolean;
  updated_at: string;
}

const DEVICE_LABELS: Record<string, string> = {
  us:   '美国M4',
  hk:   '香港VPS',
  xian: '西安M4',
};

const DEVICE_COLORS: Record<string, string> = {
  us:   'bg-blue-100 text-blue-700',
  hk:   'bg-red-100 text-red-700',
  xian: 'bg-amber-100 text-amber-700',
};

// B类：锁机器（美国M4），需本机代码/DB上下文
const B_CLASS_ROWS: Array<{ task_type: string; skill: string; desc: string }> = [
  { task_type: 'initiative_execute',  skill: '/dev',                desc: 'Initiative 执行，/dev 全流程' },
  { task_type: 'initiative_plan',     skill: '/decomp',             desc: 'Initiative 规划，读现有代码' },
  { task_type: 'initiative_verify',   skill: '/arch-review verify', desc: 'Initiative 验收，核查代码实现' },
  { task_type: 'intent_expand',       skill: '/intent-expand',      desc: '意图扩展，读 Brain DB 补全 PRD' },
  { task_type: 'pipeline_rescue',     skill: '/dev',                desc: 'Pipeline 救援，读 .dev-mode + worktree' },
  { task_type: 'code_review',         skill: '/code-review',        desc: '代码审查，读代码上下文' },
  { task_type: 'code_review_gate',    skill: '/code-review-gate',   desc: '代码质量门禁（push 前审查）' },
  { task_type: 'prd_review',          skill: '/prd-review',         desc: 'PRD 审查' },
  { task_type: 'spec_review',         skill: '/spec-review',        desc: 'Spec 审查' },
  { task_type: 'initiative_review',   skill: '/initiative-review',  desc: 'Initiative 整体审查' },
  { task_type: 'decomp_review',       skill: '/decomp-check',       desc: '拆解审查（Vivian 角色）' },
  { task_type: 'architecture_design', skill: '/architect design',   desc: '架构设计，读代码' },
  { task_type: 'architecture_scan',   skill: '/architect scan',     desc: '系统扫描，读代码' },
  { task_type: 'arch_review',         skill: '/arch-review review', desc: '架构巡检，读代码' },
  { task_type: 'dept_heartbeat',      skill: '/cecelia',            desc: '部门心跳' },
];

// C类固定 Codex 任务（只读）
const C_FIXED_ROWS: Array<{ task_type: string; location: string; skill: string; desc: string }> = [
  { task_type: 'codex_dev',          location: 'xian', skill: '/dev',              desc: 'Codex /dev，runner.sh 执行' },
  { task_type: 'codex_qa',           location: 'xian', skill: '/codex',            desc: 'Codex 免疫检查' },
  { task_type: 'codex_playwright',   location: 'xian', skill: '/playwright',       desc: 'Playwright 自动化 → CDP 控制西安PC' },
  { task_type: 'codex_test_gen',     location: 'xian', skill: '/codex-test-gen',   desc: '自动生成测试' },
  { task_type: 'pr_review',          location: 'xian', skill: '/review',           desc: '异步 PR 审查（独立账号）' },
  { task_type: 'content-pipeline',   location: 'xian', skill: '/content-creator',  desc: '内容工厂 Pipeline 入口' },
  { task_type: 'content-research',   location: 'xian', skill: '/notebooklm',       desc: '内容调研' },
  { task_type: 'content-generate',   location: 'xian', skill: '/content-creator',  desc: '内容生成' },
  { task_type: 'content-review',     location: 'xian', skill: '/content-creator',  desc: '内容审核' },
  { task_type: 'content-export',     location: 'xian', skill: '/content-creator',  desc: '内容导出' },
];

// C类动态任务（从 /api/cecelia/task-type-configs 加载，可切换机器）：
// suggestion_plan, strategy_session, knowledge, scope_plan, project_plan

// D类：香港VPS，纯脚本/轻量
const D_CLASS_ROWS: Array<{ task_type: string; skill: string; desc: string }> = [
  { task_type: 'explore',  skill: '/explore',   desc: '快速调研（MiniMax）' },
  { task_type: 'talk',     skill: '/cecelia',   desc: '对话（MiniMax）' },
  { task_type: 'research', skill: '/research',  desc: '深度调研（MiniMax）' },
  { task_type: 'data',     skill: '/sync-hk',   desc: '数据处理（N8N）' },
];

function DeviceBadge({ location }: { location: string }) {
  const label = DEVICE_LABELS[location] || location;
  const color = DEVICE_COLORS[location] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

const TABLE_HEADER = (
  <thead>
    <tr className="bg-gray-50 border-b border-gray-200">
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">任务类型</th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">路由到</th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Skill</th>
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">说明</th>
      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-16">操作</th>
    </tr>
  </thead>
);

function GroupBox({ title, subtitle, borderColor, headerBg, children }: {
  title: string; subtitle: string; borderColor: string; headerBg: string; children: React.ReactNode;
}) {
  return (
    <div className={`mb-5 rounded-xl border overflow-hidden ${borderColor}`}>
      <div className={`px-4 py-3 border-b ${borderColor} ${headerBg}`}>
        <div className="font-semibold text-sm text-gray-800">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>
      </div>
      <div className="bg-white">
        <table className="w-full text-sm">
          {TABLE_HEADER}
          <tbody className="divide-y divide-gray-100">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReadOnlyRow({ task_type, location, skill, desc }: {
  task_type: string; location: string; skill: string; desc: string;
}) {
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-800">{task_type}</td>
      <td className="px-4 py-2.5"><DeviceBadge location={location} /></td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{skill}</td>
      <td className="px-4 py-2.5 text-xs text-gray-400">{desc}</td>
      <td className="px-4 py-2.5 text-center">
        <span className="text-xs text-gray-300">固定</span>
      </td>
    </tr>
  );
}

function DynamicRow({ config, onEdit, onSave, onCancel, editing, editValues, setEditValues, saving, saved }: {
  config: TaskTypeConfig;
  onEdit: () => void; onSave: () => void; onCancel: () => void;
  editing: boolean; editValues: Partial<TaskTypeConfig>;
  setEditValues: (v: Partial<TaskTypeConfig>) => void;
  saving: boolean; saved: boolean;
}) {
  return (
    <tr className="hover:bg-amber-50/50 transition-colors bg-amber-50/20">
      <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-800">
        {config.task_type}
        <span className="ml-1.5 text-amber-400 text-xs">●</span>
      </td>
      <td className="px-4 py-2.5">
        {editing ? (
          <select
            value={editValues.location || config.location}
            onChange={e => setEditValues({ ...editValues, location: e.target.value as 'us' | 'hk' | 'xian' })}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value="us">美国M4</option>
            <option value="xian">西安M4</option>
          </select>
        ) : (
          <DeviceBadge location={config.location} />
        )}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{config.executor}</td>
      <td className="px-4 py-2.5 text-xs text-gray-400">{config.description || '-'}</td>
      <td className="px-4 py-2.5 text-center">
        {editing ? (
          <div className="flex items-center justify-center gap-1.5">
            <button onClick={onSave} disabled={saving}
              className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? '…' : '保存'}
            </button>
            <button onClick={onCancel}
              className="px-2.5 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300">
              取消
            </button>
          </div>
        ) : (
          <button onClick={onEdit}
            className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200">
            {saved ? '✓' : '编辑'}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function TaskTypeConfigPage() {
  const [dynamicConfigs, setDynamicConfigs] = useState<TaskTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<TaskTypeConfig>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/cecelia/task-type-configs');
      const data = await res.json();
      if (data.success) { setDynamicConfigs(data.configs); setError(null); }
      else setError(data.error || '加载失败');
    } catch { setError('网络错误'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const startEdit = (config: TaskTypeConfig) => {
    setEditing(config.task_type);
    setEditValues({ location: config.location, executor: config.executor });
  };
  const cancelEdit = () => { setEditing(null); setEditValues({}); };
  const saveEdit = async (taskType: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/cecelia/task-type-configs/${taskType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editValues),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(taskType); setTimeout(() => setSaved(null), 2000);
        setEditing(null); await fetchConfigs();
      } else setError(data.error || '保存失败');
    } catch { setError('保存失败'); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* 页头 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">任务路由配置</h1>
        <p className="mt-1 text-sm text-gray-500">
          按 ABCD 框架管理任务路由。<span className="text-amber-600 font-medium">● 橙色行</span>可编辑（C类动态任务）。
        </p>
      </div>

      {/* 类别说明卡片 */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          { label: 'A类', tag: '锁机器 + 锁模型', desc: '美国M4 · Claude Code only', color: 'border-blue-300 bg-blue-50' },
          { label: 'B类', tag: '锁机器', desc: '美国M4 · Claude Code 或 Codex', color: 'border-indigo-300 bg-indigo-50' },
          { label: 'C类', tag: '锁模型（Codex）', desc: '美国M4 或 西安M4 均可', color: 'border-amber-300 bg-amber-50' },
          { label: 'D类', tag: '纯脚本', desc: '香港VPS · 无大模型', color: 'border-red-300 bg-red-50' },
        ].map(c => (
          <div key={c.label} className={`rounded-lg border p-3 ${c.color}`}>
            <div className="font-bold text-base text-gray-800">{c.label}</div>
            <div className="text-xs font-medium text-gray-600 mt-0.5">{c.tag}</div>
            <div className="text-xs text-gray-400 mt-1">{c.desc}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* A类 */}
      <GroupBox
        title="A类 — 锁机器 + 锁模型"
        subtitle="必须在美国M4上，必须用 Claude Code，不可替换"
        borderColor="border-blue-200"
        headerBg="bg-blue-50"
      >
        <ReadOnlyRow task_type="dev" location="us" skill="/dev" desc="主力开发（Opus + /dev 全流程）" />
      </GroupBox>

      {/* B类 */}
      <GroupBox
        title="B类 — 锁机器（美国M4）"
        subtitle="需要本机代码/worktree/Brain DB 上下文，Claude Code 或 Codex 均可"
        borderColor="border-indigo-200"
        headerBg="bg-indigo-50"
      >
        {B_CLASS_ROWS.map(row => (
          <ReadOnlyRow key={row.task_type} task_type={row.task_type} location="us" skill={row.skill} desc={row.desc} />
        ))}
      </GroupBox>

      {/* C类 */}
      <GroupBox
        title="C类 — Codex，不锁机器"
        subtitle="美国M4 或 西安M4 均可。固定行当前在西安M4；动态行（● 橙色）可切换机器"
        borderColor="border-amber-200"
        headerBg="bg-amber-50"
      >
        {C_FIXED_ROWS.map(row => (
          <ReadOnlyRow key={row.task_type} task_type={row.task_type} location={row.location} skill={row.skill} desc={row.desc} />
        ))}
        {!loading && dynamicConfigs.length > 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-2 bg-amber-50 border-t border-amber-200">
              <span className="text-xs font-medium text-amber-700">● 动态配置（可切换机器）</span>
            </td>
          </tr>
        )}
        {loading ? (
          <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400 text-xs">加载中...</td></tr>
        ) : (
          dynamicConfigs.map(config => (
            <DynamicRow
              key={config.task_type}
              config={config}
              onEdit={() => startEdit(config)}
              onSave={() => saveEdit(config.task_type)}
              onCancel={cancelEdit}
              editing={editing === config.task_type}
              editValues={editValues}
              setEditValues={setEditValues}
              saving={saving}
              saved={saved === config.task_type}
            />
          ))
        )}
      </GroupBox>

      {/* D类 */}
      <GroupBox
        title="D类 — 香港VPS（纯脚本/轻量）"
        subtitle="MiniMax / N8N，无需大模型推理，香港 VPS 执行"
        borderColor="border-red-200"
        headerBg="bg-red-50"
      >
        {D_CLASS_ROWS.map(row => (
          <ReadOnlyRow key={row.task_type} task_type={row.task_type} location="hk" skill={row.skill} desc={row.desc} />
        ))}
      </GroupBox>

      <p className="mt-2 text-xs text-gray-400">
        保存 C类动态配置后 Brain 立即生效，无需重启。西安PC（CDP被控端）和西安M1（L4 CI Runner）不参与任务路由。
      </p>
    </div>
  );
}
