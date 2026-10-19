import assert from 'node:assert/strict';
import { EditorLayout } from '../src/editor-layout.ts';

// The editor's tabs on each side. Run with jiti.
const tabs = (layout) => layout.groups.map((group) => `${group.tabs.join(' ')}${group.active ? ` [${group.active}]` : ''}`);

// One group: tabs open at the end; the one closed makes way for its neighbor.
const layout = new EditorLayout();
['a.cpp', 'a.h', 'b.cpp'].forEach((key) => layout.activate(key));
assert.deepEqual(tabs(layout), ['a.cpp a.h b.cpp [b.cpp]']);
layout.add('c.cpp');
assert.deepEqual(tabs(layout), ['a.cpp a.h b.cpp c.cpp [b.cpp]'], 'added without coming to the front');
layout.activate('a.h');
layout.close('a.h');
assert.deepEqual(tabs(layout), ['a.cpp b.cpp c.cpp [b.cpp]']);
layout.close('c.cpp');
assert.deepEqual(tabs(layout), ['a.cpp b.cpp [b.cpp]'], 'a tab behind closes without changing the front');
layout.close('b.cpp');
assert.deepEqual(tabs(layout), ['a.cpp [a.cpp]'], 'the last one closed: the one before comes');

// Reordering in a group leaves the front alone.
layout.activate('b.cpp');
layout.activate('c.cpp');
layout.activate('a.cpp');
layout.move('c.cpp', 0, 0, 'a.cpp');
assert.deepEqual(tabs(layout), ['c.cpp a.cpp b.cpp [a.cpp]']);
layout.move('c.cpp', 0, 0);
assert.deepEqual(tabs(layout), ['a.cpp b.cpp c.cpp [a.cpp]']);

// Split Right: the same file on both sides, the new side focused.
layout.split('a.cpp');
assert.deepEqual(tabs(layout), ['a.cpp b.cpp c.cpp [a.cpp]', 'a.cpp [a.cpp]']);
assert.equal(layout.focused, 1);
assert.deepEqual(layout.groupsWith('a.cpp'), [0, 1]);
// New tabs go to the focused side.
layout.activate('a.h');
assert.deepEqual(tabs(layout), ['a.cpp b.cpp c.cpp [a.cpp]', 'a.cpp a.h [a.h]']);
assert.equal(layout.activeKey, 'a.h');
// Closing one of a file's two tabs leaves it open.
layout.close('a.cpp', 1);
assert.equal(layout.isOpen('a.cpp'), true);
assert.deepEqual(tabs(layout), ['a.cpp b.cpp c.cpp [a.cpp]', 'a.h [a.h]']);
// A third side is not made; split from the right opens on the left.
layout.split('a.h', 1);
assert.deepEqual(tabs(layout), ['a.cpp b.cpp c.cpp a.h [a.h]', 'a.h [a.h]']);
assert.equal(layout.focused, 0);
layout.close('a.h', 0);

// Dragging a tab across: it leaves one side for the other, before a tab there.
layout.move('b.cpp', 0, 1, 'a.h');
assert.deepEqual(tabs(layout), ['a.cpp c.cpp [c.cpp]', 'b.cpp a.h [b.cpp]']);
assert.equal(layout.focused, 1);
// Onto a side that has the file already: the two become one.
layout.split('a.cpp', 0);
layout.move('a.cpp', 0, 1);
assert.deepEqual(tabs(layout), ['c.cpp [c.cpp]', 'b.cpp a.h a.cpp [a.cpp]']);
// A side left empty goes, and the other takes the whole area.
layout.move('c.cpp', 0, 1, 'b.cpp');
assert.deepEqual(tabs(layout), ['c.cpp b.cpp a.h a.cpp [c.cpp]']);
assert.equal(layout.focused, 0);
// A group one past the last is a new side, the way a drop at the right edge makes it.
layout.move('a.h', 0, 1);
assert.deepEqual(tabs(layout), ['c.cpp b.cpp a.cpp [c.cpp]', 'a.h [a.h]']);
layout.move('a.h', 1, 2);
assert.equal(layout.groups.length, 2, 'never more than two sides');

// Closing the last tab on the right, or on the left, leaves one side.
layout.close('a.h', 1);
assert.deepEqual(tabs(layout), ['c.cpp b.cpp a.cpp [c.cpp]']);
assert.equal(layout.focused, 0);
layout.split('b.cpp', 0);
layout.focus(0);
['c.cpp', 'b.cpp', 'a.cpp'].forEach((key) => layout.close(key, 0));
assert.deepEqual(tabs(layout), ['b.cpp [b.cpp]']);
assert.equal(layout.focused, 0);

// A rename keeps places; a deleted folder takes its tabs from both sides.
layout.activate('src/x.cpp');
layout.split('src/x.cpp');
layout.activate('src/y.cpp');
layout.rename('src/x.cpp', 'src/z.cpp');
assert.deepEqual(tabs(layout), ['b.cpp src/z.cpp [src/z.cpp]', 'src/z.cpp src/y.cpp [src/y.cpp]']);
layout.remove((key) => key.startsWith('src/'));
assert.deepEqual(tabs(layout), ['b.cpp [b.cpp]']);
assert.deepEqual(layout.keys(), ['b.cpp']);
layout.clear();
assert.deepEqual(tabs(layout), ['']);
assert.equal(layout.activeKey, null);

// Transient tabs, marked ~ here: one per side, in place of the last, staying
// available behind regular tabs until another preview replaces it.
const marked = (state) => state.groups.map((group) => {
  const name = (key) => `${key === group.transient ? '~' : ''}${key}`;
  return `${group.tabs.map(name).join(' ')}${group.active ? ` [${name(group.active)}]` : ''}`;
});
const preview = new EditorLayout();
preview.open('a.cpp');
preview.open('b.cpp');
assert.equal(preview.open('d1', 0, true), null);
assert.deepEqual(marked(preview), ['a.cpp b.cpp ~d1 [~d1]']);
// Another transient one takes its place, in the same spot, not at the end.
preview.move('d1', 0, 0, 'b.cpp');
assert.deepEqual(marked(preview), ['a.cpp ~d1 b.cpp [~d1]'], 'reordered, it is still transient');
assert.equal(preview.open('d2', 0, true), 'd1', 'the one replaced is told, for its file to be let go');
assert.deepEqual(marked(preview), ['a.cpp ~d2 b.cpp [~d2]']);
assert.equal(preview.isTransient('d2', 0), true);
// Switching to another tab of the side leaves the preview available.
assert.equal(preview.activate('b.cpp'), null);
assert.deepEqual(marked(preview), ['a.cpp ~d2 b.cpp [b.cpp]']);
assert.equal(preview.isOpen('d2'), true);
// A new preview replaces it; bringing that preview to the front again, or
// working in the other side, does not.
preview.open('d3', 0, true);
assert.equal(preview.activate('d3'), null);
preview.split('a.cpp', 0);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp [a.cpp]'], 'Split Right from a tab behind it leaves it');
assert.equal(preview.focused, 1);
preview.focus(0);
preview.focus(1);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp [a.cpp]'], 'the other side being worked in leaves it');
// One per side: each side has its own.
preview.open('d4', 1, true);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp ~d4 [~d4]']);
preview.open('d5', 1, true);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp ~d5 [~d5]'], 'a second on the right replaces the right one only');
// A tab the side has for good is only brought to the front, never made
// transient; the existing preview stays behind it.
assert.equal(preview.open('a.cpp', 1, true), null);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp ~d5 [a.cpp]']);
// A file only on the other side gets a transient tab on this one, closed like any tab.
preview.open('b.cpp', 1, true);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp ~b.cpp [~b.cpp]']);
preview.close('b.cpp', 1);
assert.deepEqual(marked(preview), ['a.cpp ~d3 b.cpp [~d3]', 'a.cpp [a.cpp]']);
assert.equal(preview.groups[1].transient, null);

// Kept: an edit keeps its tabs on every side, a double click the one clicked,
// and opening it again to stay the one there.
preview.open('d3', 1, true);
assert.equal(preview.keep('d3'), true);
assert.deepEqual(marked(preview), ['a.cpp d3 b.cpp [d3]', 'a.cpp d3 [d3]'], 'an edit');
assert.equal(preview.keep('d3'), false, 'nothing left to keep');
preview.open('e1', 0, true);
preview.open('e1', 1, true);
preview.keep('e1', 1);
assert.deepEqual(marked(preview), ['a.cpp d3 b.cpp ~e1 [~e1]', 'a.cpp d3 e1 [e1]'], 'a double click');
preview.open('e1', 0);
assert.deepEqual(marked(preview), ['a.cpp d3 b.cpp e1 [e1]', 'a.cpp d3 e1 [e1]'], 'opened again to stay');
preview.activate('a.cpp', 0);
assert.deepEqual(marked(preview), ['a.cpp d3 b.cpp e1 [a.cpp]', 'a.cpp d3 e1 [e1]'], 'kept, it no longer closes when left');
// Opened to stay while a transient one is in front: the preview stays behind it.
preview.open('f1', 0, true);
assert.equal(preview.open('c.cpp', 0), null);
assert.deepEqual(marked(preview), ['a.cpp d3 b.cpp e1 ~f1 c.cpp [c.cpp]', 'a.cpp d3 e1 [e1]']);

// Dragged to the other side, it stays there, and leaves that side's preview available.
const moved = new EditorLayout();
moved.open('a.cpp');
moved.open('g1', 0, true);
moved.split('a.cpp', 0);
moved.open('g2', 1, true);
assert.deepEqual(marked(moved), ['a.cpp ~g1 [~g1]', 'a.cpp ~g2 [~g2]']);
assert.equal(moved.move('g1', 0, 1, 'g2'), null);
assert.deepEqual(marked(moved), ['a.cpp [a.cpp]', 'a.cpp g1 ~g2 [g1]'], 'dropped before the preview, it leaves the preview behind it');
assert.equal(moved.focused, 1);
// Split, both tabs stay.
moved.open('g3', 0, true);
moved.split('g3', 0);
assert.deepEqual(marked(moved), ['a.cpp g3 [g3]', 'a.cpp g1 ~g2 g3 [g3]']);
// Onto a side with a transient tab of the same file: the two become one, kept.
moved.open('g4', 0, true);
moved.open('g4', 1, true);
assert.equal(moved.move('g4', 0, 1), null);
assert.deepEqual(marked(moved), ['a.cpp g3 [g3]', 'a.cpp g1 g3 g4 [g4]']);
// Dragged onto the right half: a new side, where it stays.
['a.cpp', 'g1', 'g3', 'g4'].forEach((key) => moved.close(key, 1));
moved.open('g5', 0, true);
moved.move('g5', 0, 1);
assert.deepEqual(marked(moved), ['a.cpp g3 [g3]', 'g5 [g5]']);
// Renamed, it stays transient; its folder deleted, it is gone.
moved.open('src/h.cpp', 1, true);
moved.rename('src/h.cpp', 'src/i.cpp');
assert.deepEqual(marked(moved), ['a.cpp g3 [g3]', 'g5 ~src/i.cpp [~src/i.cpp]']);
moved.remove((key) => key.startsWith('src/'));
assert.deepEqual(marked(moved), ['a.cpp g3 [g3]', 'g5 [g5]']);
assert.equal(moved.groups[1].transient, null);

// Not kept for next time: in front instead, the tab closing it would have brought there.
const saved = new EditorLayout();
['a.cpp', 'b.cpp', 'c.cpp'].forEach((key) => saved.open(key));
saved.activate('a.cpp');
saved.open('d.cpp', 0, true);
saved.move('d.cpp', 0, 0, 'b.cpp');
saved.split('c.cpp', 0);
saved.open('e.cpp', 1, true);
assert.deepEqual(marked(saved), ['a.cpp ~d.cpp b.cpp c.cpp [~d.cpp]', 'c.cpp ~e.cpp [~e.cpp]']);
assert.deepEqual(saved.keptGroups(), [{ tabs: ['a.cpp', 'b.cpp', 'c.cpp'], active: 'b.cpp' }, { tabs: ['c.cpp'], active: 'c.cpp' }]);
saved.activate('c.cpp', 1);
saved.open('f.cpp', 0, true);
saved.move('f.cpp', 0, 0);
assert.deepEqual(saved.keptGroups(), [{ tabs: ['a.cpp', 'b.cpp', 'c.cpp'], active: 'c.cpp' }, { tabs: ['c.cpp'], active: 'c.cpp' }], 'the last one: the one before it');
saved.clear();
saved.open('g.cpp', 0, true);
assert.deepEqual(saved.keptGroups(), [{ tabs: [], active: null }], 'only a transient tab: nothing');

console.log('Editor layout tests passed.');
