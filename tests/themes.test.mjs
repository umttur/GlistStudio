import assert from 'node:assert/strict';
import { ansiColors, builtInThemes, editorThemeData, importVsCodeTheme, restyleSemanticTokens } from '../src/themes.ts';

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
assert.equal(imported.palette.control, '#d73a49', 'keyword.control colors control flow');
const plain = importVsCodeTheme('{ "type": "dark", "colors": {} }', 'Plain');
assert.equal(plain.name, 'Plain');
assert.equal(plain.palette.control, undefined, "no control color from Glist Dark's palette");
assert.equal(plain.palette.operator, undefined, "no operator color from Glist Dark's palette");

// Keywords by what they do, in Glist Dark.
const glistDark = builtInThemes[0];
const ruleFor = (token) => editorThemeData(glistDark).rules.find((rule) => rule.token === token);
assert.equal(ruleFor('keyword.return').foreground, glistDark.palette.control.slice(1));
assert.equal(ruleFor('keyword.int').foreground, glistDark.palette.type.slice(1));
assert.equal(ruleFor('keyword.nullptr').foreground, glistDark.palette.constant.slice(1));
assert.equal(ruleFor('variable.readonly').foreground, glistDark.palette.constant.slice(1));
assert.equal(ruleFor('method.deprecated').fontStyle, 'strikethrough');
// Without a control color, control flow keeps the keyword color.
const nord = builtInThemes.find((theme) => theme.id === 'nord');
assert.equal(editorThemeData(nord).rules.find((rule) => rule.token === 'keyword.if').foreground, nord.palette.keyword.slice(1));

// Program output keeps its hues: Glist Dark's types are gold, but cyan stays cyan.
for (const theme of builtInThemes) {
  for (const [name, value] of Object.entries(ansiColors(theme.palette, theme.kind))) assert.match(value, hexColor, `${theme.id} ${name}`);
}
assert.equal(ansiColors(glistDark.palette, 'dark').red, glistDark.palette.danger);
assert.equal(ansiColors(glistDark.palette, 'dark').cyan, glistDark.palette.operator);
assert.equal(ansiColors(nord.palette, 'dark').green, nord.palette.string);

// Semantic tokens keep only the first styled modifier each has.
const legend = ['declaration', 'definition', 'deprecated', 'deduced', 'readonly', 'static'];
const bit = (name) => 2 ** legend.indexOf(name);
const restyled = restyleSemanticTokens([
  1, 4, 6, 8, bit('declaration') | bit('readonly') | bit('static'),
  0, 9, 3, 2, bit('static') | bit('deprecated'),
  2, 0, 5, 1, bit('definition'),
], legend);
assert.deepEqual([...restyled], [1, 4, 6, 8, 2, 0, 9, 3, 2, 1, 2, 0, 5, 1, 0]);
assert.throws(() => importVsCodeTheme('not json', 'Broken'));

console.log('Theme tests passed.');
