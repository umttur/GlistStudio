import path from 'node:path';
import webpack from 'webpack';
import { webConfig } from '../../webpack.web.config';

// Builds the browser bundle once for the whole suite, into out/e2e-web so a
// running npm run web (out/web) is left alone. Types are not checked here;
// that is tsc's job in the checks.
const output = path.resolve(process.env.E2E_BUNDLE ?? path.join(__dirname, '..', '..', 'out', 'e2e-web'));
const started = Date.now();
webpack({
  ...webConfig,
  output: { ...webConfig.output, path: output },
  plugins: (webConfig.plugins ?? []).filter((plugin) => plugin?.constructor.name !== 'ForkTsCheckerWebpackPlugin'),
}, (error, stats) => {
  if (error || stats?.hasErrors()) {
    console.error(error ?? stats?.toString('errors-only'));
    process.exit(1);
  }
  console.log(`Web bundle built in ${Date.now() - started} ms, in ${path.relative(process.cwd(), output)}.`);
});
