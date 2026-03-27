import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Zap, GitBranch, Server, CheckCircle, Clock, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface ModuleItem {
  id: string;
  title: string;
  desc: string;
  priority: string;
  status: string;
  output_url: string | null;
  source_files: string[];
  completed: string | null;
}

interface ModuleGroup {
  id: string;
  label: string;
  items: ModuleItem[];
}

interface ModulesData {
  meta: {
    total?: number;
    done?: number;
    last_updated?: string;
  };
  groups: ModuleGroup[];
}

const GROUP_ICONS: Record<string, React.ElementType> = {
  brain: Brain,
  engine: Zap,
  workflows: GitBranch,
  system: Server,
};

const GROUP_ACCENT: Record<string, string> = {
  brain: '#3467D6',
  engine: '#a855f7',
  workflows: '#22c55e',
  system: '#f97316',
};

const PRIORITY_COLOR: Record<string, { bg: string; text: string }> = {
  P0: { bg: '#3a1515', text: '#f87171' },
  P1: { bg: '#3a2e10', text: '#fbbf24' },
  P2: { bg: '#1a1a1a', text: '#666' },
};

function ModuleCard({ item, groupId }: { item: ModuleItem; groupId: string }) {
  const navigate = useNavigate();
  const isDone = item.status === 'done';
  const pColor = PRIORITY_COLOR[item.priority] || PRIORITY_COLOR.P2;

  return (
    <button
      onClick={() => navigate(`/knowledge/modules/${groupId}/${item.id}`)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: '#111',
        border: '1px solid #222',
        borderRadius: '10px',
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
        (e.currentTarget as HTMLButtonElement).style.background = '#161616';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#222';
        (e.currentTarget as HTMLButtonElement).style.background = '#111';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', lineHeight: '1.4', flex: 1 }}>
          {item.title}
        </span>
        <span style={{
          flexShrink: 0,
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: '4px',
          background: pColor.bg,
          color: pColor.text,
          fontFamily: 'monospace',
        }}>
          {item.priority}
        </span>
      </div>
      <p style={{ fontSize: '12px', color: '#666', margin: '0 0 10px', lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {item.desc}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: isDone ? '#22c55e' : '#555' }}>
          {isDone ? <CheckCircle size={11} /> : <Clock size={11} />}
          <span>{isDone ? '已完成' : '待生成'}</span>
        </div>
        <ChevronRight size={13} color="#333" />
      </div>
    </button>
  );
}

function GroupSection({ group }: { group: ModuleGroup }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = GROUP_ICONS[group.id] || Server;
  const accent = GROUP_ACCENT[group.id] || '#555';
  const doneCount = group.items.filter(i => i.status === 'done').length;
  const pct = group.items.length > 0 ? Math.round((doneCount / group.items.length) * 100) : 0;

  return (
    <div style={{ marginBottom: '32px' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '12px',
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: accent + '22',
          border: `1px solid ${accent}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={15} color={accent} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{group.label}</div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
            {doneCount}/{group.items.length} 已完成 · {pct}%
          </div>
        </div>
        {expanded ? <ChevronDown size={14} color="#444" /> : <ChevronRight size={14} color="#444" />}
      </button>

      {/* 进度条 */}
      <div style={{ height: '2px', background: '#1a1a1a', borderRadius: '2px', marginBottom: '16px' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: '2px', transition: 'width 0.3s' }} />
      </div>

      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
          {group.items.map(item => (
            <ModuleCard key={item.id} item={item} groupId={group.id} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeModules() {
  const { data, loading, error } = useApi<ModulesData>(
    '/api/brain/knowledge/modules',
    { staleTime: 300_000 }
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px', color: '#555' }}>
        加载中...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#f87171' }}>
        加载失败：{error || '未知错误'}
      </div>
    );
  }

  const { meta, groups } = data;

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100%', padding: '32px' }}>
      {/* 标题区 */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: '#3467D622',
          border: '1px solid #3467D644',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Layers size={18} color="#3467D6" />
        </div>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0 }}>知识模块</h1>
          <p style={{ fontSize: '12px', color: '#555', margin: '3px 0 0' }}>
            共 {meta.total ?? 0} 个模块 · 已完成 {meta.done ?? 0} 个
            {meta.last_updated && ` · 更新于 ${meta.last_updated}`}
          </p>
        </div>
      </div>

      {/* 总进度条 */}
      {(meta.total ?? 0) > 0 && (
        <div style={{ marginBottom: '32px', background: '#111', border: '1px solid #1a1a1a', borderRadius: '10px', padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>整体完成度</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#3467D6', fontFamily: 'monospace' }}>
              {Math.round(((meta.done ?? 0) / (meta.total ?? 1)) * 100)}%
            </span>
          </div>
          <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '4px' }}>
            <div style={{
              height: '100%',
              width: `${Math.round(((meta.done ?? 0) / (meta.total ?? 1)) * 100)}%`,
              background: 'linear-gradient(90deg, #3467D6, #01C7D2)',
              borderRadius: '4px',
              transition: 'width 0.5s',
            }} />
          </div>
        </div>
      )}

      {/* 模块分组 */}
      {groups.map(group => (
        <GroupSection key={group.id} group={group} />
      ))}
    </div>
  );
}
