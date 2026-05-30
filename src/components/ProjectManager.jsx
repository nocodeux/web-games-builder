import React, { useState, useEffect } from 'react';

function ProjectManager({ currentProject, onLoadProject, onNewProject }) {
  const [projects, setProjects] = useState([]);
  
  useEffect(() => {
    const loadProjects = () => {
      const projectList = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('project_')) {
          projectList.push({
            id: key,
            name: key.replace('project_', 'Proyecto '),
            modified: localStorage.getItem(`${key}_modified`) || new Date().toLocaleString()
          });
        }
      }
      setProjects(projectList);
    };
    loadProjects();
  }, []);
  
  return (
    <div className="db-panel" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, top: 0, background: 'rgba(0,0,0,0.95)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--panel-bg)', border: '2px solid var(--border)', padding: 24, minWidth: 400 }}>
        <h2 style={{ color: 'var(--accent)', marginBottom: 16 }}>📁 GESTOR DE PROYECTOS</h2>
        
        <div style={{ marginBottom: 16 }}>
          <button onClick={onNewProject} className="retro-button">➕ Nuevo Proyecto</button>
        </div>
        
        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 16 }} />
        
        <h3 style={{ fontSize: 12, marginBottom: 8 }}>Proyectos guardados:</h3>
        {projects.length === 0 && (
          <div style={{ color: 'var(--text-dim)', padding: 20, textAlign: 'center' }}>
            No hay proyectos guardados
          </div>
        )}
        {projects.map(proj => (
          <div key={proj.id} style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>{proj.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{proj.modified}</div>
            </div>
            <button 
              onClick={() => onLoadProject(proj)}
              className="retro-button" 
              style={{ padding: '2px 8px', fontSize: 11 }}
            >
              Cargar
            </button>
          </div>
        ))}
        
      </div>
    </div>
  );
}

export default ProjectManager;