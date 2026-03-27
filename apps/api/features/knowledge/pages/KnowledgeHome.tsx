import { BookOpen, PenTool, Brain, Sparkles, BookMarked, Library } from 'lucide-react';
import GenericHome from '../../shared/pages/GenericHome';
import type { HomeCard } from '../../shared/pages/GenericHome';

const cards: HomeCard[] = [
  { id: 'content', label: 'Content Studio', icon: PenTool, path: '/knowledge/content', desc: 'Content & media assets' },
  { id: 'brain', label: 'Super Brain', icon: Brain, path: '/knowledge/brain', desc: 'Knowledge base & notes' },
  { id: 'digestion', label: '知识消化', icon: Sparkles, path: '/knowledge/digestion', desc: '反刍洞察与知识归档' },
  { id: 'instruction-book', label: '说明书', icon: BookMarked, path: '/knowledge/instruction-book', desc: 'Skills & Features 使用手册' },
  { id: 'modules', label: '深度知识页', icon: Library, path: '/knowledge/modules', desc: '86 个系统模块知识页' },
];

export default function KnowledgeHome() {
  return <GenericHome title="Knowledge" icon={BookOpen} cards={cards} minCardWidth={280} />;
}
