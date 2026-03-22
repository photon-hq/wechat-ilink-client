/**
 * Long-poll monitor loop.
 *
 * Continuously calls getUpdates and emits inbound messages via a callback.
 * Handles error backoff and session expiry.
 *
 * Sync buf (cursor) persistence is fully controlled by the caller via
 * optional `loadSyncBuf` / `saveSyncBuf` callbacks in MonitorOptions.
 */
import type { ApiClient } from "./api/client.js";
import type { WeixinMessage, GetUpdatesResp } from "./api/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

/** Error code returned by the server when the bot session has expired. */
export const SESSION_EXPIRED_ERRCODE = -14;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitorOptions {
  /** Long-poll timeout in ms. Server may override via longpolling_timeout_ms. */
  longPollTimeoutMs?: number;
  /** AbortSignal for stopping the loop. */
  signal?: AbortSignal;
  /**
   * Called once at startup to load a previously persisted sync cursor.
   * Return the cursor string, or undefined/empty to start fresh.
   */
  loadSyncBuf?: () => string | undefined | Promise<string | undefined>;
  /**
   * Called after each successful getUpdates with the new cursor value.
   * The caller can persist this for resume across restarts.
   */
  saveSyncBuf?: (buf: string) => void | Promise<void>;
}

export interface MonitorCallbacks {
  /** Called for each inbound message. */
  onMessage: (msg: WeixinMessage) => void | Promise<void>;
  /** Called when getUpdates returns an error response. */
  onError?: (err: Error) => void;
  /** Called when the bot session has expired (errcode -14). */
  onSessionExpired?: () => void;
  /** Called after each successful getUpdates response. */
  onPoll?: (resp: GetUpdatesResp) => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Start the long-poll monitor loop. Runs until the AbortSignal fires.
 */
export async function startMonitor(
  api: ApiClient,
  opts: MonitorOptions,
  callbacks: MonitorCallbacks,
): Promise<void> {
  const { signal } = opts;

  // Load persisted cursor via caller-provided callback
  let getUpdatesBuf = "";
  if (opts.loadSyncBuf) {
    const loaded = await opts.loadSyncBuf();
    if (loaded) {
      getUpdatesBuf = loaded;
    }
  }

  let nextTimeoutMs =
    opts.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (!signal?.aborted) {
    try {
      const resp = await api.getUpdates(getUpdatesBuf, nextTimeoutMs);

      // Server-suggested timeout
      if (
        resp.longpolling_timeout_ms != null &&
        resp.longpolling_timeout_ms > 0
      ) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      // Check for API errors
      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE ||
          resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          callbacks.onSessionExpired?.();
          // Pause for 1 hour
          await sleep(60 * 60 * 1000, signal);
          consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures++;
        callbacks.onError?.(
          new Error(
            `getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""}`,
          ),
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, signal);
        } else {
          await sleep(RETRY_DELAY_MS, signal);
        }
        continue;
      }

      // Success
      consecutiveFailures = 0;
      callbacks.onPoll?.(resp);

      // Persist cursor via caller-provided callback
      if (
        resp.get_updates_buf != null &&
        resp.get_updates_buf !== ""
      ) {
        getUpdatesBuf = resp.get_updates_buf;
        if (opts.saveSyncBuf) {
          await opts.saveSyncBuf(getUpdatesBuf);
        }
      }

      // Dispatch messages
      const msgs = resp.msgs ?? [];
      for (const msg of msgs) {
        await callbacks.onMessage(msg);
      }
    } catch (err) {
      if (signal?.aborted) return;
      consecutiveFailures++;
      callbacks.onError?.(
        err instanceof Error
          ? err
          : new Error(String(err)),
      );

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, signal);
      } else {
        await sleep(RETRY_DELAY_MS, signal);
      }
    }
  }
}
