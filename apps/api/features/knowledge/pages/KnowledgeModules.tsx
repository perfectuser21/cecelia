import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Zap, GitBranch, Server, CheckCircle, Clock, ChevronRight } from 'lucide-react';
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

const PRIORITY_STYLE: Record<string, React.CSSProperties> = {
  P0: { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' },
  P1: { background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)' },
  P2: { background: 'rgba(107,114,128,0.15)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.2)' },
};

function ModuleCard({ item, groupId }: { item: ModuleItem; groupId: string }) {
  const navigate = useNavigate();
  const isDone = item.status === 'done';

  return (
    <button
      onClick={() => navigate(`/knowledge/modules/${groupId}/${item.id}`)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: '#141414',
        border: '1px solid #222',
        borderRadius: '10px',
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
        (e.currentTarget as HTMLButtonElement).style.background = '#1a1a1a';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#222';
        (e.currentTarget as HTMLButtonElement).style.background = '#141414';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', lineHeight: '1.4' }}>
          {item.title}
        </span>
        <span style={{
          flexShrink: 0,
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: '4px',
          ...(PRIORITY_STYLE[item.priority] || PRIORITY_STYLE.P2),
        }}>
          {item.priority}
        </span>
      </div>
      <p style={{ fontSize: '12px', color: '#666', margin: '0 0 10px', lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {item.desc}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: isDone ? '#4ade80' : '#555' }}>
          {isDone ? <CheckCircle size={11} /> : <Clock size={11} />}
          <span>{isDone ? '已完成' : '待生成'}</span>
        </div>
        <ChevronRight size={13} color="#444" />
      </div>
    </button>
  );
}

function GroupSection({ group }: { group: ModuleGroup }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = GROUP_ICONS[group.id] || Server;
  const accent = GROUP_ACCENT[group.id] || '#888';
  const doneCount = group.items.filter(i => i.status === 'done').length;

  return (
    <div style={{ marginBottom: '32px' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '14px',
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <div style={{
          width: '32px', height: '32px',
          borderRadius: '8px',
          background: `${accent}22`,
          border: `1px solid ${accent}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon size={15} color={accent} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>{group.label}</div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '1px' }}>{doneCount}/{group.items.length} 已完成</div>
        </div>
        <ChevronRight
          size={14}
          color="#444"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
        <div style={{
          width: '28px', height: '28px',
          border: '3px solid #3467D6',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: '#f87171', fontSize: '14px' }}>
        加载失败：{error || '未知错误'}
      </div>
    );
  }

  const { meta, groups } = data;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 4px', background: '#0d0d0d' }}>
      {/* 标题区 */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>知识模块</h1>
        <p style={{ fontSize: '13px', color: '#555', margin: 0 }}>
          Cecelia 系统深度知识页 · 共 {meta.total ?? 0} 个模块，已完成 {meta.done ?? 0} 个
          {meta.last_updated && ` · 更新于 ${meta.last_updated}`}
        </p>
      </div>

      {/* 模块分组 */}
      {groups.map(group => (
        <GroupSection key={group.id} group={group} />
      ))}
    </div>
  );
}
