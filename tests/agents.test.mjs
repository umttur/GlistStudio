import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentLaunch, findAgents } from '../src/agents.ts';

// Agents are found in Glist Studio's folder, then in Glist's zbin, then on PATH.
const root = mkdtempSync(path.join(tmpdir(), 'glist-agents-'));
const home = path.join(root, 'GlistStudio');
const glist = path.join(root, 'glist');
const bin = path.join(root, 'bin');
const write = (file, text = '', mode) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mode) chmodSync(file, mode);
};
const places = { home, glist, searchPath: bin };
const status = async (id) => (await findAgents(places)).find((agent) => agent.id === id);

try {
  // Nothing installed; the user's own bin folders may hold real agents, so only
  // the ones found in these folders are checked.
  let gemini = await status('gemini');
  assert.ok(!gemini.installed || gemini.source === 'system');

  // Glist's zbin, with Windows's bundled node or a node on PATH.
  write(path.join(glist, 'zbin', 'glistzbin-macos', 'gemini', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js'), '');
  // A node on PATH: node.exe on Windows, which finds commands by their extension.
  const pathNode = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  write(pathNode, '#!/bin/sh\n', 0o755);
  gemini = await status('gemini');
  assert.equal(gemini.source, 'glist');
  let launch = await agentLaunch('gemini', places);
  assert.equal(launch.file, pathNode);
  assert.match(launch.args[0], /gemini-cli[/\\]bundle[/\\]gemini\.js$/);

  // Installed from Settings: a package with a bin entry and the Studio's Node.js.
  const nodeBinary = process.platform === 'win32' ? path.join(home, 'runtime', 'node', 'node.exe') : path.join(home, 'runtime', 'node', 'bin', 'node');
  write(nodeBinary, '#!/bin/sh\n', 0o755);
  write(path.join(home, 'agents', 'node_modules', '@google', 'gemini-cli', 'package.json'), JSON.stringify({ bin: { gemini: 'dist/index.js' } }));
  write(path.join(home, 'agents', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js'), '');
  gemini = await status('gemini');
  assert.equal(gemini.source, 'studio', 'the Studio install comes before the one Glist ships');
  launch = await agentLaunch('gemini', places);
  assert.equal(launch.file, nodeBinary);
  assert.deepEqual(launch.pathPrefix, [path.dirname(nodeBinary)]);
  assert.deepEqual(launch.env, { GEMINI_CLI_HOME: path.join(home, 'agents', 'config', 'gemini') }, 'its settings stay in the Glist folder');

  // A package whose command is a native program runs it directly.
  write(path.join(home, 'agents', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json'), JSON.stringify({ bin: { claude: 'bin/claude.exe' } }));
  write(path.join(home, 'agents', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), '\x7fELF native', 0o755);
  launch = await agentLaunch('claude', places);
  assert.equal(launch.file, path.join(home, 'agents', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  assert.deepEqual(launch.args, []);
  assert.equal(launch.env.CLAUDE_CONFIG_DIR, path.join(home, 'agents', 'config', 'claude'));

  // On PATH.
  write(path.join(bin, process.platform === 'win32' ? 'codex.exe' : 'codex'), '#!/bin/sh\n', 0o755);
  const codex = await status('codex');
  assert.equal(codex.source, 'system');
  assert.equal((await agentLaunch('codex', places)).env, undefined, "a system install keeps the user's own settings");
  assert.equal((await agentLaunch('codex', places)).file, path.join(bin, process.platform === 'win32' ? 'codex.exe' : 'codex'));

  // Antigravity has no installer that stays in the Glist folder.
  assert.equal((await status('antigravity')).installable, false);
  assert.equal((await status('claude')).installable, true);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('Agent tests passed.');
