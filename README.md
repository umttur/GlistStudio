# Glist Studio

Glist Studio is a lightweight desktop IDE for Glist Engine projects, built with Electron and TypeScript.

It expects the layout the Glist install scripts create: `C:\dev\glist` on Windows, with the toolchain in `zbin`, and `~/dev/glist` on macOS and Linux.

## Features

- Project explorer with file and folder operations, context menus, and copy/paste
- Tabbed C/C++ editor powered by Monaco, which also highlights CMake files
- C++ code intelligence from clangd: diagnostics, completion, hover, signature help, go to definition, references, rename, quick fixes, formatting, outline, and header/source switching (Alt+O)
- Save, build, run, and stop commands with live output, colored as the compiler colors it, where file locations open the file at that line
- A debugger: breakpoints, stepping, variables, the call stack, and values on hover, through lldb-dap or GDB
- A terminal next to the output, in the project folder, with the same tools on `PATH` as builds
- Automatic CMake source-list updates when files are created, renamed, or removed
- C++ class generation with matching header and source files
- Project creation from the bundled GlistApp, GlistConsoleApp, and GlistGUIApp templates, into the `myglistapps` folder of the open project's workspace
- English and Turkish interface languages (English by default)
- Themes for the whole studio: Glist, Gruvbox, Solarized, Dracula, Nord, One Dark, Monokai and Tokyo Night, plus VS Code color themes imported from their `.json` files, and a choice of code and interface fonts

## C++ code intelligence

Opening a project starts [clangd](https://clangd.llvm.org/). It is looked up on `PATH`; on Windows the Glist `clang64\bin` folder is searched first. Without clangd the editor still works, with syntax highlighting only.

clangd reads the compile flags from `_build/Release/compile_commands.json`, which the build writes. Until a project has been built once, clangd cannot find the engine headers; it restarts on its own after that first build. Definitions in GlistEngine and its plugins open read-only.

## Debugging

Click to the left of a line number to put a breakpoint there, then press Debug (F6). The studio builds a Debug configuration into `_build/Debug`, starts the program under a debugger, and stops at the breakpoint with the line highlighted. The Run and Debug view shows the variables and the call stack; hovering a variable in the editor shows its value. Continue (F5), Step Over (F10), Step Into (F11) and Step Out (Shift+F11) sit in the toolbar while debugging, and Stop (Shift+F5) ends it.

The debugger is an external program that speaks the Debug Adapter Protocol:

- macOS: `lldb-dap` from Xcode or its command line tools, found through `xcrun`.
- Linux: `lldb-dap` from the LLVM packages (also under the older name `lldb-vscode`, often with a version suffix), or GDB 14 or newer.
- Windows: the Glist toolchain does not include a debugger yet. Install LLVM, which comes with `lldb-dap`, or GDB 14 or newer from MSYS2, and put it on `PATH`.

## Terminal

The Terminal tab beside Output runs a shell in the project folder: PowerShell on Windows, and your shell (`$SHELL`) on macOS and Linux. It has the environment builds have, so on Windows the Glist `clang`, `mingw32-make` and `cmake` from `zbin` work as typed. Ctrl+` shows and hides it, the + button starts a new one, and opening another project moves it there.

Copy and paste work as elsewhere: Cmd+C and Cmd+V on macOS; on Windows and Linux, Ctrl+C copies selected text and otherwise stops the running command, and Ctrl+V pastes. The studio's own shortcuts, such as F5 to run and Ctrl+S to save, keep working while the terminal has focus.

## Themes

Settings shows every theme as a small preview; picking one recolors the interface and the editor at once. To add a theme made for VS Code, choose Import a Theme File and pick its `.json` (in a VS Code extension it sits under `themes/`). Its interface colors and code colors are translated, and it stays in the list until removed.

Under Fonts, the code font, its size and the interface font can be picked from a list or typed in, for any font installed on the computer.

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
- `src/message-process.ts`: Runs clangd and debug adapters and frames their JSON messages
- `src/clangd.ts`: The language client that feeds Monaco from clangd
- `src/web/` and `scripts/web.ts`: Browser version of the API and the server behind `npm run web`
- `src/themes.ts` and `src/appearance.ts`: Built-in themes, VS Code theme import, and the theme picker
- `src/debug-adapters.ts` and `src/debugger.ts`: Finding a debug adapter, and the debugger client and its view
- `src/cmake-language.ts`: CMake syntax highlighting
- `src/output-format.ts`: Colors and file links in the Output panel
- `src/fonts.ts`: Font settings
- `src/terminal.ts`: The terminal tab (xterm.js); the shell behind it runs through node-pty in `src/studio.ts`
- `src/icons.ts` and `src/file-icons.ts`: Interface icons (Codicons) and file icons (Seti); see `THIRD_PARTY_NOTICES.md`
- `src/renderer.ts`: Editor and interface behavior
- `src/index.html` and `src/index.css`: Interface structure and styling
- `src/localization.ts`: English and Turkish interface text
- `glistapp-template/`: Bundled new-project templates

Node.js access is disabled in the renderer. Filesystem and process actions go through the preload bridge.
