/**
 * TaskTypeConfigPage — 全量任务类型路由总览
 * 路由：/task-type-configs
 * 显示所有任务类型（来自 LOCATION_MAP），按类别分组
 * 固定行只读，B类纯策略动态行可编辑
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

// 静态分组（固定路由，只读）
const STATIC_GROUPS: Array<{
  label: string;
  color: string;
  rows: Array<{ task_type: string; location: string; skill: string; desc: string }>;
}> = [
  {
    label: 'A类 — 开发执行',
    color: 'bg-blue-50 border-blue-200',
    rows: [
      { task_type: 'dev',               location: 'us',   skill: '/dev',              desc: '主力开发（Nobel + Opus + /dev）' },
      { task_type: 'initiative_execute',location: 'us',   skill: '/dev',              desc: 'Initiative 执行，/dev 全流程' },
      { task_type: 'intent_expand',     location: 'us',   skill: '/intent-expand',    desc: '意图扩展，读 Brain DB 补全 PRD' },
      { task_type: 'pipeline_rescue',   location: 'us',   skill: '/dev',              desc: 'Pipeline 救援，读 .dev-mode + worktree' },
    ],
  },
  {
    label: 'B类 — Coding Pathway（固定 US）',
    color: 'bg-indigo-50 border-indigo-200',
    rows: [
      { task_type: 'code_review',       location: 'us',   skill: '/code-review',      desc: '代码审查，读代码上下文' },
      { task_type: 'code_review_gate',  location: 'us',   skill: '/code-review-gate', desc: '代码质量门禁（push 前审查）' },
      { task_type: 'prd_review',        location: 'us',   skill: '/prd-review',       desc: 'PRD 审查' },
      { task_type: 'spec_review',       location: 'us',   skill: '/spec-review',      desc: 'Spec 审查' },
      { task_type: 'initiative_review', location: 'us',   skill: '/initiative-review',desc: 'Initiative 整体审查' },
      { task_type: 'initiative_plan',   location: 'us',   skill: '/decomp',           desc: 'Initiative 规划，读现有代码' },
      { task_type: 'initiative_verify', location: 'us',   skill: '/arch-review verify', desc: 'Initiative 验收，核查代码实现' },
      { task_type: 'decomp_review',     location: 'us',   skill: '/decomp-check',     desc: '拆解审查（Vivian 角色）' },
      { task_type: 'architecture_design', location: 'us', skill: '/architect design', desc: '架构设计，读代码' },
      { task_type: 'architecture_scan', location: 'us',   skill: '/architect scan',   desc: '系统扫描，读代码' },
      { task_type: 'arch_review',       location: 'us',   skill: '/arch-review review', desc: '架构巡检，读代码' },
      { task_type: 'review',            location: 'us',   skill: '/code-review',      desc: '通用代码审查' },
      { task_type: 'qa',                location: 'us',   skill: '/code-review',      desc: 'QA' },
      { task_type: 'audit',             location: 'us',   skill: '/code-review',      desc: '审计' },
      { task_type: 'dept_heartbeat',    location: 'us',   skill: '/cecelia',          desc: '部门心跳（MiniMax 高速）' },
    ],
  },
  {
    label: '西安Codex机群（固定 西安M4）',
    color: 'bg-amber-50 border-amber-200',
    rows: [
      { task_type: 'codex_dev',         location: 'xian', skill: '/dev',              desc: 'Codex /dev，runner.sh 执行' },
      { task_type: 'codex_qa',          location: 'xian', skill: '/codex',            desc: 'Codex 免疫检查' },
      { task_type: 'codex_playwright',  location: 'xian', skill: '/playwright',       desc: 'Playwright 自动化 → CDP 控制西安PC' },
      { task_type: 'codex_test_gen',    location: 'xian', skill: '/codex-test-gen',   desc: '自动生成测试，扫描覆盖率低模块' },
      { task_type: 'pr_review',         location: 'xian', skill: '/review',           desc: '异步 PR 审查（MiniMax 独立账号）' },
    ],
  },
  {
    label: '香港VPS（固定 香港VPS）',
    color: 'bg-red-50 border-red-200',
    rows: [
      { task_type: 'explore',           location: 'hk',   skill: '/explore',          desc: '快速调研（MiniMax 快速）' },
      { task_type: 'talk',              location: 'hk',   skill: '/cecelia',          desc: '对话（MiniMax）' },
      { task_type: 'research',          location: 'hk',   skill: '/research',         desc: '深度调研（MiniMax）' },
      { task_type: 'data',              location: 'hk',   skill: '/sync-hk',          desc: '数据处理（N8N）' },
    ],
  },
  {
    label: '内容工厂（固定 西安M4）',
    color: 'bg-green-50 border-green-200',
    rows: [
      { task_type: 'content-pipeline',  location: 'xian', skill: '/content-creator',  desc: 'Pipeline 编排入口' },
      { task_type: 'content-research',  location: 'xian', skill: '/notebooklm',       desc: '调研阶段' },
      { task_type: 'content-generate',  location: 'xian', skill: '/content-creator',  desc: '生成阶段' },
      { task_type: 'content-review',    location: 'xian', skill: '/content-creator',  desc: '审核阶段（纯规则检查）' },
      { task_type: 'content-export',    location: 'xian', skill: '/content-creator',  desc: '导出阶段（card-renderer.mjs）' },
    ],
  },
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
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editing: boolean;
  editValues: Partial<TaskTypeConfig>;
  setEditValues: (v: Partial<TaskTypeConfig>) => void;
  saving: boolean;
  saved: boolean;
}) {
  return (
    <tr className="hover:bg-yellow-50 transition-colors bg-yellow-50/30">
      <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-800">
        {config.task_type}
        <span className="ml-1.5 text-yellow-500 text-xs">●</span>
      </td>
      <td className="px-4 py-2.5">
        {editing ? (
          <select
            value={editValues.location || config.location}
            onChange={e => setEditValues({ ...editValues, location: e.target.value as 'us' | 'hk' | 'xian' })}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value="us">美国M4</option>
            <option value="hk">香港VPS</option>
            <option value="xian">西安M4</option>
          </select>
        ) : (
          <DeviceBadge location={config.location} />
        )}
      </td>
      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
        {editing ? (
          <input
            value={editValues.executor || ''}
            onChange={e => setEditValues({ ...editValues, executor: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1 text-xs w-28"
          />
        ) : (
          config.executor
        )}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-400">
        {config.description || '-'}
      </td>
      <td className="px-4 py-2.5 text-center">
        {editing ? (
          <div className="flex items-center justify-center gap-1.5">
            <button
              onClick={onSave}
              disabled={saving}
              className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              onClick={onCancel}
              className="px-2.5 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
          >
            {saved ? '✓ 已保存' : '编辑'}
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
      if (data.success) {
        setDynamicConfigs(data.configs);
        setError(null);
      } else {
        setError(data.error || '加载失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const startEdit = (config: TaskTypeConfig) => {
    setEditing(config.task_type);
    setEditValues({ location: config.location, executor: config.executor, skill: config.skill || '' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValues({});
  };

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
        setSaved(taskType);
        setTimeout(() => setSaved(null), 2000);
        setEditing(null);
        await fetchConfigs();
      } else {
        setError(data.error || '保存失败');
      }
    } catch {
      setError('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const TABLE_HEADER = (
    <thead>
      <tr className="bg-gray-50 border-b border-gray-200">
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">任务类型</th>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">路由到</th>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Skill / Executor</th>
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">说明</th>
        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
      </tr>
    </thead>
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* 页头 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">任务类型路由总览</h1>
        <p className="mt-1 text-sm text-gray-500">
          所有任务类型的路由配置（来自 LOCATION_MAP）。<span className="text-yellow-600 font-medium">● 黄色行</span>为可动态编辑项，其余固定。
        </p>
      </div>

      {/* 设备图例 */}
      <div className="mb-5 flex flex-wrap gap-3">
        {Object.entries(DEVICE_LABELS).map(([key, label]) => (
          <div key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs ${DEVICE_COLORS[key]} border-current/20`}>
            <span className="font-medium">{label}</span>
            <span className="opacity-60">({key})</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-400">
          <span>西安PC</span>
          <span className="opacity-60">CDP 被控端</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-400">
          <span>西安M1</span>
          <span className="opacity-60">L4 CI Runner</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 静态分组 */}
      {STATIC_GROUPS.map(group => (
        <div key={group.label} className={`mb-5 rounded-xl border overflow-hidden ${group.color}`}>
          <div className={`px-4 py-2.5 border-b ${group.color} font-medium text-sm text-gray-700`}>
            {group.label}
          </div>
          <div className="bg-white">
            <table className="w-full text-sm">
              {TABLE_HEADER}
              <tbody className="divide-y divide-gray-100">
                {group.rows.map(row => (
                  <ReadOnlyRow key={row.task_type} {...row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* 动态分组：B类纯策略 */}
      <div className="mb-5 rounded-xl border overflow-hidden border-yellow-300 bg-yellow-50">
        <div className="px-4 py-2.5 border-b border-yellow-300 font-medium text-sm text-yellow-800 flex items-center gap-2">
          <span>B类 — 纯策略（可动态配置）</span>
          <span className="text-yellow-500 text-xs">● 可编辑</span>
        </div>
        <div className="bg-white">
          <table className="w-full text-sm">
            {TABLE_HEADER}
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">加载中...</td>
                </tr>
              ) : dynamicConfigs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-sm">暂无动态配置项</td>
                </tr>
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
            </tbody>
          </table>
        </div>
      </div>

      {/* 页脚说明 */}
      <div className="mt-2 text-xs text-gray-400 space-y-1">
        <p>保存动态配置后 Brain 立即生效，无需重启。</p>
        <p>西安PC（Windows，100.97.242.124）仅作 Playwright CDP 被控端；西安M1（100.103.88.66）仅作 L4 CI Runner，不参与任务路由。</p>
      </div>
    </div>
  );
}
