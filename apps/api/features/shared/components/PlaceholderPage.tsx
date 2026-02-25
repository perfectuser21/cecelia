import React from 'react';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: string;
}

export default function PlaceholderPage({ title, description, icon = '🚧' }: PlaceholderPageProps) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>{icon}</div>
      <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>{title}</h1>
      {description && (
        <p style={{ color: '#64748b', fontSize: '14px' }}>{description}</p>
      )}
    </div>
  );
}
