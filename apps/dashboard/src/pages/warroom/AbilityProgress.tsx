import { groupByStatus, AdvancementItem } from './advancement-util';

interface Props {
  abilityName: string;
  items: AdvancementItem[];
}

const COLS: { key: 'done' | 'doing' | 'todo'; label: string; mark: string }[] = [
  { key: 'done', label: '已完成', mark: '✓' },
  { key: 'doing', label: '进行中', mark: '⟳' },
  { key: 'todo', label: '待推进', mark: '○' },
];

export function AbilityProgress({ abilityName, items }: Props) {
  const g = groupByStatus(items);
  return (
    <div className="ability-progress" style={{ padding: 12, borderBottom: '1px solid #2a2a2a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span>{abilityName}</span>
        <span data-testid="progress-pct">{g.pct}%（{g.done.length}/{g.total}）</span>
      </div>
      <div style={{ height: 8, background: '#333', borderRadius: 4, overflow: 'hidden' }}>
        <div
          data-testid="progress-fill"
          style={{ width: `${g.pct}%`, height: '100%', background: '#4caf50', transition: 'width .3s' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {COLS.map(col => (
          <div key={col.key} style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {col.mark} {col.label}（<span data-testid={`col-${col.key}-count`}>{g[col.key].length}</span>）
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
              {g[col.key].map(it => (<li key={it.id}>{it.title}</li>))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
