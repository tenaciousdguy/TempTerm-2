export const THEMES = {
  Default: { bg: '#0c0c0c', text: '#d4d4d4', bright: '#ffffff', dim: '#6e6e6e', accent: '#4ade80' },
  Matrix:  { bg: '#020a02', text: '#22c55e', bright: '#86efac', dim: '#166534', accent: '#4ade80' },
  Amber:   { bg: '#0d0905', text: '#f59e0b', bright: '#fde68a', dim: '#92400e', accent: '#fbbf24' },
  Arctic:  { bg: '#070b10', text: '#bae6fd', bright: '#f0f9ff', dim: '#38607a', accent: '#38bdf8' },
  Blood:   { bg: '#0d0505', text: '#fca5a5', bright: '#fee2e2', dim: '#7f1d1d', accent: '#ef4444' },
  Sakura:  { bg: '#0d070a', text: '#fbcfe8', bright: '#fff1f7', dim: '#9d4a6e', accent: '#f472b6' },
};

export const SIZES = ['800x600', '1024x768', '1280x720'];

const DEFAULTS = {
  theme: 'Default',
  size: '800x600',
  pfps: true,
  ui: 'modern',
  language: 'English',
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function save() {
  localStorage.setItem('settings', JSON.stringify(settings));
}

export function applyTheme() {
  const t = THEMES[settings.theme] || THEMES.Default;
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg);
  root.setProperty('--text', t.text);
  root.setProperty('--bright', t.bright);
  root.setProperty('--dim', t.dim);
  root.setProperty('--accent', t.accent);
}

export function applyUi() {
  document.body.classList.toggle('ui-classic', settings.ui === 'classic');
}

export function applySize() {
  if (window.tt) window.tt.setWindowSize(settings.size);
}