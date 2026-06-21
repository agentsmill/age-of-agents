import { WS_PATH, type GameEvent, type QuestionAnswer } from '@agent-citadel/shared';
import { useWorld } from './store';

let current: WebSocket | undefined;

/** WS connection with auto-reconnect; the snapshot on each connection overwrites state. */
export function connectWorld(): void {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}${WS_PATH}`;
  let retryMs = 1000;

  const open = () => {
    const socket = new WebSocket(url);
    current = socket;
    socket.onopen = () => {
      retryMs = 1000;
      useWorld.getState().setConnected(true);
    };
    socket.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as GameEvent;
      useWorld.getState().apply(event);
    };
    socket.onclose = () => {
      if (current === socket) current = undefined;
      useWorld.getState().setConnected(false);
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
  };

  open();
}

/** Sends a panel answer to a pending agent question. No-op if disconnected. */
export function sendAnswer(answer: QuestionAnswer): void {
  if (current && current.readyState === WebSocket.OPEN) {
    current.send(JSON.stringify({ type: 'answer', payload: answer }));
  }
}
