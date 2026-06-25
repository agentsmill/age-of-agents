// Dev-entry: w trybie deweloperskim klienta serwuje Vite (proxy na /ws, /hooks...).
// npm distribution uses src/cli.ts (with webRoot). Do NOT pass webRoot here.
import { SERVER_PORT } from '@agent-citadel/shared';
import { startServer } from './server.js';

// Safety net: a single unhandled error must not shut down the visualization
// server, which would leave the client without a data source. Log and keep going.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection — server keeps running:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — server keeps running:', err);
});

const demo = process.argv.includes('--demo');
const server = await startServer({ port: SERVER_PORT, host: '127.0.0.1', demo });
console.log(`Age of Agents server (dev): ${server.url} (ws: /ws)`);
if (demo) console.log('Demo mode: scenario generator started');
