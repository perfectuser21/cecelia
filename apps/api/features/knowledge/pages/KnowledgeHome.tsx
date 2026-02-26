import { BookOpen, PenTool, Brain, Sparkles } from 'lucide-react';
import GenericHome from '../../shared/pages/GenericHome';
import type { HomeCard } from '../../shared/pages/GenericHome';

const cards: HomeCard[] = [
  { id: 'content', label: 'Content Studio', icon: PenTool, path: '/knowledge/content', desc: 'Content & media assets' },
  { id: 'brain', label: 'Super Brain', icon: Brain, path: '/knowledge/brain', desc: 'Knowledge base & notes' },
  { id: 'digestion', label: '知识消化', icon: Sparkles, path: '/knowledge/digestion', desc: '反刍洞察与知识归档' },
];

export default function KnowledgeHome() {
  return <GenericHome title="Knowledge" icon={BookOpen} cards={cards} minCardWidth={280} />;
}
