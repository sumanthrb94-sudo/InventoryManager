/**
 * Base contract for every command. Commands are typed, serialisable
 * intent objects — they describe *what* should happen, not *how*. The
 * command bus is responsible for running the chain of middleware
 * (logging, audit, error wrap) before finally invoking `execute()`,
 * which does the actual work (typically a single dbService call).
 *
 * Rules:
 *   - `type` must be a unique, stable string (used as the audit-log
 *     event type). Use PascalCase.
 *   - `payload()` returns the public, JSON-serialisable arguments —
 *     this is what ends up in /commandLog. NEVER include secrets,
 *     tokens, or large blobs (images).
 *   - `execute()` runs the side effect. Keep it small; cross-cutting
 *     concerns belong in middleware.
 */
export interface Command<TResult = void> {
  readonly type: string;
  payload(): Record<string, unknown>;
  execute(): Promise<TResult>;
}
