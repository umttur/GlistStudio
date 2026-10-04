import path from 'node:path';
import { startWebServer } from '../../src/web/server';

// The browser build's server without its webpack watch: the suite builds the
// bundle once (run.mjs) and starts one of these per test, each with its own
// port, token and workspace (common.mjs).
//   E2E_BUNDLE             the built bundle (out/e2e-web)
//   GLIST_STUDIO_PORT      port to listen on
//   GLIST_STUDIO_PROJECTS  the projects folder
//   GLIST_STUDIO_TOKEN     access token
const root = path.resolve(__dirname, '..', '..');

startWebServer({
  port: Number(process.env.GLIST_STUDIO_PORT),
  staticRoot: path.resolve(process.env.E2E_BUNDLE ?? path.join(root, 'out', 'e2e-web')),
  templateRoot: path.join(root, 'glistapp-template'),
  projectsDirectory: path.resolve(process.env.GLIST_STUDIO_PROJECTS ?? ''),
  token: process.env.GLIST_STUDIO_TOKEN ?? '',
  sourceRoot: root,
}).then(() => {
  console.log(`listening on ${process.env.GLIST_STUDIO_PORT}`);
}, (error: Error) => {
  console.error(`Could not start the server: ${error.message}`);
  process.exit(1);
});
