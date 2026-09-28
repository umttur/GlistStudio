// eslint-disable-next-line import/no-unresolved
import * as monaco from 'monaco-editor/editor/editor.api';

// Fonts for code (editor, output, debugger values) and for the interface.
// Names that are not installed fall back to the defaults after them.

export interface FontSettings {
  code: string;
  codeSize: number;
  ligatures: boolean;
  interface: string;
}

const storageKey = 'glist-studio-fonts';
const codeFallback = "'Cascadia Code', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const interfaceFallback = "'Segoe UI', system-ui, sans-serif";
const defaults: FontSettings = { code: '', codeSize: 14, ligatures: false, interface: '' };

export const codeFontSuggestions = [
  'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'SF Mono', 'Menlo', 'Monaco', 'Consolas',
  'Ubuntu Mono', 'DejaVu Sans Mono', 'Courier New',
];
export const interfaceFontSuggestions = [
  'Segoe UI', 'SF Pro Text', 'Helvetica Neue', 'Inter', 'Roboto', 'Noto Sans', 'Ubuntu', 'Cantarell', 'Arial',
];

export const loadFonts = (): FontSettings => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as Partial<FontSettings>;
    const size = Number(saved.codeSize);
    return {
      code: typeof saved.code === 'string' ? saved.code : defaults.code,
      codeSize: Number.isFinite(size) ? Math.min(32, Math.max(8, Math.round(size))) : defaults.codeSize,
      ligatures: saved.ligatures === true,
      interface: typeof saved.interface === 'string' ? saved.interface : defaults.interface,
    };
  } catch {
    return { ...defaults };
  }
};

const stack = (name: string, fallback: string): string => {
  const trimmed = name.trim();
  return trimmed ? `"${trimmed.replace(/["\\]/g, '')}", ${fallback}` : fallback;
};

// The Output panel and the terminal use the code font, a little smaller.
export const codeFontStack = (fonts: FontSettings): string => stack(fonts.code, codeFallback);
export const panelFontSize = (fonts: FontSettings): number => Math.max(10, fonts.codeSize - 2);

const fontListeners: Array<(fonts: FontSettings) => void> = [];

// For parts that set their font in code rather than CSS, such as the terminal.
export const onFontsChange = (listener: (fonts: FontSettings) => void): void => {
  fontListeners.push(listener);
  listener(loadFonts());
};

export const applyFonts = (editor: monaco.editor.IStandaloneCodeEditor, fonts: FontSettings): void => {
  try { window.localStorage.setItem(storageKey, JSON.stringify(fonts)); } catch { /* Storage may be unavailable. */ }
  const root = document.documentElement.style;
  root.setProperty('--font-code', codeFontStack(fonts));
  root.setProperty('--font-code-size', `${panelFontSize(fonts)}px`);
  root.setProperty('--font-ui', stack(fonts.interface, interfaceFallback));
  editor.updateOptions({
    fontFamily: codeFontStack(fonts),
    fontSize: fonts.codeSize,
    lineHeight: Math.round(fonts.codeSize * 1.57),
    fontLigatures: fonts.ligatures,
  });
  // Monaco measures a font once; a newly chosen one has to be measured again.
  monaco.editor.remeasureFonts();
  fontListeners.forEach((listener) => listener(fonts));
};

export interface FontControls {
  code: HTMLInputElement;
  codeSize: HTMLInputElement;
  ligatures: HTMLInputElement;
  interface: HTMLInputElement;
  codeList: HTMLDataListElement;
  interfaceList: HTMLDataListElement;
}

export const setUpFontSettings = (editor: monaco.editor.IStandaloneCodeEditor, controls: FontControls): void => {
  const fonts = loadFonts();
  const options = (names: string[]): HTMLOptionElement[] => names.map((name) => {
    const option = document.createElement('option');
    option.value = name;
    return option;
  });
  controls.codeList.replaceChildren(...options(codeFontSuggestions));
  controls.interfaceList.replaceChildren(...options(interfaceFontSuggestions));
  controls.code.value = fonts.code;
  controls.codeSize.value = String(fonts.codeSize);
  controls.ligatures.checked = fonts.ligatures;
  controls.interface.value = fonts.interface;
  const update = (): void => {
    const size = Number(controls.codeSize.value);
    Object.assign(fonts, {
      code: controls.code.value,
      codeSize: Number.isFinite(size) && size >= 8 && size <= 32 ? Math.round(size) : fonts.codeSize,
      ligatures: controls.ligatures.checked,
      interface: controls.interface.value,
    });
    applyFonts(editor, fonts);
  };
  [controls.code, controls.codeSize, controls.interface].forEach((input) => input.addEventListener('input', update));
  controls.ligatures.addEventListener('change', update);
  applyFonts(editor, fonts);
};
