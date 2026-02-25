import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface HomeCard {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  desc?: string;
}

export interface HomeGroup {
  title: string;
  items: HomeCard[];
}

interface GenericHomeProps {
  title: string;
  icon: LucideIcon;
  /** Flat list of cards (simple layout) */
  cards?: HomeCard[];
  /** Grouped cards (SystemHome-style layout) */
  groups?: HomeGroup[];
  /** Grid column min-width, default 240px */
  minCardWidth?: number;
}

export default function GenericHome({ title, icon: TitleIcon, cards, groups, minCardWidth = 240 }: GenericHomeProps) {
  const navigate = useNavigate();

  const renderCard = (item: HomeCard) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id || item.path}
        onClick={() => navigate(item.path)}
        style={{
          display: 'flex',
          flexDirection: item.desc ? 'column' : 'row',
          alignItems: item.desc ? 'stretch' : 'center',
          gap: '8px',
          padding: item.desc ? '20px' : '12px 16px',
          borderRadius: item.desc ? '12px' : '8px',
          border: '1px solid #333',
          background: 'transparent',
          color: '#ccc',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '14px',
        }}
      >
        <Icon size={item.desc ? 20 : 16} />
        <span style={{ fontSize: item.desc ? '15px' : '14px', fontWeight: 500, color: '#fff' }}>
          {item.label}
        </span>
        {item.desc && <span style={{ fontSize: '13px', color: '#888' }}>{item.desc}</span>}
      </button>
    );
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <TitleIcon size={24} />
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>{title}</h1>
      </div>

      {cards && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
          gap: '16px',
        }}>
          {cards.map(renderCard)}
        </div>
      )}

      {groups && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {groups.map(group => (
            <div key={group.title}>
              <h2 style={{ fontSize: '16px', fontWeight: 500, color: '#888', marginBottom: '12px' }}>
                {group.title}
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
                gap: '12px',
              }}>
                {group.items.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
