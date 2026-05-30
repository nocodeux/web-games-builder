export const TUTORIAL_VISIT_LIMIT = 3;
export const DEFAULT_TUTORIAL_FALLBACK_URL = 'https://youtu.be/H7sf1RDFXpU?si=OtLJRU9OdeWkdNXn';

export const DEFAULT_TUTORIAL_CONFIG = {
  enabled: true,
  visits: 0,
  disabled: false,
  visitLimit: TUTORIAL_VISIT_LIMIT,
  defaultUrl: '',
  componentVideos: {},
};

const TUTORIAL_DESCRIPTION_MAP = {
  Window: 'Container with a title bar.',
  Frame: 'Framed section for grouped content.',
  Row: 'Horizontal or vertical layout row.',
  Button: 'Clickable action button.',
  Text: 'Static text or label.',
  Input: 'Single-line user input.',
  CheckBox: 'Toggle a yes or no option.',
  RadioButton: 'Select one option from a group.',
  Selector: 'Pick one value from a list.',
  ListBox: 'Scrollable list of items.',
  Timer: 'Trigger actions on a schedule.',
  Shape: 'Draw a basic shape.',
  Line: 'Draw a straight line.',
  Image: 'Show an image asset.',
  Data: 'Read or write structured data.',
  Table: 'Display tabular records.',
  DataRepeater: 'Repeat a template for each item.',
  Form: 'Collect and submit user data.',
  Loader: 'Load data or assets on demand.',
  Tabs: 'Switch between grouped views.',
  Overlay: 'Show modal or floating content.',
  GameEmbed: 'Embed a playable game view.',
  Canvas: 'Main layout canvas.',
  LevelCanvas: 'Game world editor surface.',
  'LevelTabs.WorldSettings': 'Edit world-level settings.',
  'LevelTabs.LevelType': 'Change how the current level behaves.',
  'LevelTabs.LayerGame': 'Edit the game layer.',
  'LevelTabs.LayerHUD': 'Edit the HUD layer.',
  'LevelTabs.Play': 'Preview the active level.',
  'LevelTabs.LevelCard': 'Open a level and reorder it.',
  'LevelTabs.AddLevel': 'Create another level.',
  'UserJourney.Toggle': 'Open the user journey panel.',
  'UserJourney.ScreenCard': 'Open, reorder, or delete a screen.',
  'UserJourney.Add': 'Create another screen or world.',
  GameEntity: 'Place a playable entity in the world.',
  SpawnPoint: 'Set where the player starts.',
  Trigger: 'Fire events when the player enters.',
  Teleporter: 'Move the player to another spot.',
  ParticleEmitter: 'Spawn particle effects.',
  SoundEmitter: 'Play a sound in the world.',
  CollisionShape: 'Define a solid collision area.',
  Camera: 'Control the game camera.',
  GameView: 'Preview the playable scene.',
  'Toolbar.Theme': 'Change the editor theme.',
  'Toolbar.GameBuilder': 'Toggle game builder mode.',
  'Toolbar.Assets': 'Open the asset manager.',
  'Toolbar.Desktop': 'Switch to desktop preview.',
  'Toolbar.Mobile': 'Switch to mobile preview.',
  'Toolbar.Export': 'Export or publish the project.',
  'Toolbar.Database': 'Open the database panel.',
  'Toolbar.Projects': 'Open the project manager.',
  'Toolbar.Duplicate': 'Duplicate the current selection.',
  'Toolbar.Settings': 'Open global settings.',
  'Toolbar.Logout': 'Sign out of the session.',
  'Inspector.Title': 'Inspector title.',
  'Inspector.WebTitle': 'Exported page title.',
};

export function normalizeTutorialConfig(config) {
  const src = config || {};
  const defaultUrl = src.defaultUrl === DEFAULT_TUTORIAL_FALLBACK_URL
    ? ''
    : (src.defaultUrl ?? DEFAULT_TUTORIAL_CONFIG.defaultUrl);
  return {
    ...DEFAULT_TUTORIAL_CONFIG,
    ...src,
    defaultUrl,
    visitLimit: Number.isFinite(Number(src.visitLimit)) ? Number(src.visitLimit) : DEFAULT_TUTORIAL_CONFIG.visitLimit,
    componentVideos: { ...(src.componentVideos || {}) },
  };
}

export function listAvailableVideos(assets) {
  return assets?.videos || [];
}

export function getDefaultTutorialDescription(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  return `How to use ${text}.`;
}

export function getTutorialDescription(type, label = '') {
  return TUTORIAL_DESCRIPTION_MAP[type] || getDefaultTutorialDescription(label);
}

export function ensureTutorialComponentVideos(config, componentTypes = []) {
  const src = config || {};
  const fallback = src.defaultUrl === DEFAULT_TUTORIAL_FALLBACK_URL
    ? ''
    : (src.defaultUrl ?? DEFAULT_TUTORIAL_CONFIG.defaultUrl);
  const next = { ...(src.componentVideos || {}) };
  let changed = false;
  for (const type of componentTypes) {
    if (!next[type]) {
      next[type] = { url: '', readMoreUrl: '' };
      changed = true;
    }
  }
  if (!changed) return src;
  return normalizeTutorialConfig({ ...src, defaultUrl: fallback, componentVideos: next });
}

export function getTutorialVideoEntry(config, componentType) {
  const cfg = normalizeTutorialConfig(config);
  return cfg.componentVideos?.[componentType] || null;
}

export function isYouTubeUrl(url) {
  return /(?:youtu\.be\/|youtube\.com\/)/i.test(String(url || ''));
}

export function toYouTubeEmbedUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    let id = '';
    if (parsed.hostname.includes('youtu.be')) {
      id = parsed.pathname.replace(/^\/+/, '');
    } else {
      id = parsed.searchParams.get('v') || '';
    }
    if (!id) return raw;
    const embed = new URL(`https://www.youtube.com/embed/${id}`);
    embed.searchParams.set('autoplay', '1');
    embed.searchParams.set('mute', '1');
    embed.searchParams.set('controls', '1');
    embed.searchParams.set('playsinline', '1');
    embed.searchParams.set('loop', '1');
    embed.searchParams.set('playlist', id);
    return embed.toString();
  } catch {
    return raw;
  }
}

export function resolveTutorialVideoSource(config, assets, componentType) {
  const cfg = normalizeTutorialConfig(config);
  const entry = cfg.componentVideos?.[componentType];
  if (!entry) return cfg.defaultUrl || '';
  if (entry.videoId) {
    const match = listAvailableVideos(assets).find(v => v.id === entry.videoId);
    if (match?.src) return match.src;
  }
  return entry.url || cfg.defaultUrl || '';
}

export function resolveTutorialReadMoreUrl(config, componentType) {
  const cfg = normalizeTutorialConfig(config);
  const entry = cfg.componentVideos?.[componentType];
  return entry?.readMoreUrl || '';
}

export function resolveTutorialDescription(config, componentType, fallbackLabel = '') {
  const cfg = normalizeTutorialConfig(config);
  const entry = cfg.componentVideos?.[componentType];
  return entry?.description || getTutorialDescription(componentType, fallbackLabel);
}

export function resolveTutorialMedia(config, assets, componentType, fallbackLabel = '') {
  const url = resolveTutorialVideoSource(config, assets, componentType);
  const youtube = isYouTubeUrl(url);
  return {
    url,
    youtube,
    embedUrl: youtube ? toYouTubeEmbedUrl(url) : '',
    readMoreUrl: resolveTutorialReadMoreUrl(config, componentType),
    description: resolveTutorialDescription(config, componentType, fallbackLabel),
  };
}
