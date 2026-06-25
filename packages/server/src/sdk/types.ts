import type { SdkPermissionMode } from '@agent-citadel/shared';

export interface LaunchParams {
  cwd: string;
  prompt: string;
  model?: string;
  permissionMode: SdkPermissionMode;
}

/** A running agent session the app owns. */
export interface LiveSession {
  /** Claude session id once known (from the SDK init message). */
  sessionId?: string;
  /** Stop the session (SDK interrupt + abort). */
  stop(): Promise<void>;
  /** Push a follow-up user message into the live session. */
  pushText(text: string): void;
}

/** Abstraction over the Claude Agent SDK so the rest of the app is testable. */
export interface SdkRunner {
  /** Whether the underlying SDK is installed/usable. */
  available(): Promise<boolean>;
  /**
   * Launch a session. `onSessionId` fires once the SDK reports the session id.
   * Resolves to a handle for control (stop / pushText).
   */
  launch(params: LaunchParams, hooks: { onSessionId: (id: string) => void }): Promise<LiveSession>;
}
