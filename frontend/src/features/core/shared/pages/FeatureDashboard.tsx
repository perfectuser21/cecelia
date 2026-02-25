import { useState, useMemo } from 'react';
import {
  features,
  getFeatureStats,
  getFeatureDependencies,
  getFeatureDependents,
  type Feature,
  type FeatureCategory,
  type FeatureInstance,
  type FeaturePriority,
  type FeatureStatus,
} from '../data/features-data';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Search, Filter, X, Check, Layers, Zap, AlertCircle, TrendingUp } from 'lucide-react';

const COLORS = {
  Foundation: '#3b82f6',
  Business: '#10b981',
  Platform: '#8b5cf6',
  P0: '#ef4444',
  P1: '#f59e0b',
  P2: '#10b981',
  P3: '#6b7280',
  done: '#10b981',
  'in-progress': '#f59e0b',
  planned: '#6b7280',
};

export default function FeatureDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<FeatureCategory[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<FeatureInstance[]>([]);
  const [selectedPriority, setSelectedPriority] = useState<FeaturePriority[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<FeatureStatus[]>([]);
  const [filterRci, setFilterRci] = useState<boolean | null>(null);
  const [filterGoldenPath, setFilterGoldenPath] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [currentTab, setCurrentTab] = useState<'category' | 'instance' | 'priority' | 'status'>('category');

  const stats = getFeatureStats();

  // 筛选逻辑
  const filteredFeatures = useMemo(() => {
    return features.filter((f) => {
      // 搜索
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (
          !f.id.toLowerCase().includes(term) &&
          !f.name.toLowerCase().includes(term) &&
          !f.description.toLowerCase().includes(term)
        ) {
          return false;
        }
      }

      // 实例过滤（Core 实例默认只看 Core 或同时支持两个实例的）
      if (!showAll && !f.instances.includes('core')) {
        return false;
      }

      // Category 筛选
      if (selectedCategory.length > 0 && !selectedCategory.includes(f.category)) {
        return false;
      }

      // Instance 筛选
      if (selectedInstance.length > 0 && !f.instances.some((i) => selectedInstance.includes(i))) {
        return false;
      }

      // Priority 筛选
      if (selectedPriority.length > 0 && !selectedPriority.includes(f.priority)) {
        return false;
      }

      // Status 筛选
      if (selectedStatus.length > 0 && !selectedStatus.includes(f.status)) {
        return false;
      }

      // RCI 筛选
      if (filterRci !== null && f.hasRci !== filterRci) {
        return false;
      }

      // Golden Path 筛选
      if (filterGoldenPath !== null && f.hasGoldenPath !== filterGoldenPath) {
        return false;
      }

      return true;
    });
  }, [
    searchTerm,
    selectedCategory,
    selectedInstance,
    selectedPriority,
    selectedStatus,
    filterRci,
    filterGoldenPath,
    showAll,
  ]);

  // 图表数据
  const chartData = useMemo(() => {
    if (currentTab === 'category') {
      return [
        { name: 'Foundation', value: stats.byCategory.Foundation },
        { name: 'Business', value: stats.byCategory.Business },
        { name: 'Platform', value: stats.byCategory.Platform },
      ];
    } else if (currentTab === 'instance') {
      return [
        { name: 'Autopilot', value: stats.byInstance.autopilot },
        { name: 'Core', value: stats.byInstance.core },
        { name: 'Both', value: stats.byInstance.both },
      ];
    } else if (currentTab === 'priority') {
      return [
        { name: 'P0', value: stats.byPriority.P0 },
        { name: 'P1', value: stats.byPriority.P1 },
        { name: 'P2', value: stats.byPriority.P2 },
      ];
    } else {
      return [
        { name: 'Done', value: stats.byStatus.done },
        { name: 'In Progress', value: stats.byStatus['in-progress'] },
      ];
    }
  }, [currentTab, stats]);

  return (
    <div className="p-6 space-y-6">
      {/* 标题 */}
      <div>
        <h1 className="text-3xl font-bold">Features Dashboard</h1>
        <p className="text-gray-600 mt-2">管理和监控所有 Features 的状态和统计</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">Total Features</p>
              <p className="text-3xl font-bold mt-2">{stats.total}</p>
            </div>
            <Layers className="w-12 h-12 text-blue-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">Total Sub-features</p>
              <p className="text-3xl font-bold mt-2">{stats.subFeaturesTotal}</p>
            </div>
            <Zap className="w-12 h-12 text-green-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">RCI Coverage</p>
              <p className="text-3xl font-bold mt-2">
                {stats.rciCoverage}% <span className="text-base text-gray-600">({stats.withRci}/{stats.total})</span>
              </p>
            </div>
            <AlertCircle className="w-12 h-12 text-orange-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">Golden Path Coverage</p>
              <p className="text-3xl font-bold mt-2">
                {stats.goldenPathCoverage}%{' '}
                <span className="text-base text-gray-600">({stats.withGoldenPath}/{stats.total})</span>
              </p>
            </div>
            <TrendingUp className="w-12 h-12 text-purple-500 opacity-20" />
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="bg-white rounded-lg p-6 shadow">
        <div className="flex space-x-4 border-b mb-4">
          <button
            onClick={() => setCurrentTab('category')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              currentTab === 'category' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600'
            }`}
          >
            按层级
          </button>
          <button
            onClick={() => setCurrentTab('instance')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              currentTab === 'instance' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600'
            }`}
          >
            按实例
          </button>
          <button
            onClick={() => setCurrentTab('priority')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              currentTab === 'priority' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600'
            }`}
          >
            按优先级
          </button>
          <button
            onClick={() => setCurrentTab('status')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              currentTab === 'status' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600'
            }`}
          >
            按状态
          </button>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 搜索和筛选 */}
      <div className="bg-white rounded-lg p-6 shadow space-y-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="搜索 Features..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm">显示所有实例</span>
          </label>
        </div>

        {/* 筛选器 */}
        <div className="flex flex-wrap gap-2">
          {(['Foundation', 'Business', 'Platform'] as FeatureCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() =>
                setSelectedCategory((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]))
              }
              className={`px-3 py-1 rounded text-sm ${
                selectedCategory.includes(cat)
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Feature 列表 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instance</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">RCI</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">GP</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredFeatures.map((feature) => (
              <tr key={feature.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{feature.id}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{feature.name}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: COLORS[feature.category] + '20',
                      color: COLORS[feature.category],
                    }}
                  >
                    {feature.category}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex gap-1">
                    {feature.instances.map((inst) => (
                      <span key={inst} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                        {inst}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: COLORS[feature.priority] + '20',
                      color: COLORS[feature.priority],
                    }}
                  >
                    {feature.priority}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: COLORS[feature.status] + '20',
                      color: COLORS[feature.status],
                    }}
                  >
                    {feature.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  {feature.hasRci ? (
                    <Check className="w-5 h-5 text-green-500 inline" />
                  ) : (
                    <X className="w-5 h-5 text-gray-300 inline" />
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  {feature.hasGoldenPath ? (
                    <Check className="w-5 h-5 text-green-500 inline" />
                  ) : (
                    <X className="w-5 h-5 text-gray-300 inline" />
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => setSelectedFeature(feature)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Feature 详情抽屉 */}
      {selectedFeature && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-end"
          onClick={() => setSelectedFeature(null)}
        >
          <div
            className="bg-white w-full max-w-2xl h-full overflow-y-auto p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold">{selectedFeature.name}</h2>
                <p className="text-gray-600">{selectedFeature.id}</p>
              </div>
              <button onClick={() => setSelectedFeature(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg mb-2">基础信息</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Category</p>
                    <p className="font-medium">{selectedFeature.category}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Priority</p>
                    <p className="font-medium">{selectedFeature.priority}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Owner</p>
                    <p className="font-medium">{selectedFeature.owner}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <p className="font-medium">{selectedFeature.status}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">描述</h3>
                <p className="text-gray-700">{selectedFeature.description}</p>
              </div>

              {selectedFeature.routes && selectedFeature.routes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">路由</h3>
                  <ul className="list-disc list-inside space-y-1">
                    {selectedFeature.routes.map((route) => (
                      <li key={route} className="text-gray-700 font-mono text-sm">
                        {route}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedFeature.subFeatures && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">子功能</h3>
                  <p className="text-gray-700">共 {selectedFeature.subFeatures} 个子功能</p>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-lg mb-2">质量标准</h3>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    {selectedFeature.hasRci ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <X className="w-5 h-5 text-gray-300" />
                    )}
                    <span>RCI 契约</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {selectedFeature.hasGoldenPath ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <X className="w-5 h-5 text-gray-300" />
                    )}
                    <span>Golden Path</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-2">依赖关系</h3>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Dependencies</p>
                    {selectedFeature.dependencies.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {getFeatureDependencies(selectedFeature.id).map((dep) => (
                          <span key={dep.id} className="px-2 py-1 bg-blue-100 text-blue-700 text-sm rounded">
                            {dep.id}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">无依赖</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Dependents</p>
                    {getFeatureDependents(selectedFeature.id).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {getFeatureDependents(selectedFeature.id).map((dep) => (
                          <span key={dep.id} className="px-2 py-1 bg-purple-100 text-purple-700 text-sm rounded">
                            {dep.id}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">无依赖者</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
