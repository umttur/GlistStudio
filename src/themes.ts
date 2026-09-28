// eslint-disable-next-line import/no-unresolved
import type * as monaco from 'monaco-editor/editor/editor.api';
import type { ITheme } from '@xterm/xterm';

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
  // Optional: if, for, return and the like, apart from other keywords; and
  // operators and punctuation. Without them, keywords and plain text.
  control?: string;
  operator?: string;
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
  // The interface and the editor share one navy base; the cursor has the orange of the Glist logo.
  theme('glist-dark', 'Glist Dark', 'dark', {
    background: '#151820', chrome: '#0f1116', raised: '#1c2029', text: '#c7cdd9', muted: '#7b8399', border: '#232733',
    accent: '#2f6fe0', onAccent: '#ffffff', danger: '#ff6b81', success: '#1f8048', warning: '#f2c14e',
    editor: '#151820', editorText: '#d4dae6', lineHighlight: '#1b1f29', selection: '#29395c', cursor: '#ff9f43', lineNumber: '#434a60',
    comment: '#5f6b87', keyword: '#b794f6', string: '#a6da7a', number: '#ff9e64', type: '#ffcb6b', function: '#74b4ff',
    variable: '#d4dae6', parameter: '#ff8f8f', property: '#7fdbca', macro: '#ff7eb6', constant: '#ff9e64',
    control: '#ff7eb6', operator: '#89ddff',
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


// Monaco's C++ grammar names each keyword (keyword.if, keyword.int), so they
// can be colored by what they do.
const controlKeywords = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'try', 'catch',
  'throw', 'co_await', 'co_return', 'co_yield',
];
const typeKeywords = [
  'void', 'bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'wchar_t', 'short', 'int', 'long', 'signed', 'unsigned',
  'float', 'double', 'auto',
];
const constantKeywords = ['true', 'false', 'nullptr'];

// clangd's semantic token types, and the palette color of each.
const semanticColors = (palette: ThemePalette): Record<string, string> => ({
  namespace: palette.type, type: palette.type, class: palette.type, struct: palette.type, enum: palette.type,
  interface: palette.type, typeParameter: palette.type, concept: palette.type,
  function: palette.function, method: palette.function, variable: palette.variable, parameter: palette.parameter,
  property: palette.property, enumMember: palette.constant, macro: palette.macro,
});

// The semantic token modifiers themes style, most important first. A token
// keeps only the first it has (see restyleSemanticTokens).
export const styledModifiers = ['deprecated', 'readonly', 'static'];

// Token names cover Monaco's C++ grammar and clangd's semantic tokens.
const paletteRules = (palette: ThemePalette): monaco.editor.ITokenThemeRule[] => {
  const rule = (token: string, color: string, fontStyle?: string): monaco.editor.ITokenThemeRule =>
    ({ token, foreground: hex(color), fontStyle });
  const semantic = semanticColors(palette);
  return [
    rule('', palette.editorText),
    rule('comment', palette.comment, 'italic'),
    rule('keyword', palette.keyword),
    ...controlKeywords.map((word) => rule(`keyword.${word}`, palette.control ?? palette.keyword)),
    ...typeKeywords.map((word) => rule(`keyword.${word}`, palette.type)),
    ...constantKeywords.map((word) => rule(`keyword.${word}`, palette.constant)),
    rule('keyword.this', palette.parameter, 'italic'),
    rule('keyword.directive', palette.macro),
    rule('string', palette.string),
    rule('string.escape', palette.constant),
    rule('number', palette.number),
    rule('annotation', palette.macro),
    rule('delimiter', palette.operator ?? palette.editorText),
    rule('constant', palette.constant),
    ...Object.entries(semantic).map(([token, color]) => rule(token, color)),
    rule('parameter', palette.parameter, 'italic'),
    // Constants that are variables: const and constexpr ones.
    rule('variable.readonly', palette.constant),
    rule('property.readonly', palette.constant),
    ...['variable', 'property', 'function', 'method'].map((token) => rule(`${token}.static`, semantic[token], 'italic')),
    ...Object.entries(semantic).map(([token, color]) => rule(`${token}.deprecated`, color, 'strikethrough')),
  ];
};

// Monaco styles a semantic token by its type and modifiers joined in the
// legend's order, and matches theme rules by prefix, so 'variable.readonly'
// would never match clangd's 'variable.declaration.readonly'. This keeps only
// the first styled modifier of each token, in clangd's relative token data.
export const restyleSemanticTokens = (data: ArrayLike<number>, legendModifiers: string[]): Uint32Array => {
  const bits = styledModifiers.map((name) => legendModifiers.indexOf(name));
  const result = Uint32Array.from(data);
  for (let index = 4; index < result.length; index += 5) {
    const kept = bits.findIndex((bit) => bit >= 0 && (result[index] & (2 ** bit)) !== 0);
    result[index] = kept < 0 ? 0 : 2 ** kept;
  }
  return result;
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
      // Brackets take a color by depth.
      'editorBracketHighlight.foreground1': palette.type,
      'editorBracketHighlight.foreground2': palette.keyword,
      'editorBracketHighlight.foreground3': palette.function,
      'editorBracketHighlight.unexpectedBracket.foreground': palette.danger,
      focusBorder: palette.accent,
      ...studioTheme.editorColors,
    },
  };
};

// The interface colors, as the custom properties index.css reads.
export const interfaceVariables = (palette: ThemePalette, kind: ThemeKind): Record<string, string> => ({
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
  '--code-string': palette.string,
  '--code-keyword': palette.keyword,
  '--code-function': palette.function,
  '--code-type': palette.type,
  ...Object.fromEntries(Object.entries(ansiColors(palette, kind)).map(([name, color]) => [`--ansi-${name}`, color])),
});

const hueAndSaturation = (color: string): { hue: number; saturation: number } => {
  const full = mix(color, color, 0);
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(full.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (chroma === 0) return { hue: 0, saturation: 0 };
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, saturation };
};

const ansiHues = { red: 0, yellow: 50, green: 110, cyan: 185, blue: 220, magenta: 300 };
type AnsiHue = keyof typeof ansiHues;
// VS Code's terminal colors, for a hue a theme has nothing near.
const ansiDefaults: Record<ThemeKind, Record<AnsiHue, string>> = {
  dark: { red: '#f14c4c', yellow: '#e5e510', green: '#23d18b', cyan: '#29b8db', blue: '#3b8eea', magenta: '#d670d6' },
  light: { red: '#cd3131', yellow: '#949800', green: '#107c10', cyan: '#0598bc', blue: '#0451a5', magenta: '#bc05bc' },
};

// The eight colors programs print in, for the terminal and the Output panel.
// Each is the theme's color for that role (errors are red, strings green) when
// its hue fits, and otherwise the theme's color nearest in hue, so that cyan
// stays cyan whatever a theme uses it for in code.
export const ansiColors = (palette: ThemePalette, kind: ThemeKind): Record<AnsiHue | 'black' | 'white', string> => {
  const roles: Record<AnsiHue, string> = {
    red: palette.danger, green: palette.string, yellow: palette.warning, blue: palette.function,
    magenta: palette.keyword, cyan: palette.type,
  };
  const candidates = [
    palette.danger, palette.string, palette.warning, palette.function, palette.keyword, palette.type, palette.property,
    palette.number, palette.parameter, palette.macro, palette.constant, palette.control, palette.operator,
  ].filter((color): color is string => Boolean(color)).map((color) => ({ color, ...hueAndSaturation(color) }))
    .filter((candidate) => candidate.saturation > 0.2);
  const distance = (hue: number, name: AnsiHue): number =>
    Math.min(Math.abs(hue - ansiHues[name]), 360 - Math.abs(hue - ansiHues[name]));
  const nearest = (name: AnsiHue): string => {
    const role = hueAndSaturation(roles[name]);
    if (role.saturation > 0.2 && distance(role.hue, name) < 45) return roles[name];
    let best = ansiDefaults[kind][name];
    let bestDistance = 45;
    candidates.forEach(({ color, hue }) => {
      if (distance(hue, name) < bestDistance) { best = color; bestDistance = distance(hue, name); }
    });
    return best;
  };
  return {
    black: palette.muted, red: nearest('red'), green: nearest('green'), yellow: nearest('yellow'),
    blue: nearest('blue'), magenta: nearest('magenta'), cyan: nearest('cyan'), white: palette.text,
  };
};

// The terminal's colors, with bright variants the same as the plain ones.
export const terminalTheme = (palette: ThemePalette, kind: ThemeKind): ITheme => {
  const colors = ansiColors(palette, kind);
  return {
    background: palette.background,
    foreground: palette.text,
    cursor: palette.cursor,
    cursorAccent: palette.background,
    selectionBackground: palette.selection,
    ...colors,
    brightBlack: colors.black, brightRed: colors.red, brightGreen: colors.green, brightYellow: colors.yellow,
    brightBlue: colors.blue, brightMagenta: colors.magenta, brightCyan: colors.cyan, brightWhite: colors.white,
  };
};

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
  [/^keyword\.control/, ['control']],
  [/^keyword\.operator/, ['operator']],
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
      // Only the theme's own, so it never shows in Glist Dark's.
      control: undefined,
      operator: undefined,
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
