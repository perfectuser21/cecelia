import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { observabilityApi, type FailureStats } from '../../api/observability.api';

const REASON_KIND_COLORS = {
  TRANSIENT: '#fbbf24', // yellow
  PERSISTENT: '#ef4444', // red
  RESOURCE: '#f97316', // orange
  CONFIG: '#a855f7', // purple
  UNKNOWN: '#9ca3af', // gray
};

export function FailureAnalysisChart() {
  const [failures, setFailures] = useState<FailureStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFailures = async () => {
      try {
        const response = await observabilityApi.getTopFailures(10);
        setFailures(response.data.data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch failures');
      } finally {
        setLoading(false);
      }
    };

    fetchFailures();
    const interval = setInterval(fetchFailures, 30000); // 30 秒刷新
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="text-center text-gray-500">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded">
        <p className="text-red-600">Error: {error}</p>
      </div>
    );
  }

  if (failures.length === 0) {
    return <div className="text-center text-gray-500">No failures recorded</div>;
  }

  return (
    <div>
      <h3 className="font-semibold text-lg mb-4">Top 10 Failure Reasons</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={failures}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="reason_code" angle={-45} textAnchor="end" height={100} />
          <YAxis />
          <Tooltip />
          <Bar 
            dataKey="count" 
            fill={(entry: any) => REASON_KIND_COLORS[entry.reason_kind as keyof typeof REASON_KIND_COLORS] || '#9ca3af'}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
