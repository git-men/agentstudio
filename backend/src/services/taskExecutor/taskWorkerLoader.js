/**
 * Bootstrap loader for taskWorker.ts in tsx dev mode.
 * Worker threads cannot directly load .ts files, so this .js file
 * registers the tsx CJS loader first, then requires the actual TypeScript worker.
 */
require('tsx/cjs');
require('./taskWorker.ts');
