import { WS_PATH, type GameEvent } from '@agent-citadel/shared';
import { useWorld } from './store';

let activeSocket: WebSocket | undefined;

/** Połączenie WS z auto-reconnectem; snapshot przy każdym połączeniu nadpisuje stan. */
export function connectWorld(): void {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}${WS_PATH}`;
  let retryMs = 1000;

  const open = () => {
    const socket = new WebSocket(url);
    activeSocket = socket;
    socket.onopen = () => {
      retryMs = 1000;
      useWorld.getState().setConnected(true);
    };
    socket.onmessage = (msg) => {
      // Tryb Chronicle (#7): replay włada światem — żywe eventy ignorujemy.
      if (useWorld.getState().replayMode) return;
      const event = JSON.parse(msg.data as string) as GameEvent;
      useWorld.getState().apply(event);
    };
    socket.onclose = () => {
      useWorld.getState().setConnected(false);
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
  };

  open();
}

/** Wymusza świeży snapshot live (po wyjściu z Chronicle): zamknięcie → reconnect. */
export function reconnectWorld(): void {
  activeSocket?.close();
}
