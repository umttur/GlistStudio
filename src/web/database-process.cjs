// The browser build's SQLite process (database-process.ts), run from its
// TypeScript source as scripts/web.ts runs the server: web/server.ts forks it.
const { createJiti } = require('jiti');

createJiti(__filename)('../database-process.ts');
