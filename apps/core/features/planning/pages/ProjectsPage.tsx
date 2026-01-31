import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  repo_path: string;
  created_at: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tasks/projects')
      .then(res => res.json())
      .then(data => {
        setProjects(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load projects:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            Projects
          </h1>
          <p className="text-gray-400 text-lg">
            {projects.length} active projects
          </p>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="group"
            >
              <div
                className="relative overflow-hidden rounded-2xl p-6 backdrop-blur-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-all duration-300 hover:scale-105 hover:shadow-2xl"
                style={{
                  boxShadow: `0 0 40px ${project.color}20`,
                }}
              >
                {/* Gradient Background */}
                <div
                  className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity"
                  style={{
                    background: `linear-gradient(135deg, ${project.color}40, transparent)`,
                  }}
                />

                {/* Content */}
                <div className="relative z-10">
                  {/* Icon */}
                  <div className="text-6xl mb-4">{project.icon}</div>

                  {/* Title */}
                  <h3 className="text-2xl font-bold text-white mb-2">
                    {project.name}
                  </h3>

                  {/* Description */}
                  <p className="text-gray-300 text-sm mb-4 line-clamp-2">
                    {project.description}
                  </p>

                  {/* Status Badge */}
                  <div className="flex items-center gap-2">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${project.color}30`,
                        color: project.color,
                        border: `1px solid ${project.color}60`,
                      }}
                    >
                      {project.status}
                    </span>
                  </div>

                  {/* Path */}
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-xs text-gray-500 font-mono truncate">
                      {project.repo_path}
                    </p>
                  </div>
                </div>

                {/* Hover Effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/0 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
              </div>
            </Link>
          ))}
        </div>

        {/* Empty State */}
        {projects.length === 0 && (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-2xl font-bold text-white mb-2">No projects yet</h3>
            <p className="text-gray-400">Create your first project to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
