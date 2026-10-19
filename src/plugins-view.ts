import { updateCheckout, type CheckoutTarget, type CheckoutUpdateHooks } from './checkout-updates';
import { icon, type IconName } from './icons';
import { t } from './localization';
import { notify } from './notifications';

// The Plugins view in the side bar: GlistPlugins' plugins to install into
// glistplugins with one click, the installed ones to add to the project, and
// updates for those whose remotes include where they are published, as the
// engine's (checkout-updates.ts). Updates are also checked in the background
// and offered in a message, which runs the same steps. Clicking a plugin shows
// its README.

export interface PluginsHooks {
  hasProject(): boolean;
  // A plugin was added to or taken out of the project, or installed.
  projectChanged(): void;
  // Opens its README as a preview, or keeps it open.
  showReadme(plugin: GlistPlugin, transient: boolean): void;
  updates: CheckoutUpdateHooks;
}

// Where a copy of a plugin or the engine stands, in colors apart from its
// description: new commits to bring in, and a copy that is not as published,
// which is not updated; other parts plain.
export type StatePart = { text: string; kind?: 'update' | 'notice' | 'source' };
export const stateLine = (parts: StatePart[]): HTMLElement => {
  const line = document.createElement('div');
  line.className = 'plugin-state';
  parts.forEach((part, index) => {
    if (index > 0) line.append(' · ');
    const text = document.createElement('span');
    if (part.kind) text.className = `state-${part.kind}`;
    text.textContent = part.text;
    line.append(text);
  });
  return line;
};

// A plugin as something to update.
export const pluginTarget = ({ name, source = 'GlistPlugins' }: GlistPlugin): CheckoutTarget => ({
  name,
  source,
  run: (choice, resolve) => window.glistAPI.updatePlugin(name, choice, resolve),
});

export class PluginsView {
  private list: GlistPluginList | null = null;
  private busy = new Set<string>();
  // Loads of the list that say so, and update checks, under way: the top of the list tells which.
  private loading = 0;
  private checking = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly search: HTMLInputElement,
    private readonly refresh: HTMLButtonElement,
    private readonly activity: HTMLElement,
    private readonly hooks: PluginsHooks,
  ) {
    search.addEventListener('input', () => this.render());
    // Refresh asks GlistPlugins for its list again and each plugin's source for new commits.
    refresh.addEventListener('click', () => { void this.load(true).then(() => this.checkUpdates()); });
  }

  // The first list, which may come from GitHub, and one asked for with Refresh
  // say they are loading; the ones when the view is shown again are quick and quiet.
  async load(askGlistPlugins = false): Promise<void> {
    const told = askGlistPlugins || !this.list;
    if (told) {
      this.loading += 1;
      this.render();
    }
    try {
      this.list = await window.glistAPI.listPlugins(askGlistPlugins).catch((error: Error): GlistPluginList => ({ plugins: [], folder: '', gitFound: true, error: error.message }));
    } finally {
      if (told) this.loading -= 1;
    }
    this.render();
  }

  // Fetches installed plugins' new commits, and gives the ones to bring in.
  async checkUpdates(): Promise<GlistPlugin[]> {
    this.checking += 1;
    this.render();
    let outdated: GlistPlugin[];
    try {
      outdated = await window.glistAPI.checkPluginUpdates().catch((): GlistPlugin[] => []);
    } finally {
      this.checking -= 1;
    }
    await this.load();
    return outdated;
  }

  async updateAll(plugins: GlistPlugin[]): Promise<void> {
    for (const plugin of plugins) await this.run(plugin.name, () => updateCheckout(pluginTarget(plugin), this.hooks.updates, true));
  }

  private async run(name: string, task: () => Promise<unknown>): Promise<void> {
    this.busy.add(name);
    this.render();
    try {
      await task();
    } finally {
      this.busy.delete(name);
      await this.load();
      this.hooks.projectChanged();
    }
  }

  private async install(plugin: GlistPlugin): Promise<void> {
    await this.run(plugin.name, async () => {
      const result = await window.glistAPI.installPlugin(plugin.name).catch((error: Error): GlistPluginResult => ({ success: false, message: error.message }));
      notify(result.success
        ? { text: t('pluginInstalled').replace('{name}', plugin.name), kind: 'success' }
        : { text: t('pluginInstallFailed').replace('{name}', plugin.name), detail: result.message, kind: 'error' });
    });
  }

  // Adding or removing one changes CMakeLists.txt, which may be open: open
  // files are saved first, so nothing typed is lost, and read again after, so
  // the change shows.
  private async use(plugin: GlistPlugin, on: boolean): Promise<void> {
    await this.run(plugin.name, async () => {
      if (!(await this.hooks.updates.save())) return;
      const result = await window.glistAPI.usePlugin(plugin.name, on).catch((error: Error): GlistPluginResult => ({ success: false, message: error.message }));
      await this.hooks.updates.reload();
      if (!result.success) notify({ text: t('pluginUseFailed').replace('{name}', plugin.name), detail: result.message, kind: 'error' });
    });
  }

  private render(): void {
    const list = this.list;
    const outdated = list?.plugins.filter((plugin) => (plugin.behind ?? 0) > 0 && plugin.official && plugin.branch === plugin.defaultBranch) ?? [];
    this.activity.classList.toggle('has-updates', outdated.length > 0);
    const working = this.loading > 0 ? t('pluginsLoading') : this.checking > 0 ? t('pluginsChecking') : '';
    this.refresh.disabled = this.loading > 0;
    this.host.setAttribute('aria-busy', String(Boolean(working)));
    const nodes: HTMLElement[] = working ? [this.working(working)] : [];
    if (!list) {
      this.host.replaceChildren(...nodes);
      return;
    }
    const words = this.search.value.trim().toLowerCase();
    const shown = list.plugins.filter((plugin) => !words || `${plugin.name} ${plugin.description}`.toLowerCase().includes(words));
    if (!list.gitFound) nodes.push(this.message(t('pluginsNeedGit')));
    if (list.error) nodes.push(this.message(`${t('pluginsListFailed')}: ${list.error}`));
    const section = (title: string, plugins: GlistPlugin[]): void => {
      if (plugins.length === 0) return;
      const heading = document.createElement('div');
      heading.className = 'plugins-heading';
      heading.textContent = title;
      nodes.push(heading, ...plugins.map((plugin) => this.row(plugin, list.gitFound)));
    };
    section(t('pluginsInstalled'), shown.filter((plugin) => plugin.installed));
    section(t('pluginsAvailable'), shown.filter((plugin) => !plugin.installed));
    this.host.replaceChildren(...nodes);
  }

  private working(text: string): HTMLElement {
    const line = document.createElement('p');
    line.className = 'plugins-loading';
    line.setAttribute('role', 'status');
    line.append(icon('refresh'), Object.assign(document.createElement('span'), { textContent: text }));
    return line;
  }

  private message(text: string): HTMLElement {
    const paragraph = document.createElement('p');
    paragraph.className = 'plugins-message';
    paragraph.textContent = text;
    return paragraph;
  }

  // The name with the plugin's buttons at its right, each an icon and a word:
  // Install, Update, and Add to the project or, once added, Remove from it.
  // They move under the name when both do not fit beside it.
  private row(plugin: GlistPlugin, gitFound: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'plugin-row';
    // Anywhere but its buttons, one click previews its README and a double
    // click keeps it open. Keyboard activation opens it to stay.
    row.tabIndex = 0;
    row.title = t('readmeShow');
    row.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.plugin-action')) return;
      this.hooks.showReadme(plugin, true);
    });
    row.addEventListener('dblclick', (event) => {
      if (event.target instanceof Element && event.target.closest('.plugin-action')) return;
      this.hooks.showReadme(plugin, false);
    });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      this.hooks.showReadme(plugin, false);
    });
    const busy = this.busy.has(plugin.name);
    const button = (iconName: IconName, label: string, title: string, className: string, run: () => void): HTMLButtonElement => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = `plugin-action ${className}`;
      node.title = title;
      const text = document.createElement('span');
      text.textContent = label;
      node.append(icon(iconName), text);
      node.addEventListener('click', run);
      return node;
    };
    const header = document.createElement('div');
    header.className = 'plugin-header';
    const name = document.createElement('span');
    name.className = 'plugin-name';
    name.textContent = plugin.name;
    name.title = plugin.name;
    const actions = document.createElement('span');
    actions.className = 'plugin-actions';
    header.append(name, actions);
    const source = plugin.source ?? 'GlistPlugins';
    const updatable = plugin.installed && plugin.official && plugin.branch === plugin.defaultBranch && (plugin.behind ?? 0) > 0;
    if (busy) {
      const working = document.createElement('span');
      working.className = 'plugin-working';
      working.textContent = t('pluginWorking');
      actions.append(working);
    } else if (!plugin.installed) {
      if (gitFound && plugin.url) {
        actions.append(button('cloud-download', t('installPlugin'), t('installPluginTitle'), '', () => { void this.install(plugin); }));
      }
    } else {
      if (updatable) {
        actions.append(button('sync', t('updatePlugin'), t('updatePluginTitle').replace('{source}', source), 'primary', () => {
          void this.run(plugin.name, () => updateCheckout(pluginTarget(plugin), this.hooks.updates));
        }));
      }
      if (this.hooks.hasProject()) {
        if (plugin.used) {
          // Added; pointing at it shows what a click does.
          const added = button('check', t('pluginAdded'), t('removeFromProject'), 'added', () => { void this.use(plugin, false); });
          // Only on a change: pressing the button focuses it, and replacing what
          // was pressed before the button is let go loses the click.
          let showing = false;
          const swap = (hover: boolean): void => {
            if (hover === showing) return;
            showing = hover;
            added.replaceChildren(icon(hover ? 'close' : 'check'), Object.assign(document.createElement('span'), { textContent: hover ? t('pluginRemove') : t('pluginAdded') }));
          };
          added.addEventListener('pointerenter', () => swap(true));
          added.addEventListener('pointerleave', () => swap(false));
          added.addEventListener('focus', () => swap(true));
          added.addEventListener('blur', () => swap(false));
          actions.append(added);
        } else {
          actions.append(button('add', t('pluginAdd'), t('addToProject'), '', () => { void this.use(plugin, true); }));
        }
      }
    }
    row.append(header);
    if (plugin.description) {
      const description = document.createElement('div');
      description.className = 'plugin-description';
      description.textContent = plugin.description;
      description.title = plugin.description;
      row.append(description);
    }
    const parts = this.state(plugin);
    if (parts.length > 0) row.append(stateLine(parts));
    return row;
  }

  // Where an installed plugin stands, or where one listed from elsewhere comes from.
  private state(plugin: GlistPlugin): StatePart[] {
    const source = plugin.source ?? 'GlistPlugins';
    if (!plugin.installed) return source.includes('/') ? [{ text: t('pluginFrom').replace('{source}', source), kind: 'source' }] : [];
    const parts: StatePart[] = [];
    if (!plugin.official) parts.push({ text: t('pluginNotOfficial').replace('{source}', source), kind: 'notice' });
    else if (plugin.branch !== plugin.defaultBranch) parts.push({ text: t('pluginOtherBranch').replace('{branch}', plugin.branch ?? 'HEAD'), kind: 'notice' });
    else if ((plugin.behind ?? 0) > 0) parts.push({ text: t('pluginBehind').replace('{count}', String(plugin.behind)).replace('{source}', source), kind: 'update' });
    if ((plugin.changed ?? 0) > 0 || (plugin.ahead ?? 0) > 0) parts.push({ text: t('pluginChanged'), kind: 'notice' });
    return parts;
  }
}
