/**
 * QR code login flow for the WeChat iLink bot protocol.
 *
 * Flow:
 *   1. GET ilink/bot/get_bot_qrcode?bot_type=3 -> { qrcode, qrcode_img_content }
 *   2. Caller renders the QR code (library only returns the URL)
 *   3. Long-poll GET ilink/bot/get_qrcode_status?qrcode=... until "confirmed"
 *   4. Extract bot_token, ilink_bot_id, baseurl, ilink_user_id
 */
import type { ApiClient } from "../api/client.js";
import type { QRCodeStatusResponse } from "../api/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginResult {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
}

export interface QRLoginOptions {
  /** Maximum time to wait for QR scan (ms). Default: 480_000 (8 min). */
  timeoutMs?: number;
  /** bot_type parameter (default: "3"). */
  botType?: string;
  /** Maximum number of QR code refreshes on expiry. Default: 3. */
  maxRefreshes?: number;
  /**
   * Called when a QR code URL is available (initial and on refresh).
   * The caller is responsible for rendering the QR code.
   */
  onQRCode?: (qrcodeUrl: string) => void | Promise<void>;
  /** Called when status changes. */
  onStatus?: (status: QRCodeStatusResponse["status"]) => void;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Login implementation
// ---------------------------------------------------------------------------

/**
 * Run the full QR code login flow. Returns a LoginResult.
 *
 * The library does NOT render QR codes — use `opts.onQRCode` to receive
 * the QR code URL and handle display yourself.
 */
export async function loginWithQRCode(
  api: ApiClient,
  opts: QRLoginOptions = {},
): Promise<LoginResult> {
  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000);
  const maxRefreshes = opts.maxRefreshes ?? 3;
  const deadline = Date.now() + timeoutMs;
  let refreshCount = 1;

  // Step 1: fetch initial QR code
  const qrResponse = await api.getQRCode(opts.botType);
  let qrcode = qrResponse.qrcode;

  // Notify caller with QR code URL
  if (opts.onQRCode) {
    await opts.onQRCode(qrResponse.qrcode_img_content);
  }

  // Step 2: poll until confirmed, expired (refresh), or timeout
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      return { connected: false, message: "Login cancelled." };
    }

    const status = await api.pollQRCodeStatus(qrcode);
    opts.onStatus?.(status.status);

    switch (status.status) {
      case "wait":
        break;

      case "scaned":
        break;

      case "expired": {
        refreshCount++;
        if (refreshCount > maxRefreshes) {
          return {
            connected: false,
            message: `QR code expired ${maxRefreshes} times. Please restart login.`,
          };
        }
        // Fetch a new QR code
        const refreshed = await api.getQRCode(opts.botType);
        qrcode = refreshed.qrcode;
        if (opts.onQRCode) {
          await opts.onQRCode(refreshed.qrcode_img_content);
        }
        break;
      }

      case "confirmed": {
        if (!status.ilink_bot_id) {
          return {
            connected: false,
            message:
              "Login confirmed but server did not return ilink_bot_id.",
          };
        }
        return {
          connected: true,
          botToken: status.bot_token,
          accountId: status.ilink_bot_id,
          baseUrl: status.baseurl,
          userId: status.ilink_user_id,
          message: "Login successful!",
        };
      }
    }

    // Brief pause between polls
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { connected: false, message: "Login timed out." };
}
