import add from '@vscode/codicons/src/icons/add.svg';
import chevronRight from '@vscode/codicons/src/icons/chevron-right.svg';
import circleFilled from '@vscode/codicons/src/icons/circle-filled.svg';
import clearAll from '@vscode/codicons/src/icons/clear-all.svg';
import close from '@vscode/codicons/src/icons/close.svg';
import debugAlt from '@vscode/codicons/src/icons/debug-alt.svg';
import debugContinue from '@vscode/codicons/src/icons/debug-continue.svg';
import debugPause from '@vscode/codicons/src/icons/debug-pause.svg';
import debugStepInto from '@vscode/codicons/src/icons/debug-step-into.svg';
import debugStepOut from '@vscode/codicons/src/icons/debug-step-out.svg';
import debugStepOver from '@vscode/codicons/src/icons/debug-step-over.svg';
import debugStop from '@vscode/codicons/src/icons/debug-stop.svg';
import files from '@vscode/codicons/src/icons/files.svg';
import folder from '@vscode/codicons/src/icons/folder.svg';
import folderOpened from '@vscode/codicons/src/icons/folder-opened.svg';
import newFile from '@vscode/codicons/src/icons/new-file.svg';
import newFolder from '@vscode/codicons/src/icons/new-folder.svg';
import play from '@vscode/codicons/src/icons/play.svg';
import refresh from '@vscode/codicons/src/icons/refresh.svg';
import save from '@vscode/codicons/src/icons/save.svg';
import settingsGear from '@vscode/codicons/src/icons/settings-gear.svg';
import tools from '@vscode/codicons/src/icons/tools.svg';
import trash from '@vscode/codicons/src/icons/trash.svg';

// Interface icons: Codicons, the set VS Code uses (CC BY 4.0, see THIRD_PARTY_NOTICES.md).
// They are inline SVG, so they take the color of the text around them.
const icons = {
  add,
  'chevron-right': chevronRight,
  'circle-filled': circleFilled,
  'clear-all': clearAll,
  close,
  'debug-alt': debugAlt,
  'debug-continue': debugContinue,
  'debug-pause': debugPause,
  'debug-step-into': debugStepInto,
  'debug-step-out': debugStepOut,
  'debug-step-over': debugStepOver,
  'debug-stop': debugStop,
  files,
  folder,
  'folder-opened': folderOpened,
  'new-file': newFile,
  'new-folder': newFolder,
  play,
  refresh,
  save,
  'settings-gear': settingsGear,
  tools,
  trash,
};

export type IconName = keyof typeof icons;

export const icon = (name: IconName): SVGSVGElement => {
  const template = document.createElement('template');
  template.innerHTML = icons[name];
  const svg = template.content.firstElementChild as SVGSVGElement;
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
};

// The page marks where icons go with <i data-icon="name"></i>.
export const placeIcons = (root: ParentNode = document): void => {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((placeholder) => {
    const name = placeholder.dataset.icon as IconName;
    if (name in icons) placeholder.replaceWith(icon(name));
  });
};
