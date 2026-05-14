import { Command } from './commands/Command';
import { auth } from './firebase';
import { writeAuditLog } from './auditLog';

/**
 * Middleware signature: receives the command and a `next` function that
 * resolves with the result of the rest of the chain (the next middleware
 * if any, otherwise the command's own `execute()`). Wrap `next()` to
 * intercept errors, time the call, etc.
 */
export type Middleware = <T>(
  command: Command<T>,
  next: () => Promise<T>,
) => Promise<T>;

const middlewares: Middleware[] = [];

/** Register a middleware. They run in registration order, outermost-first. */
export function registerMiddleware(mw: Middleware): void {
  middlewares.push(mw);
}

/**
 * Dispatch a command through the middleware chain. Components MUST go
 * through this entry point instead of calling dbService directly so that
 * audit / logging / future cross-cutting concerns land everywhere.
 */
export async function dispatch<T>(command: Command<T>): Promise<T> {
  let i = 0;
  const run = async (): Promise<T> => {
    if (i < middlewares.length) {
      const mw = middlewares[i++];
      return mw(command, run);
    }
    return command.execute();
  };
  return run();
}

// ── Default middleware: audit log every dispatch ─────────────────────────────
// Wraps `next()` so both success and failure get an audit row. Errors are
// re-thrown so callers still see them; the audit write is fire-and-forget.
registerMiddleware(async (command, next) => {
  const startedAt = Date.now();
  const actorEmail = auth.currentUser?.email || 'unknown';
  try {
    const result = await next();
    writeAuditLog({
      type:       command.type,
      payload:    command.payload(),
      actorEmail,
      at:         startedAt,
      success:    true,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err: any) {
    writeAuditLog({
      type:       command.type,
      payload:    command.payload(),
      actorEmail,
      at:         startedAt,
      success:    false,
      error:      err?.message ?? String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err;
  }
});
