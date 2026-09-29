# Glist Studio

Glist Studio is a lightweight desktop IDE for Glist Engine projects, built with Electron and TypeScript.

![Glist Studio with a small Glist project open: the explorer, C++ code colored by clangd, and a finished build in the Output panel](docs/images/editor.png)

It expects the layout the Glist install scripts create: `C:\dev\glist` on Windows, with the toolchain in `zbin`, and `~/dev/glist` on macOS and Linux.

## Features

- Project explorer with file and folder operations, context menus, and copy/paste, and the engine and plugins the project uses listed below it, to browse and edit
- Tabbed C/C++ editor powered by Monaco, which also highlights CMake files
- C++ code intelligence from clangd: diagnostics, completion, hover, signature help, go to definition, references, rename, quick fixes, formatting, outline, and header/source switching (Alt+O)
- Save, build, run, and stop commands with live output, colored as the compiler colors it, where file locations open the file at that line
- A debugger: breakpoints, stepping, variables, the call stack, and values on hover, through lldb-dap or GDB
- A terminal next to the output, in the project folder, with the same tools on `PATH` as builds
- Coding agents (Claude Code, Codex, Gemini CLI, Antigravity) in an Agent tab, off until turned on, and installable into the Glist folder
- Git, off until turned on: a Commit view, changes shown as diffs in the editor area, a Git tab with the log and its graph, branches, remotes and stashes, changed lines and blame in the editor, help with conflicts, and the engine's and plugins' own repositories
- Automatic CMake source-list updates when files are created, renamed, or removed
- CMake configures again on its own when a CMake file changes, so code intelligence follows new files and plugins without a build
- C++ class generation with matching header and source files
- Project creation from the bundled GlistApp, GlistConsoleApp, and GlistGUIApp templates, into the `myglistapps` folder of the open project's workspace
- Open Project lists the projects in `myglistapps` and the ones opened before, most recently opened first, with a search box
- English and Turkish interface languages (English by default)
- Themes for the whole studio: Glist, Gruvbox, Solarized, Dracula, Nord, One Dark, Monokai and Tokyo Night, plus VS Code color themes imported from their `.json` files, and a choice of code and interface fonts
- A scale setting for the whole studio, up to 300% for projectors

## C++ code intelligence

Opening a project starts [clangd](https://clangd.llvm.org/). It is looked up on `PATH`; on Windows the Glist `clang64\bin` folder is searched first. Without clangd the editor still works, with syntax highlighting only.

clangd reads the compile flags from `_build/Release/compile_commands.json`, which the build writes. Until a project has been built once, clangd cannot find the engine headers; it restarts on its own after that first build. Definitions in GlistEngine and the plugins the project uses open for editing, as their files do from the explorer: neither builds on its own, so work on them happens from an app. The first change to one in a session says that every project shares it. Other files in the Glist folder, such as zbin's, open read-only, and a rename or fix that clangd offers only ever changes the project's own files.

## Configuring

When CMakeLists.txt or another CMake file the project uses changes, whether the project's, the engine's or a plugin's, CMake configures the project again a moment later, the way CLion reloads a CMake project.

- The files watched are the ones CMake itself read the last time it configured.
- Changes that come quickly after each other are configured once, and a save that changes nothing configures nothing.
- When the compile commands change, clangd restarts to read them; during a build, once the build is done. Adding a plugin to `PLUGINS` makes its headers known without a build.
- Configuring shows in Output. A failure says so in a message with the way to Output.
- It can be turned off in Settings, under Build.

A build folder remembers the project folder it was made for, and CMake will not use it for another. A project that was moved or copied since its last build gets a new build folder, so its first build takes longer.

## Debugging

Click to the left of a line number to put a breakpoint there, then press Debug (F6). The studio builds a Debug configuration into `_build/Debug`, starts the program under a debugger, and stops at the breakpoint with the line highlighted. The Run and Debug view shows the variables and the call stack; hovering a variable in the editor shows its value. Continue (F5), Step Over (F10), Step Into (F11) and Step Out (Shift+F11) sit in the toolbar while debugging, and Stop (Shift+F5) ends it.

![Paused at a breakpoint in update(): the variables of the ball being moved, the call stack, and the current line highlighted](docs/images/debugger.png)

The debugger is an external program that speaks the Debug Adapter Protocol:

- macOS: `lldb-dap` from Xcode or its command line tools, found through `xcrun`.
- Linux: `lldb-dap` from the LLVM packages (also under the older name `lldb-vscode`, often with a version suffix), or GDB 14 or newer.
- Windows: the Glist toolchain does not include a debugger yet. Install LLVM, which comes with `lldb-dap`, or GDB 14 or newer from MSYS2, and put it on `PATH`.

## Terminal

The Terminal tab beside Output runs a shell in the project folder: PowerShell on Windows, and your shell (`$SHELL`) on macOS and Linux. It has the environment builds have, so on Windows the Glist `clang`, `mingw32-make` and `cmake` from `zbin` work as typed. Ctrl+` shows and hides it, the + button starts a new one, and opening another project moves it there.

![The Terminal tab under the editor, with cmake, clang and ls run in the project folder](docs/images/terminal.png)

Copy and paste work as elsewhere: Cmd+C and Cmd+V on macOS; on Windows and Linux, Ctrl+C copies selected text and otherwise stops the running command, and Ctrl+V pastes. The studio's own shortcuts, such as F5 to run and Ctrl+S to save, keep working while the terminal has focus.

## Installing Glist from the studio

When Glist is not where its install scripts put it (`~/dev/glist`, or `C:\dev\glist` on Windows), the welcome screen and the Help menu offer to install it. That runs Glist Engine's own installer, the current script from [GlistEngine/InstallScripts](https://github.com/GlistEngine/InstallScripts), with its output in a dialog and a progress bar that follows the steps it reports. A password it needs is asked for by the system, not by the studio: the installer runs without a terminal, so sudo asks through `SUDO_ASKPASS`, which Glist Studio points at a macOS dialog, or on Linux at the desktop's password dialog (zenity, kdialog or ssh-askpass). Only on a Linux desktop without any of those is it typed into the dialog's terminal. It clones from GlistEngine's repositories without asking for a GitHub name, and skips the Eclipse setup the studio does not need.

## Agents

Settings, under Agents, lists the coding agents the studio knows: Claude Code, Codex, Gemini CLI and Antigravity. All are off until turned on. Turning one on adds an Agent tab beside Terminal, which runs it in the open project with the same tools on `PATH` as builds; with more than one on, the tab has a list to pick from.

The studio finds an agent installed from Settings, then the Gemini CLI in Glist's zbin (ready on Windows, and on macOS once zbin's `gemini.sh` has run), then one on `PATH`. Install puts Claude Code, Codex or Gemini CLI into the Glist folder, and changes nothing else on the computer:

- It downloads Node.js 24 from nodejs.org into `GlistStudio/runtime`, and checks it against the SHA-256 nodejs.org publishes.
- It installs the agent with that Node.js's npm into `GlistStudio/agents`, with npm's cache kept there and removed afterwards.
- An agent installed this way keeps its settings and sign-in in `GlistStudio/agents/config`.

Antigravity's own installer sets it up for the whole computer, so the studio only finds it.

## Git

Git is off until Show Git tools is turned on in Settings, under Git. While it is off the studio shows nothing of it and runs no git commands. It needs Git itself: Xcode's command line tools on macOS, the `git` package on Linux, and [Git for Windows](https://git-scm.com/) on Windows, where the Glist installer only uses a copy it removes afterwards.

![The Commit view with a changed file and a new one, the change shown as a diff in the editor area, and the Git tab with the log, its graph and a commit's details](docs/images/git.png)

Turned on, it works like it does in JetBrains IDEs:

- **The Commit view**, beside the explorer (Ctrl+K), lists what changed since the last commit: Changes, Unversioned Files and Merge Conflicts, each file with a checkbox. Only the checked files are committed, as they are on disk; files are saved first. Clicking a file shows its changes as a diff tab in the editor area, and double-clicking opens it. Below are the commit message, Amend the last commit, Commit, and Commit and Push. Rollback puts checked files back as they were in the last commit, and files that were new go to the trash. A project that is not a repository yet gets Create Git Repository, which also makes a `.gitignore` for `_build/`.
- **The Git tab**, under the editor, has the Log of every branch with its graph, a search by message or hash, and a branch filter. A commit shows its message and the files it changed, each opening its diff, and its menu copies its revision number, checks it out, makes a branch or tag there, cherry-picks or reverts it, or resets the branch to it. Beside the Log are Branches (local, remote and tags: check out, new branch, merge, rebase, rename, delete), Remotes (add, edit, remove, fetch), Stashes (stash with or without unversioned files, apply, apply and delete, see what one holds), and the Console with every git command the studio ran and what it printed.
- **In the editor**, a bar beside the line numbers marks lines added or changed since the last commit, and a small triangle marks lines removed. Clicking one shows the lines as they were, with Rollback for that change alone, which Undo takes back. Annotate with Git Blame, in the Git menu and the editor's menu, shows who last changed each line and when; clicking an annotation shows its commit in the Log. A file with conflicts has Keep Mine, Take Theirs and Keep Both above each one, and says when all are resolved.
- **The title bar** shows the branch and how many commits there are to push and to pull. Clicking it offers Update Project, Commit, Push, New Branch and the branches to switch to. The Git menu has all of this, and the explorer colors files by what changed: blue for changed, green for added, orange for unversioned, red for conflicts, and dimmed for ignored.

Update Project (Ctrl+T) brings in the remote's commits by merging, or by rebasing if Settings says so, and puts changes not committed yet aside while it runs; merging and rebasing a branch do the same. Push (Ctrl+Shift+K) lists the commits it sends, and a branch pushed for the first time follows the remote branch of its name from then on. Checking out a branch over local changes offers to stash them and bring them back. Get from Git, in the File menu and in Open Project, clones a repository into the projects folder and opens it. A conflict resolved with one click can be undone from the message that says so.

**The engine and plugins** a project is built with, GlistEngine and the plugins its CMakeLists.txt names, are repositories of their own, and the studio manages them too:

- The Git tab has a picker that shows any of them in the Log, Branches, Remotes and Stashes.
- The branch menu lists each with its branch and the commits it is ahead or behind.
- Their changes appear in the Commit view, each in a group of its own, closed and unchecked. Checked files are committed to their own repository with the same message; Amend only ever changes the project's last commit.
- Push offers each one that has commits to send, with a checkbox.

Update Engine and Plugins, in the Git menu and the branch menu, brings in their remotes' commits. It is separate from Update Project, because every project shares them. For the same reason, the studio asks before rolling back, checking out, merging, rebasing or resetting one. Their files can be edited like the project's, with their changed lines marked.

A remote that asks for a password is answered through the system, never through the studio: git and ssh ask a system dialog on macOS, and the desktop's password dialog on Linux (zenity, kdialog or ssh-askpass), through `GIT_ASKPASS` and `SSH_ASKPASS`. Git's own credential helper, such as the macOS keychain or Git Credential Manager on Windows, remembers it. GitHub takes a personal access token instead of the account password.

Commits are signed with the name and email git already has. Without them the first commit asks, offering the computer account's name, and Settings can change them; they are saved in git's global settings, for every project.

Ctrl+K, Ctrl+Shift+K and Ctrl+T (Cmd on macOS) are JetBrains' keys. While Git is on they take the place of the editor's own Ctrl+K key pairs and Ctrl+Shift+K (delete line), but not in the terminal, where they edit the command line.

## Glist Studio's folder

Glist Studio keeps everything of its own in the Glist folder, next to the engine and the projects: `~/dev/glist/GlistStudio` on macOS and Linux, `C:\dev\glist\GlistStudio` on Windows. Settings are in `data`, the projects opened recently in `recent-projects.json`, and agents installed from Settings in `agents` and `runtime`. Settings saved by an earlier version move there on first start.

## Themes

Settings shows every theme as a small preview; picking one recolors the interface and the editor at once. To add a theme made for VS Code, choose Import a Theme File and pick its `.json` (in a VS Code extension it sits under `themes/`). Its interface colors and code colors are translated, and it stays in the list until removed.

![Settings: the language, the fonts, and a preview card for each theme](docs/images/themes.png)

Under Fonts, the code font, its size and the interface font can be picked from a list or typed in, for any font installed on the computer.

Scale, at the top of Settings, makes the whole studio larger or smaller, from 50% up to 300% for a classroom projector. Ctrl + and Ctrl − (Cmd on macOS) do the same. While the scale is not 100%, the title bar shows it, and clicking it puts it back.

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
- `src/terminal.ts`: The Terminal and Agent tabs (xterm.js); the programs behind them run through node-pty in `src/studio.ts`
- `src/agents.ts` and `src/agent-settings.ts`: Finding and installing agents, and their rows in Settings
- `src/git-service.ts`: Runs git for the studio: the status, the history, branches, remotes and stashes, and every change, one at a time
- `src/git.ts`, `src/git-graph.ts`, `src/line-diff.ts` and `src/conflicts.ts`: Reading git's output, the log's graph, changed lines, and conflict markers
- `src/git-client.ts`, `src/git-commit-view.ts`, `src/git-panel.ts`, `src/git-editor.ts` and `src/git-dialogs.ts`: Git in the interface
- `src/notifications.ts` and `src/context-menu.ts`: Balloons for what finished in the background, and the menus of the Git views
- `src/icons.ts` and `src/file-icons.ts`: Interface icons (Codicons) and file icons (Seti); see `THIRD_PARTY_NOTICES.md`
- `src/renderer.ts`: Editor and interface behavior
- `src/index.html` and `src/index.css`: Interface structure and styling
- `src/localization.ts`: English and Turkish interface text
- `glistapp-template/`: Bundled new-project templates

Node.js access is disabled in the renderer. Filesystem and process actions go through the preload bridge.
