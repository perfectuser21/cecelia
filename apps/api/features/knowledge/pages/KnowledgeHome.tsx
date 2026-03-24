import { BookOpen, PenTool, Brain, Sparkles, BookMarked, GitPullRequest, Layers, Scale, Map } from 'lucide-react';
import GenericHome from '../../shared/pages/GenericHome';
import type { HomeCard } from '../../shared/pages/GenericHome';

const cards: HomeCard[] = [
  { id: 'content', label: 'Content Studio', icon: PenTool, path: '/knowledge/content', desc: 'Content & media assets' },
  { id: 'brain', label: 'Super Brain', icon: Brain, path: '/knowledge/brain', desc: 'Knowledge base & notes' },
  { id: 'digestion', label: '知识消化', icon: Sparkles, path: '/knowledge/digestion', desc: '反刍洞察与知识归档' },
  { id: 'instruction-book', label: '说明书', icon: BookMarked, path: '/knowledge/instruction-book', desc: 'Skills & Features 使用手册' },
  { id: 'dev-log', label: 'DevLog', icon: GitPullRequest, path: '/knowledge/dev-log', desc: 'PR 合并与开发记录' },
  { id: 'design-vault', label: 'Design Vault', icon: Layers, path: '/knowledge/design-vault', desc: '架构设计与规范文档' },
  { id: 'decisions', label: 'Decision Registry', icon: Scale, path: '/knowledge/decisions', desc: '历史决策与原因存档' },
  { id: 'diary', label: 'Daily Diary', icon: BookOpen, path: '/knowledge/diary', desc: '每日自动生成的日记' },
  { id: 'map', label: 'Knowledge Map', icon: Map, path: '/knowledge/map', desc: '知识系统全景一览' },
];

export default function KnowledgeHome() {
  return <GenericHome title="Knowledge" icon={BookOpen} cards={cards} minCardWidth={260} />;
}
