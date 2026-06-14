// Dev-entry: w trybie deweloperskim klienta serwuje Vite (proxy na /ws, /hooks...).
// Dystrybucja npm używa src/cli.ts (z webRoot). Tu NIE podajemy webRoot.
import { SERVER_PORT } from '@agent-citadel/shared';
import { startServer } from './server.js';

// Siatka bezpieczeństwa: pojedynczy nieobsłużony błąd nie może wygasić serwera
// wizualizacji — wtedy klient zostaje bez źródła danych. Logujemy i działamy dalej.
process.on('unhandledRejection', (reason) => {
  console.error('Nieobsłużone odrzucenie obietnicy — serwer działa dalej:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Nieobsłużony wyjątek — serwer działa dalej:', err);
});

const demo = process.argv.includes('--demo');
const server = await startServer({ port: SERVER_PORT, host: '127.0.0.1', demo });
console.log(`Agent Citadel server (dev): ${server.url} (ws: /ws)`);
if (demo) console.log('Tryb demo: generator scenariuszy uruchomiony');
