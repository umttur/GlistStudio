// Which tabs each side of the editor area has, in order, and which one is in
// front, as VS Code's editor groups: the same file can have a tab on both
// sides, and stays open while any tab shows it. No DOM and no Monaco here, so
// it can be tested on its own; the renderer draws what it describes.

export interface EditorGroupState {
  tabs: string[];
  active: string | null;
  // The side's transient tab, as IntelliJ's and VS Code's preview tabs: a
  // file or a diff only being looked at. It stays until another preview takes
  // its place or the user closes it, unless it is kept first. One per side at
  // most.
  transient: string | null;
}

// Side by side at most, left and right.
export const maxGroups = 2;

const emptyGroup = (): EditorGroupState => ({ tabs: [], active: null, transient: null });

export class EditorLayout {
  groups: EditorGroupState[] = [emptyGroup()];
  // The group the keyboard and commands act on.
  focused = 0;

  get focusedGroup(): EditorGroupState {
    return this.groups[this.focused];
  }

  // The tab in front of the focused group.
  get activeKey(): string | null {
    return this.focusedGroup.active;
  }

  isOpen(key: string): boolean {
    return this.groups.some((group) => group.tabs.includes(key));
  }

  isTransient(key: string, group: number): boolean {
    return this.groups[group]?.transient === key;
  }

  groupsWith(key: string): number[] {
    return this.groups.flatMap((group, index) => (group.tabs.includes(key) ? [index] : []));
  }

  // Every tab's key, each once, in group order.
  keys(): string[] {
    return [...new Set(this.groups.flatMap((group) => group.tabs))];
  }

  focus(group: number): void {
    if (this.groups[group]) this.focused = group;
  }

  // Gives a group a tab, at the end, without bringing it to the front. A
  // transient one takes the place of the group's transient tab, in front if
  // that was, and the key of the one it closed is returned. A tab the group
  // has already stays as it is.
  add(key: string, group = this.focused, transient = false): string | null {
    const target = this.groups[group];
    if (!target || target.tabs.includes(key)) return null;
    if (!transient) {
      target.tabs.push(key);
      return null;
    }
    const replaced = target.transient;
    target.transient = key;
    if (replaced === null) {
      target.tabs.push(key);
      return null;
    }
    target.tabs[target.tabs.indexOf(replaced)] = key;
    if (target.active === replaced) target.active = key;
    return replaced;
  }

  // Brings a tab to the front of a group, adding it there first if need be,
  // and focuses the group. A preview behind it remains available until the
  // next preview replaces it or the user closes it.
  activate(key: string, group = this.focused): string | null {
    const target = this.groups[group];
    if (!target) return null;
    this.add(key, group);
    target.active = key;
    this.focused = group;
    return null;
  }

  // Opens a tab in front of a group: transient, or to stay, which a transient
  // tab of it there then does too. One the group has for good is only brought
  // to the front, never made transient. Returns the key of a preview replaced
  // by another preview.
  open(key: string, group = this.focused, transient = false): string | null {
    const replaced = this.add(key, group, transient);
    const left = this.activate(key, group);
    if (!transient) this.keep(key, group);
    return replaced ?? left;
  }

  // A transient tab becomes one that stays: in one group, or in every group
  // when none is given, as an edit to its file does. True if any changed.
  keep(key: string, group?: number): boolean {
    let changed = false;
    this.groups.forEach((each, index) => {
      if (each.transient === key && (group === undefined || group === index)) {
        each.transient = null;
        changed = true;
      }
    });
    return changed;
  }

  // Takes a tab out of a group. The tab that took its place comes to the
  // front, and a group left empty beside another goes. Whether any tab still
  // shows the key is for the caller to ask, with isOpen.
  close(key: string, group = this.focused): void {
    const target = this.groups[group];
    const index = target?.tabs.indexOf(key) ?? -1;
    if (!target || index < 0) return;
    target.tabs.splice(index, 1);
    if (target.transient === key) target.transient = null;
    if (target.active === key) target.active = target.tabs[Math.min(index, target.tabs.length - 1)] ?? null;
    this.dropEmpty();
  }

  // Moves a tab within its group or to another one, before a tab there or at
  // its end. A group one past the last is a new one to the right. Moved to
  // another group, the tab stays there for good and comes to the front.
  move(key: string, from: number, to: number, before?: string): string | null {
    const source = this.groups[from];
    if (!source?.tabs.includes(key) || to > this.groups.length || to >= maxGroups) return null;
    if (to === this.groups.length) this.groups.push(emptyGroup());
    const target = this.groups[to];
    if (from !== to && target.tabs.includes(key)) {
      // Already there: that tab takes the moved one's place.
      target.tabs.splice(target.tabs.indexOf(key), 1);
    }
    const sourceIndex = source.tabs.indexOf(key);
    source.tabs.splice(sourceIndex, 1);
    if (from !== to && source.active === key) source.active = source.tabs[Math.min(sourceIndex, source.tabs.length - 1)] ?? null;
    if (from !== to) {
      if (source.transient === key) source.transient = null;
      if (target.transient === key) target.transient = null;
    }
    const at = before && before !== key ? target.tabs.indexOf(before) : -1;
    target.tabs.splice(at < 0 ? target.tabs.length : at, 0, key);
    // Moved to another group, it comes to the front there; reordered, nothing else changes.
    if (from !== to) {
      target.active = key;
      this.focused = to;
    }
    this.dropEmpty();
    return null;
  }

  // Opens a tab of the same file in the group beside, as Split Right does,
  // making that group if there is only one. Both tabs stay for good.
  split(key: string, from = this.focused): string | null {
    if (!this.groups[from]?.tabs.includes(key)) return null;
    const to = from + 1 < maxGroups ? from + 1 : from - 1;
    if (to === this.groups.length) this.groups.push(emptyGroup());
    this.keep(key, from);
    return this.open(key, to);
  }

  // A file that moved on disk keeps its tabs' places.
  rename(from: string, to: string): void {
    this.groups.forEach((group) => {
      group.tabs = group.tabs.map((key) => (key === from ? to : key));
      if (group.active === from) group.active = to;
      if (group.transient === from) group.transient = to;
    });
  }

  // Closes every tab whose key matches, such as the files in a deleted folder.
  // A group whose tab in front went shows its last tab instead.
  remove(matches: (key: string) => boolean): void {
    this.groups.forEach((group) => {
      group.tabs = group.tabs.filter((key) => !matches(key));
      if (group.active !== null && matches(group.active)) group.active = group.tabs.at(-1) ?? null;
      if (group.transient !== null && matches(group.transient)) group.transient = null;
    });
    this.dropEmpty();
  }

  // The tabs to open again next time, which transient ones are not; in front
  // instead of one, the tab closing it would have brought there.
  keptGroups(): Array<{ tabs: string[]; active: string | null }> {
    return this.groups.map((group) => {
      const tabs = group.tabs.filter((key) => key !== group.transient);
      if (group.active === null || group.active !== group.transient) return { tabs, active: group.active };
      return { tabs, active: tabs[Math.min(group.tabs.indexOf(group.active), tabs.length - 1)] ?? null };
    });
  }

  clear(): void {
    this.groups = [emptyGroup()];
    this.focused = 0;
  }

  private dropEmpty(): void {
    if (this.groups.length < 2) return;
    const focusedGroup = this.groups[this.focused];
    this.groups = this.groups.filter((group) => group.tabs.length > 0);
    if (this.groups.length === 0) this.groups = [emptyGroup()];
    const kept = this.groups.indexOf(focusedGroup);
    this.focused = kept >= 0 ? kept : Math.min(this.focused, this.groups.length - 1);
  }
}
