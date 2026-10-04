import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGitService, credentialListener, windowsAskpassScript } from '../src/git-service.ts';
import { createHostProtection, githubRepository, matchesBranch, protectionFrom } from '../src/git-protection.ts';
import { githubCommitPage, readRepositoryHead } from '../src/repository-head.ts';
import { toolLanguage } from '../src/tool-language.ts';

// Windows's askpass: sh hands PowerShell the question and the form, encoded, with
// MSYS's path conversion off. A stand-in powershell.exe says what it was given.
{
  const folder = mkdtempSync(path.join(tmpdir(), 'glist-askpass-'));
  try {
    const script = path.join(folder, 'askpass.sh');
    writeFileSync(script, windowsAskpassScript({ askpass: 'Git needs a password.', askOk: 'Tamam', askCancel: "L'annuler" }), { mode: 0o700 });
    writeFileSync(path.join(folder, 'powershell.exe'), '#!/bin/sh\nprintf "%s\\n" "$GLIST_STUDIO_PROMPT" "$MSYS2_ARG_CONV_EXCL" "$@"\n', { mode: 0o700 });
    const question = "Enter passphrase for key '/c/Users/Ada Lovelace/.ssh/id_ed25519': ";
    const given = execFileSync('sh', [script, question], { encoding: 'utf8', env: { ...process.env, PATH: `${folder}${path.delimiter}${process.env.PATH}` } }).split('\n');
    assert.equal(given[0], question, 'the question, spaces and quotes as they were');
    assert.equal(given[1], '*');
    assert.deepEqual(given.slice(2, 7), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand']);
    const form = Buffer.from(given[7], 'base64').toString('utf16le');
    assert.match(form, /\$box\.UseSystemPasswordChar = \$prompt -match 'assword\|assphrase\|PIN'/);
    assert.match(form, /\$ok\.Text = 'Tamam'/);
    assert.match(form, /\$cancel\.Text = 'L''annuler'/, 'a quote in a label is doubled for PowerShell');
    assert.match(form, /\[Console\]::Out\.Write\(\$box\.Text\)\n$/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// Protected branches: names and patterns, GitHub addresses, and asking GitHub.
assert.equal(matchesBranch('main', ['main', 'master']), true);
assert.equal(matchesBranch('release/1.2', ['release/*']), true);
assert.equal(matchesBranch('mainline', ['main']), false);
assert.equal(matchesBranch('a.b', ['a*b']), true);
assert.equal(matchesBranch('axb', ['a.b']), false, 'a dot is a dot, not any character');
for (const address of ['https://github.com/owner/repo.git', 'https://user@github.com/owner/repo', 'git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git']) {
  assert.equal(githubRepository(address), 'owner/repo', address);
}
assert.equal(githubRepository('https://gitlab.com/owner/repo.git'), null);
assert.equal(githubRepository('/local/remote.git'), null);
assert.deepEqual(protectionFrom(null), { on: true, branches: ['main', 'master'] });
assert.deepEqual(protectionFrom({ on: false, branches: [' dev ', '', 3] }), { on: false, branches: ['dev'] });
{
  const asked = [];
  const host = http.createServer((request, response) => {
    asked.push(request.url);
    const body = request.url.startsWith('/repos/owner/repo/') ? [{ name: 'main' }, { name: 'stable' }] : { message: 'Not Found' };
    response.writeHead(request.url.startsWith('/repos/owner/repo/') ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => { host.listen(0, '127.0.0.1', resolve); });
  let changes = 0;
  const lookup = createHostProtection(`http://127.0.0.1:${host.address().port}`, () => { changes += 1; });
  assert.deepEqual(await lookup('git@github.com:owner/repo.git'), [], 'not waited for, it is asked in the background');
  assert.deepEqual(await lookup('git@github.com:owner/repo.git', true), ['main', 'stable']);
  assert.equal(changes, 1, 'the views are told once it is known');
  assert.deepEqual(await lookup('https://github.com/owner/repo'), ['main', 'stable']);
  assert.equal(asked.length, 1, 'asked once, then remembered');
  assert.equal(asked[0], '/repos/owner/repo/branches?protected=true&per_page=100');
  assert.deepEqual(await lookup('https://github.com/owner/private', true), [], 'a repository GitHub will not describe has none');
  assert.deepEqual(await lookup('/local/remote.git', true), []);
  host.close();
}

// The Git service against a project made for the test and a remote beside it.
// Run with jiti, which resolves the service's own imports.
// The long name of the temp folder: Windows's tmpdir may be an 8.3 short one (RUNNER~1), and git answers with the long.
const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'glist-git-service-')));
// Global settings, such as the identity Settings writes, stay in the test's
// folder, and git makes up no name or email of its own.
Object.assign(process.env, { HOME: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1' });
['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'].forEach((key) => delete process.env[key]);
writeFileSync(path.join(root, '.gitconfig'), '[user]\n\tuseConfigOnly = true\n');
const projects = path.join(root, 'projects');
const project = path.join(projects, 'MyApp');
const trash = path.join(root, 'trash');
mkdirSync(project, { recursive: true });
mkdirSync(trash);
const write = (file, text) => {
  mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  writeFileSync(path.join(project, file), text);
};
const read = (file) => readFileSync(path.join(project, file), 'utf8');
const inProject = (file) => path.join(project, file);

// The engine and a plugin beside the project, each a repository of its own.
const engine = path.join(root, 'GlistEngine');
const plugin = path.join(root, 'glistplugins', 'gipDemo');
let dependencies = [];
let openRoot = project;
const consoleLines = [];
const service = createGitService({
  projectRoot: () => openRoot,
  dependencies: async () => dependencies,
  environment: () => ({ ...process.env }),
  send: (channel, payload) => { if (channel === 'git:console') consoleLines.push(payload); },
  trash: async (file) => renameSync(file, path.join(trash, path.basename(file))),
  home: () => path.join(root, 'GlistStudio'),
  projectsDirectory: () => projects,
  language: () => 'en',
});
const git = service.handlers;
const run = async (action, repositoryRoot) => {
  const result = await git.gitRun(action, repositoryRoot);
  assert.equal(result.success, true, `${action.kind}: ${result.message}`);
  return result;
};
// Relative paths with / on every system, as the expectations below write them.
const relative = (from, to) => path.relative(from, to).split(path.sep).join('/');
const changes = async () => Object.fromEntries((await git.gitStatus()).repository.changes.map((change) => [relative(project, change.path), change.state]));

try {
  // Not a repository yet; making one ignores the build folder from the start.
  write('src/main.cpp', 'int main() {\n  return 0;\n}\n');
  write('_build/Release/MyApp', 'binary');
  let status = await git.gitStatus();
  assert.match(status.version, /^\d+\.\d+/);
  assert.equal(status.repository, null);
  await run({ kind: 'init' });
  assert.match(read('.gitignore'), /^_build\/$/m);
  status = await git.gitStatus();
  assert.equal(status.repository.branch, 'main');
  assert.equal(status.repository.head, null);
  assert.equal(realpathSync(status.repository.root), realpathSync(project));
  assert.deepEqual(await changes(), { '.gitignore': 'untracked', 'src/main.cpp': 'untracked' });
  assert.deepEqual(status.repository.ignored, [inProject('_build') + path.sep]);

  // Committing needs a name and an email.
  let result = await git.gitRun({ kind: 'commit', message: 'First', paths: [inProject('src/main.cpp')], amend: false });
  assert.equal(result.success, false);
  assert.match(result.message, /name and email/);
  await run({ kind: 'identity', name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.deepEqual(await git.gitIdentity(), { name: 'Ada Lovelace', email: 'ada@example.com' });

  // Only the chosen files are committed.
  await run({ kind: 'commit', message: 'First', paths: [inProject('src/main.cpp')], amend: false });
  assert.deepEqual(await changes(), { '.gitignore': 'untracked' });
  await run({ kind: 'commit', message: 'Ignore the build', paths: [inProject('.gitignore')], amend: false });
  await run({ kind: 'commit', message: 'Ignore built files', paths: [], amend: true });
  assert.equal(await git.gitLastMessage(), 'Ignore built files');
  assert.deepEqual((await git.gitLog({})).map((commit) => commit.subject), ['Ignore built files', 'First']);
  result = await git.gitRun({ kind: 'commit', message: 'Nothing', paths: [], amend: false });
  assert.equal(result.success, false);

  // Rolling back puts tracked files back and moves new ones to the trash.
  write('src/main.cpp', 'int main() {\n  return 1;\n}\n');
  write('src/Extra.h', '#pragma once\n');
  write('src/Other.h', '// untracked\n');
  execFileSync('git', ['add', 'src/Extra.h'], { cwd: project });
  assert.deepEqual(await changes(), { 'src/main.cpp': 'modified', 'src/Extra.h': 'added', 'src/Other.h': 'untracked' });
  await run({ kind: 'rollback', paths: [inProject('src/main.cpp'), inProject('src/Extra.h'), inProject('src/Other.h')] });
  assert.equal(read('src/main.cpp'), 'int main() {\n  return 0;\n}\n');
  assert.ok(!existsSync(inProject('src/Extra.h')));
  assert.ok(existsSync(path.join(trash, 'Extra.h')));
  assert.deepEqual(await changes(), { 'src/Other.h': 'untracked' });
  await run({ kind: 'ignore', paths: [inProject('src/Other.h')] });
  assert.match(read('.gitignore'), /^\/src\/Other\.h$/m);
  assert.deepEqual(await changes(), { '.gitignore': 'modified' });
  await run({ kind: 'rollback', paths: [inProject('.gitignore')] });

  // Versions of files, blame and commit details.
  const [latest, first] = await git.gitLog({});
  assert.equal((await git.gitFileAt(first.hash, inProject('src/main.cpp'))).text, 'int main() {\n  return 0;\n}\n');
  assert.equal((await git.gitFileAt(first.hash, inProject('.gitignore'))).text, null);
  const details = await git.gitCommitDetails(latest.hash);
  assert.equal(details.base, first.hash);
  assert.deepEqual(details.files, [{ path: inProject('.gitignore'), state: 'added' }]);
  assert.equal((await git.gitCommitDetails(first.hash)).base, null);
  const blame = await git.gitBlame(inProject('src/main.cpp'), 'int main() {\n  return 5;\n}\n');
  assert.deepEqual(blame.map((line) => line.uncommitted), [false, true, false]);
  await assert.rejects(git.gitFileAt('--output=x', inProject('src/main.cpp')));
  await assert.rejects(git.gitFileAt('HEAD', path.join(root, 'elsewhere.txt')));

  // Branches: a conflict while merging, resolved by keeping one side.
  await run({ kind: 'create-branch', name: 'feature', checkout: true });
  write('src/main.cpp', 'int main() {\n  return 2;\n}\n');
  await run({ kind: 'commit', message: 'Return two', paths: [inProject('src/main.cpp')], amend: false });
  await run({ kind: 'checkout', ref: 'main' });
  write('src/main.cpp', 'int main() {\n  return 3;\n}\n');
  await run({ kind: 'commit', message: 'Return three', paths: [inProject('src/main.cpp')], amend: false });
  result = await git.gitRun({ kind: 'merge', ref: 'feature' });
  assert.equal(result.conflicts, true);
  status = await git.gitStatus();
  assert.equal(status.repository.operation, 'merge');
  assert.match(status.repository.operationSubject, /feature/);
  assert.deepEqual(status.repository.changes.filter((change) => change.conflict).map((change) => [relative(project, change.path), change.conflict]),
    [['src/main.cpp', 'UU']]);
  await run({ kind: 'resolve', path: inProject('src/main.cpp'), side: 'theirs' });
  assert.equal(read('src/main.cpp'), 'int main() {\n  return 2;\n}\n');
  // Taken back, the conflict and its markers return.
  await run({ kind: 'unresolve', path: inProject('src/main.cpp') });
  assert.match(read('src/main.cpp'), /^<<<<<<< ours$/m);
  assert.equal((await changes())['src/main.cpp'], 'conflict');
  await run({ kind: 'resolve', path: inProject('src/main.cpp'), side: 'mine' });
  assert.equal(read('src/main.cpp'), 'int main() {\n  return 3;\n}\n');
  await run({ kind: 'unresolve', path: inProject('src/main.cpp') });
  await run({ kind: 'resolve', path: inProject('src/main.cpp'), side: 'theirs' });
  await run({ kind: 'commit', message: 'Merge feature', paths: [], amend: false });
  status = await git.gitStatus();
  assert.equal(status.repository.operation, null);
  assert.equal((await git.gitLog({ limit: 1 }))[0].parents.length, 2);
  assert.deepEqual((await git.gitBranches()).map((branch) => [branch.name, branch.current]).sort(), [['feature', false], ['main', true]]);
  result = await git.gitRun({ kind: 'create-branch', name: 'bad name', checkout: false });
  assert.equal(result.success, false);
  result = await git.gitRun({ kind: 'checkout', ref: '--orphan' });
  assert.equal(result.success, false);

  // Checking out over local changes: refused, then done with them stashed and brought back.
  await run({ kind: 'checkout', ref: 'feature' });
  write('src/main.cpp', 'int main() {\n  return 9;\n}\n');
  write('notes.txt', 'mine\n');
  result = await git.gitRun({ kind: 'checkout', ref: 'main' });
  assert.equal(result.success, true);
  await run({ kind: 'checkout', ref: 'feature' });
  execFileSync('git', ['commit', '-qam', 'On feature'], { cwd: project });
  await run({ kind: 'checkout', ref: 'main' });
  write('src/main.cpp', 'int main() {\n  return 10;\n}\n');
  result = await git.gitRun({ kind: 'checkout', ref: 'feature' });
  assert.equal(result.localChanges, true);
  result = await git.gitRun({ kind: 'checkout', ref: 'feature', smart: true });
  assert.equal(result.conflicts, true);
  status = await git.gitStatus();
  assert.equal(status.repository.branch, 'feature');
  await run({ kind: 'resolve', path: inProject('src/main.cpp'), side: 'mine' });
  assert.equal(read('src/main.cpp'), 'int main() {\n  return 10;\n}\n');
  await run({ kind: 'rollback', paths: [inProject('src/main.cpp')] });
  assert.equal((await git.gitStashes()).length, 1);
  await run({ kind: 'drop-stash', name: 'stash@{0}' });

  // Stashes.
  await run({ kind: 'checkout', ref: 'main' });
  write('src/main.cpp', 'stashed\n');
  await run({ kind: 'stash', message: 'Try something', untracked: true });
  assert.deepEqual(await changes(), {});
  assert.equal((await git.gitStatus()).repository.stashes, 1);
  const [stash] = await git.gitStashes();
  assert.equal(stash.message, 'On main: Try something');
  // The changed file, and the new files stashed with it.
  assert.deepEqual((await git.gitCommitDetails(stash.name)).files.map((file) => [relative(project, file.path), file.state]),
    [['src/main.cpp', 'modified'], ['notes.txt', 'untracked'], ['src/Other.h', 'untracked']]);
  await run({ kind: 'unstash', name: stash.name, pop: true });
  assert.equal(read('src/main.cpp'), 'stashed\n');
  assert.equal(read('notes.txt'), 'mine\n');
  await run({ kind: 'rollback', paths: [inProject('src/main.cpp')] });
  // A new file stashed with it: shown in the stash's files, from the third parent git keeps it in.
  write('src/main.cpp', 'stashed again\n');
  write('fresh.txt', 'fresh\n');
  await run({ kind: 'stash', message: 'With a new file', untracked: true });
  const [withNew] = await git.gitStashes();
  const stashed = (await git.gitCommitDetails(withNew.name)).files;
  const fresh = stashed.find((file) => file.path === inProject('fresh.txt'));
  assert.deepEqual([stashed[0].state, fresh?.state], ['modified', 'untracked']);
  assert.match(fresh.at, /^[0-9a-f]{40}$/);
  assert.equal((await git.gitFileAt(fresh.at, inProject('fresh.txt'))).text, 'fresh\n');
  await run({ kind: 'unstash', name: withNew.name, pop: true });
  assert.equal(read('fresh.txt'), 'fresh\n');
  await run({ kind: 'rollback', paths: [inProject('src/main.cpp'), inProject('fresh.txt')] });

  // A remote: pushing sets the upstream, and a clone gets what was pushed.
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', remote]);
  let outgoing = await git.gitOutgoing();
  assert.equal(outgoing.remote, null);
  result = await git.gitRun({ kind: 'push' });
  assert.equal(result.success, false);
  await run({ kind: 'add-remote', name: 'origin', url: remote });
  result = await git.gitRun({ kind: 'add-remote', name: 'evil', url: '--upload-pack=touch /tmp/x' });
  assert.equal(result.success, false);
  assert.deepEqual((await git.gitRemotes()).map((entry) => entry.name), ['origin']);
  outgoing = await git.gitOutgoing();
  assert.equal(outgoing.remote, 'origin');
  assert.equal(outgoing.branch, 'main');
  assert.ok(outgoing.commits.length >= 4);
  await run({ kind: 'push' });
  status = await git.gitStatus();
  assert.equal(status.repository.upstream, 'origin/main');
  assert.equal((await git.gitOutgoing()).commits.length, 0);

  // Protection is on until turned off: the pushed commit is not amended, and main is not force pushed.
  assert.equal((await git.gitStatus()).repository.headPushed, true);
  result = await git.gitRun({ kind: 'commit', message: 'Rewritten', paths: [], amend: true });
  assert.match(result.message, /already pushed, so it cannot be amended/);
  assert.equal((await git.gitOutgoing()).protected, true);
  result = await git.gitRun({ kind: 'push', force: true });
  assert.match(result.message, /main is a protected branch/);
  // A commit not pushed yet can be amended.
  write('protected.txt', 'draft\n');
  await run({ kind: 'commit', message: 'Draft', paths: [inProject('protected.txt')], amend: false });
  assert.equal((await git.gitStatus()).repository.headPushed, false);
  await run({ kind: 'commit', message: 'Draft, amended', paths: [], amend: true });
  // HEAD itself: the log of every branch can put a stash made in the same second first.
  assert.equal(execFileSync('git', ['-C', project, 'log', '-1', '--format=%s']).toString().trim(), 'Draft, amended');
  // Branches not listed are not protected, and turned off nothing is.
  await git.gitProtection({ on: true, branches: ['release/*'] });
  assert.equal((await git.gitOutgoing()).protected, false);
  await git.gitProtection({ on: false, branches: ['main'] });
  assert.equal((await git.gitOutgoing()).protected, false);
  await run({ kind: 'push' });
  assert.equal((await git.gitStatus()).repository.headPushed, undefined);
  await run({ kind: 'commit', message: 'Draft, amended after pushing', paths: [], amend: true });
  await run({ kind: 'push', force: true });
  await git.gitProtection({ on: true, branches: ['main', 'master'] });

  await run({ kind: 'create-tag', name: 'v1', message: 'Version one' });
  await run({ kind: 'push', tags: true });
  assert.deepEqual((await git.gitTags()).map((tag) => tag.name), ['v1']);

  const cloned = await git.gitClone(remote, 'Copy');
  assert.equal(cloned.success, true, cloned.message);
  assert.equal(cloned.root, path.join(projects, 'Copy'));
  assert.equal(readFileSync(path.join(projects, 'Copy', 'src', 'main.cpp'), 'utf8'), 'int main() {\n  return 2;\n}\n');
  assert.match((await git.gitClone(remote, 'Copy')).message, /already exists/);
  assert.equal((await git.gitClone('--upload-pack=touch /tmp/x', 'Other')).success, false);

  // Someone else pushes; Update Project brings it in, with local changes kept.
  execFileSync('git', ['-C', path.join(projects, 'Copy'), 'commit', '-q', '--allow-empty', '-m', 'From the copy']);
  execFileSync('git', ['-C', path.join(projects, 'Copy'), 'push', '-q']);
  write('notes.txt', 'still mine\n');
  await run({ kind: 'fetch' });
  status = await git.gitStatus();
  assert.equal(status.repository.behind, 1);
  write('src/main.cpp', 'local edit\n');
  await run({ kind: 'pull', rebase: false });
  status = await git.gitStatus();
  assert.equal(status.repository.behind, 0);
  assert.equal(read('src/main.cpp'), 'local edit\n');
  assert.equal((await git.gitLog({ text: 'from the COPY' }))[0].subject, 'From the copy');
  assert.equal((await git.gitLog({ text: latest.hash.slice(0, 8) }))[0].hash, latest.hash);
  assert.ok((await git.gitLog({ path: inProject('src/main.cpp') })).every((commit) => commit.subject !== 'Ignore built files'));

  // Rebasing with changes not committed yet keeps them.
  await run({ kind: 'create-branch', name: 'side', checkout: true });
  write('notes.txt', 'side notes\n');
  await run({ kind: 'commit', message: 'Side notes', paths: [inProject('notes.txt')], amend: false });
  await run({ kind: 'checkout', ref: 'main' });
  write('src/main.cpp', 'kept while rebasing\n');
  await run({ kind: 'rebase', onto: 'side' });
  assert.equal(read('src/main.cpp'), 'kept while rebasing\n');
  assert.equal(read('notes.txt'), 'side notes\n');

  // The engine and plugins are repositories of their own, reached by their folders.
  for (const [folder, file] of [[engine, 'engine/gCore.h'], [plugin, 'src/gipDemo.h']]) {
    mkdirSync(path.join(folder, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(folder, file), '// first\n');
    execFileSync('git', ['init', '-q', '--initial-branch=main', folder]);
    execFileSync('git', ['-C', folder, 'add', '.']);
    execFileSync('git', ['-C', folder, '-c', 'user.name=Engine', '-c', 'user.email=e@example.com', 'commit', '-q', '-m', `Start ${path.basename(folder)}`]);
  }
  dependencies = [
    { name: 'GlistEngine', kind: 'engine', path: engine, exists: true },
    { name: 'gipDemo', kind: 'plugin', path: plugin, exists: true },
    { name: 'gipMissing', kind: 'plugin', path: path.join(root, 'glistplugins', 'gipMissing'), exists: false },
  ];
  writeFileSync(path.join(engine, 'engine', 'gCore.h'), '// first\n// changed\n');
  status = await git.gitStatus();
  assert.deepEqual(status.dependencies.map((entry) => [entry.kind, entry.name, entry.branch]), [['engine', 'GlistEngine', 'main'], ['plugin', 'gipDemo', 'main']]);
  assert.deepEqual(status.dependencies[0].changes.map((change) => [path.relative(engine, change.path), change.state]), [[path.join('engine', 'gCore.h'), 'modified']]);
  assert.equal(status.repository.kind, 'project');
  assert.deepEqual((await git.gitLog({ root: engine })).map((commit) => commit.subject), ['Start GlistEngine']);
  assert.equal((await git.gitFileAt('HEAD', path.join(engine, 'engine', 'gCore.h'))).text, '// first\n');
  assert.deepEqual((await git.gitBranches(plugin)).map((branch) => branch.name), ['main']);
  await run({ kind: 'commit', message: 'Change the core', paths: [path.join(engine, 'engine', 'gCore.h')], amend: false }, engine);
  assert.equal((await git.gitLog({ root: engine }))[0].subject, 'Change the core');
  assert.equal((await git.gitStatus()).dependencies[0].changes.length, 0);
  // Only the project's own engine and plugins can be named, not any folder.
  await assert.rejects(git.gitBranches(root));
  await assert.rejects(git.gitBranches(path.join(root, 'glistplugins', 'gipMissing')));
  assert.equal((await git.gitRun({ kind: 'fetch' }, '/')).success, false);
  await assert.rejects(git.gitFileAt('HEAD', path.join(root, 'elsewhere', 'file.h')));

  // The console shows the commands that change the repository.
  assert.ok(consoleLines.some((entry) => entry.kind === 'command' && entry.text.startsWith('git commit -m First')));

  // Stashing chosen files only, new ones too; dropping a commit not pushed yet.
  {
    const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const repo = path.join(projects, 'Drops');
    const remote = path.join(root, 'drops-remote.git');
    const put = (file, text) => writeFileSync(path.join(repo, file), text);
    const at = (file) => readFileSync(path.join(repo, file), 'utf8');
    mkdirSync(repo);
    sh(repo, 'init', '-q', '-b', 'main');
    put('a.txt', 'a\n');
    put('b.txt', 'b\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-qm', 'Start');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    sh(repo, 'remote', 'add', 'origin', remote);
    sh(repo, 'push', '-q', '-u', 'origin', 'main');
    openRoot = repo;

    put('a.txt', 'a changed\n');
    put('b.txt', 'b changed\n');
    put('new.txt', 'new\n');
    put('other.txt', 'other\n');
    await run({ kind: 'stash', message: 'two of them', untracked: true, paths: [path.join(repo, 'a.txt'), path.join(repo, 'new.txt')] });
    assert.equal(sh(repo, 'status', '--porcelain'), 'M b.txt\n?? other.txt');
    assert.deepEqual(sh(repo, 'stash', 'show', '--include-untracked', '--name-only', 'stash@{0}').split('\n'), ['a.txt', 'new.txt']);
    assert.match(sh(repo, 'stash', 'list'), /two of them/);
    sh(repo, 'checkout', '-q', '--', '.');
    sh(repo, 'clean', '-qf');
    sh(repo, 'stash', 'drop', '-q');

    // Unpublished: the branch's commits no remote has.
    put('c.txt', 'c\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-qm', 'Add c');
    put('d.txt', 'd\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-qm', 'Add d');
    const [addD, addC] = (await git.gitUnpublished()).map((hash) => sh(repo, 'log', '-1', '--format=%s', hash));
    assert.deepEqual([addD, addC], ['Add d', 'Add c']);
    // Dropping one in the middle keeps the ones after it, and changes not committed yet.
    put('a.txt', 'a typed\n');
    await run({ kind: 'drop-commit', commit: sh(repo, 'rev-parse', 'HEAD~1') });
    assert.deepEqual(sh(repo, 'log', '--format=%s').split('\n'), ['Add d', 'Start']);
    assert.deepEqual([existsSync(path.join(repo, 'c.txt')), at('d.txt'), at('a.txt')], [false, 'd\n', 'a typed\n']);
    // A pushed one stays, and so does one from another branch.
    const pushed = await git.gitRun({ kind: 'drop-commit', commit: sh(repo, 'rev-parse', 'origin/main') });
    assert.deepEqual([pushed.success, pushed.message], [false, 'This commit is already pushed, so it is not dropped: others may have it.']);
    sh(repo, 'stash', '-q');
    sh(repo, 'checkout', '-qb', 'side');
    put('e.txt', 'e\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-qm', 'Side');
    const side = sh(repo, 'rev-parse', 'HEAD');
    sh(repo, 'checkout', '-q', 'main');
    assert.equal((await git.gitRun({ kind: 'drop-commit', commit: side })).message, 'Only a commit of the current branch can be dropped.');
    // A merge after it would be flattened by the rebase, so it is refused.
    const beforeMerge = sh(repo, 'rev-parse', 'HEAD');
    sh(repo, 'merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
    assert.equal((await git.gitRun({ kind: 'drop-commit', commit: beforeMerge })).message, 'A merge commit, or one with a merge after it, cannot be dropped here.');
    // The newest one, alone.
    sh(repo, 'reset', '-q', '--hard', 'HEAD~1');
    await run({ kind: 'drop-commit', commit: sh(repo, 'rev-parse', 'HEAD') });
    assert.deepEqual(sh(repo, 'log', '--format=%s').split('\n'), ['Start']);
    openRoot = project;
  }

  // Another project is not a repository.
  openRoot = path.join(root, 'plain');
  mkdirSync(openRoot);
  assert.equal((await git.gitStatus()).repository, null);

  // Patches: commits and changes out of one repository and into another.
  {
    const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const from = path.join(projects, 'From');
    const into = path.join(projects, 'Into');
    const put = (folder, file, text) => writeFileSync(path.join(folder, file), text);
    const at = (folder, file) => readFileSync(path.join(folder, file), 'utf8');
    mkdirSync(from);
    sh(from, 'init', '-q', '-b', 'main');
    put(from, 'a.txt', 'one\ntwo\n');
    sh(from, 'add', '-A');
    sh(from, 'commit', '-qm', 'One');
    sh(projects, 'clone', '-q', from, into);
    put(from, 'a.txt', 'one\ntwo\nthree\n');
    sh(from, 'commit', '-qam', 'Three');
    put(from, 'b.txt', 'b\n');
    sh(from, 'add', '-A');
    sh(from, 'commit', '-qm', 'Add b');
    const three = sh(from, 'rev-parse', 'HEAD~1');
    const addB = sh(from, 'rev-parse', 'HEAD');
    openRoot = from;
    // Commits as git format-patch writes them, oldest first whatever the order chosen.
    const commits = await git.gitPatch({ commits: [addB, three] });
    assert.equal(commits.commits, 2);
    assert.equal(commits.name, 'From-2-commits.patch');
    assert.match(commits.patch, /^From [0-9a-f]{40} /);
    assert.ok(commits.patch.indexOf('Subject: [PATCH] Three') < commits.patch.indexOf('Subject: [PATCH] Add b'));
    assert.equal((await git.gitPatch({ commits: [three] })).name, 'Three.patch');
    // Changes not committed yet, a new file too.
    put(from, 'a.txt', 'one\ntwo\nthree\nfour\n');
    put(from, 'c.txt', 'c\n');
    const changed = await git.gitPatch({ paths: [path.join(from, 'a.txt'), path.join(from, 'c.txt')] });
    assert.deepEqual([changed.name, changed.commits], ['From-changes.patch', 0]);
    assert.match(changed.patch, /^\+four$/m);
    assert.match(changed.patch, /new file mode[\s\S]*\+c$/m);
    assert.doesNotMatch(changed.patch, /b\.txt/);

    // Into the other: the commits made again, with their messages, then the changes into the files.
    openRoot = into;
    assert.equal((await run({ kind: 'apply-patch', patch: commits.patch })).message, 'Patch applied as commits.');
    assert.deepEqual(sh(into, 'log', '--format=%s', '-3').split('\n'), ['Add b', 'Three', 'One']);
    assert.equal((await run({ kind: 'apply-patch', patch: changed.patch })).message, 'Patch applied.');
    assert.deepEqual([at(into, 'a.txt'), at(into, 'c.txt')], ['one\ntwo\nthree\nfour\n', 'c\n']);
    const notOne = await git.gitRun({ kind: 'apply-patch', patch: 'hello' });
    assert.deepEqual([notOne.success, notOne.message], [false, 'This is not a patch.']);
    // A patch with changed files the index does not have still goes into them.
    sh(into, 'checkout', '-q', '--', '.');
    sh(into, 'clean', '-qfd');
    put(into, 'b.txt', 'b\nmine\n');
    assert.equal((await run({ kind: 'apply-patch', patch: changed.patch })).message, 'Patch applied.');
    assert.equal(at(into, 'b.txt'), 'b\nmine\n');
    sh(into, 'checkout', '-q', '--', '.');
    sh(into, 'clean', '-qfd');

    // One that clashes: git am stops with both sides marked, as a patch being
    // applied, and Keep Mine is the branch's side, as in a cherry-pick.
    openRoot = from;
    sh(from, 'checkout', '-q', '--', '.');
    sh(from, 'clean', '-qfd');
    put(from, 'a.txt', 'one\ntwo from there\nthree\n');
    sh(from, 'commit', '-qam', 'Two from there');
    const clash = await git.gitPatch({ commits: [sh(from, 'rev-parse', 'HEAD')] });
    openRoot = into;
    put(into, 'a.txt', 'one\ntwo from here\nthree\n');
    sh(into, 'commit', '-qam', 'Two from here');
    const stopped = await git.gitRun({ kind: 'apply-patch', patch: clash.patch });
    assert.deepEqual([stopped.success, stopped.conflicts], [false, true], stopped.message);
    let state = (await git.gitStatus()).repository;
    assert.deepEqual([state.operation, state.operationSubject], ['am', 'Two from there']);
    assert.match(at(into, 'a.txt'), /<<<<<<<[\s\S]*two from here[\s\S]*=======[\s\S]*two from there[\s\S]*>>>>>>>/);
    const committing = await git.gitRun({ kind: 'commit', message: 'x', paths: [path.join(into, 'a.txt')], amend: false });
    assert.equal(committing.message, 'A patch is being applied: resolve the conflicts, then choose Continue.');
    await run({ kind: 'resolve', path: path.join(into, 'a.txt'), side: 'mine' });
    assert.equal(at(into, 'a.txt'), 'one\ntwo from here\nthree\n');
    await run({ kind: 'unresolve', path: path.join(into, 'a.txt') });
    await run({ kind: 'resolve', path: path.join(into, 'a.txt'), side: 'theirs' });
    assert.equal(at(into, 'a.txt'), 'one\ntwo from there\nthree\n');
    // Continue makes the commit, as git am --continue does.
    await run({ kind: 'continue' });
    state = (await git.gitStatus()).repository;
    assert.equal(state.operation, null);
    assert.equal(sh(into, 'log', '-1', '--format=%s'), 'Two from there');
    // Keeping one's own side leaves the patch nothing to commit: Continue skips it.
    put(from, 'a.txt', 'one\ntwo once more\nthree\n');
    sh(from, 'commit', '-qam', 'Two once more');
    openRoot = from;
    const once = await git.gitPatch({ commits: [sh(from, 'rev-parse', 'HEAD')] });
    openRoot = into;
    put(into, 'a.txt', 'one\ntwo mine\nthree\n');
    sh(into, 'commit', '-qam', 'Two mine');
    assert.equal((await git.gitRun({ kind: 'apply-patch', patch: once.patch })).conflicts, true);
    await run({ kind: 'resolve', path: path.join(into, 'a.txt'), side: 'mine' });
    await run({ kind: 'continue' });
    assert.deepEqual([(await git.gitStatus()).repository.operation, sh(into, 'log', '-1', '--format=%s')], [null, 'Two mine']);
    // Abort takes a stopped one back.
    put(from, 'a.txt', 'one\ntwo again\nthree\n');
    sh(from, 'commit', '-qam', 'Two again');
    openRoot = from;
    const again = await git.gitPatch({ commits: [sh(from, 'rev-parse', 'HEAD')] });
    openRoot = into;
    put(into, 'a.txt', 'one\ntwo here again\nthree\n');
    sh(into, 'commit', '-qam', 'Two here again');
    assert.equal((await git.gitRun({ kind: 'apply-patch', patch: again.patch })).conflicts, true);
    await run({ kind: 'abort' });
    assert.deepEqual([(await git.gitStatus()).repository.operation, at(into, 'a.txt')], [null, 'one\ntwo here again\nthree\n']);
    openRoot = project;
  }
} finally {
  service.stop();
  rmSync(root, { recursive: true, force: true });
}

// Where a checkout stands, read from its .git folder for Settings > About,
// against git's own answers.
{
  const headRoot = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'glist-head-')));
  const headEnv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(headRoot, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  writeFileSync(headEnv.GIT_CONFIG_GLOBAL, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n');
  const headGit = (folder, ...args) => execFileSync('git', args, { cwd: folder, env: headEnv, encoding: 'utf8' }).trim();

  try {
    const repo = path.join(headRoot, 'GlistEngine');
    mkdirSync(repo);
    headGit(repo, 'init', '-q');
    // A branch with no commits yet.
    assert.deepEqual(await readRepositoryHead(repo), { branch: 'main', commit: null });
    writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    headGit(repo, 'add', '.');
    headGit(repo, 'commit', '-qm', 'first');
    const first = headGit(repo, 'rev-parse', 'HEAD');
    headGit(repo, 'remote', 'add', 'origin', 'git@github.com:GlistEngine/GlistEngine.git');
    assert.deepEqual(await readRepositoryHead(repo), {
      branch: 'main', commit: first, commitPage: `https://github.com/GlistEngine/GlistEngine/commit/${first}`,
    });

    // Packed refs, as after git gc or a fresh clone.
    headGit(repo, 'checkout', '-qb', 'feature/one');
    writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    headGit(repo, 'commit', '-qam', 'second', '--allow-empty');
    const second = headGit(repo, 'rev-parse', 'HEAD');
    headGit(repo, 'pack-refs', '--all');
    assert.equal((await readRepositoryHead(repo)).commit, second);
    assert.equal((await readRepositoryHead(repo)).branch, 'feature/one');

    // A commit checked out rather than a branch.
    headGit(repo, 'checkout', '-q', first);
    assert.equal((await readRepositoryHead(repo)).branch, null);
    assert.equal((await readRepositoryHead(repo)).commit, first);

    // A worktree: a .git file, its own HEAD, the branches shared.
    headGit(repo, 'checkout', '-q', 'main');
    const worktree = path.join(headRoot, 'worktree');
    headGit(repo, 'worktree', 'add', '-q', worktree, 'feature/one');
    assert.deepEqual(await readRepositoryHead(worktree), {
      branch: 'feature/one', commit: second, commitPage: `https://github.com/GlistEngine/GlistEngine/commit/${second}`,
    });

    // Not a checkout.
    assert.equal(await readRepositoryHead(path.join(headRoot, 'nothing')), null);

    // GitHub's remote forms; others have no page.
    assert.equal(githubCommitPage('https://github.com/GlistPlugins/gipBox2D', 'abc'), 'https://github.com/GlistPlugins/gipBox2D/commit/abc');
    assert.equal(githubCommitPage('https://user@github.com/a/b.git/', 'abc'), 'https://github.com/a/b/commit/abc');
    assert.equal(githubCommitPage('ssh://git@github.com/a/b.c.git', 'abc'), 'https://github.com/a/b.c/commit/abc');
    assert.equal(githubCommitPage('https://gitlab.com/a/b.git', 'abc'), undefined);
  } finally {
    rmSync(headRoot, { recursive: true, force: true });
  }
}

console.log('Git service tests passed.');

// Why a command failed, told without reading git's sentences, which change with
// its language and version: the credential helpers, push's porcelain lines and
// the repository's state.
{
  const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'glist-git-why-')));
  const plainEnv = () => {
    const env = { ...process.env, HOME: base, XDG_CONFIG_HOME: base, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
    ['GIT_ASKPASS', 'SSH_ASKPASS', 'LANGUAGE', 'LC_ALL', 'LC_MESSAGES'].forEach((key) => delete env[key]);
    return env;
  };
  try {
    // The listener writes down what git asks of the helpers, by the protocol, and never a password.
    const log = path.join(base, 'asked');
    const credential = (action, input) => spawnSync('git', ['-c', 'credential.helper=', '-c', `credential.helper=${credentialListener}`, 'credential', action],
      { input, env: { ...plainEnv(), GLIST_STUDIO_CREDENTIALS: log }, encoding: 'utf8' });
    credential('fill', 'protocol=https\nhost=example.com\n\n');
    credential('approve', 'protocol=https\nhost=example.com\nusername=student\npassword=hunter2\n\n');
    credential('reject', 'protocol=https\nhost=example.com\nusername=student\npassword=hunter2\n\n');
    assert.equal(readFileSync(log, 'utf8'), 'get example.com\nstore example.com\nerase example.com\n');

    // A remote that refuses every login, also standing in for github.com as a proxy.
    const hosts = [];
    const refusing = http.createServer((request, response) => {
      hosts.push(request.headers.host);
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
      response.end();
    });
    await new Promise((resolve) => { refusing.listen(0, '127.0.0.1', resolve); });
    const port = refusing.address().port;
    const refused = path.join(base, 'Refused');
    mkdirSync(refused);
    const inRefused = (...args) => execFileSync('git', args, { cwd: refused, env: plainEnv() });
    inRefused('init', '-q', '-b', 'main');
    inRefused('config', 'user.name', 'Ada');
    inRefused('config', 'user.email', 'ada@example.com');
    // A helper of the student's own gives a password, so nothing asks on screen.
    inRefused('config', 'credential.helper', '!f() { echo username=student; echo password=hunter2; }; f');
    writeFileSync(path.join(refused, 'a.txt'), 'a\n');
    inRefused('add', 'a.txt');
    inRefused('commit', '-qm', 'A');
    inRefused('remote', 'add', 'origin', `http://127.0.0.1:${port}/repo.git`);
    const why = createGitService({
      projectRoot: () => refused, dependencies: async () => [], environment: plainEnv, send: () => undefined,
      trash: async () => undefined, home: () => path.join(base, 'GlistStudio'), projectsDirectory: () => base, language: () => 'en',
    }).handlers;
    let refusal = await why.gitRun({ kind: 'push' });
    assert.equal(refusal.success, false);
    assert.equal(refusal.message, 'The remote did not accept the login.');
    inRefused('remote', 'set-url', 'origin', 'http://github.com/owner/repo.git');
    inRefused('config', 'http.proxy', `http://127.0.0.1:${port}`);
    refusal = await why.gitRun({ kind: 'push' });
    assert.ok(hosts.includes('github.com'), 'went through the stand-in');
    assert.match(refusal.message, /personal access token/, 'a refused github.com login: a token, not the password');
    refusing.close();

    // The same failures with git answering in Turkish: the same flags, git's own words left as they are.
    const candidates = ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'];
    // Asked as the service asks (toolLanguage), so a system whose locale cannot
    // carry Turkish, such as a CI runner's C.UTF-8, skips rather than fails.
    const turkishGit = candidates.find((candidate) => existsSync(candidate) && /deposu/.test(spawnSync(candidate, ['-C', base, 'rev-parse'],
      { env: { ...plainEnv(), ...toolLanguage('tr', plainEnv()) }, encoding: 'utf8' }).stderr));
    if (!turkishGit) {
      console.log('No git with Turkish here: the Turkish checks are skipped.');
    } else {
      const trEnv = () => ({ ...plainEnv(), PATH: `${path.dirname(turkishGit)}${path.delimiter}${process.env.PATH}` });
      const tg = (cwd, ...args) => execFileSync(turkishGit, args, { cwd, env: trEnv(), encoding: 'utf8', stdio: 'pipe' }).trim();
      const remote = path.join(base, 'remote.git');
      const app = path.join(base, 'TurkishApp');
      const other = path.join(base, 'other');
      tg(base, 'init', '-q', '--bare', '-b', 'main', remote);
      tg(base, 'clone', '-q', remote, app);
      tg(base, 'clone', '-q', remote, other);
      for (const folder of [app, other]) { tg(folder, 'config', 'user.name', 'Ada'); tg(folder, 'config', 'user.email', 'ada@example.com'); }
      writeFileSync(path.join(app, 'main.cpp'), 'int a;\n');
      tg(app, 'add', 'main.cpp');
      tg(app, 'commit', '-qm', 'Start');
      tg(app, 'push', '-q', 'origin', 'main');
      tg(other, 'pull', '-q', 'origin', 'main');
      writeFileSync(path.join(other, 'other.cpp'), 'int b;\n');
      tg(other, 'add', 'other.cpp');
      tg(other, 'commit', '-qm', 'Other');
      tg(other, 'push', '-q', 'origin', 'main');
      const consoleText = [];
      const tr = createGitService({
        projectRoot: () => app, dependencies: async () => [], environment: trEnv,
        send: (channel, entry) => { if (channel === 'git:console' && entry.text) consoleText.push(entry.text); },
        trash: async () => undefined, home: () => path.join(base, 'GlistStudio'), projectsDirectory: () => base, language: () => 'tr',
      }).handlers;
      const failed = async (action, flag) => {
        const result = await tr.gitRun(action);
        assert.equal(result.success, false, `${action.kind} should fail`);
        if (flag) assert.equal(result[flag], true, `${action.kind}: ${flag} (${result.message})`);
        return result;
      };
      // A push the remote has moved past.
      writeFileSync(path.join(app, 'main.cpp'), 'int a = 1;\n');
      tg(app, 'commit', '-qam', 'Mine');
      await failed({ kind: 'push' }, 'rejected');
      assert.ok(consoleText.join('').includes('ipucu'), 'git spoke Turkish in the console');
      // Conflicts from a merge.
      tg(app, 'fetch', '-q');
      tg(app, 'checkout', '-qb', 'clash', 'origin/main');
      writeFileSync(path.join(app, 'main.cpp'), 'int a = 2;\n');
      tg(app, 'commit', '-qam', 'Clash');
      tg(app, 'checkout', '-q', 'main');
      await failed({ kind: 'merge', ref: 'clash' }, 'conflicts');
      tg(app, 'merge', '--abort');
      // A checkout over changed files; not with a lock left by another git, nor to a name that is no commit.
      writeFileSync(path.join(app, 'main.cpp'), 'int a = 3;\n');
      await failed({ kind: 'checkout', ref: 'clash' }, 'localChanges');
      const lock = path.join(app, '.git', 'index.lock');
      writeFileSync(lock, '');
      assert.notEqual((await failed({ kind: 'checkout', ref: 'clash' })).localChanges, true, 'a lock is not local changes');
      rmSync(lock);
      const unknown = await tr.gitRun({ kind: 'checkout', ref: 'nowhere' });
      assert.equal(unknown.localChanges, undefined, 'a name that is no commit is not local changes');
      assert.match(unknown.message, /[çğıöşüÇĞİÖŞÜ]/, `git's own Turkish words: ${unknown.message}`);
      tg(app, 'checkout', '-q', '--', 'main.cpp');
      // A branch with commits nowhere else.
      await failed({ kind: 'delete-branch', name: 'clash', remote: false }, 'notMerged');
      // A pull on a branch that follows nothing.
      tg(app, 'checkout', '-qb', 'lonely');
      const lonely = await failed({ kind: 'pull', rebase: false });
      const trWords = JSON.parse(readFileSync(new URL('../src/locales/tr.json', import.meta.url), 'utf8')).git;
      assert.equal(lonely.message, trWords.noUpstream);
      // A commit without a name or email.
      tg(app, 'config', '--unset', 'user.name');
      tg(app, 'config', 'user.useConfigOnly', 'true');
      writeFileSync(path.join(app, 'new.cpp'), 'int c;\n');
      const nameless = await failed({ kind: 'commit', message: 'New', paths: [path.join(app, 'new.cpp')], amend: false });
      assert.equal(nameless.message, trWords.identity);
      // A branch whose remote branch was deleted is gone, though git words that in Turkish too.
      tg(app, 'config', 'user.name', 'Ada');
      tg(app, 'checkout', '-q', 'main');
      tg(app, 'push', '-q', 'origin', 'clash');
      tg(app, 'branch', '-q', '--set-upstream-to=origin/clash', 'clash');
      tg(app, 'push', '-q', 'origin', '--delete', 'clash');
      tg(app, 'fetch', '-q', '--prune');
      const branches = await tr.gitBranches();
      assert.equal(branches.find((entry) => entry.name === 'clash')?.gone, true, 'gone, read in English');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

