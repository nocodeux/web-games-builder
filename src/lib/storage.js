// storage.js — project persistence adapter.
//
// In dev mode the Vite plugin serves /api/projects from the local filesystem.
// In production (static hosting) that middleware is absent, so we fall back
// to localStorage automatically. The API check is done once and cached.

const LIST_KEY = 'nanostudio_project_list';
const dataKey  = (id) => `nanostudio_proj_${id}`;

// --- API availability probe (cached after first call) ---
let _apiOk = null;
async function apiAvailable() {
  if (_apiOk !== null) return _apiOk;
  try {
    const res = await fetch('/api/projects');
    _apiOk = res.ok && res.headers.get('content-type')?.includes('application/json');
  } catch {
    _apiOk = false;
  }
  return _apiOk;
}

// --- localStorage helpers ---
function lsList() {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; }
}
function lsSave(project) {
  const meta = { id: project.id, name: project.name || 'Untitled', lastSaved: project.lastSaved || new Date().toISOString() };
  const list = lsList().filter(p => p.id !== project.id);
  list.unshift(meta);
  list.sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
  localStorage.setItem(dataKey(project.id), JSON.stringify(project));
}
function lsLoad(id) {
  try { return JSON.parse(localStorage.getItem(dataKey(id)) || 'null'); } catch { return null; }
}
function lsDelete(id) {
  localStorage.setItem(LIST_KEY, JSON.stringify(lsList().filter(p => p.id !== id)));
  localStorage.removeItem(dataKey(id));
}

// --- Public API ---

export async function fetchProjects() {
  if (await apiAvailable()) {
    const res = await fetch('/api/projects');
    return res.json();
  }
  return lsList();
}

export async function saveProject(project) {
  if (await apiAvailable()) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    return res.json();
  }
  lsSave(project);
  return { success: true };
}

export async function loadProject(id) {
  if (await apiAvailable()) {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return null;
    return res.json();
  }
  return lsLoad(id);
}

export async function deleteProject(id) {
  if (await apiAvailable()) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    return;
  }
  lsDelete(id);
}

export async function renameProject(id, name) {
  const project = await loadProject(id);
  if (!project) return;
  await saveProject({ ...project, name });
}
