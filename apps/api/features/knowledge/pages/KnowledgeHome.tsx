import { BookOpen, PenTool, Brain } from 'lucide-react';
import GenericHome from '../../shared/pages/GenericHome';
import type { HomeCard } from '../../shared/pages/GenericHome';

const cards: HomeCard[] = [
  { id: 'content', label: 'Content Studio', icon: PenTool, path: '/knowledge/content', desc: 'Content & media assets' },
  { id: 'brain', label: 'Super Brain', icon: Brain, path: '/knowledge/brain', desc: 'Knowledge base & notes' },
];

export default function KnowledgeHome() {
  return <GenericHome title="Knowledge" icon={BookOpen} cards={cards} minCardWidth={280} />;
}
