// eslint-disable-next-line import/no-unresolved
import type * as monaco from 'monaco-editor/editor/editor.api';

// A theme colors both the interface and the code. The interface takes a
// handful of base colors and derives the rest in index.css.

export type ThemeKind = 'dark' | 'light';

export interface ThemePalette {
  // Interface
  background: string;
  chrome: string;
  raised: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  danger: string;
  // The Run button's background.
  success: string;
  warning: string;
  // Editor
  editor: string;
  editorText: string;
  lineHighlight: string;
  selection: string;
  cursor: string;
  lineNumber: string;
  // Code
  comment: string;
  keyword: string;
  string: string;
  number: string;
  type: string;
  function: string;
  variable: string;
  parameter: string;
  property: string;
  macro: string;
  constant: string;
}

export interface StudioTheme {
  id: string;
  name: string;
  kind: ThemeKind;
  palette: ThemePalette;
  // Only imported themes: their own editor colors and token rules, applied on top.
  editorColors?: Record<string, string>;
  rules?: monaco.editor.ITokenThemeRule[];
  custom?: boolean;
}

const theme = (id: string, name: string, kind: ThemeKind, palette: ThemePalette): StudioTheme =>
  ({ id, name, kind, palette });

// Colors come from each theme's published palette.
export const builtInThemes: StudioTheme[] = [
  theme('glist-dark', 'Glist Dark', 'dark', {
    background: '#1e1e1e', chrome: '#181818', raised: '#252526', text: '#cccccc', muted: '#858585', border: '#2b2b2b',
    accent: '#007acc', onAccent: '#ffffff', danger: '#f48771', success: '#26733b', warning: '#cca700',
    editor: '#111318', editorText: '#cdd6e5', lineHighlight: '#171b23', selection: '#304661', cursor: '#f2b84b', lineNumber: '#475166',
    comment: '#68758b', keyword: '#c792ea', string: '#a7d17a', number: '#f7b267', type: '#61c7c1', function: '#82aaff',
    variable: '#cdd6e5', parameter: '#e9c46a', property: '#89ddff', macro: '#f78c6c', constant: '#f7b267',
  }),
  theme('glist-light', 'Glist Light', 'light', {
    background: '#ffffff', chrome: '#f5f5f5', raised: '#ffffff', text: '#3b3b3b', muted: '#6b7280', border: '#dedede',
    accent: '#0969da', onAccent: '#ffffff', danger: '#c42b1c', success: '#218739', warning: '#9a6700',
    editor: '#ffffff', editorText: '#24292f', lineHighlight: '#f6f8fa', selection: '#add6ff', cursor: '#0969da', lineNumber: '#9ba3af',
    comment: '#667085', keyword: '#7a3e9d', string: '#437a32', number: '#a35400', type: '#087e8b', function: '#0550ae',
    variable: '#24292f', parameter: '#953800', property: '#0a3069', macro: '#a35400', constant: '#a35400',
  }),
  theme('gruvbox-dark', 'Gruvbox Dark', 'dark', {
    background: '#282828', chrome: '#1d2021', raised: '#32302f', text: '#ebdbb2', muted: '#a89984', border: '#3c3836',
    accent: '#458588', onAccent: '#fbf1c7', danger: '#fb4934', success: '#79740e', warning: '#d79921',
    editor: '#282828', editorText: '#ebdbb2', lineHighlight: '#32302f', selection: '#504945', cursor: '#ebdbb2', lineNumber: '#7c6f64',
    comment: '#928374', keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', type: '#fabd2f', function: '#8ec07c',
    variable: '#ebdbb2', parameter: '#83a598', property: '#83a598', macro: '#fe8019', constant: '#d3869b',
  }),
  theme('gruvbox-light', 'Gruvbox Light', 'light', {
    background: '#fbf1c7', chrome: '#f2e5bc', raised: '#fbf1c7', text: '#3c3836', muted: '#7c6f64', border: '#d5c4a1',
    accent: '#076678', onAccent: '#fbf1c7', danger: '#9d0006', success: '#79740e', warning: '#b57614',
    editor: '#fbf1c7', editorText: '#3c3836', lineHighlight: '#f2e5bc', selection: '#d5c4a1', cursor: '#3c3836', lineNumber: '#a89984',
    comment: '#928374', keyword: '#9d0006', string: '#79740e', number: '#8f3f71', type: '#b57614', function: '#427b58',
    variable: '#3c3836', parameter: '#076678', property: '#076678', macro: '#af3a03', constant: '#8f3f71',
  }),
  theme('solarized-dark', 'Solarized Dark', 'dark', {
    background: '#002b36', chrome: '#00212b', raised: '#073642', text: '#93a1a1', muted: '#657b83', border: '#073642',
    accent: '#268bd2', onAccent: '#fdf6e3', danger: '#dc322f', success: '#859900', warning: '#b58900',
    editor: '#002b36', editorText: '#839496', lineHighlight: '#073642', selection: '#274642', cursor: '#d30102', lineNumber: '#586e75',
    comment: '#586e75', keyword: '#859900', string: '#2aa198', number: '#d33682', type: '#b58900', function: '#268bd2',
    variable: '#839496', parameter: '#6c71c4', property: '#268bd2', macro: '#cb4b16', constant: '#d33682',
  }),
  theme('solarized-light', 'Solarized Light', 'light', {
    background: '#fdf6e3', chrome: '#eee8d5', raised: '#fdf6e3', text: '#586e75', muted: '#93a1a1', border: '#e3dcc6',
    accent: '#268bd2', onAccent: '#fdf6e3', danger: '#dc322f', success: '#859900', warning: '#b58900',
    editor: '#fdf6e3', editorText: '#657b83', lineHighlight: '#eee8d5', selection: '#eee8d5', cursor: '#657b83', lineNumber: '#93a1a1',
    comment: '#93a1a1', keyword: '#859900', string: '#2aa198', number: '#d33682', type: '#b58900', function: '#268bd2',
    variable: '#657b83', parameter: '#6c71c4', property: '#268bd2', macro: '#cb4b16', constant: '#d33682',
  }),
  theme('dracula', 'Dracula', 'dark', {
    background: '#282a36', chrome: '#21222c', raised: '#343746', text: '#f8f8f2', muted: '#6272a4', border: '#191a21',
    accent: '#bd93f9', onAccent: '#282a36', danger: '#ff5555', success: '#2f9e5b', warning: '#f1fa8c',
    editor: '#282a36', editorText: '#f8f8f2', lineHighlight: '#44475a', selection: '#44475a', cursor: '#f8f8f2', lineNumber: '#6272a4',
    comment: '#6272a4', keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', type: '#8be9fd', function: '#50fa7b',
    variable: '#f8f8f2', parameter: '#ffb86c', property: '#f8f8f2', macro: '#ff79c6', constant: '#bd93f9',
  }),
  theme('nord', 'Nord', 'dark', {
    background: '#2e3440', chrome: '#2e3440', raised: '#3b4252', text: '#d8dee9', muted: '#7b88a1', border: '#3b4252',
    accent: '#88c0d0', onAccent: '#2e3440', danger: '#bf616a', success: '#4f7a58', warning: '#ebcb8b',
    editor: '#2e3440', editorText: '#d8dee9', lineHighlight: '#3b4252', selection: '#434c5e', cursor: '#d8dee9', lineNumber: '#4c566a',
    comment: '#616e88', keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', type: '#8fbcbb', function: '#88c0d0',
    variable: '#d8dee9', parameter: '#d8dee9', property: '#d8dee9', macro: '#5e81ac', constant: '#b48ead',
  }),
  theme('one-dark', 'One Dark', 'dark', {
    background: '#282c34', chrome: '#21252b', raised: '#2c313a', text: '#abb2bf', muted: '#7f848e', border: '#181a1f',
    accent: '#4d78cc', onAccent: '#ffffff', danger: '#e06c75', success: '#3d8b47', warning: '#e5c07b',
    editor: '#282c34', editorText: '#abb2bf', lineHighlight: '#2c313c', selection: '#3e4451', cursor: '#528bff', lineNumber: '#495162',
    comment: '#5c6370', keyword: '#c678dd', string: '#98c379', number: '#d19a66', type: '#e5c07b', function: '#61afef',
    variable: '#e06c75', parameter: '#d19a66', property: '#e06c75', macro: '#56b6c2', constant: '#d19a66',
  }),
  theme('monokai', 'Monokai', 'dark', {
    background: '#272822', chrome: '#1e1f1c', raised: '#3e3d32', text: '#f8f8f2', muted: '#90908a', border: '#414339',
    accent: '#a6e22e', onAccent: '#272822', danger: '#f92672', success: '#5c8a14', warning: '#e6db74',
    editor: '#272822', editorText: '#f8f8f2', lineHighlight: '#3e3d32', selection: '#49483e', cursor: '#f8f8f0', lineNumber: '#90908a',
    comment: '#75715e', keyword: '#f92672', string: '#e6db74', number: '#ae81ff', type: '#66d9ef', function: '#a6e22e',
    variable: '#f8f8f2', parameter: '#fd971f', property: '#f8f8f2', macro: '#f92672', constant: '#ae81ff',
  }),
  theme('tokyo-night', 'Tokyo Night', 'dark', {
    background: '#1a1b26', chrome: '#16161e', raised: '#1f2335', text: '#a9b1d6', muted: '#565f89', border: '#101014',
    accent: '#7aa2f7', onAccent: '#1a1b26', danger: '#f7768e', success: '#3f8f4e', warning: '#e0af68',
    editor: '#1a1b26', editorText: '#a9b1d6', lineHighlight: '#1e2030', selection: '#33467c', cursor: '#c0caf5', lineNumber: '#3b4261',
    comment: '#565f89', keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', type: '#2ac3de', function: '#7aa2f7',
    variable: '#c0caf5', parameter: '#e0af68', property: '#73daca', macro: '#7dcfff', constant: '#ff9e64',
  }),
];

const hex = (color: string): string => color.replace(/^#/, '');

// Blends two #rrggbb colors; amount is the share of the second.
const mix = (first: string, second: string, amount: number): string => {
  const channels = (color: string): number[] => {
    const digits = hex(color).slice(0, 6);
    const full = digits.length === 3 ? digits.split('').map((digit) => digit + digit).join('') : digits;
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
  };
  const [a, b] = [channels(first), channels(second)];
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
};

const luminance = (color: string): number => {
  const full = mix(color, color, 0); // #rrggbb, without alpha
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};


// Token names cover Monaco's C++ grammar and clangd's semantic tokens.
const paletteRules = (palette: ThemePalette): monaco.editor.ITokenThemeRule[] => {
  const rule = (token: string, color: string, fontStyle?: string): monaco.editor.ITokenThemeRule =>
    ({ token, foreground: hex(color), fontStyle });
  return [
    rule('', palette.editorText),
    rule('comment', palette.comment, 'italic'),
    rule('keyword', palette.keyword),
    rule('keyword.directive', palette.macro),
    rule('string', palette.string),
    rule('string.escape', palette.constant),
    rule('number', palette.number),
    rule('annotation', palette.macro),
    ...['namespace', 'type', 'class', 'struct', 'enum', 'interface', 'typeParameter', 'concept']
      .map((token) => rule(token, palette.type)),
    rule('function', palette.function),
    rule('method', palette.function),
    rule('variable', palette.variable),
    rule('parameter', palette.parameter),
    rule('property', palette.property),
    rule('enumMember', palette.constant),
    rule('macro', palette.macro),
  ];
};

export const editorThemeData = (studioTheme: StudioTheme): monaco.editor.IStandaloneThemeData => {
  const { palette } = studioTheme;
  return {
    base: studioTheme.kind === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [...paletteRules(palette), ...(studioTheme.rules ?? [])],
    colors: {
      'editor.background': palette.editor,
      'editor.foreground': palette.editorText,
      'editorLineNumber.foreground': palette.lineNumber,
      'editorLineNumber.activeForeground': palette.editorText,
      'editorCursor.foreground': palette.cursor,
      'editor.selectionBackground': palette.selection,
      'editor.lineHighlightBackground': palette.lineHighlight,
      'editorWidget.background': palette.raised,
      'editorSuggestWidget.background': palette.raised,
      'editorHoverWidget.background': palette.raised,
      focusBorder: palette.accent,
      ...studioTheme.editorColors,
    },
  };
};

// The interface colors, as the custom properties index.css reads.
export const interfaceVariables = (palette: ThemePalette): Record<string, string> => ({
  '--ui-bg': palette.background,
  '--ui-chrome': palette.chrome,
  '--ui-raised': palette.raised,
  '--ui-fg': palette.text,
  '--ui-fg-muted': palette.muted,
  '--ui-border': palette.border,
  '--ui-accent': palette.accent,
  '--ui-on-accent': palette.onAccent,
  '--ui-danger': palette.danger,
  '--ui-success': palette.success,
  '--ui-on-success': luminance(palette.success) > 0.5 ? '#000000' : '#ffffff',
  '--ui-warning': palette.warning,
});

// Importing VS Code color themes

type Json = Record<string, unknown>;

const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

// Theme files are JSON with comments and trailing commas.
const parseLenient = (text: string): Json => JSON.parse(text
  .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, quoted: string | undefined) => quoted ?? '')
  .replace(/,(\s*[}\]])/g, '$1')) as Json;

// Which of our tokens a TextMate scope colors. The first match wins.
const scopeTokens: Array<[RegExp, Array<keyof ThemePalette>]> = [
  [/^comment/, ['comment']],
  [/^constant\.character\.escape/, ['constant']],
  [/^string/, ['string']],
  [/^constant\.numeric/, ['number']],
  [/^(keyword\.control\.directive|meta\.preprocessor|entity\.name\.function\.preprocessor)/, ['macro']],
  [/^(keyword|storage)/, ['keyword']],
  [/^(entity\.name\.(type|class|struct|namespace)|support\.(type|class)|entity\.other\.inherited-class)/, ['type']],
  [/^(entity\.name\.function|support\.function|meta\.function-call)/, ['function']],
  [/^variable\.parameter/, ['parameter']],
  [/^variable\.other\.(property|member|object\.property)/, ['property']],
  [/^variable/, ['variable']],
  [/^constant/, ['constant']],
];

const semanticTokens: Record<string, keyof ThemePalette> = {
  namespace: 'type', type: 'type', class: 'type', struct: 'type', enum: 'type', interface: 'type',
  typeParameter: 'type', function: 'function', method: 'function', variable: 'variable',
  parameter: 'parameter', property: 'property', enumMember: 'constant', macro: 'macro',
};

export const importVsCodeTheme = (source: string, fallbackName: string): StudioTheme => {
  const file = parseLenient(source);
  const colors = (file.colors ?? {}) as Record<string, unknown>;
  const color = (...keys: string[]): string | undefined => keys.map((key) => colors[key]).find(isColor);
  // The kind usually lives in the extension manifest, not the theme file.
  const background = color('editor.background');
  let kind: ThemeKind = background && luminance(background) > 0.5 ? 'light' : 'dark';
  if (file.type === 'light' || file.type === 'hcLight') kind = 'light';
  if (file.type === 'dark' || file.type === 'hc') kind = 'dark';
  const base = builtInThemes[kind === 'light' ? 1 : 0].palette;

  const editor = background ?? base.editor;
  const text = color('foreground', 'sideBar.foreground', 'editor.foreground') ?? base.text;
  const chrome = color('sideBar.background', 'activityBar.background', 'editorGroupHeader.tabsBackground', 'titleBar.activeBackground')
    ?? mix(editor, '#000000', 0.08);
  const editorText = color('editor.foreground') ?? text;

  // Code colors: the theme's token colors, strongest scope first.
  const code: Partial<ThemePalette> = {};
  const specificity: Partial<Record<keyof ThemePalette, number>> = {};
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (const entry of (Array.isArray(file.tokenColors) ? file.tokenColors : []) as Json[]) {
    const settings = (entry.settings ?? {}) as Json;
    const scopes = (Array.isArray(entry.scope) ? entry.scope : String(entry.scope ?? '').split(','))
      .map((scope: unknown) => String(scope).trim()).filter(Boolean);
    // Selectors with a space only apply inside other scopes.
    for (const scope of scopes.filter((candidate) => !candidate.includes(' '))) {
      const target = scopeTokens.find(([pattern]) => pattern.test(scope))?.[1][0];
      if (!target || !isColor(settings.foreground) || (specificity[target] ?? -1) > scope.length) continue;
      specificity[target] = scope.length;
      code[target] = settings.foreground;
      if (target === 'comment' && typeof settings.fontStyle === 'string') {
        rules.push({ token: 'comment', foreground: hex(settings.foreground), fontStyle: settings.fontStyle });
      }
    }
  }
  const semantic = (file.semanticTokenColors ?? {}) as Record<string, unknown>;
  Object.entries(semantic).forEach(([selector, value]) => {
    const style = (typeof value === 'string' ? { foreground: value } : value) as Json;
    const target = semanticTokens[selector.split('.')[0].split(':')[0]];
    if (target && isColor(style.foreground)) {
      rules.push({ token: selector.replace(/:.*$/, ''), foreground: hex(style.foreground), fontStyle: style.fontStyle as string | undefined });
    }
  });

  const editorColors: Record<string, string> = {};
  Object.entries(colors).forEach(([key, value]) => { if (isColor(value)) editorColors[key] = value; });

  const name = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : fallbackName;
  return {
    id: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    kind,
    custom: true,
    editorColors,
    rules,
    palette: {
      ...base,
      ...code,
      background: editor,
      chrome,
      raised: color('menu.background', 'editorWidget.background', 'dropdown.background') ?? chrome,
      text,
      muted: color('descriptionForeground', 'tab.inactiveForeground') ?? mix(text, editor, 0.4),
      border: color('panel.border', 'sideBar.border', 'editorGroup.border', 'tab.border') ?? mix(chrome, text, 0.12),
      accent: color('focusBorder', 'button.background', 'activityBarBadge.background') ?? base.accent,
      onAccent: color('button.foreground') ?? '#ffffff',
      danger: color('errorForeground', 'editorError.foreground') ?? base.danger,
      success: color('terminal.ansiGreen', 'gitDecoration.addedResourceForeground') ?? base.success,
      warning: color('editorWarning.foreground') ?? base.warning,
      editor,
      editorText,
      lineHighlight: color('editor.lineHighlightBackground') ?? mix(editor, editorText, 0.05),
      selection: color('editor.selectionBackground') ?? mix(editor, editorText, 0.2),
      cursor: color('editorCursor.foreground') ?? editorText,
      lineNumber: color('editorLineNumber.foreground') ?? mix(editorText, editor, 0.55),
    },
  };
};
