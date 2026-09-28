import { getHostPlatform } from './host';
import { shortcutLabel } from './shortcuts';

export type Language = 'en' | 'tr';

const en = {
  menuFile: 'File', menuEdit: 'Edit', menuView: 'View', menuRun: 'Run', menuHelp: 'Help',
  openProject: 'Open Project', newProject: 'New Project', save: 'Save', build: 'Build', run: 'Run', stop: 'Stop',
  saveTitle: 'Save (Ctrl+S)', buildTitle: 'Build (Ctrl+Shift+B)', runTitle: 'Build and Run (F5)',
  stopTitle: 'Stop (Shift+F5)', settings: 'Settings', explorer: 'EXPLORER',
  buildRunControls: 'Build and run controls',
  newFile: 'New File', newFolder: 'New Folder', newCppClass: 'New C++ Class',
  newMenu: 'New', copy: 'Copy', paste: 'Paste', showIn: 'Show in',
  systemExplorer: 'System Explorer', commandPrompt: 'CMD',
  copied: 'Copied', pasted: 'Pasted', copyFailed: 'Could not copy item', showFailed: 'Could not open location',
  rename: 'Rename', delete: 'Move to Recycle Bin', deleteTitle: 'Move Selected Item to Recycle Bin',
  refresh: 'Refresh', projectPlaceholder: 'GLIST PROJECT', noFolder: 'No folder is open.',
  noFolderHint: 'Open an existing Glist project or create a new one.',
  openFolder: 'Open Folder', tagline: 'A focused development environment for Glist Engine.',
  output: 'OUTPUT', ready: 'Ready', clearOutput: 'Clear Output',
  closeExplorer: 'Close Explorer', closeOutput: 'Close Output',
  initialOutput: 'Glist Studio is ready. Open a project to get started.',
  cancel: 'Cancel', create: 'Create', close: 'Close', template: 'Template',
  projectName: 'Project name', language: 'Language', appearance: 'Appearance',
  importTheme: 'Import a Theme File...', removeTheme: 'Remove',
  themeImportFailed: 'This file is not a VS Code color theme.',
  languageHint: 'The interface language changes immediately.',
  themeHint: 'Themes color the whole studio. Color themes from VS Code (.json) can be imported.',
  undo: 'Undo', redo: 'Redo', find: 'Find', showExplorer: 'Show Explorer', hideExplorer: 'Hide Explorer',
  showOutput: 'Show Output', hideOutput: 'Hide Output', engineAbout: 'About Glist Engine',
  layout: 'Layout', zoom: 'Zoom', preferences: 'Preferences',
  zoomIn: 'Zoom In', zoomOut: 'Zoom Out', resetZoom: 'Reset Zoom',
  fileName: 'File name', folderName: 'Folder name', className: 'Class name', newName: 'New name',
  openedProject: 'Project', noCmake: 'CMakeLists.txt was not found in this folder.',
  fileCreated: 'File created', folderCreated: 'Folder created', classCreated: 'C++ class created',
  projectCreated: 'Project created', movedToTrash: 'Moved to Recycle Bin', renamed: 'Renamed',
  createFailed: 'Could not create item', deleteFailed: 'Could not delete item', renameFailed: 'Could not rename item',
  fileOpenFailed: 'Could not open file', projectOpenFailed: 'Could not open project', treeFailed: 'Could not load files', saveFailed: 'Save failed',
  saved: 'saved', buildSucceeded: 'Build succeeded', buildFailed: 'Build failed',
  running: 'Application running', exit: 'Exit',
  confirmProjectSwitch: 'You have unsaved files. Open another project?',
  confirmClose: 'has unsaved changes. Close anyway?',
  confirmDeleteFile: 'Move this file to the Recycle Bin?',
  confirmDeleteFolder: 'Move this folder and all its contents to the Recycle Bin?',
  confirmDirtyDelete: 'Unsaved changes in this item will be lost. Continue?',
  classLocation: 'Select a folder for the C++ class.',
  open: 'Open',
  readOnly: 'Read-only', switchSourceHeader: 'Switch Header/Source', clangdRunning: 'is running',
  renameUnavailable: 'This symbol cannot be renamed.',
  editOutsideProject: 'The change touches files outside the project and was not applied.',
} as const;

export type TranslationKey = keyof typeof en;

const tr: Record<TranslationKey, string> = {
  menuFile: 'Dosya', menuEdit: 'Düzen', menuView: 'Görünüm', menuRun: 'Çalıştır', menuHelp: 'Yardım',
  openProject: 'Proje Aç', newProject: 'Yeni Proje', save: 'Kaydet', build: 'Derle', run: 'Çalıştır', stop: 'Durdur',
  saveTitle: 'Kaydet (Ctrl+S)', buildTitle: 'Derle (Ctrl+Shift+B)', runTitle: 'Derle ve Çalıştır (F5)',
  stopTitle: 'Durdur (Shift+F5)', settings: 'Ayarlar', explorer: 'EXPLORER',
  buildRunControls: 'Derleme ve çalıştırma kontrolleri',
  newFile: 'Yeni Dosya', newFolder: 'Yeni Klasör', newCppClass: 'Yeni C++ Sınıfı',
  newMenu: 'Yeni', copy: 'Kopyala', paste: 'Yapıştır', showIn: 'Şurada Göster',
  systemExplorer: 'Sistem Gezgini', commandPrompt: 'CMD',
  copied: 'Kopyalandı', pasted: 'Yapıştırıldı', copyFailed: 'Öğe kopyalanamadı', showFailed: 'Konum açılamadı',
  rename: 'Yeniden Adlandır', delete: 'Geri Dönüşüm Kutusu’na Taşı', deleteTitle: 'Seçili Öğeyi Geri Dönüşüm Kutusu’na Taşı',
  refresh: 'Yenile', projectPlaceholder: 'GLIST PROJESİ', noFolder: 'Henüz bir klasör açılmadı.',
  noFolderHint: 'Mevcut bir Glist projesini açın veya yeni bir proje oluşturun.',
  openFolder: 'Klasör Aç', tagline: 'Glist Engine için odaklanmış geliştirme ortamı.',
  output: 'ÇIKTI', ready: 'Hazır', clearOutput: 'Çıktıyı Temizle',
  closeExplorer: 'Explorer’ı Kapat', closeOutput: 'Çıktıyı Kapat',
  initialOutput: 'Glist Studio hazır. Başlamak için bir proje açın.',
  cancel: 'İptal', create: 'Oluştur', close: 'Kapat', template: 'Şablon',
  projectName: 'Proje adı', language: 'Dil', appearance: 'Görünüm',
  importTheme: 'Tema Dosyası İçe Aktar...', removeTheme: 'Kaldır',
  themeImportFailed: 'Bu dosya bir VS Code renk teması değil.',
  languageHint: 'Arayüz dili hemen değişir.',
  themeHint: 'Temalar tüm stüdyoyu renklendirir. VS Code renk temaları (.json) içe aktarılabilir.',
  undo: 'Geri Al', redo: 'Yinele', find: 'Bul', showExplorer: 'Explorer’ı Göster', hideExplorer: 'Explorer’ı Gizle',
  showOutput: 'Çıktıyı Göster', hideOutput: 'Çıktıyı Gizle', engineAbout: 'Glist Engine Hakkında',
  layout: 'Yerleşim', zoom: 'Yakınlaştırma', preferences: 'Tercihler',
  zoomIn: 'Yakınlaştır', zoomOut: 'Uzaklaştır', resetZoom: 'Yakınlaştırmayı Sıfırla',
  fileName: 'Dosya adı', folderName: 'Klasör adı', className: 'Sınıf adı', newName: 'Yeni ad',
  openedProject: 'Proje', noCmake: 'Bu klasörde CMakeLists.txt bulunamadı.',
  fileCreated: 'Dosya oluşturuldu', folderCreated: 'Klasör oluşturuldu', classCreated: 'C++ sınıfı oluşturuldu',
  projectCreated: 'Proje oluşturuldu', movedToTrash: 'Geri Dönüşüm Kutusu’na taşındı', renamed: 'Yeniden adlandırıldı',
  createFailed: 'Öğe oluşturulamadı', deleteFailed: 'Öğe silinemedi', renameFailed: 'Öğe yeniden adlandırılamadı',
  fileOpenFailed: 'Dosya açılamadı', projectOpenFailed: 'Proje açılamadı', treeFailed: 'Dosyalar yüklenemedi', saveFailed: 'Kaydetme başarısız',
  saved: 'kaydedildi', buildSucceeded: 'Derleme başarılı', buildFailed: 'Derleme başarısız',
  running: 'Uygulama çalışıyor', exit: 'Çıkış',
  confirmProjectSwitch: 'Kaydedilmemiş dosyalar var. Başka proje açılsın mı?',
  confirmClose: 'kaydedilmedi. Yine de kapatılsın mı?',
  confirmDeleteFile: 'Bu dosya Geri Dönüşüm Kutusu’na taşınsın mı?',
  confirmDeleteFolder: 'Bu klasör ve içindekiler Geri Dönüşüm Kutusu’na taşınsın mı?',
  confirmDirtyDelete: 'Bu öğedeki kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?',
  classLocation: 'C++ sınıfı için bir klasör seçin.',
  open: 'Aç',
  readOnly: 'Salt okunur', switchSourceHeader: 'Başlık/Kaynak Dosyasına Geç', clangdRunning: 'çalışıyor',
  renameUnavailable: 'Bu sembol yeniden adlandırılamaz.',
  editOutsideProject: 'Değişiklik proje dışındaki dosyalara dokunuyor ve uygulanmadı.',
};

const dictionaries = { en, tr };

type Wording = Partial<Record<TranslationKey, string>>;

// Names the host gives its trash, file manager and terminal; the dictionaries
// above use the Windows ones.
const hostWording: Record<string, Record<Language, Wording>> = {
  darwin: {
    en: {
      delete: 'Move to Trash', deleteTitle: 'Move Selected Item to Trash', movedToTrash: 'Moved to Trash',
      confirmDeleteFile: 'Move this file to the Trash?',
      confirmDeleteFolder: 'Move this folder and all its contents to the Trash?',
      systemExplorer: 'Finder', commandPrompt: 'Terminal',
    },
    tr: {
      delete: 'Çöp Sepeti’ne Taşı', deleteTitle: 'Seçili Öğeyi Çöp Sepeti’ne Taşı', movedToTrash: 'Çöp Sepeti’ne taşındı',
      confirmDeleteFile: 'Bu dosya Çöp Sepeti’ne taşınsın mı?',
      confirmDeleteFolder: 'Bu klasör ve içindekiler Çöp Sepeti’ne taşınsın mı?',
      systemExplorer: 'Finder', commandPrompt: 'Terminal',
    },
  },
  linux: {
    en: {
      delete: 'Move to Trash', deleteTitle: 'Move Selected Item to Trash', movedToTrash: 'Moved to Trash',
      confirmDeleteFile: 'Move this file to the Trash?',
      confirmDeleteFolder: 'Move this folder and all its contents to the Trash?',
      systemExplorer: 'File Manager', commandPrompt: 'Terminal',
    },
    tr: {
      delete: 'Çöp Kutusu’na Taşı', deleteTitle: 'Seçili Öğeyi Çöp Kutusu’na Taşı', movedToTrash: 'Çöp Kutusu’na taşındı',
      confirmDeleteFile: 'Bu dosya Çöp Kutusu’na taşınsın mı?',
      confirmDeleteFolder: 'Bu klasör ve içindekiler Çöp Kutusu’na taşınsın mı?',
      systemExplorer: 'Dosya Yöneticisi', commandPrompt: 'Terminal',
    },
  },
};

export const savedLanguage = (): Language => {
  try { return window.localStorage.getItem('glist-studio-language') === 'tr' ? 'tr' : 'en'; }
  catch { return 'en'; }
};

let language: Language = savedLanguage();

export const getLanguage = (): Language => language;
export const t = (key: TranslationKey): string =>
  hostWording[getHostPlatform()]?.[language][key] ?? dictionaries[language][key];

export const applyLanguage = (next: Language): void => {
  language = next;
  try { window.localStorage.setItem('glist-studio-language', next); } catch { /* Storage may be unavailable. */ }
  document.documentElement.lang = next;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n as TranslationKey;
    if (key in en) node.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
    const key = node.dataset.i18nTitle as TranslationKey;
    if (key in en) node.title = shortcutLabel(t(key));
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((node) => {
    const key = node.dataset.i18nAriaLabel as TranslationKey;
    if (key in en) node.setAttribute('aria-label', t(key));
  });
  document.querySelectorAll('kbd').forEach((node) => { node.textContent = shortcutLabel(node.textContent ?? ''); });
};
