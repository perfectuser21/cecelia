import { useEffect, useState } from 'react';
import {
  Shield,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCode,
  ChevronDown,
} from 'lucide-react';

interface DevGateData {
  window: {
    since: string;
    until: string;
  };
  summary: {
    total_tests: number;
    p0_count: number;
    p1_count: number;
    rci_coverage: {
      total: number;
      covered: number;
      pct: number;
    };
    manual_tests: number;
  };
  new_rci: Array<{
    file: string;
    function: string;
    reason: string;
  }>;
}

interface LogEntry {
  received_at: string;
  month: string;
  source: string;
}

function generateMonthOptions(): string[] {
  const options: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    options.push(`${year}-${month}`);
  }
  return options;
}

export default function DevGateMetrics() {
  const [data, setData] = useState<DevGateData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthOptions = generateMonthOptions();

  const loadData = async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, logRes] = await Promise.all([
        fetch(`/api/devgate/metrics?month=${month}`),
        fetch('/api/devgate/log'),
      ]);

      const metricsData = await metricsRes.json();
      const logData = await logRes.json();

      if (metricsData.data) {
        setData(metricsData.data);
      } else {
        setData(null);
      }

      if (logData.lastUpdate) {
        setLastUpdate(logData.lastUpdate);
      } else {
        setLastUpdate(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedMonth);
  }, [selectedMonth]);

  const formatDate = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-7 h-7" />
            DevGate Metrics
          </h1>
          <p className="text-gray-400 mt-1">
            {lastUpdate
              ? `Last updated: ${formatDate(lastUpdate.received_at)}`
              : 'No updates yet'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="appearance-none bg-white/5 border border-white/10 rounded-lg px-4 py-2 pr-8 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m} className="bg-gray-900">
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          <button
            onClick={() => loadData(selectedMonth)}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {!data ? (
        <div className="bg-white/5 rounded-lg border border-white/10 p-8 text-center">
          <Clock className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No metrics yet</h3>
          <p className="text-gray-400">Waiting for nightly push from engine...</p>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* P0 Count */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="flex items-center gap-2 text-gray-400">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span>P0 Issues</span>
              </div>
              <div
                className={`text-3xl font-bold mt-1 ${
                  data.summary.p0_count > 0 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {data.summary.p0_count}
              </div>
            </div>

            {/* P1 Count */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="flex items-center gap-2 text-gray-400">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span>P1 Issues</span>
              </div>
              <div
                className={`text-3xl font-bold mt-1 ${
                  data.summary.p1_count > 0 ? 'text-yellow-400' : 'text-emerald-400'
                }`}
              >
                {data.summary.p1_count}
              </div>
            </div>

            {/* RCI Coverage */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="flex items-center gap-2 text-gray-400">
                <CheckCircle2 className="w-4 h-4 text-blue-400" />
                <span>RCI Coverage</span>
              </div>
              <div className="text-3xl font-bold text-white mt-1">
                {data.summary.rci_coverage.pct.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {data.summary.rci_coverage.covered} / {data.summary.rci_coverage.total}
              </div>
            </div>

            {/* Manual Tests */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="flex items-center gap-2 text-gray-400">
                <FileCode className="w-4 h-4 text-purple-400" />
                <span>Manual Tests</span>
              </div>
              <div className="text-3xl font-bold text-white mt-1">
                {data.summary.manual_tests}
              </div>
            </div>
          </div>

          {/* Time Window */}
          <div className="bg-white/5 rounded-lg p-4 border border-white/10">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Time Window</h3>
            <p className="text-white">
              {formatDate(data.window.since)} - {formatDate(data.window.until)}
            </p>
          </div>

          {/* New RCI List */}
          {data.new_rci && data.new_rci.length > 0 && (
            <div className="bg-white/5 rounded-lg border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h3 className="text-lg font-medium text-white">
                  New RCI ({data.new_rci.length})
                </h3>
                <p className="text-sm text-gray-400">
                  Recently added to Required Code Investigation list
                </p>
              </div>
              <div className="divide-y divide-white/5">
                {data.new_rci.map((item, idx) => (
                  <div key={idx} className="px-4 py-3 hover:bg-white/5">
                    <div className="flex items-start gap-3">
                      <FileCode className="w-4 h-4 text-blue-400 mt-1 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-white truncate">
                          {item.file}
                        </div>
                        <div className="text-sm text-blue-400 mt-0.5">
                          {item.function}
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                          {item.reason}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
