# Glist Studio

Glist Studio is a lightweight desktop IDE for Glist Engine projects, built with Electron and TypeScript.

It expects the layout the Glist install scripts create: `C:\dev\glist` on Windows, with the toolchain in `zbin`, and `~/dev/glist` on macOS and Linux.

## Features

- Project explorer with file and folder operations, context menus, and copy/paste
- Tabbed C/C++ editor powered by Monaco
- C++ code intelligence from clangd: diagnostics, completion, hover, signature help, go to definition, references, rename, quick fixes, formatting, outline, and header/source switching (Alt+O)
- Save, build, run, and stop commands with live output
- Automatic CMake source-list updates when files are created, renamed, or removed
- C++ class generation with matching header and source files
- Project creation from the bundled GlistApp, GlistConsoleApp, and GlistGUIApp templates, into the `myglistapps` folder of the open project's workspace
- English and Turkish interface languages (English by default)
- Themes for the whole studio: Glist, Gruvbox, Solarized, Dracula, Nord, One Dark, Monokai and Tokyo Night, plus VS Code color themes imported from their `.json` files

## C++ code intelligence

Opening a project starts [clangd](https://clangd.llvm.org/). It is looked up on `PATH`; on Windows the Glist `clang64\bin` folder is searched first. Without clangd the editor still works, with syntax highlighting only.

clangd reads the compile flags from `_build/Release/compile_commands.json`, which the build writes. Until a project has been built once, clangd cannot find the engine headers; it restarts on its own after that first build. Definitions in GlistEngine and its plugins open read-only.

## Themes

Settings shows every theme as a small preview; picking one recolors the interface and the editor at once. To add a theme made for VS Code, choose Import a Theme File and pick its `.json` (in a VS Code extension it sits under `themes/`). Its interface colors and code colors are translated, and it stays in the list until removed.

## Development

Install dependencies and start the IDE:

```powershell
npm ci
npm start
```

Run the checks:

```powershell
npm test
npm run lint
npx tsc --noEmit
```

Use the IDE from a browser, for example on another machine:

```powershell
npm run web
```

This builds the renderer as a web page, runs the same backend in Node, and prints a link with an access token. The server listens on `127.0.0.1:8787`; reach it from elsewhere through a tunnel or reverse proxy. Anyone with the link can build and run code on the host, so share it accordingly. Open Project asks for a folder path on the host, and showing items in the system explorer is not available. Settings come from environment variables:

- `GLIST_STUDIO_PORT`: port to listen on
- `GLIST_STUDIO_PROJECTS`: the `myglistapps` folder to use while no project is open
- `GLIST_STUDIO_TOKEN`: a fixed access token instead of a new one per run

Build the installers for the machine you are on; `.github/workflows/release.yml` has the exact command for each platform:

```powershell
npm run make
```

## Installing

Each release carries a universal `.dmg` for macOS, a setup `.exe` for Windows on x64 and arm64, and an AppImage for Linux on x86_64 and aarch64. The builds are not signed yet, so each system asks once:

- macOS: right-click the app and choose Open, or run `xattr -dr com.apple.quarantine "/Applications/Glist Studio.app"`.
- Windows: SmartScreen shows "Windows protected your PC"; choose More info, then Run anyway.
- Linux: make the AppImage executable (`chmod +x`) and run it. It runs natively on Wayland when the session sets `XDG_SESSION_TYPE=wayland`, as Hyprland does; elsewhere pass `--ozone-platform=wayland`. On tiling compositors such as Hyprland, sway and i3 the window has no buttons of its own.

## Releasing

Pushing a tag such as `v0.2.0` runs `.github/workflows/release.yml`, which builds every installer with the version taken from the tag and drafts a GitHub release carrying them. Check the draft and publish it. The workflow can also be started by hand from the Actions tab, which builds without releasing.

## Project layout

- `src/index.ts`: Electron main process with the window, dialogs, and IPC
- `src/studio.ts`: Filesystem access and build commands, independent of Electron
- `src/api.ts`: The renderer API and the IPC channel for each call
- `src/preload.ts`: Restricted bridge between the renderer and main process
- `src/clangd-process.ts` and `src/clangd.ts`: clangd process and the language client that feeds Monaco
- `src/web/` and `scripts/web.ts`: Browser version of the API and the server behind `npm run web`
- `src/themes.ts` and `src/appearance.ts`: Built-in themes, VS Code theme import, and the theme picker
- `src/renderer.ts`: Editor and interface behavior
- `src/index.html` and `src/index.css`: Interface structure and styling
- `src/localization.ts`: English and Turkish interface text
- `glistapp-template/`: Bundled new-project templates

Node.js access is disabled in the renderer. Filesystem and process actions go through the preload bridge.
