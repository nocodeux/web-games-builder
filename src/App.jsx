/**
 * App.jsx — Data model with rows for layout
 *
 * MAIN CHANGES:
 * - `components` is now `rows`: array of { id, layout, children }
 * - addComponent → addToRow(type, rowId, index)
 * - addNewRow(type, existingItem, afterIndex) → creates a new row
 * - moveComponent(item, toRowId, toIndex) → reorders existing components
 * - Canvas and Inspector receive updated `rows` and handlers
 * - Inspector shows AutoLayout controls when a ROW is selected
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { GameContext } from './contexts/gameContext';
import Toolbox, { TOOLBOX_PALETTE } from './components/Toolbox';
import RetroTabs from './components/Componentes/Tabs';
import { normalizeTutorialConfig, DEFAULT_TUTORIAL_CONFIG } from './lib/tutorialMedia';
import Canvas, { DEFAULT_MOBILE_SCREEN_LAYOUT, DEFAULT_MOBILE_ROW_LAYOUT } from './components/Canvas';
import Inspector from './components/Inspector';
import DatabasePanel from './components/DatabasePanel';
import LevelTabs from './components/LevelTabs';
import LevelCanvas from './components/LevelCanvas';
import RuntimeView from './components/RuntimeView';
import SpriteSheetManager from './components/SpriteSheetManager';
import DocsPanel from './components/DocsPanel';
import { apiFetch, getToken, setToken, clearToken } from './lib/apiFetch';
import { uploadAsset } from './lib/assetUpload';
import { buildLevelEntities } from './lib/gamePresets';
import './App.css';
import appCss from './App.css?raw';

const THEMES = {
  'theme-nano':  { name: 'Nano',  bg: '#000000', panelBg: '#000000', border: '#00aa00', text: '#00ff00', textDim: '#008800', accent: '#ffff00', selected: '#003300' },
  'theme-bios':  { name: 'BIOS',  bg: '#0000aa', panelBg: '#0000aa', border: '#aaaaaa', text: '#ffffff', textDim: '#cccccc', accent: '#ffff00', selected: '#000088' },
  'theme-retro': { name: 'Retro', bg: '#0a0a0a', panelBg: '#0c0c0c', border: '#2a5a2a', text: '#33ff33', textDim: '#1a7a1a', accent: '#ffaa00', selected: '#1e3a1e' },
  'theme-amber': { name: 'Amber', bg: '#0a0800', panelBg: '#0d0a00', border: '#aa7700', text: '#ffb000', textDim: '#886600', accent: '#ffcc00', selected: '#332200' },
  'theme-tron':  { name: 'TRON',  bg: '#010b13', panelBg: '#010e17', border: '#00f0ff', text: '#c8f8ff', textDim: '#3aa8c1', accent: '#ff6a00', selected: '#00202e' },
};

const DEFAULT_LAYOUT = {
  direction: 'row', gap: 8, align: 'flex-start', justify: 'flex-start', wrap: false,
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, paddingLinked: true,
};

// Default autolayout for the screen container (stacks rows top-to-bottom, stretch width)
const DEFAULT_SCREEN_LAYOUT = {
  direction: 'column', gap: 0, align: 'stretch', justify: 'flex-start', wrap: false,
  paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20, paddingLinked: true,
};

const mkId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

function App() {
  const [screens, setScreens] = useState([
    { id: 'screen-1', name: 'Screen 1', rows: [], settings: { timeout: 0, nextScreenId: null } }
  ]);
  const [currentScreenId, setCurrentScreenId] = useState('screen-1');
  const [editingTextId, setEditingTextId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]); // Array of IDs
  const [lastSelectedId, setLastSelectedId] = useState(null); // For shift-select ranges if needed later
  const [viewMode, setViewMode] = useState('desktop');
  const [theme, setTheme] = useState(() => localStorage.getItem('nanostudio_theme') || 'theme-retro');
  const [showUserJourney, setShowUserJourney] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showDatabase, setShowDatabase] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [builderName, setBuilderName] = useState(() => localStorage.getItem('nanostudio_builder_name') || 'TUI Builder');
  const [currentProject, setCurrentProject] = useState(() => {
    const saved = localStorage.getItem('nanostudio_current_project');
    return saved ? JSON.parse(saved) : { id: 'default', name: 'Untitled' };
  });
  const [saveStatus, setSaveStatus] = useState('');
  const [activeWindow, setActiveWindow] = useState(null);
  const [database, setDatabase] = useState({ tables: [], data: {} });
  const [downloadLink, setDownloadLink] = useState(null);
  const [externalApis, setExternalApis] = useState([]);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('New Project');
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [projectList, setProjectList] = useState([]);
  const [projectLoadKey, setProjectLoadKey] = useState(0);
  const [currentUser, setCurrentUser] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [entityClipboard, setEntityClipboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [gameMode, setGameMode] = useState(false);
  const [selectedLevelId, setSelectedLevelId] = useState(null);
  const [showWorldSettings, setShowWorldSettings] = useState(false);
  // Which authoring surface the canvas shows when a level is active.
  // 'game' = entities + tilemap (absolute positioning, LevelCanvas).
  // 'hud'  = level.rows (flexbox layout, the existing Canvas).
  const [levelLayer, setLevelLayer] = useState('game');
  // Active tile brush. When set, clicks on LevelCanvas paint instead of
  // deselecting. tileValue 0 = eraser; 1+ = tileset cell index + 1.
  const [paintBrush, setPaintBrush] = useState(null);
  // Currently selected collider shape (highlighted in both canvas and inspector).
  const [selectedColliderShapeId, setSelectedColliderShapeId] = useState(null);
  // Currently selected occlusion (mask) shape.
  const [selectedOcclusionShapeId, setSelectedOcclusionShapeId] = useState(null);
  // True while the runtime is mounted on the level canvas. Toggled by
  // the Play / Stop button on LevelTabs.
  const [isPlaying, setIsPlaying] = useState(false);
  // Assets live in a sidecar file (projects/<id>.assets.json) so the main
  // project JSON stays small and the editor can save schema changes without
  // re-uploading megabytes of base64 sprite data.
  const [assets, setAssetsState] = useState({ sprites: [], tilesets: [], sounds: [], backgrounds: [] });
  const [showSpriteSheetManager, setShowSpriteSheetManager] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState('login'); // 'login' | 'register'
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [settingsDisplayName, setSettingsDisplayName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishSlug, setPublishSlug] = useState('');
  const [publishTitle, setPublishTitle] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishStatus, setPublishStatus] = useState('idle'); // idle | checking | publishing | done | error
  const [publishUrl, setPublishUrl] = useState('');
  const [publishError, setPublishError] = useState('');
  const [publishedList, setPublishedList] = useState([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const themeMenuRef = useRef(null);
  const [publishMode, setPublishMode] = useState('page'); // 'page' | 'game'
  const [publishWorldId, setPublishWorldId] = useState(null);
  const [tutorialConfig, setTutorialConfig] = useState(() => normalizeTutorialConfig(null));
  const [tutorialActive, setTutorialActive] = useState(false);

  const isInitialLoading = useRef(true);
  const settingsLoaded = useRef(false);
  const projectLoaded = useRef(false);
  const editsMade = useRef(false);
  const saveTimer = useRef(null);
  const assetsDirty = useRef(false);
  const assetsSaveTimer = useRef(null);
  const canvasContainerRef = useRef(null);

  // Auth: handle OAuth redirect token in URL hash (#token=...)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('token=')) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get('token');
      const error = params.get('error');
      window.history.replaceState({}, '', window.location.pathname);
      if (token) {
        setToken(token);
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(user => { if (user) { setCurrentUser(user); setShowLogin(false); } });
        return;
      }
      if (error) { setShowLogin(true); setLoginError(decodeURIComponent(error)); return; }
    }
    // Normal token check
    const token = getToken();
    if (!token) { setShowLogin(true); return; }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(user => {
        if (user) setCurrentUser(user);
        else { clearToken(); setShowLogin(true); }
      })
      .catch(() => { clearToken(); setShowLogin(true); });
  }, []);

  // Show login modal whenever any apiFetch gets a 401
  useEffect(() => {
    const handler = () => setShowLogin(true);
    window.addEventListener('tuify:auth-required', handler);
    return () => window.removeEventListener('tuify:auth-required', handler);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || 'Login failed'); return; }
      setToken(data.token);
      setCurrentUser(data);
      setShowLogin(false);
      setLoginPassword('');
    } catch {
      setLoginError('Connection error — is the server running?');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    // Revoke token on server (fire-and-forget)
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});

    // Cancel all pending saves immediately
    clearToken();
    editsMade.current = false;
    assetsDirty.current = false;
    projectLoaded.current = false;
    isInitialLoading.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (assetsSaveTimer.current) clearTimeout(assetsSaveTimer.current);

    // Wipe localStorage session data
    localStorage.removeItem('nanostudio_current_project');

    // Reset ALL project state so no data leaks to the next user
    setScreens([{ id: 'screen-1', name: 'Screen 1', rows: [], settings: { timeout: 0, nextScreenId: null } }]);
    setCurrentScreenId('screen-1');
    setSelectedIds([]);
    setLastSelectedId(null);
    setCurrentProject({ id: 'default', name: 'Untitled' });
    setDatabase({ tables: [], data: {} });
    setActiveWindow(null);
    setGameMode(false);
    setSelectedLevelId(null);
    setLevelLayer('game');
    setPaintBrush(null);
    setSelectedColliderShapeId(null);
    setSelectedOcclusionShapeId(null);
    setIsPlaying(false);
    setAssetsState({ sprites: [], tilesets: [], sounds: [], backgrounds: [] });
    setHistory([]);
    setHistoryIndex(-1);
    setClipboard(null);
    setViewMode('desktop');

    // Reset user/session-scoped data
    setProjectList([]);
    setExternalApis([]);
    setPublishedList([]);
    setPublishSlug('');
    setPublishTitle('');
    setPublishDesc('');
    setPublishStatus('idle');
    setPublishUrl('');
    setPublishError('');
    setPublishMode('page');
    setSaveStatus('');

    // Close all panels/modals
    setShowProjects(false);
    setShowDatabase(false);
    setShowSettings(false);
    setShowPublish(false);
    setShowExportMenu(false);
    setShowSpriteSheetManager(false);
    setConfirmModal(null);
    setDownloadLink(null);

    // Show login
    setCurrentUser(null);
    setShowLogin(true);
    setLoginMode('login');
    setLoginEmail('');
    setLoginPassword('');
    setLoginError('');
    setRegName('');
    setRegEmail('');
    setRegPassword('');
    setRegConfirm('');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (regPassword !== regConfirm) { setLoginError('Passwords do not match'); return; }
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: regEmail, password: regPassword, displayName: regName }),
      });
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || 'Registration failed'); return; }
      setToken(data.token);
      setCurrentUser(data);
      setShowLogin(false);
      setRegPassword(''); setRegConfirm('');
    } catch {
      setLoginError('Connection error — is the server running?');
    } finally {
      setLoginLoading(false);
    }
  };

  // Sync editable display name whenever the Settings modal opens; reset tab
  useEffect(() => {
    if (showSettings) setSettingsDisplayName(currentUser?.displayName || '');
  }, [showSettings, currentUser?.displayName]);

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: settingsDisplayName }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentUser(prev => ({ ...prev, ...updated }));
      }
    } catch (err) {
      console.error('Profile save error:', err);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleAvatarUpload = async (file) => {
    setAvatarUploading(true);
    try {
      const { url } = await uploadAsset(file, 'avatar');
      const res = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentUser(prev => ({ ...prev, ...updated }));
      }
    } catch (err) {
      console.error('Avatar upload error:', err);
    } finally {
      setAvatarUploading(false);
    }
  };

  const addExternalApi = () => {
    setExternalApis(prev => [...prev, { id: mkId(), name: '', url: '', authHeader: '', authValue: '' }]);
  };
  const updateExternalApi = (id, field, value) => {
    setExternalApis(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  };
  const removeExternalApi = (id) => {
    setExternalApis(prev => prev.filter(a => a.id !== id));
  };

  const fetchPublishedList = async () => {
    try {
      const res = await apiFetch('/api/publish/list');
      if (res.ok) setPublishedList(await res.json());
    } catch { /* ignore */ }
  };

  const handleOpenPublish = () => {
    const pageScreens = screens.filter(s => s.kind !== 'world');
    const worlds = screens.filter(s => s.kind === 'world');
    const hasPage = pageScreens.length > 0;
    const hasGame = worlds.length > 0;

    // Detect if the page already has GameEmbed components — if so, "page+game"
    // is already handled natively and we just publish the page.
    const pageEmbeds = pageScreens.flatMap(s =>
      (s.rows || []).flatMap(r => {
        const findEmbeds = (comps) => comps.flatMap(c =>
          c.type === 'GameEmbed' && c.props?.worldId ? [c.props.worldId]
          : c.children ? findEmbeds(c.children) : []
        );
        return findEmbeds(r.children || []);
      })
    );
    const hasGameEmbed = pageEmbeds.length > 0;

    // Mode selection: page and game are always separate publishes.
    // Games are embedded in pages only via explicit GameEmbed components.
    let mode = 'page';
    if (gameMode && hasGame) {
      mode = 'game';
    } else if (hasGame && !hasPage) {
      mode = 'game';
    }

    // Determine which world to publish (embedded world takes priority)
    const embeddedWorld = pageEmbeds.length > 0
      ? worlds.find(w => w.id === pageEmbeds[0]) || worlds[0]
      : worlds[0];

    // Pull title/slug/description from screen/world settings (source of truth)
    const firstScreen = pageScreens[0];
    const targetWorld = embeddedWorld || worlds[0];

    let title = '';
    let slug  = '';
    let desc  = '';

    if (mode === 'game') {
      // Game-only: pull from world settings
      title = targetWorld?.name || currentProject.name || 'Untitled';
      slug  = targetWorld?.worldSettings?.slug || currentProject.publishSlug || slugify(title);
      desc  = targetWorld?.worldSettings?.description || currentProject.description || '';
    } else {
      // Page or page+game: pull from first screen settings (webTitle → fallback to project name)
      title = firstScreen?.settings?.webTitle || currentProject.name || 'Untitled';
      slug  = firstScreen?.settings?.slug || currentProject.publishSlug || slugify(title);
      desc  = firstScreen?.settings?.description || currentProject.description || '';
    }

    setPublishMode(mode);
    setPublishWorldId(targetWorld?.id || null);
    setPublishTitle(title);
    setPublishSlug(slug);
    setPublishDesc(desc);
    setPublishStatus('idle');
    setPublishUrl('');
    setPublishError('');
    setShowPublish(true);
    fetchPublishedList();
  };

  const handlePublish = async () => {
    setPublishStatus('publishing');
    setPublishError('');
    try {
      const needsPage = publishMode === 'page';
      const pageHtml = needsPage ? buildPageHtml() : undefined;
      const projectData = {
        id: currentProject.id,
        name: currentProject.name,
        publishSlug: currentProject.publishSlug,
        description: currentProject.description,
        theme,
        viewMode,
        screens,
        currentScreenId,
        activeWindow,
        database,
        gameMode,
        lastSaved: new Date().toISOString()
      };
      // Game = all worlds in the project — no worldId selection needed
      const res = await apiFetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: currentProject.id,
          slug: publishSlug,
          title: publishTitle,
          description: publishDesc,
          isPublic: true,
          publishMode,
          pageHtml,
          projectData,
          assetsData: assets,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPublishError(data.error || 'Publish failed'); setPublishStatus('error'); return; }
      setPublishUrl(data.url);
      setPublishStatus('done');
      fetchPublishedList();
    } catch (err) {
      setPublishError(err.message);
      setPublishStatus('error');
    }
  };

  const handleUnpublish = async (slug) => {
    try {
      const res = await apiFetch(`/api/publish/${slug}`, { method: 'DELETE' });
      if (res.ok) fetchPublishedList();
    } catch { /* ignore */ }
  };

  const handleRepublishItem = async (item) => {
    setPublishStatus('publishing');
    setPublishError('');
    try {
      // Downgrade legacy 'page+game' to 'page' — floating play button removed
      const rawMode = item.publish_mode || 'game';
      const mode = rawMode === 'page+game' ? 'page' : rawMode;
      const needsPage = mode === 'page';
      // Game = all worlds — no worldId needed
      const res = await apiFetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: item.source_id,
          slug: item.slug,
          title: item.title || '',
          description: item.description || '',
          isPublic: item.is_public !== false,
          publishMode: mode,
          pageHtml: needsPage ? buildPageHtml() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPublishError(data.error || 'Republish failed'); setPublishStatus('error'); return; }
      setPublishUrl(data.url);
      setPublishStatus('done');
      fetchPublishedList();
    } catch (err) {
      setPublishError(err.message);
      setPublishStatus('error');
    }
  };

  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  }

  // Wrap setAssets so every mutation flips the dirty flag and schedules a
  // sidecar save. Components should always go through this setter.
  const setAssets = useCallback((updater) => {
    assetsDirty.current = true;
    setAssetsState(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await apiFetch('/api/projects');
      const data = await res.json();
      setProjectList(data);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    fetchProjects();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (showProjects) fetchProjects();
  }, [showProjects, currentUser]);
  // ── Sidecar assets persistence ───────────────────────────────────────────
  // Debounced 2s after any asset change. Skipped during initial load and when
  // there's no real project (id === 'default').
  useEffect(() => {
    if (isInitialLoading.current) return;
    if (!assetsDirty.current) return;
    if (!currentProject?.id || currentProject.id === 'default') return;
    if (assetsSaveTimer.current) clearTimeout(assetsSaveTimer.current);
    assetsSaveTimer.current = setTimeout(() => {
      apiFetch(`/api/projects/${currentProject.id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assets),
      })
        .then(res => res.json())
        .then(() => { assetsDirty.current = false; })
        .catch(err => console.error('[Assets] save error:', err));
    }, 2000);
    return () => { if (assetsSaveTimer.current) clearTimeout(assetsSaveTimer.current); };
  }, [assets, currentProject?.id]);

  // ── Persistencia ──────────────────────────────────────────────────────────
  const triggerSave = useCallback(() => {
    if (!getToken()) return;
    if (!currentProject.id || currentProject.id === 'default') return;
    if (isInitialLoading.current) return;
    if (!projectLoaded.current) return;
    if (!editsMade.current) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);

    setSaveStatus('Saving...');
    saveTimer.current = setTimeout(() => {
      editsMade.current = false; // reset before async save so new edits re-arm it
      const projectData = {
        id: currentProject.id,
        name: currentProject.name,
        publishSlug: currentProject.publishSlug,
        description: currentProject.description,
        theme,
        viewMode,
        screens,
        currentScreenId,
        activeWindow,
        database,
        gameMode,
        lastSaved: new Date().toISOString()
      };

      apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData)
      })
      .then(res => res.json())
      .then(() => {
        setSaveStatus('Saved');
        localStorage.setItem('nanostudio_current_project', JSON.stringify(currentProject));
        if (showProjects) fetchProjects();
        setTimeout(() => setSaveStatus(''), 1500);
      })
      .catch(err => {
        editsMade.current = true; // save failed — keep dirty so it retries on next edit
        console.error('[Save] Error saving project:', err);
        setSaveStatus('Save Error');
        setTimeout(() => setSaveStatus(''), 2000);
      });
    }, 1000); // 1 second debounce
  }, [screens, currentScreenId, database, currentProject, theme, viewMode, activeWindow, gameMode, showProjects]);

  // Visible screens depend on the current mode. Screens (kind != 'world') and
  // Worlds (kind === 'world') live in the same `screens` array but are surfaced
  // separately so the two authoring modes stay isolated.
  const visibleScreens = gameMode
    ? screens.filter(s => s.kind === 'world')
    : screens.filter(s => s.kind !== 'world');
  const activeScreen = visibleScreens.find(s => s.id === currentScreenId) || visibleScreens[0] || null;
  // When a level is selected on the active world, the canvas content is the
  // level's rows; otherwise we author the world/screen's own rows (the HUD).
  const activeLevel = (activeScreen?.kind === 'world' && activeScreen?.currentLevelId)
    ? (activeScreen.levels || []).find(l => l.id === activeScreen.currentLevelId) || null
    : null;
  const rows = activeLevel ? (activeLevel.rows || []) : (activeScreen?.rows || []);

  // Sync the layer toggle whenever the active level changes so each level
  // independently remembers its last-viewed layer (game vs hud).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeLevel) setLevelLayer(activeLevel.editorLayer || 'game');
  }, [activeLevel?.id]);

  // When toggling modes, keep currentScreenId pointing at something visible.
  useEffect(() => {
    if (!activeScreen && visibleScreens.length > 0) {
      setCurrentScreenId(visibleScreens[0].id);
    } else if (activeScreen && activeScreen.id !== currentScreenId) {
      setCurrentScreenId(activeScreen.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode]);

  // ── History Management ───────────────────────────────────────────────────
  const [isUndoing, setIsUndoing] = useState(false);

  const saveHistory = useCallback((nextScreens) => {
    if (isUndoing) return;
    setHistory(prev => {
      const nextHistory = prev.slice(0, historyIndex + 1);
      nextHistory.push(JSON.parse(JSON.stringify(nextScreens)));
      if (nextHistory.length > 50) nextHistory.shift();
      return nextHistory;
    });
    setHistoryIndex(prev => {
      const next = prev + 1;
      return next > 49 ? 49 : next;
    });
  }, [historyIndex, isUndoing]);

  const updateScreens = useCallback((newScreensOrFn, shouldSaveHistory = true) => {
    if (!isInitialLoading.current && currentProject.id && currentProject.id !== 'default') editsMade.current = true;
    setScreens(prev => {
      const next = typeof newScreensOrFn === 'function' ? newScreensOrFn(prev) : newScreensOrFn;
      if (shouldSaveHistory && !isInitialLoading.current) {
        saveHistory(next);
      }
      return next;
    });
  }, [saveHistory]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setIsUndoing(true);
      editsMade.current = true;
      const prevScreens = history[historyIndex - 1];
      setScreens(JSON.parse(JSON.stringify(prevScreens)));
      setHistoryIndex(historyIndex - 1);
      setTimeout(() => setIsUndoing(false), 50);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setIsUndoing(true);
      editsMade.current = true;
      const nextScreens = history[historyIndex + 1];
      setScreens(JSON.parse(JSON.stringify(nextScreens)));
      setHistoryIndex(historyIndex + 1);
      setTimeout(() => setIsUndoing(false), 50);
    }
  }, [history, historyIndex]);

  // Wrapped setRows to update the active screen in the screens array
  // Routes row mutations to either Screen.rows or Level.rows depending on
  // whether the active world has a level selected. Keeps undo/history snapshots
  // intact because both arrays live inside the screens tree.
  const setRows = useCallback((newRowsOrFn) => {
    updateScreens(prev => {
      return prev.map(s => {
        if (s.id !== currentScreenId) return s;
        // World + selected level → mutate that level's rows
        if (s.kind === 'world' && s.currentLevelId) {
          const levels = (s.levels || []).map(l => {
            if (l.id !== s.currentLevelId) return l;
            const nextRows = typeof newRowsOrFn === 'function' ? newRowsOrFn(l.rows || []) : newRowsOrFn;
            return { ...l, rows: nextRows };
          });
          return { ...s, levels };
        }
        // Screen, or World with no level selected → mutate the screen's own rows
        const nextRows = typeof newRowsOrFn === 'function' ? newRowsOrFn(s.rows || []) : newRowsOrFn;
        return { ...s, rows: nextRows };
      });
    });
  }, [currentScreenId, updateScreens]);

  // Initial history snapshot
  useEffect(() => {
    if (!isInitialLoading.current && historyIndex === -1 && screens.length > 0) {
       setHistory([screens]);
       setHistoryIndex(0);
    }
  }, [screens, historyIndex]);

  const moveScreen = useCallback((dragIndex, hoverIndex) => {
    // dragIndex / hoverIndex come from the User Journey Panel and refer to
    // VISIBLE positions (filtered by the current mode). Translate them back
    // to absolute positions in the underlying screens array before swapping.
    updateScreens(prev => {
      const visible = gameMode
        ? prev.filter(s => s.kind === 'world')
        : prev.filter(s => s.kind !== 'world');
      const dragged = visible[dragIndex];
      const target = visible[hoverIndex];
      if (!dragged || !target || dragged.id === target.id) return prev;
      const next = [...prev];
      const fromAbs = next.findIndex(s => s.id === dragged.id);
      next.splice(fromAbs, 1);
      const toAbs = next.findIndex(s => s.id === target.id);
      const insertAt = toAbs >= 0 ? (hoverIndex > dragIndex ? toAbs + 1 : toAbs) : next.length;
      next.splice(insertAt, 0, dragged);
      return next;
    });
  }, [updateScreens, gameMode]);

  const addScreen = useCallback(() => {
    const base = { id: mkId(), name: `${gameMode ? 'World' : 'Screen'} ${screens.length + 1}`, rows: [], settings: { timeout: 0, nextScreenId: null } };
    const newScreen = gameMode
      ? { ...base, kind: 'world', levels: [], currentLevelId: null, worldSettings: { defaultViewport: '', defaultGravity: null, controlLayout: '', themeMusicAssetId: null, gameType: { primary: '', secondary: '' } } }
      : base;
    updateScreens(prev => [...prev, newScreen]);
    setCurrentScreenId(newScreen.id);
  }, [screens.length, updateScreens, gameMode]);

  const deleteScreen = useCallback((screenId) => {
    const screen = screens.find(s => s.id === screenId);
    if (!screen) return;
    // Worlds can always be deleted (project may have zero worlds, that's fine).
    // Regular screens must keep at least one — otherwise app mode has nothing.
    if (screen.kind !== 'world') {
      const screenCount = screens.filter(s => s.kind !== 'world').length;
      if (screenCount <= 1) return;
    }
    const hasContent = screen && (
      (screen.rows || []).some(r => r.children && r.children.length > 0) ||
      (screen.kind === 'world' && (screen.levels || []).length > 0)
    );
    const fallbackAfterDelete = (next) => {
      if (currentScreenId !== screenId) return;
      const sameKind = screen.kind === 'world'
        ? next.filter(s => s.kind === 'world')
        : next.filter(s => s.kind !== 'world');
      setCurrentScreenId(sameKind[0]?.id || null);
    };
    if (hasContent) {
      setConfirmModal({
        title: screen.kind === 'world' ? 'Delete World' : 'Delete Screen',
        message: `Are you sure you want to delete "${screen.name}"?`,
        confirmText: screen.kind === 'world' ? 'Delete world' : 'Delete screen',
        onConfirm: () => {
          updateScreens(prev => {
            const next = prev.filter(s => s.id !== screenId);
            fallbackAfterDelete(next);
            return next;
          });
          setConfirmModal(null);
        },
        onCancel: () => setConfirmModal(null)
      });
      return;
    }
    updateScreens(prev => {
      const next = prev.filter(s => s.id !== screenId);
      fallbackAfterDelete(next);
      return next;
    });
  }, [screens, currentScreenId, updateScreens]);

  const duplicateScreen = useCallback((screen) => {
    updateScreens(prev => {
      const next = JSON.parse(JSON.stringify(screen));
      next.id = mkId();
      next.name = `${screen.name} (Copy)`;
      return [...prev, next];
    });
  }, [updateScreens]);

  const updateScreenSettings = useCallback((screenId, settings) => {
    updateScreens(prev => prev.map(s => {
      if (s.id === screenId) {
        return { ...s, settings: { ...s.settings, ...settings } };
      }
      return s;
    }));
  }, [updateScreens]);

  const updateScreen = useCallback((id, updates) => {
    updateScreens(prev => prev.map(s => {
      if (s.id === id) {
        if (updates.settings) {
          return { ...s, settings: { ...(s.settings || {}), ...updates.settings } };
        }
        if (updates.worldSettings) {
          return { ...s, worldSettings: { ...(s.worldSettings || {}), ...updates.worldSettings } };
        }
        return { ...s, ...updates };
      }
      return s;
    }));
  }, [updateScreens]);

  // Measure the visible LevelCanvas area, then pick a tile size that lets
  // the world fit the viewport with exactly 22 columns of tiles. Rows are
  // computed from the same tile size against the available height so the
  // grid stays square-ish. Declared above addLevel (its dependency).
  const measureLevelCanvasGrid = useCallback(() => {
    const TARGET_COLS = 22;
    const c = canvasContainerRef.current;
    if (!c || !c.clientWidth || !c.clientHeight) {
      return { cols: TARGET_COLS, rows: TARGET_COLS, tileSize: 32 };
    }
    const tabsHeight = 62; // LevelTabs strip (controls row + tabs row)
    const w = c.clientWidth;
    const h = Math.max(0, c.clientHeight - tabsHeight);
    // Pick the largest tile size that fits TARGET_COLS columns, but never
    // exceed the height. Floor to a power-of-2 friendly value for crispness.
    const rawTile = Math.floor(w / TARGET_COLS);
    const tileSize = Math.max(8, rawTile);
    const rows = Math.max(4, Math.floor(h / tileSize));
    return { cols: TARGET_COLS, rows, tileSize };
  }, []);

  // ── Levels (only meaningful for screens with kind === 'world') ──────────
  const makeDefaultLevel = useCallback((world, index, opts = {}) => {
    const ws = world?.worldSettings || {};
    const tileSize = opts.tileSize || 32;
    const cols = opts.cols ?? 22;
    const rows = opts.rows ?? 22;
    return {
      id: mkId(),
      name: `Level ${index + 1}`,
      viewport: ws.defaultViewport || 'custom',
      controlLayout: ws.controlLayout || ws.mobileControls?.layout || '',
      gravity: Number.isFinite(Number(ws.defaultGravity)) ? Number(ws.defaultGravity) : 0,
      backgroundMusicAssetId: null,
      spawnPointId: null,
      rows: [],
      tileMap: {
        tileWidth: tileSize, tileHeight: tileSize, cols, rows,
        tilesetAssetId: null,
        layers: [{ id: mkId(), name: 'Background', kind: 'tiles', data: [] }],
      },
      entities: [],
      levelType: opts.levelType || 'game',
      viewportCols: cols,
      viewportRows: rows,
    };
  }, []);

  const addLevel = useCallback((worldId) => {
    // Auto-fit the new level's tilemap to whatever the canvas area
    // measures right now so the world fills the viewport instead of
    // landing on a one-size-fits-all default that leaves empty space.
    const grid = measureLevelCanvasGrid();
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      const levels = s.levels || [];
      const next = makeDefaultLevel(s, levels.length, grid);
      return { ...s, levels: [...levels, next], currentLevelId: next.id };
    }));
  }, [updateScreens, makeDefaultLevel, measureLevelCanvasGrid]);

  // Generates a complete game structure in one call: sets worldSettings, creates N levels
  // with correct physics/viewport/runnerMode, and populates each with template entities.
  // Also generates Splash Screen and Game Over HUD levels for editing.
  // Replaces any existing levels on the world.
  const buildGame = useCallback((worldId, { primary, secondary, preset, numLevels }) => {
    const presetKey    = `${primary}.${secondary}`;
    const grid         = measureLevelCanvasGrid();
    const isVertical   = preset.gravityDir === 'down' || preset.gravityDir === 'up';
    const isRunner     = presetKey === 'platformer.endless-runner';
    const viewportType = isVertical ? 'platformer' : 'topdown';

    // Portrait orientation: vertical-scroll games use a narrower/taller grid.
    // All other games keep the measured landscape layout.
    const PORTRAIT_KEYS = new Set(['racing.endless']);
    const isPortrait = PORTRAIT_KEYS.has(presetKey);
    const vpCols = isPortrait ? Math.max(8, Math.round(grid.cols * 0.6)) : grid.cols;
    const vpRows = isPortrait ? grid.cols : grid.rows;
    const ts     = grid.tileSize || 32;

    // Helper: blank HUD level (splash, game-over, etc.)
    const makeHudLevel = (name) => ({
      id:   mkId(),
      name,
      levelType: 'hud-only',
      viewport:  'topdown',
      gravity:   0,
      gravityDir: 'none',
      cameraAxis: 'fixed',
      backgroundMusicAssetId: null,
      spawnPointId: null,
      rows:     [],
      entities: [],
      tileMap:  {
        tileWidth: ts, tileHeight: ts,
        cols: vpCols, rows: vpRows,
        tilesetAssetId: null,
        layers: [{ id: mkId(), name: 'Background', kind: 'tiles', data: [] }],
      },
      viewportCols: vpCols,
      viewportRows: vpRows,
    });

    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      const ws = s.worldSettings || {};

      const newWorldSettings = {
        ...ws,
        defaultGravity:  preset.physics.gravity,
        defaultViewport: viewportType,
        controlLayout:   preset.mobileControls?.layout || 'platformer',
        mobileControls:  { ...(ws.mobileControls || {}), layout: preset.mobileControls?.layout || 'platformer' },
        gameType:        { primary, secondary },
      };

      const count = Math.max(1, Math.min(numLevels, 10));

      // ── Game levels ──────────────────────────────────────────────────────────
      const gameLevels = Array.from({ length: count }, (_, i) => {
        const base = makeDefaultLevel({ ...s, worldSettings: newWorldSettings }, i,
          { cols: vpCols, rows: vpRows, tileSize: ts });
        const tw = base.tileMap.tileWidth  || 32;
        const th = base.tileMap.tileHeight || 32;
        const c  = base.tileMap.cols || vpCols;
        const r  = base.tileMap.rows || vpRows;

        const bgLayers = isRunner ? [
          { id: mkId(), assetId: null, parallax: { x: 0.2, y: 0 }, scroll: { x: -80,  y: 0 }, offset: { x: 0, y: 0 }, repeat: { x: true, y: false }, opacity: 1, scale: 1 },
          { id: mkId(), assetId: null, parallax: { x: 0.5, y: 0 }, scroll: { x: -200, y: 0 }, offset: { x: 0, y: 0 }, repeat: { x: true, y: false }, opacity: 1, scale: 1 },
        ] : [];

        return {
          ...base,
          name:            count === 1 ? 'Level 1' : `Level ${i + 1}`,
          gravity:         preset.physics.gravity,
          gravityDir:      preset.gravityDir    || 'none',
          cameraAxis:      preset.camera?.axis  || 'both',
          levelType:       'game',
          viewport:        viewportType,
          controlLayout:   preset.mobileControls?.layout || 'platformer',
          runnerMode:            isRunner || undefined,
          runnerBaseSpeed:       isRunner ? (preset.runner?.baseSpeed       ?? preset.playerStats?.speed ?? 240) : undefined,
          runnerLanes:           isRunner ? (preset.runner?.lanes           ?? 3)   : undefined,
          runnerLaneSpacing:     isRunner ? (preset.runner?.laneSpacing     ?? 0)   : undefined,
          speedRampRate:         isRunner ? (preset.runner?.speedRampRate   ?? 2)   : undefined,
          speedRampInterval:     isRunner ? (preset.runner?.speedRampInterval ?? 8) : undefined,
          speedMax:              isRunner ? (preset.runner?.speedMax        ?? 800)  : undefined,
          playerCanShoot:        isRunner ? (preset.runner?.playerCanShoot  ?? true) : undefined,
          playerBulletSpeed:     isRunner ? (preset.runner?.bulletSpeed     ?? 700) : undefined,
          playerBulletDamage:    isRunner ? (preset.runner?.bulletDamage    ?? 25)  : undefined,
          playerBulletSize:      isRunner ? (preset.runner?.bulletSize      ?? 5)   : undefined,
          playerBulletColor:     isRunner ? (preset.runner?.bulletColor     ?? '#fffa60') : undefined,
          spawnWaves:            isRunner ? (preset.spawnWaves ? preset.spawnWaves.map(w => ({ ...w })) : []) : undefined,
          backgrounds:           bgLayers,
          entities:              buildLevelEntities(presetKey, tw, th, c, r),
          viewportCols:          c,
          viewportRows:          r,
          gameSettings: {
            lives:        preset.game?.lives        ?? 3,
            timerSeconds: preset.game?.timerSeconds ?? 0,
            startScore:   preset.game?.startScore   ?? 0,
            winDistance:  preset.runner?.winDistance ?? preset.game?.winDistance ?? 0,
            winWaves:     preset.game?.winWaves     ?? 0,
            winCoins:     preset.game?.winCoins     ?? 0,
            winScore:     preset.game?.winScore     ?? 0,
          },
        };
      });

      // ── HUD levels ───────────────────────────────────────────────────────────
      const splashLevel   = makeHudLevel('Splash Screen');
      const gameOverLevel = makeHudLevel('Game Over');

      // Default HUD content builders
      const _mkRow = (children, layoutOvr = {}) => ({
        id: mkId(),
        layout: {
          direction: 'row', gap: 16, align: 'center', justify: 'center', wrap: false,
          paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, paddingLinked: true,
          ...layoutOvr,
        },
        children,
      });
      const _mkText = (text, textColor = '', fontSize = 14, bindTo = undefined) => ({
        id: mkId(), type: 'Text',
        props: {
          text, textColor, fontSize, alignment: 'center', linkUrl: '',
          sizing: { widthMode: 'hug', heightMode: 'hug' },
          ...(bindTo ? { bindTo } : {}),
        },
        children: [],
      });
      const _mkBtn = (text, targetLevelId) => ({
        id: mkId(), type: 'Button',
        props: {
          text, bgColor: '', textColor: '', borderColor: '', width: 140,
          disabled: false, action: 'level', targetLevelId,
          sizing: { widthMode: 'hug', heightMode: 'hug' },
        },
        children: [],
      });

      const firstGameLevelId = gameLevels[0]?.id;
      const genreLabel = [primary, secondary].filter(Boolean).join(' · ').toUpperCase();

      splashLevel.rows = [
        _mkRow([_mkText(preset.label || 'MY GAME', '', 32)],            { paddingTop: 48, paddingBottom: 16 }),
        _mkRow([_mkText(genreLabel, 'rgba(255,255,255,0.4)', 10)],       { paddingBottom: 32 }),
        _mkRow([_mkBtn('▶  PLAY', firstGameLevelId)]),
      ];

      gameOverLevel.rows = [
        _mkRow([_mkText('GAME OVER', '#ff4444', 36)],                    { paddingTop: 48, paddingBottom: 16 }),
        _mkRow([_mkText('SCORE: {value}', '', 20, 'score')],              { paddingBottom: 24 }),
        _mkRow([_mkBtn('▶  PLAY AGAIN', firstGameLevelId)]),
      ];

      // Level order: Splash → Game Levels → Game Over
      const allLevels = [splashLevel, ...gameLevels, gameOverLevel];

      return {
        ...s,
        worldSettings: newWorldSettings,
        levels:        allLevels,
        currentLevelId: splashLevel.id,
      };
    }));
  }, [updateScreens, makeDefaultLevel, measureLevelCanvasGrid]);

  const moveLevel = useCallback((worldId, dragIndex, hoverIndex) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      const levels = [...(s.levels || [])];
      const [dragged] = levels.splice(dragIndex, 1);
      levels.splice(hoverIndex, 0, dragged);
      return { ...s, levels };
    }));
  }, [updateScreens]);

  const deleteLevel = useCallback((worldId, levelId) => {
    const world = screens.find(s => s.id === worldId);
    const level = world?.levels?.find(l => l.id === levelId);
    if (!level) return;
    // A level has content if any of its surfaces is non-empty:
    // (a) UI rows authored on the canvas (Phase 1), (b) game entities
    // placed on the level (Phase 3+), or (c) painted tilemap data (Phase 3+).
    const hasContent = (
      (level.rows || []).some(r => (r.children || []).length > 0) ||
      (level.entities || []).length > 0 ||
      (level.tileMap?.layers || []).some(layer => (layer.data || []).some(v => v))
    );
    const apply = () => {
      updateScreens(prev => prev.map(s => {
        if (s.id !== worldId || s.kind !== 'world') return s;
        const levels = (s.levels || []).filter(l => l.id !== levelId);
        // After delete, fall back to the world overlay (currentLevelId = null)
        // so the user sees a clear surface instead of being silently moved.
        const nextCurrent = s.currentLevelId === levelId ? null : s.currentLevelId;
        return { ...s, levels, currentLevelId: nextCurrent };
      }));
      if (selectedLevelId === levelId) setSelectedLevelId(null);
    };
    if (hasContent) {
      setConfirmModal({
        title: 'Delete Level',
        message: `Are you sure you want to delete "${level.name}"? Its content will be removed.`,
        confirmText: 'Delete level',
        onConfirm: () => { apply(); setConfirmModal(null); },
        onCancel: () => setConfirmModal(null),
      });
      return;
    }
    apply();
  }, [screens, selectedLevelId, updateScreens]);

  const duplicateLevel = useCallback((worldId, levelId) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      const src = (s.levels || []).find(l => l.id === levelId);
      if (!src) return s;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = mkId();
      copy.name = `${src.name} (Copy)`;
      // regenerate ids inside the copy
      (copy.tileMap?.layers || []).forEach(layer => { layer.id = mkId(); });
      return { ...s, levels: [...(s.levels || []), copy] };
    }));
  }, [updateScreens]);

  const updateLevel = useCallback((worldId, levelId, patch) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      const levels = (s.levels || []).map(l => l.id === levelId ? { ...l, ...patch } : l);
      return { ...s, levels };
    }));
  }, [updateScreens]);

  const selectLevel = useCallback((worldId, levelId) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return { ...s, currentLevelId: levelId };
    }));
    setSelectedLevelId(levelId);
    setSelectedIds([]);
    setShowWorldSettings(false); // selecting a level exits world-settings view
  }, [updateScreens]);


  // ── Entities (live inside a level, absolute positioning) ────────────────
  const makeDefaultEntity = useCallback((type, position = { x: 0, y: 0 }) => {
    const _roleMap = {
      SpawnPoint:      { role: 'spawnPoint',      w: 32, h: 32 },
      Trigger:         { role: 'trigger',          w: 64, h: 64 },
      Teleporter:      { role: 'teleporter',       w: 48, h: 48 },
      ParticleEmitter: { role: 'particleEmitter',  w: 32, h: 32 },
      SoundEmitter:    { role: 'soundEmitter',     w: 28, h: 28 },
      Window:          { role: 'platform',         w: 220, h: 120 },
      Frame:           { role: 'platform',         w: 180, h: 96 },
      Button:          { role: 'platform',         w: 120, h: 36 },
      Shape:           { role: 'platform',         w: 96, h: 64 },
      Image:           { role: 'platform',         w: 96, h: 96 },
      Text:            { role: 'prop',             w: 120, h: 28 },
    };
    const meta = _roleMap[type] || { role: 'prop', w: 64, h: 64 };
    return ({
    id: mkId(),
    type: 'GameEntity',
    name: type === 'GameEntity' ? 'Entity' : type,
    role: meta.role,
    position,
    renderSize: { width: meta.w, height: meta.h },
    animations: [],           // per-animation sprite sheet mappings
    spriteSheetAssetId: null, // legacy fallback — kept for backward compat
    defaultAnimation: null,
    facing: 'right',
    stats: { hp: 100, speed: 100, runSpeed: 180, damage: 10, jumpHeight: 3, defense: 0 },
    spriteOffsetY: 0,
    behavior: {
      // Multi-attack / combo list (replaces single attackAnim for new entities)
      attacks: [], idles: [],
      // Single-anim shortcuts (still used as fallback when attacks[] is empty)
      attackAnim: null, runAnim: null, jumpAnim: null,
      hitAnim: null, heavyHitAnim: null,
      hitThreshold: 30, hitDuration: 500,
      // Enemy AI defaults
      detectionRange: 8, attackRange: 48, patrolRange: 3, attackCooldown: 1200,
    },
    persona: {},
    });
  }, []);

  const addEntity = useCallback((worldId, levelId, type, position) => {
    const entity = makeDefaultEntity(type, position);
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          const tm = l.tileMap || {};
          const entities = l.entities || [];

          // Determine final role (auto-promote first GameEntity to playerMain).
          const shouldBecomePlayer = type === 'GameEntity' && !entities.some(e => e.role === 'playerMain');
          const baseEntity = shouldBecomePlayer
            ? { ...entity, name: entity.name === 'Entity' ? 'Player' : entity.name, role: 'playerMain' }
            : entity;

          // If a configured entity of the same role already exists anywhere in the
          // world, clone its sprite/stats/behavior as the starting point for the
          // new one. Searching all levels means a new level can inherit from a
          // configured playerMain/enemy in another level.
          // Only the id and drop position are kept from the fresh entity.
          const worldEntities = (s.levels || []).flatMap(lvl => lvl.entities || []);
          const template = worldEntities.find(e => e.role === baseEntity.role);
          const nextEntity = template
            ? {
                ...template,
                id:       baseEntity.id,
                position: baseEntity.position,
              }
            : baseEntity;

          return {
            ...l,
            levelType: l.levelType === 'hud-only' && !(l.rows || []).length ? 'game' : (l.levelType || 'game'),
            viewportCols: l.viewportCols || tm.cols || 22,
            viewportRows: l.viewportRows || tm.rows || 16,
            entities: [...entities, nextEntity],
          };
        }),
      };
    }));
    setSelectedIds([entity.id]);
    setSelectedLevelId(null);
    return entity.id;
  }, [makeDefaultEntity, updateScreens]);

  const updateEntity = useCallback((worldId, levelId, entityId, patch) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;

      // When role changes, find a configured entity of that role elsewhere in
      // the world and use it as a template so the new assignment isn't blank.
      let templatePatch = null;
      if (patch.role) {
        const worldEntities = (s.levels || []).flatMap(lvl => lvl.entities || []);
        const tmpl = worldEntities.find(e => e.role === patch.role && e.id !== entityId);
        if (tmpl) templatePatch = tmpl;
      }

      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          return {
            ...l,
            entities: (l.entities || []).map(e => {
              if (e.id !== entityId) return e;
              if (templatePatch) {
                // Full clone of template; preserve only id and position from current entity
                return { ...templatePatch, id: e.id, position: e.position, ...patch };
              }
              return { ...e, ...patch };
            }),
          };
        }),
      };
    }));
  }, [updateScreens]);

  // ── Background layers (per-level, render below the tilemap) ─────────────
  const addBackgroundLayer = useCallback((worldId, levelId, assetId) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          const tm = l.tileMap || {};
          const layers = l.backgrounds || [];
          const next = {
            id: mkId(),
            assetId,
            // 0 = static, 0.5 = half-camera-speed (distant), 1 = tracks 1:1.
            parallax: { x: 0.5, y: 0.5 },
            // Continuous auto-scroll in px/sec (clouds, water, etc.). Applied
            // by the runtime; static in the editor preview.
            scroll: { x: 0, y: 0 },
            offset: { x: 0, y: 0 },
            repeat: { x: true, y: false },
            opacity: 1,
            scale: 1,
          };
          return {
            ...l,
            levelType: l.levelType === 'hud-only' && !(l.rows || []).length ? 'game' : (l.levelType || 'game'),
            viewportCols: l.viewportCols || tm.cols || 22,
            viewportRows: l.viewportRows || tm.rows || 16,
            backgrounds: [...layers, next],
          };
        }),
      };
    }));
  }, [updateScreens]);

  const updateBackgroundLayer = useCallback((worldId, levelId, layerId, patch) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          return {
            ...l,
            backgrounds: (l.backgrounds || []).map(b => b.id === layerId ? { ...b, ...patch } : b),
          };
        }),
      };
    }));
  }, [updateScreens]);

  const removeBackgroundLayer = useCallback((worldId, levelId, layerId) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          return { ...l, backgrounds: (l.backgrounds || []).filter(b => b.id !== layerId) };
        }),
      };
    }));
  }, [updateScreens]);

  const moveBackgroundLayer = useCallback((worldId, levelId, layerId, direction) => {
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          const layers = [...(l.backgrounds || [])];
          const i = layers.findIndex(b => b.id === layerId);
          if (i < 0) return l;
          const j = direction === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= layers.length) return l;
          [layers[i], layers[j]] = [layers[j], layers[i]];
          return { ...l, backgrounds: layers };
        }),
      };
    }));
  }, [updateScreens]);

  const deleteEntities = useCallback((worldId, levelId, entityIds) => {
    const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          return { ...l, entities: (l.entities || []).filter(e => !ids.includes(e.id)) };
        }),
      };
    }));
    setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
  }, [updateScreens]);

  const duplicateEntities = useCallback((worldId, levelId, entityIds) => {
    const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
    const newIds = [];
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          const extras = [];
          (l.entities || []).forEach(e => {
            if (ids.includes(e.id)) {
              const nid = mkId();
              newIds.push(nid);
              extras.push({ ...JSON.parse(JSON.stringify(e)), id: nid, position: { x: e.position.x + 32, y: e.position.y + 32 } });
            }
          });
          return { ...l, entities: [...(l.entities || []), ...extras] };
        }),
      };
    }));
    setTimeout(() => { if (newIds.length > 0) setSelectedIds(newIds); }, 0);
  }, [updateScreens]);

  const copyEntity = useCallback((entityId, level) => {
    const entity = (level?.entities || []).find(e => e.id === entityId);
    if (entity) setEntityClipboard(JSON.parse(JSON.stringify(entity)));
  }, []);

  const pasteEntity = useCallback((worldId, levelId, level) => {
    if (!entityClipboard) return;
    const nid = mkId();
    const pasted = { ...JSON.parse(JSON.stringify(entityClipboard)), id: nid, position: { x: entityClipboard.position.x + 32, y: entityClipboard.position.y + 32 } };
    updateScreens(prev => prev.map(s => {
      if (s.id !== worldId || s.kind !== 'world') return s;
      return {
        ...s,
        levels: (s.levels || []).map(l => {
          if (l.id !== levelId) return l;
          return { ...l, entities: [...(l.entities || []), pasted] };
        }),
      };
    }));
    setSelectedIds([nid]);
  }, [entityClipboard, updateScreens]);

  // ── Color Migration for Existing Components ──────────────────────────────
  useEffect(() => {
    const cleanProps = (props) => {
      const next = { ...props };
      const targets = ['textColor', 'borderColor', 'bgColor', 'color', 'thumbColor', 'iconColor'];
      targets.forEach(key => {
        const val = String(next[key] || '').toLowerCase();
        // If it matches the old hardcoded defaults, clear it so it uses the theme variables
        if (val === '#00ff00' || val === '#000000' || val === 'transparent' || val === 'rgba(0,0,0,0)') {
           next[key] = '';
        }
      });
      return next;
    };

    const cleanComps = (comps) => comps.map(c => ({
      ...c,
      props: cleanProps(c.props),
      children: c.children ? cleanComps(c.children) : []
    }));

    const cleanRows = (rs) => rs.map(r => ({
      ...r,
      props: r.props ? cleanProps(r.props) : {},
      children: r.children ? cleanComps(r.children) : []
    }));

    // Perform one-time migration of existing rows to remove hardcoded green/black defaults
    setRows(prev => cleanRows(prev));
  }, []);

  // ── Defaults by type ────────────────────────────────────────────────────
  const getDefaultProps = type => ({
    Window: { title: 'Window1', width: 400, height: '', bgColor: '', textColor: '', borderColor: '', bgImage: '', bgImageFit: 'cover', layout: { ...DEFAULT_LAYOUT }, sizing: { widthMode: 'fixed', heightMode: 'hug' }, staggered: false },
    Frame: { title: 'Frame1', width: 300, height: '', borderStyle: 'single', bgColor: '', textColor: '', borderColor: '', fontSize: 12, alignment: 'left', layout: { ...DEFAULT_LAYOUT }, sizing: { widthMode: 'fixed', heightMode: 'hug' } },
    Row: { layout: { ...DEFAULT_LAYOUT }, sizing: { widthMode: 'fill', heightMode: 'hug' }, bgColor: '', bgImage: '', bgImageFit: 'cover' },
    Button: { text: 'Button1', bgColor: '', textColor: '', borderColor: '', width: 80, disabled: false, sizing: { widthMode: 'hug', heightMode: 'hug' } },
    Text: { text: 'Text', textColor: '', fontSize: 12, alignment: 'left', linkUrl: '', sizing: { widthMode: 'hug', heightMode: 'hug' } },
    Input: { label: '', placeholder: 'Enter text...', width: 150, maxLength: 0, readOnly: false, disabled: false, textColor: '', borderColor: '', bgColor: '', inputType: 'text', isOTP: false, digits: 4, sizing: { widthMode: 'fixed', heightMode: 'hug' } },
    TextBox: { label: '', placeholder: 'Enter text...', width: 150, maxLength: 0, readOnly: false, disabled: false, textColor: '', borderColor: '', bgColor: '', inputType: 'text', isOTP: false, digits: 4, sizing: { widthMode: 'fixed', heightMode: 'hug' } },
    CheckBox: { text: 'CheckBox1', checked: false, textColor: '', sizing: { widthMode: 'hug', heightMode: 'hug' } },
    RadioButton: { text: 'Option1', checked: false, group: 'group1', textColor: '', sizing: { widthMode: 'hug', heightMode: 'hug' } },
    ComboBox: { items: ['Option 1', 'Option 2', 'Option 3'], width: 150, selectedIndex: 0, textColor: '', borderColor: '', bgColor: '', sizing: { widthMode: 'fixed', heightMode: 'hug' } },
    ListBox: { items: ['Item 1', 'Item 2', 'Item 3'], width: 150, height: 100, multiSelect: false, textColor: '', borderColor: '', bgColor: '', sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
    HScrollBar: { value: 50, min: 0, max: 100, width: 150, bgColor: '', thumbColor: '', sizing: { widthMode: 'fixed', heightMode: 'hug' } },
    VScrollBar: { value: 50, min: 0, max: 100, height: 100, bgColor: '', thumbColor: '', sizing: { widthMode: 'hug', heightMode: 'fixed' } },
    Timer: { interval: 1000, enabled: false, sizing: { widthMode: 'hug', heightMode: 'hug' } },
    Shape: { shapeType: 'rectangle', width: 60, height: 40, borderColor: '', bgColor: '', fill: false, sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
    Line: { color: '', thickness: 1, fullWidth: true, widthPercent: 100, lineStyle: 'solid', sizing: { widthMode: 'fill', heightMode: 'hug' } },
    Image: { src: '', width: 80, height: 80, alt: 'Image', iconSrc: '', iconColor: '', borderThickness: 1, borderColor: '', sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
    Table: {
      columns: [
        { name: 'ID', type: 'number', width: 60 },
        { name: 'Name', type: 'text', width: 120 },
        { name: 'Status', type: 'text', width: 80 },
      ],
      rows: [
        { ID: 1, Name: 'Item 1', Status: 'Active' },
      ],
      width: 400,
      height: 200,
      showHeaders: true,
      stripedRows: true,
      borderColor: '',
      textColor: '',
      headerBgColor: '',
      dataSource: '',
      dataSourceType: 'manual',
      sizing: { widthMode: 'fixed', heightMode: 'fixed' },
    },
    Data: { tableName: '', dataSource: 'sqlite', query: '', sizing: { widthMode: 'hug', heightMode: 'hug' } },
    Loader: { loaderType: 'spinner', color: '', size: 40, speed: 1, thickness: 4, sizing: { widthMode: 'hug', heightMode: 'hug' } },
    Tabs: { tabs: [{ id: 'tab1', label: 'Tab 1' }, { id: 'tab2', label: 'Tab 2' }], activeTabIndex: 0, sizing: { widthMode: 'fill', heightMode: 'hug' } },
    Overlay: { title: 'Modal Overlay', isOpen: false, bgColor: '#000000', modalBg: '', borderColor: '', layout: { direction: 'column', gap: 8, align: 'stretch', justify: 'flex-start' }, sizing: { widthMode: 'fixed', heightMode: 'fixed' } },
    DataRepeater: { tableName: '', layout: { direction: 'column', gap: 8, align: 'stretch', justify: 'flex-start' }, sizing: { widthMode: 'fill', heightMode: 'hug' } },
    Form: { targetTable: '', sourceTable: '', filterValue: '', padding: 10, layout: { direction: 'column', gap: 8, align: 'stretch', justify: 'flex-start' }, sizing: { widthMode: 'fill', heightMode: 'hug' } },
    GameEmbed: { worldId: '', worldName: '', scaling: 'fit', maintainAspect: true, showControls: true, showWindow: true, windowTitle: '', width: 640, height: 360, sizing: { widthMode: 'hug', heightMode: 'hug' } },
    GradualBlur: { position: 'bottom', strength: 12, height: 200, divCount: 16, exponential: true, opacity: 1, animated: false, sizing: { widthMode: 'fill', heightMode: 'hug' } },
  }[type] || { text: type });

  const mkComp = type => {
    const canonicalType = (type === 'TextBox' ? 'Input' : (type === 'Label' ? 'Text' : type));
    return { id: mkId(), type: canonicalType, props: getDefaultProps(canonicalType), children: [] };
  };

  // ── Recursive helpers ────────────────────────────────────────────────────
  const findInRows = (rowsArr, id) => {
    for (const row of rowsArr) {
      if (row.id === id) return row;
      for (const comp of row.children) {
        if (comp.id === id) return comp;
        if (comp.children) {
          const found = findInComps(comp.children, id);
          if (found) return found;
        }
      }
    }
    return null;
  };

  const findInComps = (comps, id) => {
    for (const c of comps) {
      if (c.id === id) return c;
      if (c.children) { const f = findInComps(c.children, id); if (f) return f; }
    }
    return null;
  };

  const updateCompRecursive = (comps, id, newProps) =>
    comps.map(c => {
      if (c.id === id) {
        const layoutKeys = ['direction', 'gap', 'align', 'justify', 'wrap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingLinked'];
        const hasLayoutKeys = Object.keys(newProps).some(key => layoutKeys.includes(key));
        const nextProps = { ...c.props };

        // Handle sizing updates
        if (newProps.sizing) {
          nextProps.sizing = { ...(c.props?.sizing || {}), ...newProps.sizing };
        }

        // Copy non-layout, non-sizing props
        Object.keys(newProps).forEach(key => {
          if (!layoutKeys.includes(key) && key !== 'sizing') {
            nextProps[key] = newProps[key];
          }
        });

        if (hasLayoutKeys) {
          nextProps.layout = {
            ...(c.props?.layout || DEFAULT_LAYOUT),
            ...layoutKeys.reduce((acc, key) => {
              if (newProps[key] !== undefined) acc[key] = newProps[key];
              return acc;
            }, {})
          };
        }

        return { ...c, props: nextProps };
      }

      return { ...c, children: c.children ? updateCompRecursive(c.children, id, newProps) : c.children };
    });

  const deleteCompRecursive = (comps, id) =>
    comps.filter(c => c.id !== id).map(c => ({ ...c, children: c.children ? deleteCompRecursive(c.children, id) : c.children }));

  const addToCompChildren = (comps, parentId, newComp, index = null) => {
    console.log(`[addToCompChildren] Looking for ${parentId} in`, comps.map(c => c.id));
    return comps.map(c => {
      if (c.id === parentId) {
        const nextChildren = [...(c.children || [])];
        const insertAt = index === null ? nextChildren.length : Math.min(Math.max(index, 0), nextChildren.length);
        nextChildren.splice(insertAt, 0, newComp);
        return { ...c, children: nextChildren };
      }
      if (c.children && c.children.length > 0) {
        return { ...c, children: addToCompChildren(c.children, parentId, newComp, index) };
      }
      return c;
    });
  };

  const removeCompRecursive = (comps, id, parentId) => {
    for (let i = 0; i < comps.length; i += 1) {
      const comp = comps[i];
      if (comp.id === id) {
        const nextComps = [...comps];
        const [moved] = nextComps.splice(i, 1);
        return { comps: nextComps, moved, parentId, fromIndex: i };
      }

      if (comp.children?.length) {
        const nested = removeCompRecursive(comp.children, id, comp.id);
        if (nested.moved) {
          const nextComps = [...comps];
          nextComps[i] = { ...comp, children: nested.comps };
          return { comps: nextComps, moved: nested.moved, parentId: nested.parentId, fromIndex: nested.fromIndex };
        }
      }
    }

    return { comps, moved: null, parentId: null, fromIndex: -1 };
  };

  const removeCompFromRows = (rowsArr, id) => {
    for (let i = 0; i < rowsArr.length; i += 1) {
      const row = rowsArr[i];
      const nested = removeCompRecursive(row.children, id, row.id);
      if (nested.moved) {
        const nextRows = [...rowsArr];
        nextRows[i] = { ...row, children: nested.comps };
        return { rows: nextRows, moved: nested.moved, parentId: nested.parentId, fromIndex: nested.fromIndex };
      }
    }

    return { rows: rowsArr, moved: null, parentId: null, fromIndex: -1 };
  };

  const insertIntoComps = (comps, targetId, movedComp, index, parentId = null) => {
    const finalTarget = parentId || targetId;
    for (let i = 0; i < comps.length; i += 1) {
      const comp = comps[i];
      if (comp.id === finalTarget) {
        const nextChildren = [...(comp.children || [])];
        const insertAt = Math.min(Math.max(index, 0), nextChildren.length);
        nextChildren.splice(insertAt, 0, movedComp);
        const nextComps = [...comps];
        nextComps[i] = { ...comp, children: nextChildren };
        return { comps: nextComps, inserted: true };
      }

      if (comp.children?.length) {
        const nested = insertIntoComps(comp.children, targetId, movedComp, index, parentId);
        if (nested.inserted) {
          const nextComps = [...comps];
          nextComps[i] = { ...comp, children: nested.comps };
          return { comps: nextComps, inserted: true };
        }
      }
    }
    return { comps, inserted: false };
  };

  const insertIntoRows = (rowsArr, targetId, movedComp, index, parentId = null) => {
    const finalTarget = parentId || targetId;
    for (let i = 0; i < rowsArr.length; i += 1) {
      const row = rowsArr[i];
      if (row.id === finalTarget) {
        const nextChildren = [...row.children];
        const insertAt = Math.min(Math.max(index, 0), nextChildren.length);
        nextChildren.splice(insertAt, 0, movedComp);
        const nextRows = [...rowsArr];
        nextRows[i] = { ...row, children: nextChildren };
        return { rows: nextRows, inserted: true };
      }

      const nested = insertIntoComps(row.children, targetId, movedComp, index, parentId);
      if (nested.inserted) {
        const nextRows = [...rowsArr];
        nextRows[i] = { ...row, children: nested.comps };
        return { rows: nextRows, inserted: true };
      }
    }
    return { rows: rowsArr, inserted: false };
  };

  const subtreeContainsId = (comp, targetId) => {
    if (!comp || !targetId) return false;
    if (comp.id === targetId) return true;
    return (comp.children || []).some(child => subtreeContainsId(child, targetId));
  };

  const normalizeComponentTree = (comps = []) => comps.map(comp => {
    const canonicalType = comp.type === 'TextBox' ? 'Input' : comp.type;
    const baseProps = getDefaultProps(canonicalType);
    const normalizedProps = { ...baseProps, ...(comp.props || {}) };

    if (['Window', 'Frame', 'Row'].includes(canonicalType)) {
      normalizedProps.layout = {
        ...DEFAULT_LAYOUT,
        ...(baseProps.layout || {}),
        ...(comp.props?.layout || {})
      };
    }

    const cleanColor = (val) => {
      if (!val) return '';
      const low = String(val).toLowerCase();
      if (low === '#00ff00' || low === '#000000' || low === 'transparent' || low === 'rgba(0,0,0,0)') return '';
      return val;
    };

    const colorKeys = ['textColor', 'borderColor', 'bgColor', 'color', 'thumbColor', 'iconColor'];
    colorKeys.forEach(k => {
      if (normalizedProps[k] !== undefined) {
        normalizedProps[k] = cleanColor(normalizedProps[k]);
      }
    });

    return {
      ...comp,
      type: canonicalType,
      props: normalizedProps,
      children: normalizeComponentTree(comp.children || [])
    };
  });

  const normalizeRows = (rowsArr = []) => rowsArr.map(row => ({
    ...row,
    layout: { ...DEFAULT_LAYOUT, ...(row.layout || {}) },
    children: normalizeComponentTree(row.children || [])
  }));

  // ── Add component to existing row ─────────────────────────────────────────
  const addToRow = useCallback((type, rowId, index, parentContainerId = null, extraProps = {}) => {
    console.log(`🚀 [DEBUG] addToRow: screen=${currentScreenId}, row=${rowId}, parent=${parentContainerId}, type=${type}, extra=`, extraProps);
    const newComp = mkComp(type);
    if (extraProps && Object.keys(extraProps).length > 0) {
      newComp.props = { ...newComp.props, ...extraProps };
    }
    setRows(prev => prev.map(row => {
      if (row.id !== rowId) return row;
      if (parentContainerId) {
        return { ...row, children: addToCompChildren(row.children, parentContainerId, newComp, index) };
      }
      const newChildren = [...row.children];
      newChildren.splice(index, 0, newComp);
      return { ...row, children: newChildren };
    }));
    setSelectedIds([newComp.id]);
  }, [setRows, currentScreenId]);

  // ── Create new row ────────────────────────────────────────────────────────
  const addNewRow = useCallback((type, existingItem = null, afterIndex = null, targetScreenId = currentScreenId) => {
    const newRow = { id: mkId(), layout: { ...DEFAULT_LAYOUT }, children: [] };
    if (type) {
      newRow.children = [mkComp(type)];
    }
    if (targetScreenId === currentScreenId) {
      // Goes through setRows which routes to Screen.rows or Level.rows correctly.
      setRows(prev => {
        if (afterIndex !== null) {
          const next = [...prev];
          next.splice(afterIndex, 0, newRow);
          return next;
        }
        return [...prev, newRow];
      });
    } else {
      // Cross-screen targeting (e.g. paste into another screen) — direct mutation.
      // Levels never receive cross-screen drops today, so this stays at screen.rows.
      setScreens(prevScreens => prevScreens.map(s => {
        if (s.id !== targetScreenId) return s;
        const currentRows = s.rows || [];
        if (afterIndex !== null) {
          const next = [...currentRows];
          next.splice(afterIndex, 0, newRow);
          return { ...s, rows: next };
        }
        return { ...s, rows: [...currentRows, newRow] };
      }));
    }
    if (newRow.children.length > 0) setSelectedIds([newRow.children[0].id]);
    else setSelectedIds([newRow.id]);
  }, [currentScreenId, setRows]);

  // ── Move existing component ───────────────────────────────────────────────
  const moveComponent = useCallback((item, toRowId, toIndex, newRowAfter = null, parentId = null) => {
    console.log(`🚀 [DEBUG] moveComponent: id=${item.id}, toRow=${toRowId}, toIndex=${toIndex}, newRowAfter=${newRowAfter}, parentId=${parentId}`);
    setRows(prev => {
      const source = findInRows(prev, item.id);
      if (!source || !source.type) return prev;

      if (item.id === toRowId || subtreeContainsId(source, toRowId)) {
        return prev;
      }

      const removed = removeCompFromRows(prev, item.id);
      if (!removed.moved) {
        console.warn(`⚠️ [DEBUG] moveComponent: Component ${item.id} not found in any row.`);
        return prev;
      }

      // Apply extra props if moving into a special container (like Tabs)
      if (item.extraProps) {
        removed.moved.props = { ...removed.moved.props, ...item.extraProps };
      }

      if (toRowId === '__newrow__') {
        const newRow = { id: mkId(), layout: { ...DEFAULT_LAYOUT }, children: [removed.moved] };
        const result = [...removed.rows];
        result.splice(newRowAfter ?? result.length, 0, newRow);
        console.log(`🚀 [DEBUG] moveComponent: Created new row with component ${item.id}`);
        return result;
      }

      if (!parentId && removed.parentId === toRowId && (toIndex === removed.fromIndex || toIndex === removed.fromIndex + 1)) {
         if (!item.extraProps) return prev; 
      }

      const adjustedIndex = (!parentId && removed.parentId === toRowId && toIndex > removed.fromIndex) ? toIndex - 1 : toIndex;
      const inserted = insertIntoRows(removed.rows, toRowId, removed.moved, adjustedIndex, parentId);
      
      if (!inserted.inserted) {
        console.error(`❌ [DEBUG] moveComponent: Failed to insert component ${item.id} into target ${parentId || toRowId}`);
        return prev; // Fallback to original state if insertion fails
      }

      console.log(`✅ [DEBUG] moveComponent: Successfully moved ${item.id} to ${parentId || toRowId} at index ${adjustedIndex}`);
      return inserted.rows;
    });
  }, [findInRows, setRows]);

  // ── Update component props ────────────────────────────────────────────────
  const updateComponent = useCallback((id, newProps) => {
    setRows(prev => prev.map(row => {
      if (row.id === id) {
        return { ...row, layout: { ...(row.layout || DEFAULT_LAYOUT), ...newProps } };
      }
      return { ...row, children: updateCompRecursive(row.children, id, newProps) };
    }));
  }, [setRows]);

  // ── Delete component ───────────────────────────────────────────────────────
  const deleteComponent = useCallback((idOrIds) => {
    const idsToDelete = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    setRows(prev => {
      let next = [...prev];
      idsToDelete.forEach(id => {
        const isRow = next.some(r => r.id === id);
        if (isRow) next = next.filter(r => r.id !== id);
        else next = next.map(row => ({ ...row, children: deleteCompRecursive(row.children, id) }));
      });
      return next;
    });
    setSelectedIds(prev => prev.filter(id => !idsToDelete.includes(id)));
  }, [setRows]);

  // ── Duplicate component ────────────────────────────────────────────────────
  const duplicateComponent = useCallback((idOrIds) => {
    const idsToDup = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    let newIds = [];

    const cloneTree = (node) => {
      const nid = mkId();
      newIds.push(nid);
      return {
        ...node,
        id: nid,
        children: (node.children || []).map(cloneTree)
      };
    };

    // Routes through setRows so duplication respects the active level (if any).
    setRows(prev => {
      let nextRows = [...prev];
      idsToDup.forEach(id => {
        const isRow = nextRows.some(r => r.id === id);
        if (isRow) {
          nextRows = nextRows.flatMap(row => {
            if (row.id === id) {
              const duplicate = { ...row, id: mkId(), children: (row.children || []).map(cloneTree) };
              return [row, duplicate];
            }
            return [row];
          });
        } else {
           const duplicateTree = (comps) => comps.flatMap(comp => {
            if (comp.id === id) {
              const duplicate = cloneTree(comp);
              return [comp, duplicate];
            }
            if (comp.children?.length) {
              return [{ ...comp, children: duplicateTree(comp.children) }];
            }
            return [comp];
          });
          nextRows = nextRows.map(row => ({ ...row, children: duplicateTree(row.children) }));
        }
      });
      return nextRows;
    });

    if (newIds.length > 0) setSelectedIds(newIds);
  }, [setRows]);

  // ── Clipboard Management ──────────────────────────────────────────────────
  // ── Seleccionar fila ──────────────────────────────────────────────────────
  const selectRow = useCallback((rowId, multi = false) => {
    setSelectedIds(prev => {
      if (multi) {
        if (prev.includes(rowId)) return prev.filter(id => id !== rowId);
        return [...prev, rowId];
      }
      return [rowId];
    });
    setLastSelectedId(rowId);
    setSelectedLevelId(null);
  }, []);

  // ── Find selected element ──────────────────────────────────────────────────
  const findSelected = useCallback(() => {
    if (selectedIds.length === 0) return null;
    return findInRows(rows, selectedIds[selectedIds.length - 1]);
  }, [rows, selectedIds]);

  const copyComponent = useCallback((id) => {
    const comp = findInRows(rows, id);
    if (comp) {
      setClipboard(JSON.parse(JSON.stringify(comp)));
      console.log(`📋 [DEBUG] Copied component ${id} to clipboard`);
    }
  }, [rows]);

  const pasteComponent = useCallback(() => {
    if (!clipboard) return;

    const cloneTree = (node) => ({
      ...node,
      id: mkId(),
      children: (node.children || []).map(cloneTree)
    });

    const pasted = cloneTree(clipboard);
    
    // Insert into current selected container or active screen's last row
    const target = findSelected();
    if (target && CONTAINER_TYPES.includes(target.type)) {
      addToRow(pasted.type, rows[0]?.id, 0, target.id, pasted.props);
    } else {
      // Add to last row
      const lastRowId = rows[rows.length - 1]?.id;
      if (lastRowId) {
        addToRow(pasted.type, lastRowId, (rows[rows.length-1].children || []).length, null, pasted.props);
      } else {
        addNewRow(pasted.type, null, null);
      }
    }
    console.log(`📋 [DEBUG] Pasted component from clipboard`);
  }, [clipboard, rows, findSelected, addToRow, addNewRow]);

  useEffect(() => {
    const handleShortcuts = (e) => {
      const tagName = e.target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

      // Undo/redo work regardless of selection state
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        redo();
        return;
      }

      if (selectedIds.length === 0) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tagName = e.target?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || e.target?.isContentEditable || e.target?.closest('[contenteditable="true"]')) return;

        e.preventDefault();
        // Route entity deletes to deleteEntities; component deletes to deleteComponent.
        const entityIds = selectedIds.filter(id =>
          (activeLevel?.entities || []).some(en => en.id === id)
        );
        if (entityIds.length > 0 && activeLevel && activeScreen) {
          deleteEntities(activeScreen.id, activeLevel.id, entityIds);
          const compIds = selectedIds.filter(id => !entityIds.includes(id));
          if (compIds.length > 0) deleteComponent(compIds);
        } else {
          deleteComponent(selectedIds);
        }
      }
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const entityIds = selectedIds.filter(id => (activeLevel?.entities || []).some(en => en.id === id));
        if (entityIds.length > 0 && activeLevel && activeScreen) {
          duplicateEntities(activeScreen.id, activeLevel.id, entityIds);
        } else {
          duplicateComponent(selectedIds);
        }
      }
      if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
        const tagName = e.target?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
        e.preventDefault();
        const lastId = selectedIds[selectedIds.length - 1];
        const isEntity = lastId && (activeLevel?.entities || []).some(en => en.id === lastId);
        if (isEntity && activeLevel && activeScreen) {
          copyEntity(lastId, activeLevel);
        } else {
          copyComponent(lastId);
        }
      }
      if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
        const tagName = e.target?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
        e.preventDefault();
        if (entityClipboard && activeLevel && activeScreen) {
          pasteEntity(activeScreen.id, activeLevel.id, activeLevel);
        } else {
          pasteComponent();
        }
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [selectedIds, deleteComponent, duplicateComponent, duplicateEntities, copyComponent, copyEntity, pasteComponent, pasteEntity, entityClipboard, undo, redo, activeLevel, activeScreen, deleteEntities]);



  useEffect(() => {
    localStorage.setItem('nanostudio_theme', theme);
    // Apply theme to body so CSS variables reach portals rendered outside .app
    const allThemes = ['theme-nano', 'theme-bios', 'theme-retro', 'theme-amber', 'theme-tron'];
    document.body.classList.remove(...allThemes);
    document.body.classList.add(theme);
  }, [theme]);
  useEffect(() => { 
    localStorage.setItem('nanostudio_builder_name', builderName); 
    document.title = builderName;
  }, [builderName]);

  // Load settings from server on login.
  // builderName is global (admin-set); theme + externalApis are per-user.
  useEffect(() => {
    if (!currentUser) return;
    settingsLoaded.current = false;
    apiFetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.builderName) setBuilderName(data.builderName);
        if (data.externalApis) setExternalApis(data.externalApis);
        if (data.theme) setTheme(data.theme);
        if (data.tutorial) {
          const cfg = normalizeTutorialConfig(data.tutorial);
          setTutorialConfig(cfg);
          if (cfg.visitLimit > 0 && currentUser.role !== 'admin') {
            const visitKey = `nanostudio_tutorial_visits:${currentUser.userId}`;
            const visits = parseInt(localStorage.getItem(visitKey) || '0', 10);
            if (visits < cfg.visitLimit) {
              setTutorialActive(true);
              localStorage.setItem(visitKey, String(visits + 1));
            }
          }
        }
      })
      .catch(err => console.error('Error loading settings:', err))
      .finally(() => { settingsLoaded.current = true; });
  }, [currentUser]);


  // Auto-save settings — builderName write is gated to admin on the server.
  // theme is saved as a per-user preference so each user keeps their own choice.
  useEffect(() => {
    if (!currentUser) return;
    if (isInitialLoading.current) return;
    if (!settingsLoaded.current) return;
    apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ builderName, externalApis, theme, tutorial: tutorialConfig })
    }).catch(err => console.error('Error saving settings:', err));
  }, [builderName, externalApis, theme, tutorialConfig, currentUser]);

  useEffect(() => {
    if (!currentProject.id || currentProject.id === 'default') {
      projectLoaded.current = true;
      isInitialLoading.current = false;
      return;
    }
    if (!currentUser) return;

    projectLoaded.current = false;
    isInitialLoading.current = true;
    Promise.all([
      apiFetch(`/api/projects/${currentProject.id}`).then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      }),
      apiFetch(`/api/projects/${currentProject.id}/assets`).then(r => r.ok ? r.json() : { sprites: [], tilesets: [], sounds: [], backgrounds: [] }),
    ])
      .then(([data, sidecar]) => {
        if (data.screens && data.screens.length > 0) {
          setScreens(data.screens);
          setCurrentScreenId(data.currentScreenId || data.screens[0].id);
        }
        // theme is a per-user preference — don't override it from project data
        if (data.viewMode) setViewMode(data.viewMode);
        if (data.database) setDatabase(data.database);
        if (data.activeWindow) setActiveWindow(data.activeWindow);
        setGameMode(data.gameMode === true);
        if (data.publishSlug || data.description) {
          setCurrentProject(p => ({ ...p, publishSlug: data.publishSlug, description: data.description }));
        }
        // Sidecar is the source of truth; if missing, fall back to inline assets
        // for projects authored before the sidecar split (cheap migration).
        const sidecarHasAny = (sidecar?.sprites?.length || sidecar?.tilesets?.length || sidecar?.sounds?.length);
        const fallback = data.assets || { sprites: [], tilesets: [], sounds: [], backgrounds: [] };
        setAssetsState(sidecarHasAny ? sidecar : fallback);
        assetsDirty.current = false;

        setSaveStatus('');
        // Allow saving after a short delay to ensure React has finished updating state
        setTimeout(() => {
          projectLoaded.current = true;
          isInitialLoading.current = false;
        }, 500);
      })
      .catch((err) => {
        console.error('Error loading project from API:', err);
        // Reset to default so a bad/foreign ID in localStorage can't keep polluting state
        setCurrentProject({ id: 'default', name: 'Untitled' });
        localStorage.removeItem('nanostudio_current_project');
        isInitialLoading.current = false;
      });
  }, [currentProject.id, projectLoadKey, currentUser]);

  useEffect(() => {
    if (editsMade.current) triggerSave();
  }, [screens, database, theme, gameMode, triggerSave]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const countAll = (rowsArr) => rowsArr.reduce((acc, row) => acc + countComps(row.children), 0);
  const countComps = (comps) => comps.reduce((acc, c) => acc + 1 + (c.children ? countComps(c.children) : 0), 0);
  const collectByType = (comps, type) => comps.flatMap(comp => [
    ...(comp.type === type ? [comp] : []),
    ...collectByType(comp.children || [], type)
  ]);
  const getWindows = () => rows.flatMap(r => collectByType(r.children, 'Window'));
  const getOverlays = () => rows.flatMap(r => collectByType(r.children, 'Overlay'));

  const handleNavigate = useCallback((comp) => {
    const p = comp.props || {};
    if (p.action === 'screen' && p.targetScreenId) {
      const targetScreen = screens.find(s => s.id === p.targetScreenId);
      if (targetScreen) {
        // Switch editor mode so the target is visible in visibleScreens.
        const targetIsWorld = targetScreen.kind === 'world';
        if (targetIsWorld && !gameMode) setGameMode(true);
        else if (!targetIsWorld && gameMode) setGameMode(false);
      }
      setCurrentScreenId(p.targetScreenId);
      setSelectedIds([]);
    } else if (p.action === 'overlay' && p.targetOverlayId) {
      const target = findInRows(rows, p.targetOverlayId);
      const isCurrentlyOpen = target?.props?.isOpen;
      updateComponent(p.targetOverlayId, { isOpen: !isCurrentlyOpen });
      if (!isCurrentlyOpen) setSelectedIds([p.targetOverlayId]);
    } else if (p.action === 'level' && p.targetLevelId) {
      // Switch to the specified level within whichever world contains it.
      updateScreens(prev => prev.map(s => {
        if (s.kind !== 'world') return s;
        if (!(s.levels || []).some(l => l.id === p.targetLevelId)) return s;
        return { ...s, currentLevelId: p.targetLevelId };
      }));
      setSelectedIds([]);
    } else if (p.action === 'external' && p.href) {
      window.open(p.href, '_blank');
    } else if (p.action === 'email' && p.mailto) {
      window.location.href = `mailto:${p.mailto}`;
    }
  }, [setCurrentScreenId, setSelectedIds, updateComponent, updateScreens, rows, screens, gameMode, setGameMode]);

  // ── Export HTML ───────────────────────────────────────────────────────────
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const safeJson = (obj) => JSON.stringify(obj)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--');

  const styleObjToString = (styles) => {
    const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'zoom', 'tabSize']);
    const camelToKebab = (str) => str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

    return Object.entries(styles)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        let cssValue = value;
        if (typeof cssValue === 'number' && cssValue !== 0 && !unitless.has(key)) {
          cssValue = `${cssValue}px`;
        }
        return `${camelToKebab(key)}:${cssValue}`;
      })
      .join(';');
  };

  // Mirrors Canvas.jsx screen container inline style exactly
  const screenLayoutToStyles = (sl = {}) => {
    const direction = sl.direction || 'column';
    const gap = sl.gap != null ? sl.gap : 0;
    const align = sl.align || 'stretch';
    const justify = sl.justify || 'flex-start';
    const wrap = sl.wrap || false;
    return {
      display: 'flex',
      flexDirection: direction,
      gap: `${gap}px`,
      alignItems: align,
      justifyContent: justify,
      flexWrap: wrap ? 'wrap' : 'nowrap',
      paddingTop: `${sl.paddingTop ?? 20}px`,
      paddingRight: `${sl.paddingRight ?? 20}px`,
      paddingBottom: `${sl.paddingBottom ?? 20}px`,
      paddingLeft: `${sl.paddingLeft ?? 20}px`,
    };
  };

  // Mirrors Canvas.jsx LayoutRow inline style exactly
  const rowLayoutToStyles = (layout) => {
    const l = layout || {};
    const direction = l.direction || 'row';
    const gap = l.gap ?? 8;
    const align = l.align || 'flex-start';
    const justify = l.justify || 'flex-start';
    const wrap = l.wrap || false;
    return {
      display: 'flex',
      flexDirection: direction,
      gap: `${gap}px`,
      alignItems: align,
      justifyContent: justify,
      flexWrap: wrap ? 'wrap' : 'nowrap',
      paddingTop: `${l.paddingTop ?? 0}px`,
      paddingRight: `${l.paddingRight ?? 0}px`,
      paddingBottom: `${l.paddingBottom ?? 0}px`,
      paddingLeft: `${l.paddingLeft ?? 0}px`,
    };
  };

  // Generic layout-to-styles (used for Window/Frame inner content)
  const layoutToStyles = (layout = {}) => ({
    display: 'flex',
    flexDirection: layout.direction || 'row',
    gap: layout.gap !== '' && layout.gap != null ? `${layout.gap}px` : '8px',
    alignItems: layout.align || 'flex-start',
    justifyContent: layout.justify || 'flex-start',
    flexWrap: layout.wrap ? 'wrap' : 'nowrap',
    paddingTop: layout.paddingTop != null ? `${layout.paddingTop}px` : undefined,
    paddingRight: layout.paddingRight != null ? `${layout.paddingRight}px` : undefined,
    paddingBottom: layout.paddingBottom != null ? `${layout.paddingBottom}px` : undefined,
    paddingLeft: layout.paddingLeft != null ? `${layout.paddingLeft}px` : undefined,
  });

  const getThemeColor = (val, themeVar) => {
    if (!val) return `var(${themeVar})`;
    if (String(val).startsWith('var(--')) return val;
    const low = String(val).toLowerCase();
    if (low === '#00ff00' || low === '#000000' || low === 'transparent') return `var(${themeVar})`;
    return val;
  };

  const renderComponentExport = (comp, parentDirection = 'row') => {
    const p = comp.props || {};
    const isWidthFill = p.sizing?.widthMode === 'fill';
    const isHeightFill = p.sizing?.heightMode === 'fill';
    const isWidthHug = p.sizing?.widthMode === 'hug';
    const isHeightHug = p.sizing?.heightMode === 'hug';

    // Match Canvas sizing logic (Canvas.jsx lines 197-214)
    const shouldStretch = isHeightFill || (isWidthFill && parentDirection === 'column');

    const renderChildren = (childDirection) => {
      const dir = childDirection || 'row';
      return (comp.children || []).map(c => renderComponentExport(c, dir)).join('');
    };

    const wrapperStyle = {
      display: (isWidthFill || isHeightFill) ? 'flex' : 'inline-flex',
      flex: isWidthFill ? '1 1 0%' : (isHeightFill ? '1 1 auto' : '0 0 auto'),
      alignSelf: shouldStretch ? 'stretch' : 'auto',
      minWidth: 0,
      minHeight: isHeightFill ? 0 : undefined,
      boxSizing: 'border-box',
      maxWidth: '100%',
    };

    const wrapComponent = (innerHtml) => {
      return `<div id="${comp.id}" class="export-wrapper" style="${styleObjToString(wrapperStyle)}">${innerHtml}</div>`;
    };

    switch (comp.type) {
      case 'Window': {
        const layoutStyles = layoutToStyles(p.layout);
        const paddedStyles = {
          ...layoutStyles,
          paddingTop: `${(parseInt(p.layout?.paddingTop) || 0) + 12}px`,
          paddingRight: `${(parseInt(p.layout?.paddingRight) || 0) + 12}px`,
          paddingBottom: `${(parseInt(p.layout?.paddingBottom) || 0) + 12}px`,
          paddingLeft: `${(parseInt(p.layout?.paddingLeft) || 0) + 12}px`,
        };
        
        let closeBtnHtml = '';
        if (p.showClose && p.closeNextScreenId) {
          if (p.closeNextScreenId === '__close_window__') {
            closeBtnHtml = `<button class="retro-window-close" onclick="closeScreen(this)">X</button>`;
          } else {
            closeBtnHtml = `<button class="retro-window-close" onclick="goToScreen('${p.closeNextScreenId}')">X</button>`;
          }
        }

        const html = `<div id="${comp.id}" class="retro-window" style="${styleObjToString({
          ...wrapperStyle,
          display: isWidthFill ? 'flex' : 'inline-flex',
          flexDirection: 'column',
          width: isWidthFill ? '100%' : (isWidthHug ? 'auto' : (p.width ? `${p.width}px` : '100%')),
          minHeight: isHeightFill ? '100%' : (isHeightHug ? 'auto' : (p.height ? `${p.height}px` : '')),
          height: isHeightFill ? '100%' : (isHeightHug ? 'auto' : 'auto'),
          background: getThemeColor(p.bgColor, '--bg'),
          borderColor: getThemeColor(p.borderColor, '--border'),
        })}"><div class="retro-window-titlebar"><span class="retro-window-title" style="color:${getThemeColor(p.textColor, '--accent')}">${escapeHtml(p.title)}</span>${closeBtnHtml}</div><div class="retro-window-content" style="${styleObjToString(paddedStyles)}">${renderChildren(p.layout?.direction || 'row')}</div></div>`;
        return html;
      }
      case 'Frame': {
        const borderValue = p.borderStyle === 'double' ? '3px double' : p.borderStyle === 'dashed' ? '1px dashed' : '1px solid';
        const html = `<div id="${comp.id}" class="retro-frame-wrapper" style="${styleObjToString({ 
          ...wrapperStyle,
          display: isWidthFill ? 'flex' : 'inline-flex',
          flexDirection: 'column',
          width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '100%'),
          height: isHeightFill ? '100%' : 'auto',
        })}"><fieldset class="retro-frame" style="${styleObjToString({
          border: `${borderValue} ${getThemeColor(p.borderColor, '--border')}`,
          background: p.bgColor || 'transparent',
          minHeight: isHeightFill ? '100%' : (p.height ? `${p.height}px` : 'auto'),
          height: isHeightFill ? '100%' : 'auto',
        })}"><legend style="color:${getThemeColor(p.textColor, '--accent')};font-size:${p.fontSize||12}px;text-align:${p.alignment||'left'};">${escapeHtml(p.title)}</legend><div class="retro-frame-content" style="${styleObjToString(layoutToStyles(p.layout))}">${renderChildren(p.layout?.direction || 'row')}</div></fieldset></div>`;
        return html;
      }
      case 'Row': {
        const rowDirection = p.layout?.direction || 'row';
        const rowBgStyles = p.bgImage ? {
          backgroundImage: `url(${p.bgImage})`,
          backgroundSize: p.bgImageFit === 'tile' ? 'auto' : (p.bgImageFit === 'fill' ? '100% 100%' : (p.bgImageFit || 'cover')),
          backgroundRepeat: p.bgImageFit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center',
        } : {};
        const html = `<div id="${comp.id}" class="retro-row" style="${styleObjToString({
          ...wrapperStyle,
          ...layoutToStyles(p.layout),
          width: isWidthFill ? '100%' : (p.width ? (typeof p.width === 'string' ? p.width : `${p.width}px`) : '100%'),
          minHeight: isHeightFill ? '100%' : (p.height ? (typeof p.height === 'string' ? p.height : `${p.height}px`) : '32px'),
          height: isHeightFill ? '100%' : 'auto',
          background: p.bgColor || 'transparent',
          ...rowBgStyles,
        })}">${renderChildren(rowDirection)}</div>`;
        return html;
      }
      case 'Button': {
        const buildExportIcon = (src) => {
          const resolved = (src || '').trim();
          if (!resolved) return '';
          const sz = p.iconSize || 12;
          const isSvg = resolved.includes('<svg');
          // HTML attribute uses double quotes, so url() must use single quotes.
          // Encode " as %22 (not ') so the SVG content is safe inside url('...').
          const encoded = resolved
            .replace(/"/g, '%22')
            .replace(/#/g, '%23')
            .replace(/[\n\r]/g, '')
            .replace(/\s+/g, ' ');
          const maskVal = isSvg
            ? `url('data:image/svg+xml,${encoded}')`
            : `url('${resolved}')`;
          return `<span aria-hidden="true" style="display:inline-block;width:${sz}px;height:${sz}px;flex-shrink:0;background-color:currentColor;mask-image:${maskVal};-webkit-mask-image:${maskVal};mask-size:contain;-webkit-mask-size:contain;mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;mask-position:center;-webkit-mask-position:center;"></span>`;
        };

        const iconLeft  = buildExportIcon(p.iconLeftSrc  || p.iconLeftUrl);
        const iconRight = buildExportIcon(p.iconRightSrc || p.iconRightUrl);
        const hasIcons  = !!(iconLeft || iconRight);
        const iconOnly  = hasIcons && !(p.text || '').trim();

        // Use CSS custom properties so :hover CSS rules can override backgrounds/colors
        const btnStyle = styleObjToString({
          ...(iconOnly
            ? { aspectRatio: '1 / 1', padding: '4px' }
            : { width: isWidthFill ? '100%' : (isWidthHug ? 'auto' : (p.width ? `${p.width}px` : 'auto')) }),
          '--button-bg':     p.bgColor     ? getThemeColor(p.bgColor,     '--bg')   : '',
          '--button-text':   p.textColor   ? getThemeColor(p.textColor,   '--text') : '',
          '--button-border': p.borderColor ? getThemeColor(p.borderColor, '--text') : '',
          cursor: p.disabled ? 'not-allowed' : 'pointer',
          opacity: p.disabled ? 0.6 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: hasIcons && !iconOnly ? '6px' : undefined,
        });

        let onClickAttr = '';
        if (p.action === 'screen' && p.targetScreenId) {
          onClickAttr = p.staggered
            ? `onclick="goToScreen('${p.targetScreenId}', true)"`
            : `onclick="goToScreen('${p.targetScreenId}')"`;
        } else if (p.action === 'overlay' && p.targetOverlayId) {
          onClickAttr = `onclick="toggleOverlay('${p.targetOverlayId}', true)"`;
        } else if (p.action === 'external' && p.href) {
          onClickAttr = `onclick="window.open('${escapeHtml(p.href)}','_blank')"`;
        } else if (p.action === 'email' && p.mailto) {
          onClickAttr = `onclick="location.href='mailto:${escapeHtml(p.mailto)}'"`;
        }

        const variantClass = p.variant && p.variant !== 'default' ? ` retro-button--${p.variant}` : '';
        const btnContent = `${iconLeft}${iconOnly ? '' : `<span>${escapeHtml(p.text || '')}</span>`}${iconRight}`;
        return wrapComponent(`<button class="retro-button${variantClass}" style="${btnStyle}" ${onClickAttr} ${p.disabled ? 'disabled' : ''}>${btnContent}</button>`);
      }
      case 'Text':
      case 'Label': {
        const textAlign = p.alignment || 'left';
        
        // Helper to convert [tag] to <tag> for export (multiline support)
        const formatForExport = (txt) => {
          if (!txt) return '';
          return escapeHtml(txt)
            .replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<strong>$1</strong>')
            .replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<em>$1</em>')
            .replace(/\[u\]([\s\S]*?)\[\/u\]/g, '<u style="text-decoration:underline;">$1</u>')
            .replace(/\[s\]([\s\S]*?)\[\/s\]/g, '<s style="text-decoration:line-through;">$1</s>')
            .replace(/\[sup\]([\s\S]*?)\[\/sup\]/g, '<sup>$1</sup>')
            .replace(/\[sub\]([\s\S]*?)\[\/sub\]/g, '<sub>$1</sub>');
        };

        const style = styleObjToString({
          fontSize: p.fontSize || 12,
          textAlign,
          justifyContent: textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: getThemeColor(p.textColor, '--text'),
          display: 'inline-block',
          width: isWidthFill ? '100%' : 'auto'
        });

        const innerContent = formatForExport(p.text);
        const accentColor = THEMES[theme]?.accent || '#33ff33';
        const caretHtml = p.showCaret
          ? `<span class="tfy-caret" style="display:inline-block;width:${Math.max(2, Math.round((p.fontSize || 12) * 0.55))}px;height:1.1em;background:${accentColor};vertical-align:text-bottom;margin-left:1px;animation:tfy-caret-blink 1s step-end infinite;flex-shrink:0;"></span>`
          : '';

        // Action-based rendering
        let onClickAttr = '';
        let linkStyle = '';
        if (p.action === 'screen' && p.targetScreenId) {
          onClickAttr = p.staggered
            ? `onclick="goToScreen('${p.targetScreenId}', true)"`
            : `onclick="goToScreen('${p.targetScreenId}')"`;
          linkStyle = 'text-decoration:underline;cursor:pointer;';
        } else if (p.action === 'overlay' && p.targetOverlayId) {
          onClickAttr = `onclick="toggleOverlay('${p.targetOverlayId}', true)"`;
          linkStyle = 'text-decoration:underline;cursor:pointer;';
        } else if (p.action === 'external' && p.href) {
          const html = `<a href="${escapeHtml(p.href)}" target="_blank" style="text-decoration:underline;color:inherit;display:inline-block;width:${isWidthFill?'100%':'auto'};"><span style="${style}">${innerContent}${caretHtml}</span></a>`;
          return wrapComponent(html);
        } else if (p.action === 'email' && p.mailto) {
          onClickAttr = `onclick="location.href='mailto:${escapeHtml(p.mailto)}'"`;
          linkStyle = 'text-decoration:underline;cursor:pointer;';
        }

        const innerWithCaret = `${innerContent}${caretHtml}`;
        const html = onClickAttr
          ? wrapComponent(`<span style="${style};${linkStyle}" ${onClickAttr}>${innerWithCaret}</span>`)
          : wrapComponent(`<span style="${style}">${innerWithCaret}</span>`);

        return html;
      }
      case 'Input':
      case 'TextBox': {
        let inputContent = '';
        if (p.isOTP) {
          const digitCount = parseInt(p.digits) || 4;
          let inputs = '';
          for (let i = 0; i < digitCount; i++) {
            inputs += `<input class="retro-textbox" type="text" maxlength="1" style="width:36px;height:42px;text-align:center;font-size:18px;margin-right:8px;border-color:${getThemeColor(p.borderColor, '--text')};color:${getThemeColor(p.textColor, '--text')};background:${getThemeColor(p.bgColor, '--input-bg')};" ${p.readOnly ? 'readonly' : ''} ${p.disabled ? 'disabled' : ''} />`;
            if (digitCount === 6 && i === 2) inputs += `<span style="color:var(--border);margin-right:8px;align-self:center;">-</span>`;
          }
          inputContent = `<div style="display:flex;align-items:center;">${inputs}</div>`;
        } else {
          inputContent = `<input class="retro-textbox" type="${p.inputType || 'text'}" placeholder="${escapeHtml(p.placeholder)}" style="${styleObjToString({
            width: '100%',
            borderColor: getThemeColor(p.borderColor, '--text'),
            color: getThemeColor(p.textColor, '--text'),
            background: getThemeColor(p.bgColor, '--input-bg'),
          })}" ${p.readOnly ? 'readonly' : ''} ${p.disabled ? 'disabled' : ''} />`;
        }

        const finalHtml = p.label 
          ? `<div class="property-group" style="width: ${isWidthFill ? '100%' : (isWidthHug ? 'auto' : (p.width ? `${p.width}px` : '150px'))};">
               <label>${escapeHtml(p.label)}</label>
               ${inputContent}
             </div>`
          : inputContent;

        return wrapComponent(finalHtml);
      }
      case 'CheckBox':
        return wrapComponent(`<label class="retro-checkbox" style="color:${getThemeColor(p.textColor, '--text')};"><input type="checkbox" ${p.checked ? 'checked' : ''} /><span>${escapeHtml(p.text)}</span></label>`);
      case 'RadioButton':
        return wrapComponent(`<label class="retro-radio" style="color:${getThemeColor(p.textColor, '--text')};"><input type="radio" name="${escapeHtml(p.group || 'group1')}" ${p.checked ? 'checked' : ''} /><span>${escapeHtml(p.text)}</span></label>`);
      case 'Selector':
      case 'ComboBox': {
        const items = (p.items?.length ? p.items : ['Option 1', 'Option 2', 'Option 3']).map(item => `<option ${item === p.value ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('');
        return wrapComponent(`<select class="retro-select" style="${styleObjToString({
          width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '150px'),
          height: isHeightFill ? '100%' : 'auto',
          borderColor: getThemeColor(p.borderColor, '--border'),
          color: getThemeColor(p.textColor, '--text'),
          backgroundColor: getThemeColor(p.bgColor, '--input-bg'),
        })}">${items}</select>`);
      }
      case 'ListBox': {
        const items = (p.items || []).map(item => `<option ${item === p.value ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('');
        return wrapComponent(`<select class="retro-listbox" ${p.multiSelect ? 'multiple' : ''} size="4" style="${styleObjToString({
          width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '150px'),
          height: isHeightFill ? '100%' : (p.height ? `${p.height}px` : '100px'),
          borderColor: getThemeColor(p.borderColor, '--border'),
          color: getThemeColor(p.textColor, '--text'),
          backgroundColor: getThemeColor(p.bgColor, '--input-bg'),
        })}">${items}</select>`);
      }
      case 'HScrollBar':
      case 'VScrollBar': {
        const isVertical = comp.type === 'VScrollBar';
        const barStyle = styleObjToString({
          width: isVertical ? '16px' : (p.width ? `${p.width}px` : '150px'),
          height: isVertical ? (p.height ? `${p.height}px` : '100px') : '16px',
          background: getThemeColor(p.bgColor, '--bg'),
          border: `1px solid var(--border)`,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'flex-start',
        });
        const thumbStyle = styleObjToString({
          width: isVertical ? '100%' : `${p.value || 50}%`,
          height: isVertical ? `${p.value || 50}%` : '100%',
          background: getThemeColor(p.thumbColor, '--text'),
          opacity: 0.5,
        });
        return wrapComponent(`<div class="retro-scrollbar" style="${barStyle}"><div style="${thumbStyle}"></div></div>`);
      }
      case 'PictureBox':
        return wrapComponent(`<div class="retro-picturebox" style="${styleObjToString({
          width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '150px'),
          minHeight: isHeightFill ? '100%' : (p.height ? `${p.height}px` : '100px'),
          height: isHeightFill ? '100%' : 'auto',
          border: p.border ? `1px solid ${getThemeColor(p.borderColor, '--border')}` : 'none',
        })}">${renderChildren()}</div>`);
      case 'Shape':
        return wrapComponent(`<div style="${styleObjToString({
          width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '60px'),
          height: isHeightFill ? '100%' : (p.height ? `${p.height}px` : '40px'),
          background: p.fill ? getThemeColor(p.bgColor, '--text') : 'transparent',
          border: `1px solid ${getThemeColor(p.borderColor, '--text')}`,
          borderRadius: p.shapeType === 'circle' ? '50%' : '0',
          display: 'inline-block',
        })}"></div>`);
      case 'Line': {
        const borderValue = 
          p.lineStyle === 'double' ? `${p.thickness || 1}px double` :
          p.lineStyle === 'dashed' ? `${p.thickness || 1}px dashed` :
          `${p.thickness || 1}px solid`;
        return wrapComponent(`<div style="${styleObjToString({
          width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '100%'),
          borderTop: `${borderValue} ${getThemeColor(p.color, '--text')}`,
          margin: '8px 0',
          height: 0,
          flexShrink: 0
        })}"></div>`);
      }
      case 'Image': {
        const bThick = p.borderThickness !== undefined ? p.borderThickness : 1;
        const bStyle = bThick > 0 ? `${bThick}px solid ${getThemeColor(p.borderColor, '--border')}` : 'none';
        const isSvg = p.src && (p.src.toLowerCase().endsWith('.svg') || p.src.startsWith('data:image/svg+xml'));
        const finalIconColor = getThemeColor(p.iconColor, '--accent');

        const containerStyle = {
          width: isWidthFill ? '100%' : (isWidthHug ? 'auto' : (p.width > 0 ? `${p.width}px` : '80px')),
          height: isHeightFill ? '100%' : (isHeightHug ? 'auto' : (p.height > 0 ? `${p.height}px` : '80px')),
          border: bStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: 'transparent'
        };

        // Si hay iconSrc (de la librería interna), lo priorizamos
        if (p.iconSrc) {
          const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(p.iconSrc)}`;
          const iconHtml = `<div style="width:100%;height:100%;background-color:${finalIconColor};mask-image:url('${svgDataUri}');mask-repeat:no-repeat;mask-position:center;mask-size:contain;-webkit-mask-image:url('${svgDataUri}');-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain;"></div>`;
          return wrapComponent(`<div class="image-icon-render" style="${styleObjToString(containerStyle)}">${iconHtml}</div>`);
        }

        if (isSvg && p.iconColor) {
          return wrapComponent(`<div style="${styleObjToString(containerStyle)}"><div style="width:100%;height:100%;background-color:${finalIconColor};mask-image:url('${p.src}');mask-repeat:no-repeat;mask-position:center;mask-size:contain;-webkit-mask-image:url('${p.src}');-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain;"></div></div>`);
        }

        if (p.src) {
          const imgStyle = isWidthHug || isHeightHug 
            ? `max-width:100%; height:auto; object-fit:contain;`
            : `width:100%; height:100%; object-fit:contain;`;
          return wrapComponent(`<div style="${styleObjToString(containerStyle)}"><img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.alt || '')}" style="${imgStyle}"></div>`);
        }
        return wrapComponent(`<div style="${styleObjToString(containerStyle)}"><span style="font-size:10px;color:var(--text-dim);">[IMG ${p.width || 80}x${p.height || 80}]</span></div>`);
      }
      case 'Form': {
        const layoutStyles = layoutToStyles(p.layout);
        const padding = p.padding || 10;
        const formInner = (comp.children || []).map(c => renderComponentExport(c, p.layout?.direction || 'row')).join('');
        const formStyles = {
          ...layoutStyles,
          width: isWidthFill ? '100%' : (isWidthHug ? 'auto' : (p.width ? `${p.width}px` : '100%')),
          height: isHeightFill ? '100%' : (isHeightHug ? 'auto' : 'auto'),
          padding: `${padding}px`,
          boxSizing: 'border-box'
        };
        return wrapComponent(`<form class="retro-form" style="${styleObjToString(formStyles)}">${formInner}</form>`);
      }
      case 'DataRepeater': {
        const layoutStyles = layoutToStyles(p.layout);
        const repeaterInner = (comp.children || []).map(c => renderComponentExport(c, p.layout?.direction || 'row')).join('');
        const repeaterStyles = {
          ...layoutStyles,
          width: isWidthFill ? '100%' : (isWidthHug ? 'auto' : (p.width ? `${p.width}px` : '100%')),
          height: isHeightFill ? '100%' : (isHeightHug ? 'auto' : 'auto'),
          padding: '0',
          border: 'none',
          boxSizing: 'border-box'
        };
        // Export just one instance as a template placeholder
        return wrapComponent(`<div class="retro-data-repeater" style="${styleObjToString(repeaterStyles)}" data-table="${p.tableName || ''}">
          <!-- REPEATER TEMPLATE -->
          ${repeaterInner}
        </div>`);
      }
      case 'Loader': {
        const dur = (2 / (p.speed || 1)).toFixed(2);
        const color = getThemeColor(p.color, '--accent');
        const loaderWidth = isWidthFill ? '100%' : (p.width ? `${p.width}px` : 'auto');
        const loaderHeight = isHeightFill ? '100%' : (p.height ? `${p.height}px` : 'auto');
        
        let loaderInner = '';
        if (p.loaderType === 'dots') {
          loaderInner = `<div class="retro-loader-dots">
            <div style="width:${p.size/4}px;height:${p.size/4}px;background-color:${color};animation:retro-dots ${dur}s ease-in-out infinite;"></div>
            <div style="width:${p.size/4}px;height:${p.size/4}px;background-color:${color};animation:retro-dots ${dur}s ease-in-out infinite 0.2s;"></div>
            <div style="width:${p.size/4}px;height:${p.size/4}px;background-color:${color};animation:retro-dots ${dur}s ease-in-out infinite 0.4s;"></div>
          </div>`;
        } else if (p.loaderType === 'bar') {
          loaderInner = `<div class="retro-loader-bar" style="width:100%;height:${p.thickness||4}px;border:1px solid ${color};"><div style="background-color:${color};animation:retro-bar ${dur}s linear infinite;"></div></div>`;
        } else if (p.loaderType === 'bounce') {
          loaderInner = `<div class="retro-loader-bounce" style="width:${p.size}px;height:${p.size/2}px;"><div style="width:${p.size/3}px;height:${p.size/3}px;background-color:${color};animation:retro-bounce ${dur}s cubic-bezier(0.455,0.03,0.515,0.955) infinite alternate;"></div></div>`;
        } else {
          loaderInner = `<div class="retro-loader-spinner" style="width:${p.size}px;height:${p.size}px;border:${p.thickness||4}px solid rgba(255,255,255,0.1);border-top-color:${color};animation:retro-spin ${dur}s linear infinite;"></div>`;
        }
        return wrapComponent(`<div style="display:flex;align-items:center;justify-content:center;padding:10px;width:${loaderWidth};height:${loaderHeight};box-sizing:border-box;">${loaderInner}</div>`);
      }
      case 'Tabs': {
        const tabsArr = p.tabs || [];
        const activeIdx = p.activeTabIndex || 0;
        const containerId = `tabs-${comp.id}`;
        let headers = '';
        tabsArr.forEach((t, i) => {
          const isActive = i === activeIdx;
          headers += `<div class="retro-tab ${isActive?'active':''}" 
            id="${containerId}-header-${i}"
            onclick="switchTab('${containerId}', ${i})"
            style="padding:6px 12px;cursor:pointer;font-size:11px;font-family:monospace;border:1px solid var(--border);border-bottom:${isActive?'1px solid var(--bg)':'1px solid var(--border)'};background:${isActive?'var(--bg)':'rgba(0,0,0,0.2)'};color:${isActive?'var(--accent)':'var(--text-dim)'};margin-bottom:-1px;margin-right:2px;font-weight:${isActive?'bold':'normal'};white-space:nowrap;">${escapeHtml(t.label)}</div>`;
        });

        let contents = '';
        tabsArr.forEach((t, i) => {
          const isActive = i === activeIdx;
          const tabChildren = (comp.children || []).filter(c => (c.props?.tabIndex || 0) === i);
          const renderedTabChildren = tabChildren.map(renderComponentExport).join('');
          contents += `<div id="${containerId}-content-${i}" class="retro-tab-content" style="display:${isActive?'block':'none'};">
            <div style="${styleObjToString(layoutToStyles(p.layout))}">${renderedTabChildren}</div>
          </div>`;
        });

        return wrapComponent(`<div class="retro-tabs-container" id="${containerId}" style="width:100%;display:flex;flex-direction:column;"><div class="retro-tabs-header" style="display:flex;border-bottom:1px solid var(--border);">${headers}</div><div class="retro-tabs-content" style="border:1px solid var(--border);border-top:none;padding:12px;min-height:100px;background:var(--bg);position:relative;">${contents}</div></div>`);
      }
      case 'GradualBlur': {
        const gbPos = p.position || 'bottom';
        const gbStr = Math.max(0, Number(p.strength) || 12);
        const gbH   = Math.max(4, Number(p.height) || 200);
        const gbN   = Math.max(2, Math.min(32, Number(p.divCount) || 16));
        const gbExp = p.exponential !== false;
        const gbOpa = Number(p.opacity ?? 1);
        const isVert = gbPos === 'top' || gbPos === 'bottom';

        const gbLayers = Array.from({ length: gbN }, (_, i) => {
          const t = i / (gbN - 1);
          const intensity = gbExp ? t * t : t;
          const blurAmt = (gbPos === 'top' || gbPos === 'left') ? (1 - intensity) * gbStr : intensity * gbStr;
          const sizeVal = gbH / gbN;
          const layerStyle = isVert
            ? `height:${sizeVal}px;backdrop-filter:blur(${blurAmt.toFixed(2)}px);-webkit-backdrop-filter:blur(${blurAmt.toFixed(2)}px);`
            : `width:${sizeVal}px;backdrop-filter:blur(${blurAmt.toFixed(2)}px);-webkit-backdrop-filter:blur(${blurAmt.toFixed(2)}px);`;
          return `<div style="${layerStyle}flex-shrink:0;"></div>`;
        }).join('');

        const wrapStyle = [
          'display:flex;',
          `opacity:${gbOpa};`,
          'pointer-events:none;',
          'overflow:hidden;',
          'flex-shrink:0;',
          isVert ? `width:100%;height:${gbH}px;flex-direction:column;` : `height:100%;width:${gbH}px;flex-direction:row;`,
          p.animated ? 'animation:gb-pulse 3s ease-in-out infinite;' : '',
        ].join('');

        return wrapComponent(`<div style="${wrapStyle}">${gbLayers}</div>`);
      }
      case 'Overlay': {
        return `<div class="retro-overlay-mask" id="overlay-${comp.id}" style="position:fixed;top:0;left:0;right:0;bottom:0;background:${p.bgColor||'rgba(0,0,0,0.7)'};z-index:1000;display:none;align-items:center;justify-content:center;pointer-events:all;" onclick="this.style.display='none'">
          <div class="retro-window" style="width:400px;min-height:200px;background:${p.modalBg||'var(--panel-bg)'};border-color:${p.borderColor||'var(--border)'};position:relative;box-shadow:0 0 30px rgba(0,0,0,0.5);" onclick="event.stopPropagation()">
            <div class="retro-window-titlebar"><span class="retro-window-title">${escapeHtml(p.title)}</span><button class="retro-window-close" onclick="document.getElementById('overlay-${comp.id}').style.display='none'">X</button></div>
            <div class="retro-window-content" style="padding:20px;">${renderChildren()}</div>
          </div>
        </div>`;
      }
      case 'GameEmbed': {
        const worldId = p.worldId || '';
        // Mirror GameEmbed.jsx resolvedW/resolvedH: if height/width is falsy use world's native viewport size
        const _gameWorld = worldId ? screens.find(s => s.id === worldId && s.kind === 'world') : null;
        const _canonLevel = _gameWorld?.levels?.find(l => l.levelType === 'game' || l.levelType === 'game+hud') || _gameWorld?.levels?.[0];
        // Use desktop (tile-based) dims for the static HTML container.
        // EmbedRuntime detects the actual device at runtime and sizes itself correctly.
        const nativeW = _canonLevel ? ((_canonLevel.viewportCols || 20) * (_canonLevel.tileMap?.tileWidth  || 32)) : 640;
        const nativeH = _canonLevel ? ((_canonLevel.viewportRows || 14) * (_canonLevel.tileMap?.tileHeight || 32)) : 360;
        // hug mode mirrors GameEmbed.jsx: 'auto' → nativeW/nativeH (ignore stored p.width/p.height)
        const embedW = isWidthFill  ? '100%' : (isWidthHug  ? `${nativeW}px` : (p.width  ? `${p.width}px`  : `${nativeW}px`));
        const embedH = isHeightFill ? '100%' : (isHeightHug ? `${nativeH}px` : (p.height ? `${p.height}px` : `${nativeH}px`));
        const containerId = `_tfy_embed_${worldId.replace(/[^a-z0-9]/gi, '_')}`;
        const showWindow = p.showWindow !== false;
        const showControls = p.showControls !== false;
        const titleText = escapeHtml(p.windowTitle || p.worldName || 'GAME');

        // Controls bar — matches ControlsCard in GameEmbed.jsx; only rendered when showControls is on
        const keyStyle = 'display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;border:1px solid rgba(255,255,255,0.25);border-radius:2px;font-size:9px;font-family:monospace;color:rgba(255,255,255,0.6);background:rgba(255,255,255,0.06);';
        const k = (label) => `<span style="${keyStyle}">${escapeHtml(label)}</span>`;
        const controlsHtml = showControls
          ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:5px 8px;border:1px solid rgba(255,255,255,0.1);border-top:none;background:rgba(0,0,0,0.7);font-family:monospace;font-size:9px;color:rgba(255,255,255,0.35);user-select:none;flex-shrink:0;">` +
            `<span style="display:flex;align-items:center;gap:2px;">${k('←')}${k('↑')}${k('↓')}${k('→')}<span style="margin-left:2px;opacity:0.5">/ WASD</span></span>` +
            `<span style="color:rgba(255,255,255,0.15)">·</span>` +
            `<span style="display:flex;align-items:center;gap:3px;">${k('SPC')}<span style="opacity:0.5">jump</span></span>` +
            `<span style="display:flex;align-items:center;gap:3px;">${k('Z')}<span style="opacity:0.5">attack</span></span>` +
            `<span style="display:flex;align-items:center;gap:3px;">${k('E')}<span style="opacity:0.5">interact</span></span>` +
            `<span style="display:flex;align-items:center;gap:3px;">${k('⇧')}<span style="opacity:0.5">dash</span></span>` +
            `</div>`
          : '';

        // Game canvas container — React EmbedRuntime mounts here and drives its own height
        // via an internal aspect-ratio placeholder. No aspect-ratio or min-height baked in so
        // EmbedRuntime can pick the right dimensions for the actual device (desktop vs mobile).
        const outerId = `_tfy_gout_${worldId.replace(/[^a-z0-9]/gi, '_')}`;
        const gameDiv = `<div id="${containerId}" class="_tfy-embed-inner" style="width:100%;overflow:hidden;flex-shrink:0;"></div>`;

        // Outer column wrapper keeps game + controls stacked vertically,
        // exactly mirroring the inline-flex column layout of GameEmbed.jsx
        const outerStyle = `display:${isWidthFill ? 'flex' : 'inline-flex'};flex-direction:column;width:${embedW};max-width:100%;`;

        // Maximize button — uses Fullscreen API on the outer container
        const expandSvg = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><polyline points="1,4 1,1 4,1"/><polyline points="5,8 8,8 8,5"/><line x1="1" y1="1" x2="4.5" y2="4.5"/><line x1="8" y1="8" x2="4.5" y2="4.5"/></svg>`;
        const compressSvg = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><polyline points="4,1 4,4 1,4"/><polyline points="5,8 5,5 8,5"/><line x1="4" y1="4" x2="1" y2="1"/><line x1="5" y1="5" x2="8" y2="8"/></svg>`;
        const maxBtnStyle = `display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid rgba(255,255,255,0.2);border-radius:2px;color:rgba(255,255,255,0.55);background:rgba(255,255,255,0.04);cursor:pointer;user-select:none;flex-shrink:0;`;
        const maxBtnOnClick = `(function(b){var o=document.getElementById('${outerId}');if(!document.fullscreenElement){(o.requestFullscreen||o.webkitRequestFullscreen).call(o);}else{(document.exitFullscreen||document.webkitExitFullscreen).call(document);}})()`;
        const maxBtnHtml = `<span style="${maxBtnStyle}" onclick="${maxBtnOnClick}" title="Pantalla completa"><span class="tfy-fs-expand">${expandSvg}</span><span class="tfy-fs-compress">${compressSvg}</span></span>`;
        const decorIcon = `<span style="font-size:9px;font-family:monospace;opacity:0.6">▦</span>`;
        const titlebarRight = `<div style="display:flex;align-items:center;gap:5px;">${maxBtnHtml}${decorIcon}</div>`;

        if (showWindow) {
          return wrapComponent(
            `<div id="${outerId}" data-tfy-game-outer style="${outerStyle}">` +
            `<div class="retro-window" style="width:100%;display:flex;flex-direction:column;overflow:hidden;">` +
            `<div class="retro-window-titlebar"><span class="retro-window-title">${titleText}</span>${titlebarRight}</div>` +
            gameDiv +
            `</div>` +
            controlsHtml +
            `</div>`
          );
        }
        return wrapComponent(
          `<div style="${outerStyle}">` +
          gameDiv +
          controlsHtml +
          `</div>`
        );
      }
      case 'Data':
        return wrapComponent(`<div class="retro-data" style="font-size:11px;color:var(--text-dim);padding:4px 8px;border:1px dashed var(--border);">[DATA] Table: ${escapeHtml(p.tableName || 'none')} | Source: ${escapeHtml(p.dataSource || 'sqlite')}${p.query ? `<div style="font-size:9px;margin-top:2px;">${p.dataSource === 'sqlite' ? 'Query' : p.dataSource === 'json' ? 'JSON Path' : 'API URL'}: ${escapeHtml(p.query)}</div>` : ''}</div>`);
      case 'Table': {
        const cols = p.columns || [];
        const trows = p.rows || [];
        const thRow = p.showHeaders !== false ? `<tr>${cols.map(c => `<th style="border:1px solid ${getThemeColor(p.borderColor, '--border')};padding:4px 8px;font-size:11px;background:${p.headerBgColor || 'var(--selected)'};color:${getThemeColor(p.textColor, '--accent')};">${escapeHtml(c.name)}</th>`).join('')}</tr>` : '';
        const tbRows = trows.map((r, ri) => `<tr style="background:${p.stripedRows && ri % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent'}">${cols.map(c => `<td style="border:1px solid ${getThemeColor(p.borderColor, '--border')};padding:4px 8px;font-size:11px;color:${getThemeColor(p.textColor, '--text')};">${escapeHtml(String(r[c.name] ?? '')) || '&nbsp;'}</td>`).join('')}</tr>`).join('');
        return wrapComponent(`<div style="${styleObjToString({ width: isWidthFill ? '100%' : (p.width ? `${p.width}px` : '100%'), maxHeight: isHeightFill ? '100%' : (p.height ? `${p.height}px` : 'auto'), height: isHeightFill ? '100%' : 'auto', overflow: 'auto' })}"><table style="width:100%;border-collapse:collapse;">${thRow ? `<thead>${thRow}</thead>` : ''}<tbody>${tbRows}</tbody></table></div>`);
      }
      default:
        return wrapComponent(`<div style="${styleObjToString({ color: THEMES[theme].text, background: 'transparent', padding: '6px' })}">[${escapeHtml(comp.type)}]</div>`);
    }
  };

  const downloadFile = (filename, content, type) => {
    console.log('--- downloadFile starting ---');
    try {
      let blob;
      if (content instanceof Blob) {
        blob = content;
      } else if (typeof content === 'string' && content.startsWith('data:')) {
        // Direct data URI support
        const a = document.createElement('a');
        a.href = content;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      } else {
        // Convert raw string to Blob
        blob = new Blob([content], { type });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 10000);
    } catch (err) {
      console.error('Error in downloadFile:', err);
    }
  };

  // Recursively collect all GameEmbed worldIds from a component tree.
  const collectGameEmbeds = (comps) => {
    const found = [];
    (comps || []).forEach(c => {
      if (c.type === 'GameEmbed' && c.props?.worldId) {
        found.push({
          worldId: c.props.worldId,
          scaling: c.props.scaling || 'fit',
          maintainAspect: c.props.maintainAspect !== false,
        });
      }
      if (c.children?.length) found.push(...collectGameEmbeds(c.children));
    });
    return found;
  };

  const buildGameHtml = () => {
    const worlds = screens.filter(s => s.kind === 'world');
    const normalizeExportLevel = (level) => {
      const hasTiles = (level.tileMap?.layers || []).some(layer => (layer.data || []).some(v => v));
      const hasGameContent = !!((level.entities || []).length || (level.backgrounds || []).length || hasTiles);
      const tm = level.tileMap || {};
      return {
        ...level,
        levelType: level.levelType === 'hud-only' && !(level.rows || []).length && hasGameContent ? 'game' : (level.levelType || 'game'),
        viewportCols: level.viewportCols || tm.cols || 22,
        viewportRows: level.viewportRows || tm.rows || 16,
      };
    };
    const playableWorlds = worlds
      .filter(w => (w.levels || []).length > 0)
      .map(w => ({ ...w, levels: (w.levels || []).map(normalizeExportLevel) }));
    if (!playableWorlds.length) {
      throw new Error('No game worlds with levels to export.');
    }
    const pageTitle = escapeHtml(currentProject.name || playableWorlds[0]?.name || 'TUIFY Game');
    const worldsJson = safeJson(playableWorlds);
    const assetsJson = safeJson(assets);
    const runtimeSrc = `${window.location.origin}/runtime/tuify-game.js`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; background: #0a0a0a; overflow: hidden; }
#game-root { width: 100%; height: 100%; }
.tuify-badge {
  position: fixed; bottom: 20px; right: 20px; z-index: 99999;
  padding: 8px 14px; background: rgba(0,0,0,0.82); border: 1px solid #33ff33;
  color: #33ff33; text-decoration: none; font-family: monospace; font-size: 12px;
}
</style>
</head>
<body>
  <div id="game-root"></div>
  <script>
    window.__TUIFY_WORLDS__ = ${worldsJson};
    window.__TUIFY_ASSETS__ = ${assetsJson};
  </script>
  <script src="${runtimeSrc}"></script>
  <a href="https://tuify.app" target="_blank" rel="noopener noreferrer" class="tuify-badge">TUIFY.app</a>
</body>
</html>`;
  };

  // Returns the full HTML string for the current page screens.
  // Called by exportHTML (download) and handlePublish (server publish).
  const buildPageHtml = () => {
      const t = THEMES[theme];

    // Collect CSS rules in separate arrays so @media can override layout rules
    const desktopLayoutRules = [];
    const allMobileRules = [];

    const pageScreens = screens.filter(s => s.kind !== 'world');
    const screensHtml = pageScreens.map((screen, sIdx) => {
      const rows = screen.rows || [];
      // Single game-embed screen: fills full viewport, no padding, no margins
      const isSingleComponent = rows.length === 1 && rows[0].children?.length === 1;

      // Resolve screen-level autolayout — mobile is fully independent from desktop
      const desktopScreenLayout = { ...DEFAULT_SCREEN_LAYOUT, ...(screen.layout || {}) };
      const mobileScreenOverride = desktopScreenLayout.mobile;
      const hasMobileScreenOverride = mobileScreenOverride && typeof mobileScreenOverride === 'object' && Object.keys(mobileScreenOverride).length > 0;
      const screenLayout = viewMode === 'mobile'
        ? { ...DEFAULT_MOBILE_SCREEN_LAYOUT, ...(mobileScreenOverride || {}) }
        : desktopScreenLayout;

      const rowsHtml = rows.map(row => {
        const desktopLayout = row.layout || {};
        const mobileOverride = desktopLayout.mobile;
        const hasMobileOverride = mobileOverride && typeof mobileOverride === 'object' && Object.keys(mobileOverride).length > 0;

        // In mobile export: mobile is independent from desktop — start from mobile defaults
        const effectiveLayout = viewMode === 'mobile'
          ? { ...DEFAULT_MOBILE_ROW_LAYOUT, ...(mobileOverride || {}) }
          : desktopLayout;

        const rowSizing = row.props?.sizing || {};
        // Sizing stays inline — only layout (flex properties) goes to the style block
        const rowSizingStyle = {
          width: rowSizing.widthMode === 'hug' ? 'fit-content' : '100%',
          ...(rowSizing.heightMode === 'fill'
            ? { flex: '1 1 0', minHeight: '0' }
            : { minHeight: '32px' }),
          height: rowSizing.heightMode === 'hug' ? 'auto' : undefined,
        };

        // Layout CSS goes to the <style> block so @media rules can override it
        desktopLayoutRules.push(`#row-${row.id}{${styleObjToString(rowLayoutToStyles(effectiveLayout))}}`);

        // Desktop export: always emit a @media override for rows (mobile is independent from desktop)
        if (viewMode === 'desktop') {
          const mobileResolved = { ...DEFAULT_MOBILE_ROW_LAYOUT, ...(mobileOverride || {}) };
          allMobileRules.push(`#row-${row.id}{${styleObjToString(rowLayoutToStyles(mobileResolved))}}`);
        }

        return `<div id="row-${row.id}" class="layout-row" style="${styleObjToString(rowSizingStyle)}">${(row.children || []).map(c => renderComponentExport(c, effectiveLayout.direction || 'row')).join('')}</div>`;
      }).join('');

      // Single-component (game embed): override screen layout to fill viewport with no padding
      const effectiveScreenLayout = isSingleComponent
        ? { direction: 'column', gap: 0, align: 'center', justify: 'center', wrap: false, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }
        : screenLayout;

      // Screen layout CSS goes to the <style> block so @media rules can override it
      desktopLayoutRules.push(`#screen-preview-${screen.id}{${styleObjToString(screenLayoutToStyles(effectiveScreenLayout))}}`);

      // Desktop export: emit a @media override for screens with mobile layout overrides
      if (viewMode === 'desktop' && !isSingleComponent) {
        const mobileResolved = { ...DEFAULT_MOBILE_SCREEN_LAYOUT, ...(mobileScreenOverride || {}) };
        allMobileRules.push(`#screen-preview-${screen.id}{${styleObjToString(screenLayoutToStyles(mobileResolved))}}`);
      }

      return `
        <div id="${screen.id}" class="screen-container${isSingleComponent ? ' full-viewport' : ''}" style="display: ${sIdx === 0 ? 'block' : 'none'};"
             data-timeout="${screen.settings?.timeout || 0}"
             data-next="${screen.settings?.nextScreenId || ''}">
          <div class="canvas ${viewMode === 'mobile' ? 'mobile' : ''}${isSingleComponent ? ' full-viewport' : ''}">
            <div id="screen-preview-${screen.id}" class="preview-area${isSingleComponent ? ' full-viewport' : ''}">
              ${rowsHtml}
            </div>
          </div>
        </div>`;
    }).join('');

    const dotColor = (t.accent || '#00aa00').replace('#', '%23');
    const baseCss = typeof appCss === 'string' ? appCss : '';
    const layoutCss = desktopLayoutRules.join('');
    const responsiveCss = allMobileRules.length > 0
      ? `@media(max-width:768px){${allMobileRules.join('')}}`
      : '';
    const css = `${baseCss}${layoutCss}${responsiveCss}
html, body { height: 100%; overflow: hidden; }
body {
  background: ${t.bg};
  color: ${t.text};
  margin: 0;
  padding: 0;
  background-image: url("data:image/svg+xml,%3Csvg width='8' height='8' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='0' y='0' width='2' height='2' fill='${dotColor}' opacity='0.08'/%3E%3Crect x='4' y='4' width='2' height='2' fill='${dotColor}' opacity='0.08'/%3E%3C/svg%3E");
  background-size: 8px 8px;
  background-repeat: repeat;
}
/* screen-container fills the viewport and scrolls — mirrors .canvas { overflow: auto } in the builder */
.screen-container {
  width: 100%;
  height: 100%;
  overflow: auto;
}
/* single-component screens (game embeds, single windows) never scroll — content is centered */
.screen-container.full-viewport { overflow: hidden; }
.screen-container.staggered { background: transparent !important; }
.canvas {
  width: 100%;
  margin: 0;
  overflow: visible !important;
  display: flex;
  flex-direction: column;
  background: transparent !important;
  border: none !important;
}
.canvas.full-viewport { height: 100vh !important; }
.canvas.mobile {
  max-width: 420px;
  margin: 0 auto;
  background: transparent !important;
  border: none !important;
}
.preview-area {
  min-width: 0;
  width: 100%;
  height: auto;
  min-height: 100vh;
  overflow: visible !important;
  background: transparent !important;
  box-sizing: border-box;
  padding: 0;
}
.preview-area.full-viewport { height: 100vh !important; min-height: 0 !important; padding: 0 !important; }
.retro-window-content {
  flex: 1 1 auto !important;
  min-height: 40px !important;
}
.layout-row, .retro-row, .export-wrapper {
  background-color: transparent;
  border: none !important;
}
.retro-window, .retro-frame {
  background: ${t.bg} !important;
}
.retro-window-titlebar {
  background: ${t.selected || 'rgba(0,170,0,0.1)'};
  border-bottom: 1px solid ${t.border};
  padding: 4px 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.retro-window-title {
  color: ${t.accent};
  font-size: 12px;
  font-weight: bold;
  font-family: monospace;
}
.retro-window-close {
  background: transparent;
  border: 1px solid ${t.border};
  color: ${t.textDim || t.text};
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.property-group label {
  display: block;
  font-size: 11px;
  color: ${t.accent};
  margin-bottom: 4px;
  font-weight: bold;
  text-transform: uppercase;
}
.retro-textbox {
  background: ${t.inputBg || 'rgba(0,0,0,0.3)'};
  border: 1px solid ${t.border};
  color: ${t.text};
  padding: 4px 8px;
  font-family: monospace;
  font-size: 12px;
}
.layout-row, .export-wrapper, .retro-window, .retro-window-content, .retro-frame, .retro-frame-content, .retro-row { min-width: 0; }
.export-wrapper > * { max-width: 100%; }
.export-wrapper { padding: 0 !important; border: none !important; outline: none !important; }
.drop-zone, .new-row-drop, .drop-indicator { display: none !important; }
/* ── Game embed fullscreen ── */
.tfy-fs-compress { display: none; }
[data-tfy-game-outer]:fullscreen,
[data-tfy-game-outer]:-webkit-full-screen {
  width: 100% !important; height: 100% !important;
  display: flex !important; flex-direction: column !important;
}
[data-tfy-game-outer]:fullscreen .retro-window,
[data-tfy-game-outer]:-webkit-full-screen .retro-window { flex: 1; min-height: 0; }
[data-tfy-game-outer]:fullscreen ._tfy-embed-inner,
[data-tfy-game-outer]:-webkit-full-screen ._tfy-embed-inner {
  flex: 1 !important; min-height: 0 !important;
}
[data-tfy-game-outer]:fullscreen .tfy-fs-expand,
[data-tfy-game-outer]:-webkit-full-screen .tfy-fs-expand { display: none; }
[data-tfy-game-outer]:fullscreen .tfy-fs-compress,
[data-tfy-game-outer]:-webkit-full-screen .tfy-fs-compress { display: inline; }
/* ── TUIFY badge ── */
.tuify-badge {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
  padding: 8px 14px;
  background: rgba(0,0,0,0.82);
  border: 1px solid ${t.accent};
  color: ${t.text};
  text-decoration: none;
  font-family: monospace;
  z-index: 99999;
  cursor: pointer;
  transition: background 0.22s, box-shadow 0.22s, transform 0.22s, padding 0.22s;
  box-shadow: 0 0 8px ${t.accent}33;
  overflow: hidden;
}
.tuify-badge::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid ${t.accent};
  opacity: 0;
  transition: opacity 0.22s;
  transform: translate(3px, 3px);
  pointer-events: none;
}
.tuify-badge:hover {
  background: ${t.accent};
  box-shadow: 0 0 22px ${t.accent}99, 0 0 50px ${t.accent}44;
  transform: translateY(-3px);
  padding: 12px 18px;
}
.tuify-badge:hover::before { opacity: 1; }
.tuify-badge-label {
  font-size: 8px;
  color: ${t.textDim || t.text};
  letter-spacing: 1.2px;
  text-transform: uppercase;
  line-height: 1.5;
  white-space: nowrap;
  max-height: 0;
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  margin-bottom: 0;
  transition: max-height 0.22s ease, max-width 0.22s ease, opacity 0.18s ease, margin-bottom 0.22s, color 0.18s;
}
.tuify-lbl-1, .tuify-lbl-2, .tuify-lbl-3, .tuify-lbl-4 {
  animation: tuify-label-bold 4s linear infinite;
}
.tuify-lbl-1 { animation-delay: 0s; }
.tuify-lbl-2 { animation-delay: -3s; }
.tuify-lbl-3 { animation-delay: -2s; }
.tuify-lbl-4 { animation-delay: -1s; }
@keyframes tuify-label-bold {
  0%, 24.9% { font-weight: bold; }
  25%, 100% { font-weight: normal; }
}
.tuify-badge:hover .tuify-badge-label {
  max-height: 24px;
  max-width: 500px;
  opacity: 1;
  margin-bottom: 6px;
  color: ${t.bg};
}
.tuify-badge-brand {
  font-size: 15px;
  font-weight: bold;
  color: ${t.accent};
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.18s;
}
.tuify-word { display: flex; align-items: center; }
.tuify-l {
  max-width: 0;
  overflow: hidden;
  display: inline-block;
  animation: tuify-appear 0.01s step-end forwards;
}
.tuify-l1 { animation-delay: 0.5s; }
.tuify-l2 { animation-delay: 0.68s; }
.tuify-l3 { animation-delay: 0.86s; }
.tuify-l4 { animation-delay: 1.04s; }
.tuify-l5 { animation-delay: 1.22s; }
@keyframes tuify-appear { to { max-width: 20px; margin-right: 2px; } }
.tuify-domain {
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  display: inline-block;
  transition: max-width 0.22s ease;
}
.tuify-badge:hover .tuify-domain { max-width: 60px; }
.tuify-badge-cursor {
  display: inline-block;
  width: 9px;
  height: 15px;
  background: ${t.accent};
  animation: tuify-blink 1s step-end infinite;
  transition: background 0.18s;
  flex-shrink: 0;
}
@keyframes tuify-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.tuify-badge:hover .tuify-badge-brand { color: ${t.bg}; }
.tuify-badge:hover .tuify-badge-cursor { background: ${t.bg}; }
@keyframes tfy-caret-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
@keyframes gb-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
.retro-button:focus-visible, .retro-button.tfy-kb-focus {
  outline: 2px solid ${t.accent};
  outline-offset: 2px;
}
.retro-select, .retro-listbox {
  -webkit-appearance: none !important;
  appearance: none !important;
  background-color: ${t.bg} !important;
  background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjUiIHZpZXdCb3g9IjAgMCA4IDUiPjxwYXRoIGZpbGw9IiM4ODg4ODgiIGQ9Ik0wIDBsNCA1IDQtNXoiLz48L3N2Zz4=") !important;
  background-repeat: no-repeat !important;
  background-position: right 7px center !important;
  background-size: 8px 5px !important;
  border: 1px solid ${t.border} !important;
  color: ${t.text} !important;
  padding: 3px 22px 3px 6px !important;
  font-family: monospace !important;
  font-size: 11px !important;
  cursor: pointer !important;
  box-sizing: border-box !important;
}
`;

    // Get webTitle from screen 1 settings, fallback to project name
    const screen1 = screens.find(s => s.id === 'screen-1') || screens[0];
    const webTitle = screen1?.settings?.webTitle || currentProject.name || 'Prototype';
    const metaTags = screen1?.settings?.metaTags || '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(webTitle)}</title>
${metaTags}
<style>
${css}
</style>
</head>
<body class="${theme}">
  ${screensHtml}

  <script>
    let timer = null;

    function toggleOverlay(id, state) {
      const ov = document.getElementById(id);
      if (!ov) return;
      if (state === undefined) {
        ov.style.display = ov.style.display === 'none' ? 'flex' : 'none';
      } else {
        ov.style.display = state ? 'flex' : 'none';
      }
    }

    function switchTab(containerId, index) {
      const container = document.getElementById(containerId);
      if (!container) return;
      
      // Update headers
      container.querySelectorAll('.retro-tab').forEach((h, i) => {
        const isActive = i === index;
        h.style.background = isActive ? 'var(--bg)' : 'rgba(0,0,0,0.2)';
        h.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
        h.style.borderBottom = isActive ? '1px solid var(--bg)' : '1px solid var(--border)';
        h.style.fontWeight = isActive ? 'bold' : 'normal';
      });
      
      // Update contents
      container.querySelectorAll('.retro-tab-content').forEach((c, i) => {
        c.style.display = i === index ? 'block' : 'none';
      });
    }

    function closeScreen(btn) {
      const screen = btn.closest('.screen-container');
      if (screen) {
        screen.style.display = 'none';
        screen.style.position = '';
        screen.style.zIndex = '';
      }
    }

    function goToScreen(screenId, staggered) {
      if (timer) clearTimeout(timer);
      
      if (staggered) {
        // Staggered mode: overlay the new screen on top
        const target = document.getElementById(screenId);
        if (target) {
          target.style.display = 'block';
          target.style.position = 'fixed';
          target.style.top = Math.floor(Math.random() * 60 + 20) + 'px';
          target.style.left = Math.floor(Math.random() * 60 + 20) + 'px';
          target.style.width = 'auto';
          target.style.height = 'auto';
          target.style.maxWidth = '80vw';
          target.style.maxHeight = '80vh';
          target.style.overflow = 'auto';
          target.style.zIndex = '1000';
          target.style.boxShadow = '8px 8px 0px rgba(0,0,0,0.5)';
          target.style.border = 'none';
          target.style.background = 'transparent';
          target.classList.add('staggered');
          
          // Remove padding from preview area to keep shadow tight
          const preview = target.querySelector('.preview-area');
          if (preview) preview.style.padding = '0';
        }
      } else {
        // Normal mode: hide all, show target
        document.querySelectorAll('.screen-container').forEach(s => {
          s.style.display = 'none';
          s.style.position = '';
          s.style.zIndex = '';
        });
        
        const target = document.getElementById(screenId);
        if (target) {
          target.style.display = 'block';
          window.scrollTo(0, 0);
        }
      }
      
      // Handle auto-jump timer
      const target = document.getElementById(screenId);
      if (target) {
        const timeout = parseFloat(target.getAttribute('data-timeout') || '0');
        const nextId = target.getAttribute('data-next');
        if (timeout > 0 && nextId) {
          timer = setTimeout(() => {
            goToScreen(nextId);
          }, timeout * 1000);
        }
      }
    }

    // Initialize first screen timer
    window.onload = () => {
      const firstScreen = document.querySelector('.screen-container');
      if (firstScreen) {
        const timeout = parseFloat(firstScreen.getAttribute('data-timeout') || '0');
        const nextId = firstScreen.getAttribute('data-next');
        if (timeout > 0 && nextId) {
          timer = setTimeout(() => {
            goToScreen(nextId);
          }, timeout * 1000);
        }
      }
    };

    // ── TUI keyboard navigation ───────────────────────────────────────────────
    (function () {
      function visibleButtons() {
        const screen = Array.from(document.querySelectorAll('.screen-container'))
          .find(s => s.style.display !== 'none');
        if (!screen) return [];
        return Array.from(screen.querySelectorAll('.retro-button:not([disabled])'));
      }

      function moveFocus(delta) {
        const btns = visibleButtons();
        if (!btns.length) return;
        const cur = btns.indexOf(document.activeElement);
        const next = cur < 0
          ? (delta > 0 ? 0 : btns.length - 1)
          : (cur + delta + btns.length) % btns.length;
        btns[next].focus();
        btns[next].scrollIntoView({ block: 'nearest' });
      }

      document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); moveFocus(1); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); }
      });
    })();
  </script>
${(() => {
  // Detect GameEmbed components and inject runtime for each unique world
  const allEmbeds = pageScreens.flatMap(s =>
    (s.rows || []).flatMap(r => collectGameEmbeds(r.children || []))
  );
  const seen = new Set();
  const unique = allEmbeds.filter(e => { if (seen.has(e.worldId)) return false; seen.add(e.worldId); return true; });
  if (!unique.length) return '';
  const safeJsonEmbed = (obj) => JSON.stringify(obj).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
  const embedData = unique.map(({ worldId, scaling, maintainAspect }) => {
    const world = screens.find(s => s.id === worldId && s.kind === 'world');
    if (!world) return null;
    const containerId = `_tfy_embed_${worldId.replace(/[^a-z0-9]/gi, '_')}`;
    return `{ containerId: '${containerId}', scaling: '${scaling}', maintainAspect: ${maintainAspect}, world: ${safeJsonEmbed(world)}, assets: ${safeJsonEmbed(assets)} }`;
  }).filter(Boolean).join(',\n  ');
  return `  <script>window.__TUIFY_EMBEDS__=[${embedData}];</script>\n  <script src="/runtime/tuify-game.js"></script>`;
})()}

  <a href="https://tuify.app" target="_blank" rel="noopener noreferrer" class="tuify-badge">
    <span class="tuify-badge-label"><span class="tuify-lbl-1">Design</span> &middot; <span class="tuify-lbl-2">Build</span> &middot; <span class="tuify-lbl-3">Deploy</span> &middot; <span class="tuify-lbl-4">Scale with</span></span>
    <span class="tuify-badge-brand"><span class="tuify-word"><span class="tuify-l tuify-l1">T</span><span class="tuify-l tuify-l2">U</span><span class="tuify-l tuify-l3">I</span><span class="tuify-l tuify-l4">F</span><span class="tuify-l tuify-l5">Y</span><span class="tuify-domain">.app</span></span><span class="tuify-badge-cursor"></span></span>
  </a>
</body>
</html>`;

    return html;
  };

  const exportHTML = () => {
    try {
      const html = gameMode ? buildGameHtml() : buildPageHtml();
      const baseName = `${currentProject.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '') || 'project'}`;
      downloadFile(`${baseName}.html`, html, 'text/html');
    } catch (err) {
      console.error('Error in exportHTML:', err);
      alert(err.message || 'Export failed');
    }
  };

  const newProject = () => {
    setNewProjectName('');
    setShowNewProjectModal(true);
  };

  const handleConfirmNewProject = async () => {
    if (!newProjectName.trim()) return;
    const name = newProjectName.trim();
    const id = mkId();
    const initialScreens = [{ id: 'screen-1', name: 'Screen 1', rows: [], settings: { timeout: 0, nextScreenId: null } }];

    // Persist the project to the API BEFORE setting state.
    // The load effect fires when currentProject.id changes and tries to
    // GET the project — if it doesn't exist yet it gets a 404 and resets
    // everything back to the "Untitled" default. Saving first prevents that.
    if (getToken()) {
      try {
        await apiFetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id, name,
            screens: initialScreens,
            currentScreenId: 'screen-1',
            database: { tables: [], data: {} },
            gameMode: false,
            lastSaved: new Date().toISOString(),
          }),
        });
      } catch (err) {
        console.error('[New Project] Failed to persist:', err);
        // Continue anyway — the project will live in memory but may not survive a refresh
      }
    }

    setCurrentProject({ id, name });
    setScreens(initialScreens);
    setCurrentScreenId('screen-1');
    setSelectedIds([]);
    setActiveWindow(null);
    setDatabase({ tables: [], data: {} });
    setGameMode(false);
    setAssetsState({ sprites: [], tilesets: [], sounds: [], backgrounds: [] });
    assetsDirty.current = false;
    setShowProjects(false);
    setShowNewProjectModal(false);
  };

  useEffect(() => {
    window.openDatabasePanel = () => setViewMode('database');
    return () => { delete window.openDatabasePanel; };
  }, []);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  useEffect(() => {
    if (!showThemeMenu) return;
    const handler = (e) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target)) setShowThemeMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showThemeMenu]);

  const loadProject = async (id) => {
    try {
      const res = await apiFetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      isInitialLoading.current = true;
      projectLoaded.current = false;
      // Always use the DB row id (not data.id from the JSON) so the load effect
      // fetches from the correct row. Bumping loadKey forces the effect to re-run
      // even when reloading the same project that's already active.
      setCurrentProject({ id, name: data.name || 'Untitled' });
      setProjectLoadKey(k => k + 1);
      setShowProjects(false);
    } catch (err) {
      console.error('Load error:', err);
    }
  };

  const deleteProject = (id, name) => {
    setConfirmModal({
      title: 'Delete Project',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
          if (currentProject.id === id) {
            isInitialLoading.current = true;
            setCurrentProject({ id: 'default', name: 'Untitled' });
            setScreens([{ id: 'screen-1', name: 'Screen 1', rows: [], settings: { timeout: 0, nextScreenId: null } }]);
            setCurrentScreenId('screen-1');
            setSelectedIds([]);
            setActiveWindow(null);
            setDatabase({ tables: [], data: {} });
            setGameMode(false);
            setAssetsState({ sprites: [], tilesets: [], sounds: [], backgrounds: [] });
            assetsDirty.current = false;
            setTimeout(() => { isInitialLoading.current = false; }, 500);
          }
          fetchProjects();
        } catch (err) {
          console.error('Delete error:', err);
        }
      },
      onCancel: () => setConfirmModal(null),
    });
  };

  const renameProject = async (id, name) => {
    try {
      const res = await apiFetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const updated = { ...data, name };
      await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (currentProject.id === id) setCurrentProject(p => ({ ...p, name }));
      setEditingProjectId(null);
      fetchProjects();
    } catch (err) {
      console.error('Rename error:', err);
    }
  };

  const duplicateProject = async (proj) => {
    try {
      const res = await apiFetch(`/api/projects/${proj.id}`);
      if (!res.ok) return;
      const data = await res.json();
      const assetsRes = await apiFetch(`/api/projects/${proj.id}/assets`);
      const assetsData = assetsRes.ok ? await assetsRes.json() : { sprites: [], tilesets: [], sounds: [], backgrounds: [] };
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const copy = { ...data, id: newId, name: `${data.name} (copy)`, lastSaved: new Date().toISOString() };
      await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(copy),
      });
      await apiFetch(`/api/projects/${newId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assetsData),
      });
      fetchProjects();
    } catch (err) {
      console.error('duplicateProject error:', err);
    }
  };

  const toggleDemo = async (proj) => {
    try {
      await apiFetch(`/api/projects/${proj.id}/demo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDemo: !proj.isDemo }),
      });
      fetchProjects();
    } catch (err) {
      console.error('toggleDemo error:', err);
    }
  };

  const selectedElement = findSelected();
  const isRowSelected = selectedElement && (activeScreen?.rows || []).some(r => selectedIds.includes(r.id));
  // Find the first selected ID that maps to an entity in the active level.
  // Entities live outside the rows tree so findSelected() can't see them.
  const selectedEntity = (activeLevel && selectedIds.length > 0)
    ? (activeLevel.entities || []).find(e => selectedIds.includes(e.id)) || null
    : null;

  return (
    <DndProvider backend={HTML5Backend}>
      {/* Game Mode visual cues — pulsing accent on the toggle, plus
          marching-ant stripes around all four sides of the viewport so
          the user has a constant peripheral reminder they're authoring a
          game project rather than a regular app. */}
      <style>{`
        @keyframes gm-pulse {
          0%, 100% { box-shadow: 0 0 4px var(--accent), inset 0 0 4px var(--accent); }
          50%      { box-shadow: 0 0 14px var(--accent), inset 0 0 8px var(--accent); }
        }
        .toolbar-btn.gm-active {
          background: var(--accent);
          color: var(--bg);
          font-weight: bold;
          letter-spacing: 0.5px;
          animation: gm-pulse 1.8s ease-in-out infinite;
          position: relative;
        }
        .toolbar-btn.gm-active::before {
          content: '◆';
          margin-right: 6px;
          opacity: 0.85;
        }
        /* Marching-ant border around the .main-layout area (toolbox +
           canvas + inspector). Excludes top toolbar and bottom status bar
           by design. The stripe pattern is 24px; animation translates 24px
           so motion is continuously visible. */
        @keyframes gm-stripe-h { from { background-position: 0 0; } to { background-position: 10px 0; } }
        @keyframes gm-stripe-v { from { background-position: 0 0; } to { background-position: 0 10px; } }
        .gm-frame {
          position: absolute;
          z-index: 1000;
          pointer-events: none;
        }
        .gm-frame-top, .gm-frame-bottom {
          left: 0; right: 0; height: 1px;
          background-image: repeating-linear-gradient(
            90deg,
            var(--accent) 0, var(--accent) 6px,
            transparent 6px, transparent 10px
          );
          background-size: 10px 1px;
        }
        .gm-frame-left, .gm-frame-right {
          top: 0; bottom: 0; width: 1px;
          background-image: repeating-linear-gradient(
            0deg,
            var(--accent) 0, var(--accent) 6px,
            transparent 6px, transparent 10px
          );
          background-size: 1px 10px;
        }
        .gm-frame-top    { top: 0;    animation: gm-stripe-h 1.2s linear infinite; }
        .gm-frame-bottom { bottom: 0; animation: gm-stripe-h 1.2s linear infinite reverse; }
        .gm-frame-left   { left: 0;   animation: gm-stripe-v 1.2s linear infinite; }
        .gm-frame-right  { right: 0;  animation: gm-stripe-v 1.2s linear infinite reverse; }
        .app.gm-on .toolbox h3 { color: var(--accent); }
      `}</style>
      <div className={`app ${theme}${gameMode ? ' gm-on' : ''}`}>
        <div className="toolbar" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'relative' }} ref={themeMenuRef}>
            <button className="toolbar-btn" onClick={() => setShowThemeMenu(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'flex', gap: 2 }}>
                {['bg','border','text','accent'].map(k => (
                  <span key={k} style={{ width: 7, height: 7, borderRadius: 1, background: THEMES[theme][k], display: 'inline-block' }} />
                ))}
              </span>
              {THEMES[theme].name} <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
            </button>
            {showThemeMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 9999,
                background: 'var(--bg)', border: '1px solid var(--border)',
                minWidth: 180, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                display: 'flex', flexDirection: 'column',
              }}>
                {Object.entries(THEMES).map(([key, t]) => (
                  <button key={key} onClick={() => { setTheme(key); editsMade.current = true; setShowThemeMenu(false); }}
                    style={{
                      padding: '7px 10px', background: theme === key ? 'var(--selected)' : 'transparent',
                      border: 'none', borderBottom: '1px solid var(--border)',
                      color: 'var(--text)', fontFamily: 'monospace', fontSize: 11,
                      textAlign: 'left', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => { if (key !== theme) e.currentTarget.style.background = 'var(--selected)'; }}
                    onMouseLeave={e => { if (key !== theme) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{
                      display: 'inline-flex', gap: 0, borderRadius: 2, overflow: 'hidden',
                      border: `1px solid ${t.border}`, flexShrink: 0,
                    }}>
                      <span style={{ width: 14, height: 18, background: t.bg, display: 'inline-block' }} />
                      <span style={{ width: 14, height: 18, background: t.border, display: 'inline-block' }} />
                      <span style={{ width: 14, height: 18, background: t.text, display: 'inline-block' }} />
                      <span style={{ width: 14, height: 18, background: t.accent, display: 'inline-block' }} />
                    </span>
                    <span>{t.name}</span>
                    {theme === key && <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="toolbar-sep">|</span>
          <button
            className={`toolbar-btn ${gameMode ? 'gm-active' : ''}`}
            onClick={() => setGameMode(g => !g)}
            title="Toggle Game Builder"
          >
            Game Builder
          </button>
          {gameMode && (
            <button
              className={`toolbar-btn ${showSpriteSheetManager ? 'active' : ''}`}
              onClick={() => setShowSpriteSheetManager(s => !s)}
              title="Assets Manager"
            >
              Assets
            </button>
          )}
          <span className="toolbar-sep">|</span>
          <button className={`toolbar-btn ${viewMode === 'desktop' ? 'active' : ''}`} onClick={() => setViewMode('desktop')}>Desktop</button>
          <button className={`toolbar-btn ${viewMode === 'mobile' ? 'active' : ''}`} onClick={() => setViewMode('mobile')}>Mobile</button>
          <span className="toolbar-sep">|</span>
          <div style={{ position: 'relative' }} ref={exportMenuRef}>
            <button className="toolbar-btn" onClick={() => setShowExportMenu(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              Export <span style={{ fontSize: 8, opacity: 0.7 }}>▼</span>
            </button>
            {showExportMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 9999,
                background: 'var(--bg)', border: '1px solid var(--border)',
                minWidth: 170, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                display: 'flex', flexDirection: 'column',
              }}>
                <button onClick={() => { exportHTML(); setShowExportMenu(false); }}
                  style={{ padding: '8px 12px', background: 'transparent', border: 'none', color: 'var(--text)', fontFamily: 'monospace', fontSize: 11, textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--selected)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Export HTML
                </button>
                <button onClick={() => { handleOpenPublish(); setShowExportMenu(false); }}
                  style={{ padding: '8px 12px', background: 'transparent', border: 'none', color: 'var(--accent)', fontFamily: 'monospace', fontSize: 11, textAlign: 'left', cursor: 'pointer', fontWeight: 'bold' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--selected)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Publish to TUIFY
                </button>
              </div>
            )}
          </div>
          <button className="toolbar-btn" onClick={() => setShowDatabase(!showDatabase)}>Database</button>
          <button className="toolbar-btn" onClick={() => setShowProjects(!showProjects)}>Projects</button>
          <button className="toolbar-btn" onClick={() => selectedIds.length > 0 && duplicateComponent(selectedIds)} disabled={selectedIds.length === 0}>Duplicate</button>
          <button className="toolbar-btn" onClick={() => setShowDocs(true)} title="Documentation" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            Docs
          </button>
          <button className="toolbar-btn" onClick={() => setShowSettings(true)} title="Settings" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: 16,
              height: 16,
              backgroundColor: 'currentColor',
              maskImage: 'url(/img/icons/imgi_17_gear.svg)',
              WebkitMaskImage: 'url(/img/icons/imgi_17_gear.svg)',
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat'
            }} />
          </button>
          {currentUser && (
            <button
              className="toolbar-btn"
              onClick={handleLogout}
              title={`Signed in as ${currentUser.email}`}
              style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}
            >
              Logout
            </button>
          )}
        </div>

        <div className="main-layout" style={{ position: 'relative' }}>
          {gameMode && (
            <>
              <div className="gm-frame gm-frame-top" />
              <div className="gm-frame gm-frame-bottom" />
              <div className="gm-frame gm-frame-left" />
              <div className="gm-frame gm-frame-right" />
            </>
          )}
          <Toolbox gameMode={gameMode} assets={assets} tutorialConfig={tutorialConfig} tutorialActive={tutorialActive} />
          <div ref={canvasContainerRef} className="canvas-container" style={{ position: 'relative', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
            {gameMode && activeScreen?.kind === 'world' && (
              <LevelTabs
                world={activeScreen}
                onSelectLevel={selectLevel}
                onAddLevel={addLevel}
                onMoveLevel={moveLevel}
                onDeleteLevel={deleteLevel}
                onDuplicateLevel={duplicateLevel}
                layer={levelLayer}
                onLayerChange={(k) => {
                  setLevelLayer(k);
                  setIsPlaying(false);
                  if (activeScreen?.id && activeLevel?.id) {
                    updateLevel(activeScreen.id, activeLevel.id, { editorLayer: k });
                  }
                }}
                canPlay={!!activeLevel}
                isPlaying={isPlaying}
                onTogglePlay={() => { setPaintBrush(null); setIsPlaying(p => !p); }}
                onUpdateLevelType={(levelId, lt) => activeScreen?.id && updateLevel(activeScreen.id, levelId, { levelType: lt })}
                showingWorldSettings={showWorldSettings}
                onShowWorldSettings={setShowWorldSettings}
              />
            )}
            {!activeScreen && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: 24, zIndex: 5,
                background: 'var(--bg)',
              }}>
                <div>
                  [ No {gameMode ? 'world' : 'screen'} selected ]<br />
                  <span style={{ opacity: 0.6, fontSize: 10 }}>
                    Open the {gameMode ? 'Worlds' : 'Journey'} panel and add {gameMode ? 'a World' : 'a Screen'} to start.
                  </span>
                </div>
              </div>
            )}
            {activeLevel && isPlaying ? (
              <RuntimeView
                world={activeScreen}
                assets={assets}
                onStop={() => setIsPlaying(false)}
                viewMode={viewMode}
                activeLevelId={activeLevel?.id}
              />
            ) : activeLevel && activeLevel.levelType === 'game+hud' && !isPlaying ? (
              /* WYSIWYG: both game and HUD layers visible simultaneously.
                 Active layer is fully interactive; inactive layer is ghosted (opacity 0.3) with events blocked. */
              <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <LevelCanvas
                  level={activeLevel}
                  worldId={activeScreen.id}
                  worldSettings={activeScreen.worldSettings}
                  assets={assets}
                  selectedIds={selectedIds}
                  onSelectEntity={(id, shift) => { selectRow(id, shift); setPaintBrush(null); }}
                  onDeselect={() => setSelectedIds([])}
                  onAddEntity={(type, position) => addEntity(activeScreen.id, activeLevel.id, type, position)}
                  onMoveEntity={(id, position) => updateEntity(activeScreen.id, activeLevel.id, id, { position })}
                  onDeleteEntities={(ids) => deleteEntities(activeScreen.id, activeLevel.id, ids)}
                  paintBrush={paintBrush}
                  onUpdateLevel={(patch) => updateLevel(activeScreen.id, activeLevel.id, patch)}
                  selectedColliderShapeId={selectedColliderShapeId}
                  onSelectColliderShape={setSelectedColliderShapeId}
                  selectedOcclusionShapeId={selectedOcclusionShapeId}
                  onSelectOcclusionShape={setSelectedOcclusionShapeId}
                  readOnly={levelLayer !== 'game'}
                  ghostOpacity={levelLayer !== 'game' ? 0.3 : 1}
                />
                <div
                  style={{
                    position: 'absolute', inset: 0, overflow: 'auto',
                    opacity: levelLayer === 'hud' ? 1 : 0.3,
                  }}
                  onPointerDownCapture={levelLayer !== 'hud' ? (e) => e.stopPropagation() : undefined}
                  onClickCapture={levelLayer !== 'hud' ? (e) => e.stopPropagation() : undefined}
                >
                  <GameContext.Provider value={{ screens, assets }}>
                  <Canvas
                    rows={rows}
                    selectedIds={selectedIds}
                    onSelect={(id, multi) => selectRow(id, multi)}
                    onDelete={deleteComponent}
                    onDuplicate={duplicateComponent}
                    viewMode={viewMode}
                    onAddToRow={addToRow}
                    onAddNewRow={addNewRow}
                    onMoveComponent={moveComponent}
                    onSelectRow={selectRow}
                    activeWindow={activeWindow}
                    screenLayout={{ ...DEFAULT_SCREEN_LAYOUT, ...(activeScreen?.layout || {}) }}
                    database={database}
                    onNavigate={handleNavigate}
                    onUpdateComponent={updateComponent}
                    editingTextId={editingTextId}
                    onStartTextEdit={id => { setEditingTextId(id); }}
                    onCommitTextEdit={(id, text) => {
                      if (text !== null) updateComponent(id, { text });
                      setEditingTextId(null);
                    }}
                    onSaveRecord={(tableName, record) => {
                      setDatabase(prev => ({
                        ...prev,
                        data: {
                          ...prev.data,
                          [tableName]: [...(prev.data[tableName] || []), { ...record, id: Date.now() }]
                        }
                      }));
                    }}
                    onLogin={(tableName, credentials) => {
                      const table = database.data[tableName] || [];
                      const user = table.find(u =>
                        String(u.email || u.username) === String(credentials.email || credentials.username) &&
                        String(u.password) === String(credentials.password)
                      );
                      if (user) {
                        setCurrentUser(user);
                        alert(`Welcome back, ${user.name || user.email}!`);
                        return true;
                      } else {
                        alert('Invalid credentials.');
                        return false;
                      }
                    }}
                    currentUser={currentUser}
                  />
                  </GameContext.Provider>
                </div>
              </div>
            ) : activeLevel && levelLayer === 'game' ? (
              <LevelCanvas
                level={activeLevel}
                worldId={activeScreen.id}
                worldSettings={activeScreen.worldSettings}
                assets={assets}
                selectedIds={selectedIds}
                onSelectEntity={(id, shift) => { selectRow(id, shift); setPaintBrush(null); }}
                onDeselect={() => setSelectedIds([])}
                onAddEntity={(type, position) => addEntity(activeScreen.id, activeLevel.id, type, position)}
                onMoveEntity={(id, position) => updateEntity(activeScreen.id, activeLevel.id, id, { position })}
                onDeleteEntities={(ids) => deleteEntities(activeScreen.id, activeLevel.id, ids)}
                paintBrush={paintBrush}
                onUpdateLevel={(patch) => updateLevel(activeScreen.id, activeLevel.id, patch)}
                selectedColliderShapeId={selectedColliderShapeId}
                onSelectColliderShape={setSelectedColliderShapeId}
                selectedOcclusionShapeId={selectedOcclusionShapeId}
                onSelectOcclusionShape={setSelectedOcclusionShapeId}
              />
            ) : (
            <GameContext.Provider value={{ screens, assets }}>
            <Canvas
              rows={rows}
              selectedIds={selectedIds}
              onSelect={(id, multi) => selectRow(id, multi)}
              onDelete={deleteComponent}
              onDuplicate={duplicateComponent}
              viewMode={viewMode}
              onAddToRow={addToRow}
              onAddNewRow={addNewRow}
              onMoveComponent={moveComponent}
              onSelectRow={selectRow}
              activeWindow={activeWindow}
              screenLayout={{ ...DEFAULT_SCREEN_LAYOUT, ...(activeScreen?.layout || {}) }}
              database={database}
              onNavigate={handleNavigate}
              onUpdateComponent={updateComponent}
              editingTextId={editingTextId}
              onStartTextEdit={id => { setEditingTextId(id); }}
              onCommitTextEdit={(id, text) => {
                if (text !== null) updateComponent(id, { text });
                setEditingTextId(null);
              }}
              onSaveRecord={(tableName, record) => {
                setDatabase(prev => ({
                  ...prev,
                  data: {
                    ...prev.data,
                    [tableName]: [...(prev.data[tableName] || []), { ...record, id: Date.now() }]
                  }
                }));
              }}
              onLogin={(tableName, credentials) => {
                const table = database.data[tableName] || [];
                const user = table.find(u =>
                  String(u.email || u.username) === String(credentials.email || credentials.username) &&
                  String(u.password) === String(credentials.password)
                );
                if (user) {
                  setCurrentUser(user);
                  alert(`Welcome back, ${user.name || user.email}!`);
                  return true;
                } else {
                  alert('Invalid credentials.');
                  return false;
                }
              }}
              currentUser={currentUser}
            />
            </GameContext.Provider>
            )}

            {showUserJourney && (
              <UserJourneyPanel
                screens={visibleScreens}
                currentScreenId={currentScreenId}
                onSelect={setCurrentScreenId}
                onAdd={addScreen}
                onDelete={deleteScreen}
                onMove={moveScreen}
                onClose={() => setShowUserJourney(false)}
                setConfirmModal={setConfirmModal}
                gameMode={gameMode}
              />
            )}

        {/* Global Toolbar Buttons (Floating) */}
        {!showUserJourney && (
          <button 
            className="toolbar-btn user-journey-toggle"
            onClick={() => setShowUserJourney(true)}
            title="User Journey"
            style={{ 
              zIndex: 100, 
              width: 40, 
              height: 40,
              padding: '4px',
              borderRadius: '0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
            onMouseOver={e => {
              e.currentTarget.style.backgroundColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--bg)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--accent)';
            }}
          >
            <div style={{ 
              width: 32, 
              height: 32, 
              backgroundColor: 'currentColor', 
              maskImage: 'url(/img/icons/imgi_47_monitor-medical.svg)',
              WebkitMaskImage: 'url(/img/icons/imgi_47_monitor-medical.svg)',
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat'
            }} />
          </button>
        )}


          </div>
          <Inspector
            key={selectedIds.join(',') || (selectedLevelId ? `level:${selectedLevelId}` : 'none')}
            component={selectedElement}
            onUpdate={updateComponent}
            onDelete={() => selectedIds.length > 0 && (selectedEntity ? deleteEntities(activeScreen.id, activeLevel.id, selectedIds) : deleteComponent(selectedIds))}
            onDuplicate={() => selectedIds.length > 0 && duplicateComponent(selectedIds)}
            isRow={isRowSelected}
            viewMode={viewMode}
            database={database}
            screens={screens}
            activeScreen={activeScreen}
            onUpdateScreen={updateScreen}
            windows={getWindows()}
            overlays={getOverlays()}
            screenLayout={{ ...DEFAULT_SCREEN_LAYOUT, ...(activeScreen?.layout || {}) }}
            onUpdateScreenLayout={(changes) => activeScreen && updateScreen(activeScreen.id, { layout: { ...(activeScreen.layout || DEFAULT_SCREEN_LAYOUT), ...changes } })}
            selectedIds={selectedIds}
            themeColors={THEMES[theme]}
            gameMode={gameMode}
            assets={assets}
            selectedLevel={(!showWorldSettings && levelLayer === 'game' && activeLevel) ? activeLevel : null}
            onUpdateLevel={(levelId, patch) => activeScreen?.id && updateLevel(activeScreen.id, levelId, patch)}
            selectedEntity={selectedEntity}
            onUpdateEntity={(entityId, patch) => activeLevel && updateEntity(activeScreen.id, activeLevel.id, entityId, patch)}
            paintBrush={paintBrush}
            onSetPaintBrush={setPaintBrush}
            selectedColliderShapeId={selectedColliderShapeId}
            onSelectColliderShape={setSelectedColliderShapeId}
            selectedOcclusionShapeId={selectedOcclusionShapeId}
            onSelectOcclusionShape={setSelectedOcclusionShapeId}
            onBuildGame={(worldId, config) => buildGame(worldId, config)}
            onAddBackgroundLayer={(assetId) => activeLevel && addBackgroundLayer(activeScreen.id, activeLevel.id, assetId)}
            onUpdateBackgroundLayer={(layerId, patch) => activeLevel && updateBackgroundLayer(activeScreen.id, activeLevel.id, layerId, patch)}
            onRemoveBackgroundLayer={(layerId) => activeLevel && removeBackgroundLayer(activeScreen.id, activeLevel.id, layerId)}
            onMoveBackgroundLayer={(layerId, direction) => activeLevel && moveBackgroundLayer(activeScreen.id, activeLevel.id, layerId, direction)}
          />
        </div>

        <div className="status-bar">
          <div style={{ display: 'flex', gap: 16 }}>
            <span>Project: {currentProject.name}</span>
            <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>Screen: {screens.find(s => s.id === currentScreenId)?.name || 'Default'}</span>
          </div>
          <span>{countAll(rows)} components · {rows.length} rows</span>
          <span>{viewMode === 'desktop' ? 'Desktop' : 'Mobile'}</span>
          <span>Theme: {THEMES[theme]?.name}</span>
          <span className={`save-status ${saveStatus === 'Saved' ? 'saved' : saveStatus === 'Saving...' ? 'saving' : ''}`}>{saveStatus}</span>
        </div>

        {showProjects && (
          <div className="projects-overlay" onClick={() => setShowProjects(false)}>
            <div className="projects-modal" 
                 onClick={e => e.stopPropagation()}
                 onKeyDown={e => e.key === 'Escape' && setShowProjects(false)}
                 tabIndex={-1}
            >
              <div className="modal-titlebar">
                <span className="modal-title">[ Project Manager ]</span>
                <button className="modal-close" onClick={() => setShowProjects(false)}>X</button>
              </div>
              <div className="modal-body">
                <button className="modal-action-btn" onClick={newProject}>+ New Project</button>
                <div className="modal-divider" />
                {projectList.map(proj => (
                  <div key={proj.id} className="project-item">
                    <div className="project-name-cell">
                      {editingProjectId === proj.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={editingProjectName}
                          onChange={e => setEditingProjectName(e.target.value)}
                          onBlur={() => renameProject(proj.id, editingProjectName)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') renameProject(proj.id, editingProjectName);
                            if (e.key === 'Escape') setEditingProjectId(null);
                          }}
                          style={{ background: 'var(--input-bg)', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '2px 4px', width: '100%', fontFamily: 'monospace', fontSize: 13 }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ color: 'var(--text)', fontWeight: 'bold', cursor: 'pointer' }}
                               onClick={() => { setEditingProjectId(proj.id); setEditingProjectName(proj.name); }}>{proj.name}</div>
                          {proj.isDemo && (
                            <span style={{ fontSize: 8, padding: '1px 4px', background: 'rgba(0,170,255,0.15)', border: '1px solid rgba(0,170,255,0.4)', color: '#00aaff', fontFamily: 'monospace', letterSpacing: 1 }}>DEMO</span>
                          )}
                          {proj.clonedFrom && !proj.isDemo && currentUser?.role !== 'admin' && (
                            <span style={{ fontSize: 8, padding: '1px 4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dim)', fontFamily: 'monospace', letterSpacing: 1 }}>from demo</span>
                          )}
                        </div>
                      )}
                      <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{proj.lastSaved}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {currentUser?.role === 'admin' && (
                        <button
                          className="small-btn"
                          title={proj.isDemo ? 'Remove demo flag' : 'Set as demo project'}
                          onClick={() => toggleDemo(proj)}
                          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: 0, height: 28, paddingInline: 6, opacity: proj.isDemo ? 1 : 0.5, color: proj.isDemo ? '#00aaff' : 'var(--text-dim)', borderColor: proj.isDemo ? '#00aaff' : 'var(--border)', fontSize: 14 }}
                        >
                          {proj.isDemo ? '★' : '☆'}
                          <span style={{ fontSize: 9 }}>demo</span>
                        </button>
                      )}
                      <button className="small-btn" onClick={() => loadProject(proj.id)}>Load</button>
                      <button className="small-btn" title="Duplicate project" onClick={() => duplicateProject(proj)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0, fontSize: 16 }}>⧉</button>
                      <button className="small-btn danger" onClick={() => deleteProject(proj.id, proj.name)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0, fontSize: 14 }}>
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {showNewProjectModal && (
          <div className="projects-overlay" onClick={() => setShowNewProjectModal(false)}>
            <div className="projects-modal" 
                 onClick={e => e.stopPropagation()} 
                 style={{ maxWidth: '300px' }}
                 onKeyDown={e => {
                   if (e.key === 'Escape') setShowNewProjectModal(false);
                 }}
                 tabIndex={-1}
            >
              <div className="modal-titlebar">
                <span className="modal-title">[ Create Project ]</span>
                <button className="modal-close" onClick={() => setShowNewProjectModal(false)}>X</button>
              </div>
              <div className="modal-body">
                <div className="property-group">
                  <label>PROJECT NAME</label>
                  <input 
                    type="text" 
                    value={newProjectName} 
                    onChange={e => setNewProjectName(e.target.value)} 
                    autoFocus
                    placeholder="Type new project name..."
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleConfirmNewProject();
                      if (e.key === 'Escape') setShowNewProjectModal(false);
                    }}
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px', width: '100%', fontFamily: 'monospace' }}
                  />
                </div>
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="modal-action-btn" onClick={handleConfirmNewProject} style={{ padding: '8px 24px' }}>Create</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showSettings && (() => {
          const isSuperAdmin = currentUser?.role === 'admin';
          const settingsTabs = [
            { id: 'profile', label: 'Profile' },
            { id: 'api', label: 'API' },
            ...(isSuperAdmin ? [{ id: 'tutorial', label: 'Tutorial' }] : []),
          ];
          const updateComponentUrl = (type, url) => setTutorialConfig(prev => ({
            ...prev,
            componentVideos: { ...(prev?.componentVideos || {}), [type]: { ...(prev?.componentVideos?.[type] || {}), url } },
          }));
          return (
          <div className="projects-overlay" onClick={() => setShowSettings(false)}>
            <div className="projects-modal"
                 onClick={e => e.stopPropagation()}
                 style={{ maxWidth: '500px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
                 onKeyDown={e => e.key === 'Escape' && setShowSettings(false)}
                 tabIndex={-1}
            >
              <div className="modal-titlebar" style={{ flexShrink: 0 }}>
                <span className="modal-title">[ Settings ]</span>
                <button className="modal-close" onClick={() => setShowSettings(false)}>X</button>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px 12px 12px 12px' }}>
              <RetroTabs
                key={showSettings ? 1 : 0}
                tabs={settingsTabs}
                activeTabIndex={0}
                layout={{ direction: 'column', gap: 16, align: 'stretch', justify: 'flex-start' }}
                containerStyle={{ flex: 1, minHeight: 0 }}
                contentStyle={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: 16 }}
              >

                {/* ── Profile tab — tabIndex 0 ────────────────────── */}
                <div tabIndex={0}>
                  <div style={{ border: '1px solid var(--border)', padding: '16px', position: 'relative', marginBottom: 0 }}>
                    <div style={{ position: 'absolute', top: '-10px', left: '10px', background: 'var(--bg)', padding: '0 5px', fontSize: '11px', color: 'var(--accent)' }}>Profile</div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {currentUser?.avatarUrl ? (
                          <img src={currentUser.avatarUrl} alt="avatar"
                            style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--border)', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--border)', background: 'var(--selected)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--accent)', fontFamily: 'monospace' }}>
                            {(currentUser?.displayName || currentUser?.email || '?')[0].toUpperCase()}
                          </div>
                        )}
                        <label style={{ position: 'absolute', inset: 0, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', opacity: 0, transition: 'opacity 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.opacity = 1}
                          onMouseLeave={e => e.currentTarget.style.opacity = 0}
                          title="Upload avatar">
                          <span style={{ color: '#fff', fontSize: 10, fontFamily: 'monospace', pointerEvents: 'none' }}>{avatarUploading ? '...' : 'EDIT'}</span>
                          <input type="file" accept="image/*" style={{ display: 'none' }}
                            onChange={e => e.target.files[0] && handleAvatarUpload(e.target.files[0])} />
                        </label>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>DISPLAY NAME</div>
                        <input type="text" value={settingsDisplayName} onChange={e => setSettingsDisplayName(e.target.value)}
                          style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', width: '100%', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' }} />
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {currentUser?.email}
                        </div>
                        {currentUser?.xHandle && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>@{currentUser.xHandle} (X)</div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="modal-action-btn"
                        onClick={handleProfileSave}
                        disabled={profileSaving || settingsDisplayName === currentUser?.displayName}
                        style={{ fontSize: 11, padding: '4px 14px' }}>
                        {profileSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── API tab — tabIndex 1 ─────────────────────────── */}
                <div tabIndex={1} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {isSuperAdmin && (
                    <div style={{ border: '1px solid var(--border)', padding: '16px', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: '-10px', left: '10px', background: 'var(--bg)', padding: '0 5px', fontSize: '11px', color: 'var(--accent)' }}>Builder Name</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>Visible to all users as the app title.</div>
                      <input type="text" value={builderName} onChange={e => setBuilderName(e.target.value)}
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                  )}

                  <div style={{ border: '1px solid var(--border)', padding: '16px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '-10px', left: '10px', background: 'var(--bg)', padding: '0 5px', fontSize: '11px', color: 'var(--accent)' }}>TUIFY API</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Your session token for API access.</div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>BACKEND URL</div>
                      <input readOnly value={`${window.location.origin}/api`}
                        style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '5px 8px', fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>JWT TOKEN</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input readOnly value={getToken() || '—'} type="password"
                          style={{ flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '5px 8px', fontFamily: 'monospace', fontSize: 11 }} />
                        <button className="modal-action-btn" style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                          onClick={() => { navigator.clipboard.writeText(getToken() || ''); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 1500); }}>
                          {tokenCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div style={{ border: '1px solid var(--border)', padding: '16px', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '-10px', left: '10px', background: 'var(--bg)', padding: '0 5px', fontSize: '11px', color: 'var(--accent)' }}>External Services</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>Named API connections your app components can reference.</div>
                    {externalApis.map(api => (
                      <div key={api.id} style={{ border: '1px solid var(--border)', padding: '10px', marginBottom: 10, position: 'relative' }}>
                        <button onClick={() => removeExternalApi(api.id)}
                          style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>X</button>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>NAME</div>
                            <input value={api.name} onChange={e => updateExternalApi(api.id, 'name', e.target.value)} placeholder="My API"
                              style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>URL</div>
                            <input value={api.url} onChange={e => updateExternalApi(api.id, 'url', e.target.value)} placeholder="https://api.example.com"
                              style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>AUTH HEADER</div>
                            <input value={api.authHeader} onChange={e => updateExternalApi(api.id, 'authHeader', e.target.value)} placeholder="Authorization"
                              style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>AUTH VALUE</div>
                            <input value={api.authValue} onChange={e => updateExternalApi(api.id, 'authValue', e.target.value)} placeholder="Bearer ..." type="password"
                              style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button className="modal-action-btn" onClick={addExternalApi}
                      style={{ fontSize: 11, padding: '5px 12px', marginTop: 4 }}>
                      + Add API
                    </button>
                  </div>
                </div>

                {/* ── Tutorial tab — tabIndex 2 (super admin only) ─── */}
                {isSuperAdmin && (
                  <div tabIndex={2} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    <div style={{ border: '1px solid var(--border)', padding: 16, position: 'relative' }}>
                      <div style={{ position: 'absolute', top: '-10px', left: '10px', background: 'var(--bg)', padding: '0 5px', fontSize: '11px', color: 'var(--accent)' }}>Tutorial Controls</div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, cursor: 'pointer', marginBottom: 14 }}>
                        <input type="checkbox" checked={tutorialActive} onChange={e => setTutorialActive(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
                        <span style={{ color: 'var(--text)' }}>Test tutorial (show hover previews in Toolbox)</span>
                      </label>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>MAX TIMES SHOWN TO USERS</div>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tutorialConfig?.visitLimit ?? DEFAULT_TUTORIAL_CONFIG.visitLimit}
                            onChange={e => {
                              const raw = e.target.value.replace(/\D/g, '');
                              setTutorialConfig(prev => ({ ...prev, visitLimit: raw === '' ? 0 : Math.min(99, Number(raw)) }));
                            }}
                            onFocus={e => e.target.select()}
                            style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>DEFAULT FALLBACK URL</div>
                          <input type="text"
                            value={tutorialConfig?.defaultUrl ?? ''}
                            onChange={e => setTutorialConfig(prev => ({ ...prev, defaultUrl: e.target.value }))}
                            placeholder="https://youtube.com/..."
                            style={{ width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', fontFamily: 'monospace', fontSize: 11, boxSizing: 'border-box' }} />
                        </div>
                      </div>
                    </div>

                    <div style={{ border: '1px solid var(--border)', padding: 16, position: 'relative' }}>
                      <div style={{ position: 'absolute', top: '-10px', left: '10px', background: 'var(--bg)', padding: '0 5px', fontSize: '11px', color: 'var(--accent)' }}>Component Tutorial URLs</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>URL shown when user hovers each toolbox item.</div>
                      {TOOLBOX_PALETTE.map((p, i) => {
                        if (p.kind === 'section') {
                          return <div key={`s-${i}`} style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: 1, marginTop: 6, marginBottom: 4 }}>{p.label}</div>;
                        }
                        const entry = tutorialConfig?.componentVideos?.[p.type] || {};
                        return (
                          <div key={p.type} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</div>
                            <input type="text"
                              value={entry.url || ''}
                              onChange={e => updateComponentUrl(p.type, e.target.value)}
                              placeholder={tutorialConfig?.defaultUrl || 'https://youtu.be/...'}
                              style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 6px', fontFamily: 'monospace', fontSize: 10, width: '100%', boxSizing: 'border-box' }} />
                          </div>
                        );
                      })}
                    </div>

                  </div>
                )}

              </RetroTabs>
              </div>
            </div>
          </div>
          );
        })()}

        {showDatabase && (
          <DatabasePanel database={database} setDatabase={(updater) => { editsMade.current = true; setDatabase(updater); }} onClose={() => setShowDatabase(false)} />
        )}

        {/* ── Publish Modal ──────────────────────────────────────────────── */}
        {showPublish && (() => {
          const pageScreens = screens.filter(s => s.kind !== 'world');
          const worlds      = screens.filter(s => s.kind === 'world');
          const hasPage = pageScreens.length > 0;
          const hasGame = worlds.length > 0;

          // Detect GameEmbed components in page screens
          const findEmbedIds = (comps) => (comps || []).flatMap(c =>
            c.type === 'GameEmbed' && c.props?.worldId ? [c.props.worldId]
            : c.children ? findEmbedIds(c.children) : []
          );
          const embeddedWorldIds = pageScreens.flatMap(s =>
            (s.rows || []).flatMap(r => findEmbedIds(r.children || []))
          );
          const hasGameEmbed = embeddedWorldIds.length > 0;
          const embeddedWorlds = [...new Set(embeddedWorldIds)].map(id => worlds.find(w => w.id === id)).filter(Boolean);

          // Which modes are available
          const availableModes = [];
          if (hasPage) availableModes.push('page');
          if (hasGame) availableModes.push('game');

          const modeLabel = { page: 'Page', game: 'Game only' };
          const modeDesc  = {
            page: hasGameEmbed
              ? `Page with ${embeddedWorlds.map(w=>w.name).join(', ')} embedded — game launches in-page.`
              : 'Publishes your screens as a website.',
            game: 'Publishes a playable standalone game.',
          };

          const inputStyle = { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' };
          const labelStyle = { fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 };

          return (
            <div className="projects-overlay" onClick={() => setShowPublish(false)}>
              <div className="projects-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }}
                   onKeyDown={e => e.key === 'Escape' && setShowPublish(false)} tabIndex={-1}>
                <div className="modal-titlebar">
                  <span className="modal-title">[ Publish Project ]</span>
                  <button className="modal-close" onClick={() => setShowPublish(false)}>X</button>
                </div>
                <div className="modal-body">

                  {publishStatus === 'done' ? (
                    /* ── Success state ── */
                    <div style={{ textAlign: 'center', padding: '12px 0' }}>
                      <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>Published!</div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                        <input readOnly value={publishUrl} style={{ ...inputStyle, fontSize: 11 }} />
                        <button className="modal-action-btn" style={{ fontSize: 11 }}
                          onClick={() => navigator.clipboard.writeText(publishUrl)}>Copy</button>
                        <a href={publishUrl} target="_blank" rel="noopener noreferrer"
                          className="retro-mini-btn accent" style={{ padding: '5px 10px', fontSize: 11 }}>Open</a>
                      </div>
                      <button className="modal-action-btn" style={{ fontSize: 11 }} onClick={() => setPublishStatus('idle')}>Update / Re-publish</button>
                    </div>
                  ) : (
                    <>
                      {/* ── Content detection ── */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, letterSpacing: 1 }}>PROJECT CONTENT</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ color: hasPage ? 'var(--accent)' : 'var(--text-dim)' }}>{hasPage ? '✓' : '○'}</span>
                            <span style={{ color: hasPage ? 'var(--text)' : 'var(--text-dim)' }}>
                              Page — {hasPage ? `${pageScreens.length} screen${pageScreens.length !== 1 ? 's' : ''}` : 'no screens'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ color: hasGame ? 'var(--accent)' : 'var(--text-dim)' }}>{hasGame ? '✓' : '○'}</span>
                            <span style={{ color: hasGame ? 'var(--text)' : 'var(--text-dim)' }}>
                              Game — {hasGame
                                ? `${worlds.length} world${worlds.length !== 1 ? 's' : ''}, ${worlds.reduce((n, w) => n + (w.levels?.length || 0), 0)} levels`
                                : 'no worlds (enable Game Mode to add)'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* ── Mode selector ── */}
                      {availableModes.length > 0 ? (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ ...labelStyle, letterSpacing: 1 }}>PUBLISH AS</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {availableModes.map(m => (
                              <button key={m} onClick={() => setPublishMode(m)}
                                className={`publish-mode-btn${publishMode === m ? ' active' : ''}`}>
                                <span style={{ color: publishMode === m ? 'var(--accent)' : 'inherit', fontWeight: publishMode === m ? 'bold' : 'normal' }}>
                                  {publishMode === m ? '▶ ' : '  '}{modeLabel[m]}
                                </span>
                                <span style={{ fontSize: 10, opacity: 0.7 }}>{modeDesc[m]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '10px 12px', background: 'var(--selected)', border: '1px solid var(--border)', marginBottom: 14, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                          Add some screens or enable Game Mode to start building something publishable.
                        </div>
                      )}

                      {/* ── Game summary (all worlds are included) ── */}
                      {publishMode === 'game' && worlds.length > 0 && (
                        <div style={{ marginBottom: 12, padding: '7px 10px', background: 'var(--selected)', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                          {worlds.map((w, i) => (
                            <div key={w.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{i + 1}.</span>
                              <span style={{ color: 'var(--text)' }}>{w.name}</span>
                              <span style={{ opacity: 0.5 }}>— {w.levels?.length || 0} level{(w.levels?.length || 0) !== 1 ? 's' : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Title / Slug / Description ── sync back to Screen/World settings ── */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={labelStyle}>
                          TITLE
                          <span style={{ opacity: 0.5, marginLeft: 6 }}>
                            {publishMode === 'game' ? '(project name)' : '(screen web title)'}
                          </span>
                        </div>
                        <input type="text" value={publishTitle}
                          onChange={e => {
                            const v = e.target.value;
                            setPublishTitle(v);
                            if (pageScreens[0] && publishMode !== 'game') {
                              updateScreen(pageScreens[0].id, { settings: { ...(pageScreens[0].settings || {}), webTitle: v } });
                            }
                            setCurrentProject(p => ({ ...p, name: v }));
                            editsMade.current = true;
                          }}
                          style={inputStyle} />
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <div style={labelStyle}>SLUG <span style={{ opacity: 0.5 }}>(URL path)</span></div>
                        <input type="text" value={publishSlug}
                          onChange={e => {
                            const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
                            setPublishSlug(v);
                            if (pageScreens[0] && publishMode !== 'game') {
                              updateScreen(pageScreens[0].id, { settings: { ...(pageScreens[0].settings || {}), slug: v } });
                            }
                            setCurrentProject(p => ({ ...p, publishSlug: v }));
                            editsMade.current = true;
                          }}
                          placeholder="my-project" style={inputStyle} />
                        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                          tuify.app / username / {publishSlug || '...'}
                        </div>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <div style={labelStyle}>DESCRIPTION <span style={{ opacity: 0.5 }}>(optional)</span></div>
                        <textarea value={publishDesc} rows={2}
                          onChange={e => {
                            const v = e.target.value;
                            setPublishDesc(v);
                            if (pageScreens[0] && publishMode !== 'game') {
                              updateScreen(pageScreens[0].id, { settings: { ...(pageScreens[0].settings || {}), description: v } });
                            }
                            setCurrentProject(p => ({ ...p, description: v }));
                            editsMade.current = true;
                          }}
                          style={{ ...inputStyle, resize: 'vertical' }} />
                      </div>

                      {publishError && <div style={{ color: '#f44', fontSize: 11, marginBottom: 10, fontFamily: 'monospace' }}>{publishError}</div>}

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="modal-action-btn" onClick={handlePublish}
                          disabled={publishStatus === 'publishing' || !publishSlug || availableModes.length === 0}
                          style={{ minWidth: 100 }}>
                          {publishStatus === 'publishing' ? 'Publishing...' : 'Publish'}
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── Already published list ── */}
                  {publishedList.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, letterSpacing: 1 }}>YOUR PUBLISHED ITEMS</div>
                      {publishedList.map(p => (
                        <div key={p.id} style={{ border: '1px solid var(--border)', padding: '10px 12px', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{p.title || p.slug}</span>
                            {p.publish_mode && <span style={{ fontSize: 9, color: 'var(--text-dim)', border: '1px solid var(--border)', padding: '1px 4px', flexShrink: 0 }}>{p.publish_mode}</span>}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <a href={p.url} target="_blank" rel="noopener noreferrer"
                              className="retro-mini-btn">Open</a>
                            {p.source_id === currentProject?.id && (
                              <button onClick={() => handleRepublishItem(p)}
                                disabled={publishStatus === 'publishing'}
                                className="retro-mini-btn accent">Republish</button>
                            )}
                            <button onClick={() => handleUnpublish(p.slug)}
                              className="retro-mini-btn">Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              </div>
            </div>
          );
        })()}

        {showSpriteSheetManager && (
          <SpriteSheetManager
            assets={assets}
            setAssets={setAssets}
            onClose={() => setShowSpriteSheetManager(false)}
            setConfirmModal={setConfirmModal}
            tutorialConfig={tutorialConfig}
            setTutorialConfig={setTutorialConfig}
            tutorialItems={TOOLBOX_PALETTE.map(p => p.kind === 'section' ? { kind: 'section', label: p.label } : { kind: 'item', type: p.type, label: p.label })}
            isSuperAdmin={currentUser?.role === 'admin'}
          />
        )}

        {/* Auth Modal — login / register / OAuth */}
        {showLogin && (
          <div className="projects-overlay" style={{ zIndex: 99999 }}>
            <div className="projects-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
              <div className="modal-titlebar">
                <span className="modal-title">[ TUIFY ]</span>
              </div>
              <div className="modal-body">
                {/* Tabs */}
                <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
                  {['login', 'register'].map(mode => (
                    <button key={mode} onClick={() => { setLoginMode(mode); setLoginError(''); }}
                      style={{ flex: 1, padding: '6px 0', fontFamily: 'monospace', fontSize: 11, background: loginMode === mode ? 'var(--selected)' : 'transparent', color: loginMode === mode ? 'var(--text)' : 'var(--text-dim)', border: 'none', borderBottom: loginMode === mode ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1 }}>
                      {mode === 'login' ? 'Sign In' : 'Register'}
                    </button>
                  ))}
                </div>

                {/* Login form */}
                {loginMode === 'login' && (
                  <form onSubmit={handleLogin}>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-dim)' }}>EMAIL</label>
                      <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@example.com" autoFocus required
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-dim)' }}>PASSWORD</label>
                      <input type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" required
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                    {loginError && <div style={{ color: '#ff4444', fontSize: 12, marginBottom: 12, fontFamily: 'monospace' }}>{loginError}</div>}
                    <div className="modal-divider" />
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'stretch', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <a href="/api/auth/x" className="oauth-btn" style={{ aspectRatio: '1 / 1', padding: 0 }}>𝕏</a>
                        <a href="/api/auth/google" className="oauth-btn">Google</a>
                      </div>
                      <button type="submit" className="modal-action-btn" disabled={loginLoading}
                        style={{ border: '1px solid var(--accent)', minWidth: 80, ...(loginLoading ? { background: 'var(--accent)', color: 'var(--bg)' } : {}) }}>
                        {loginLoading ? 'Signing in...' : 'Sign In'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Register form */}
                {loginMode === 'register' && (
                  <form onSubmit={handleRegister}>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-dim)' }}>DISPLAY NAME</label>
                      <input type="text" value={regName} onChange={e => setRegName(e.target.value)} placeholder="Your name" autoFocus
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-dim)' }}>EMAIL</label>
                      <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="you@example.com" required
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-dim)' }}>PASSWORD</label>
                      <input type="password" value={regPassword} onChange={e => setRegPassword(e.target.value)} placeholder="Min. 8 characters" required
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-dim)' }}>CONFIRM PASSWORD</label>
                      <input type="password" value={regConfirm} onChange={e => setRegConfirm(e.target.value)} placeholder="••••••••" required
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                    {loginError && <div style={{ color: '#ff4444', fontSize: 12, marginBottom: 12, fontFamily: 'monospace' }}>{loginError}</div>}
                    <div className="modal-divider" />
                    <div style={{ marginTop: 12, textAlign: 'right' }}>
                      <button type="submit" className="modal-action-btn" disabled={loginLoading}
                        style={{ border: '1px solid var(--accent)', minWidth: 80, ...(loginLoading ? { background: 'var(--accent)', color: 'var(--bg)' } : {}) }}>
                        {loginLoading ? 'Creating account...' : 'Create Account'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Confirm Modal — inside app div so theme CSS variables work */}
        {showDocs && <DocsPanel onClose={() => setShowDocs(false)} />}
        {confirmModal && (
          <div className="projects-overlay" style={{ zIndex: 10000 }} onClick={() => setConfirmModal(null)}>
            <div className="projects-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
              <div className="modal-titlebar">
                <span className="modal-title">[ {confirmModal.title} ]</span>
                <button className="modal-close" onClick={() => setConfirmModal(null)}>X</button>
              </div>
              <div className="modal-body">
                <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                  {confirmModal.message}
                </div>
                <div className="modal-divider" />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="modal-action-btn" onClick={() => setConfirmModal(null)}>
                    Cancel
                  </button>
                  <button
                    className="modal-action-btn"
                    onClick={confirmModal.onConfirm}
                    style={{ border: '1px solid var(--accent)' }}
                  >
                    {confirmModal.confirmText || 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DndProvider>
  );
}

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
    <path d="M18 6L17.1991 18.0129C17.129 19.065 17.0939 19.5911 16.8667 19.99C16.6666 20.3412 16.3648 20.6235 16.0011 20.7998C15.588 21 15.0607 21 14.0062 21H9.99377C8.93927 21 8.41202 21 7.99889 20.7998C7.63517 20.6235 7.33339 20.3412 7.13332 19.99C6.90607 19.5911 6.871 19.065 6.80086 18.0129L6 6M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.523 3 12.6936 3H11.3064C10.477 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6M14 10V17M10 10V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ─── User Journey Auxiliary Components ──────────────────────────────────────


function DraggableScreenCard({ screen, index, currentScreenId, onSelect, onDelete, onMove, setConfirmModal, gameMode = false, canDelete = false }) {
  const ref = React.useRef(null);
  
  const [{ isDragging }, drag] = useDrag({
    type: 'SCREEN_CARD',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: 'SCREEN_CARD',
    hover(item, monitor) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;
      onMove(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  drag(drop(ref));

  return (
    <div 
      ref={ref}
      className={`uj-screen-card ${currentScreenId === screen.id ? 'active' : ''}`}
      style={{ opacity: isDragging ? 0.3 : 1 }}
      onClick={() => onSelect(screen.id)}
    >
      <div className="uj-screen-thumb">
        {screen.kind === 'world' ? (
          <div style={{ fontSize: 9, opacity: 0.6, color: 'var(--accent)' }}>
            [ World · {(screen.levels || []).length} level{(screen.levels || []).length === 1 ? '' : 's'} ]
          </div>
        ) : screen.rows.length > 0 ? (
          <div style={{ fontSize: 9, opacity: 0.5 }}>[ {gameMode ? 'Screen' : 'Screen'} {index + 1} ]</div>
        ) : (
          <div style={{ fontSize: 9, opacity: 0.3 }}>[ Empty ]</div>
        )}
      </div>
      <div className="uj-screen-info">
        <span className="uj-screen-name">{screen.name}</span>
        {canDelete && (
          <button
            className="uj-screen-delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(screen.id);
            }}
          >
            delete
          </button>
        )}
      </div>
    </div>
  );
}

function UserJourneyPanel({ screens, currentScreenId, onSelect, onAdd, onDelete, onMove, onClose, setConfirmModal, gameMode = false }) {
  // Worlds can always be deleted; regular screens cannot delete the last one.
  const cardCanDelete = (screen) => gameMode ? true : screens.length > 1;
  return (
    <div className="user-journey-panel">
      <div className="uj-header">
        <span>[ {gameMode ? 'WORLDS' : 'USER JOURNEY'} ]</span>
        <button className="uj-close" onClick={onClose}>X</button>
      </div>
      <div className="uj-content">
        <div className="uj-screens-list">
          {screens.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 12, textAlign: 'center' }}>
              [ No {gameMode ? 'worlds' : 'screens'} yet ]
            </div>
          )}
          {screens.map((screen, idx) => (
            <DraggableScreenCard
              key={screen.id}
              screen={screen}
              index={idx}
              currentScreenId={currentScreenId}
              onSelect={onSelect}
              onDelete={onDelete}
              onMove={onMove}
              setConfirmModal={setConfirmModal}
              gameMode={gameMode}
              canDelete={cardCanDelete(screen)}
            />
          ))}
          <button className="uj-add-screen" onClick={onAdd}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>+</div>
            <span>{gameMode ? 'Add World' : 'Add Screen'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
