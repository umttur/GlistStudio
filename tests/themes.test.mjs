import assert from 'node:assert/strict';
import { builtInThemes, editorThemeData, importVsCodeTheme } from '../src/themes.ts';

const hexColor = /^#[0-9a-f]{6}$/i;
const ids = new Set();
for (const theme of builtInThemes) {
  assert.ok(!ids.has(theme.id), `duplicate theme id ${theme.id}`);
  ids.add(theme.id);
  for (const [key, value] of Object.entries(theme.palette)) assert.match(value, hexColor, `${theme.id}.${key}`);
  assert.equal(editorThemeData(theme).base, theme.kind === 'light' ? 'vs' : 'vs-dark');
}

// A theme file as VS Code extensions ship them: comments, trailing commas, no type.
const imported = importVsCodeTheme(`{
  // A light theme
  "name": "Paper",
  "colors": {
    "editor.background": "#fafafa",
    "editor.foreground": "#222222",
    "sideBar.background": "#eeeeee",
    "focusBorder": "#0366d6", /* accent */
    "not.a.color": "red",
  },
  "tokenColors": [
    { "scope": "comment", "settings": { "foreground": "#999999", "fontStyle": "italic" } },
    { "scope": ["string", "string meta.embedded"], "settings": { "foreground": "#032f62" } },
    { "scope": "string meta.image", "settings": { "foreground": "#ff0000" } },
    { "scope": "keyword.control, storage.type", "settings": { "foreground": "#d73a49" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#6f42c1" } },
  ],
  "semanticTokenColors": { "parameter": "#e36209", "property:cpp": { "foreground": "#005cc5" } },
}`, 'fallback');
assert.equal(imported.name, 'Paper');
assert.equal(imported.id, 'custom-paper');
assert.equal(imported.kind, 'light', 'kind inferred from the background');
assert.equal(imported.palette.editor, '#fafafa');
assert.equal(imported.palette.chrome, '#eeeeee');
assert.equal(imported.palette.accent, '#0366d6');
assert.equal(imported.palette.comment, '#999999');
assert.equal(imported.palette.string, '#032f62', 'descendant selectors do not override');
assert.equal(imported.palette.keyword, '#d73a49');
assert.equal(imported.palette.function, '#6f42c1');
assert.ok(!('not.a.color' in imported.editorColors));
assert.ok(imported.rules.some((rule) => rule.token === 'parameter' && rule.foreground === 'e36209'));
assert.ok(imported.rules.some((rule) => rule.token === 'property' && rule.foreground === '005cc5'));
assert.equal(importVsCodeTheme('{ "type": "dark", "colors": {} }', 'Plain').name, 'Plain');
assert.throws(() => importVsCodeTheme('not json', 'Broken'));

console.log('Theme tests passed.');
