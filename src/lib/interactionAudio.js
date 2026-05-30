export const SOUND_ACTIONS = [
  { key: 'hover', label: 'Hover' },
  { key: 'click', label: 'Click' },
  { key: 'swipe', label: 'Swipe' },
  { key: 'inputHover', label: 'Input Hover' },
  { key: 'inputClick', label: 'Input Click' },
  { key: 'focus', label: 'Cursor Focus' },
  { key: 'caret', label: 'Caret Blink' },
  { key: 'open', label: 'Window Open' },
  { key: 'close', label: 'Window Close' },
];

export const BUILTIN_MACHINE_SOUNDS = [
  {
    id: 'builtin-machine-hover',
    kind: 'sound',
    builtin: true,
    name: 'Machine Hover',
    src: '/sounds/machine-hover.wav',
  },
  {
    id: 'builtin-machine-click',
    kind: 'sound',
    builtin: true,
    name: 'Machine Click',
    src: '/sounds/machine-click.wav',
  },
  {
    id: 'builtin-machine-swipe',
    kind: 'sound',
    builtin: true,
    name: 'Machine Swipe',
    src: '/sounds/machine-swipe.wav',
  },
  {
    id: 'builtin-machine-input-hover',
    kind: 'sound',
    builtin: true,
    name: 'Machine Input Hover',
    src: '/sounds/machine-input-hover.wav',
  },
  {
    id: 'builtin-machine-input-click',
    kind: 'sound',
    builtin: true,
    name: 'Machine Input Click',
    src: '/sounds/machine-input-click.wav',
  },
  {
    id: 'builtin-machine-cursor',
    kind: 'sound',
    builtin: true,
    name: 'Machine Cursor',
    src: '/sounds/machine-cursor.wav',
  },
  {
    id: 'builtin-machine-caret',
    kind: 'sound',
    builtin: true,
    name: 'Machine Caret',
    src: '/sounds/machine-caret.wav',
  },
  {
    id: 'builtin-machine-open',
    kind: 'sound',
    builtin: true,
    name: 'Machine Window Open',
    src: '/sounds/machine-window-open.wav',
  },
  {
    id: 'builtin-machine-close',
    kind: 'sound',
    builtin: true,
    name: 'Machine Window Close',
    src: '/sounds/machine-window-close.wav',
  },
];

export const DEFAULT_INTERACTION_SOUNDS = {
  enabled: true,
  volume: 0.7,
  defaults: {
    hover: 'builtin-machine-hover',
    click: 'builtin-machine-click',
    swipe: 'builtin-machine-swipe',
    inputHover: 'builtin-machine-input-hover',
    inputClick: 'builtin-machine-input-click',
    focus: 'builtin-machine-cursor',
    caret: 'builtin-machine-caret',
    open: 'builtin-machine-open',
    close: 'builtin-machine-close',
  },
};

const ACTION_VOLUME_SCALE = {
  hover: 0.6,
  click: 1,
  swipe: 1,
  inputHover: 0.18,
  inputClick: 0.28,
  focus: 0.14,
  caret: 0.3,
  open: 0.35,
  close: 0.35,
};

const audioCache = new Map();

export function getInteractionAudioContext() {
  if (typeof window === 'undefined') return { settings: null, assets: null };
  return window.__TUIFY_BUILDER_AUDIO__ || window.__TUIFY_SOUND_CONTEXT__ || { settings: null, assets: null };
}

export function getInteractionAssets(assets = null) {
  return assets || getInteractionAudioContext().assets || null;
}

export function getInteractionSettings(settings = null) {
  return settings || getInteractionAudioContext().settings || null;
}

export function normalizeInteractionSounds(settings) {
  const src = settings || {};
  return {
    ...DEFAULT_INTERACTION_SOUNDS,
    ...src,
    defaults: {
      ...DEFAULT_INTERACTION_SOUNDS.defaults,
      ...(src.defaults || {}),
    },
  };
}

export function getScreenSoundSettings(screen) {
  const raw = screen?.kind === 'world'
    ? screen?.worldSettings?.interactionSounds
    : screen?.settings?.interactionSounds;
  return normalizeInteractionSounds(raw);
}

export function resolveSoundId(settings, action, componentSounds = null) {
  const cfg = normalizeInteractionSounds(settings);
  const local = componentSounds || {};
  const localValue = local[action];
  if (localValue === '__none__') return '';
  return localValue || cfg.defaults?.[action] || '';
}

export function listAvailableSounds(assets) {
  const projectSounds = assets?.sounds || [];
  return [
    ...BUILTIN_MACHINE_SOUNDS,
    ...projectSounds.filter(s => !s.builtin),
  ];
}

export function findAvailableSound(assets, soundId) {
  return listAvailableSounds(assets).find(s => s.id === soundId) || null;
}

export function playInteractionSound(settings, assets, action, componentSounds = null) {
  const cfg = normalizeInteractionSounds(getInteractionSettings(settings));
  if (!cfg.enabled) return;
  const soundId = resolveSoundId(cfg, action, componentSounds);
  if (!soundId) return;
  const sound = findAvailableSound(getInteractionAssets(assets), soundId);
  const src = sound?.src || sound?.url;
  if (!src) return;
  try {
    let audio = audioCache.get(soundId);
    if (!audio || audio.src !== src) {
      audio = new Audio(src);
      audio.preload = 'auto';
      audioCache.set(soundId, audio);
    }
    audio.pause();
    audio.currentTime = 0;
    const baseVolume = Number(cfg.volume);
    const actionScale = ACTION_VOLUME_SCALE[action] ?? 1;
    audio.volume = Math.max(0, Math.min(1, (Number.isFinite(baseVolume) ? baseVolume : 0) * actionScale));
    const result = audio.play();
    if (result?.catch) result.catch(() => {});
  } catch {
    // Browser autoplay policies can reject audio before the first gesture.
  }
}
