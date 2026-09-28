// eslint-disable-next-line import/no-unresolved
import * as monaco from 'monaco-editor/editor/editor.api';
import { icon } from './icons';
import { t } from './localization';
import { builtInThemes, editorThemeData, importVsCodeTheme, interfaceVariables, type StudioTheme } from './themes';

const themeKey = 'glist-studio-theme';
const customThemesKey = 'glist-studio-custom-themes';

const loadCustomThemes = (): StudioTheme[] => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(customThemesKey) ?? '[]') as StudioTheme[];
    return Array.isArray(stored) ? stored.filter((theme) => theme?.id && theme.palette) : [];
  } catch {
    return [];
  }
};

let customThemes = loadCustomThemes();

const saveCustomThemes = (): void => {
  try { window.localStorage.setItem(customThemesKey, JSON.stringify(customThemes)); } catch { /* Storage may be unavailable. */ }
};

const allThemes = (): StudioTheme[] => [...builtInThemes, ...customThemes];

const savedThemeId = (): string => {
  try {
    const saved = window.localStorage.getItem(themeKey) ?? 'glist-dark';
    // Before themes there were only these two.
    return ({ dark: 'glist-dark', light: 'glist-light' } as Record<string, string>)[saved] ?? saved;
  } catch {
    return 'glist-dark';
  }
};

let activeTheme = allThemes().find((theme) => theme.id === savedThemeId()) ?? builtInThemes[0];

export const getActiveTheme = (): StudioTheme => activeTheme;

const themeListeners: Array<(theme: StudioTheme) => void> = [];

// For parts that are colored in code rather than CSS, such as the terminal.
export const onThemeChange = (listener: (theme: StudioTheme) => void): void => {
  themeListeners.push(listener);
  listener(activeTheme);
};

// Recolors the interface, the editor and the window frame.
export const applyTheme = (theme: StudioTheme): void => {
  activeTheme = theme;
  try { window.localStorage.setItem(themeKey, theme.id); } catch { /* Storage may be unavailable. */ }
  const root = document.documentElement;
  Object.entries(interfaceVariables(theme.palette)).forEach(([name, value]) => root.style.setProperty(name, value));
  root.dataset.kind = theme.kind;
  monaco.editor.defineTheme(theme.id, editorThemeData(theme));
  monaco.editor.setTheme(theme.id);
  void window.glistAPI.setTheme({
    kind: theme.kind, background: theme.palette.background, chrome: theme.palette.chrome, text: theme.palette.text,
  });
  themeListeners.forEach((listener) => listener(theme));
};

const previewCard = (theme: StudioTheme, onRemove: () => void): HTMLLabelElement => {
  const { palette } = theme;
  const card = document.createElement('label');
  card.className = 'theme-card';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'studio-theme';
  input.value = theme.id;
  input.checked = theme.id === activeTheme.id;
  input.addEventListener('change', () => { if (input.checked) applyTheme(theme); });

  // A tiny window: side bar, and a few lines of code in the theme's colors.
  const preview = document.createElement('span');
  preview.className = 'theme-preview';
  preview.style.background = palette.editor;
  preview.style.borderColor = palette.border;
  const side = document.createElement('i');
  side.style.background = palette.chrome;
  preview.append(side);
  [[palette.keyword, palette.function, palette.text], [palette.comment], [palette.type, palette.string]].forEach((line, row) => {
    const code = document.createElement('span');
    code.className = 'theme-preview-line';
    code.style.top = `${7 + row * 9}px`;
    line.forEach((color, index) => {
      const token = document.createElement('b');
      token.style.background = color;
      token.style.width = `${[9, 14, 6][index] ?? 8}px`;
      code.append(token);
    });
    preview.append(code);
  });

  const name = document.createElement('span');
  name.className = 'theme-name';
  name.textContent = theme.name;
  card.append(input, preview, name);

  if (theme.custom) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'theme-remove';
    remove.title = t('removeTheme');
    remove.setAttribute('aria-label', `${t('removeTheme')} ${theme.name}`);
    remove.append(icon('close'));
    remove.addEventListener('click', (event) => { event.preventDefault(); onRemove(); });
    card.append(remove);
  }
  return card;
};

export interface ThemePicker {
  options: HTMLElement;
  importButton: HTMLButtonElement;
  fileInput: HTMLInputElement;
  error: HTMLElement;
}

// Fills the settings dialog with a card per theme, and imports VS Code themes.
export const setUpThemePicker = (picker: ThemePicker): void => {
  const render = (): void => {
    picker.options.replaceChildren(...allThemes().map((theme) => previewCard(theme, () => {
      customThemes = customThemes.filter((custom) => custom.id !== theme.id);
      saveCustomThemes();
      if (activeTheme.id === theme.id) applyTheme(builtInThemes[theme.kind === 'light' ? 1 : 0]);
      render();
    })));
  };
  picker.importButton.addEventListener('click', () => picker.fileInput.click());
  picker.fileInput.addEventListener('change', async () => {
    const file = picker.fileInput.files?.[0];
    picker.fileInput.value = '';
    picker.error.textContent = '';
    if (!file) return;
    try {
      const theme = importVsCodeTheme(await file.text(), file.name.replace(/\.json$/i, ''));
      customThemes = [...customThemes.filter((custom) => custom.id !== theme.id), theme];
      saveCustomThemes();
      applyTheme(theme);
      render();
    } catch {
      picker.error.textContent = t('themeImportFailed');
    }
  });
  render();
};
