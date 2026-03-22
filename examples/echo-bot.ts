#!/usr/bin/env npx tsx
/**
 * Echo Bot — a complete example using wechat-ilink-client.
 *
 * Demonstrates:
 *   - File-based credential persistence (the library itself is stateless)
 *   - QR code rendering via qrcode-terminal (the library only returns URLs)
 *   - Sync buf persistence for message resume across restarts
 *   - Echoing back every message type: text, image, video, file, voice
 *
 * Prerequisites:
 *   pnpm add qrcode-terminal               # for inline QR code rendering
 *
 * Usage:
 *   pnpm tsx examples/echo-bot.ts           # first run — shows QR code
 *   pnpm tsx examples/echo-bot.ts           # subsequent runs — resumes session
 *   pnpm tsx examples/echo-bot.ts --fresh   # force new QR login
 *
 * Press Ctrl+C to stop.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  WeChatClient,
  normalizeAccountId,
  MessageType,
  MessageItemType,
  type WeixinMessage,
  type MessageItem,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Simple file-based persistence (example only — use your own storage)
// ---------------------------------------------------------------------------

const STATE_DIR = path.join(os.homedir(), ".wechat-echo-bot");
const TEMP_DIR = path.join(STATE_DIR, "tmp");

interface SavedCredentials {
  accountId: string;
  token: string;
  baseUrl?: string;
  userId?: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function credentialsPath(): string {
  return path.join(STATE_DIR, "credentials.json");
}

function syncBufPath(): string {
  return path.join(STATE_DIR, "sync-buf.json");
}

function loadCredentials(): SavedCredentials | null {
  try {
    const raw = fs.readFileSync(credentialsPath(), "utf-8");
    return JSON.parse(raw) as SavedCredentials;
  } catch {
    return null;
  }
}

function saveCredentials(creds: SavedCredentials): void {
  ensureDir(STATE_DIR);
  const filePath = credentialsPath();
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), "utf-8");
  try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
}

function loadSyncBuf(): string | undefined {
  try {
    const raw = fs.readFileSync(syncBufPath(), "utf-8");
    const data = JSON.parse(raw) as { buf?: string };
    return data.buf;
  } catch {
    return undefined;
  }
}

function saveSyncBuf(buf: string): void {
  ensureDir(STATE_DIR);
  fs.writeFileSync(syncBufPath(), JSON.stringify({ buf }), "utf-8");
}

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

const MEDIA_EXTENSIONS: Record<string, string> = {
  image: ".jpg",
  video: ".mp4",
  voice: ".silk",
  file: ".bin",
};

/**
 * Write a buffer to a temp file and return its path.
 * The caller can pass a preferred filename (for file attachments).
 */
function writeTempFile(data: Buffer, kind: string, fileName?: string): string {
  ensureDir(TEMP_DIR);
  const ext = fileName
    ? path.extname(fileName) || MEDIA_EXTENSIONS[kind] || ".bin"
    : MEDIA_EXTENSIONS[kind] || ".bin";
  const name = fileName ?? `echo-${kind}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const filePath = path.join(TEMP_DIR, name);
  fs.writeFileSync(filePath, data);
  return filePath;
}

function cleanupTempFile(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// QR code rendering (example — uses qrcode-terminal if available)
// ---------------------------------------------------------------------------

async function renderQRCode(url: string): Promise<void> {
  try {
    const qrt = await import("qrcode-terminal");
    qrt.default.generate(url, { small: true });
  } catch {
    console.log(`QR Code URL: ${url}`);
    console.log("(install qrcode-terminal for inline QR rendering)");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(msg: string): void {
  console.log(`[${timestamp()}] ${msg}`);
}

function describeItems(items: MessageItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    switch (item.type) {
      case MessageItemType.TEXT:
        parts.push(`text: "${item.text_item?.text ?? ""}"`);
        break;
      case MessageItemType.IMAGE:
        parts.push(`image (mid_size=${item.image_item?.mid_size ?? "?"})`);
        break;
      case MessageItemType.VOICE:
        parts.push(
          `voice (${item.voice_item?.playtime ?? "?"}ms)` +
            (item.voice_item?.text ? ` [STT: "${item.voice_item.text}"]` : ""),
        );
        break;
      case MessageItemType.FILE:
        parts.push(`file: "${item.file_item?.file_name ?? "?"}" (${item.file_item?.len ?? "?"} bytes)`);
        break;
      case MessageItemType.VIDEO:
        parts.push(`video (${item.video_item?.play_length ?? "?"}s)`);
        break;
      default:
        parts.push(`unknown type=${item.type}`);
    }
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Media echo: download -> save to temp -> re-upload and send back
// ---------------------------------------------------------------------------

/**
 * Download a media item from an inbound message, then re-upload and send
 * it back to the sender. Returns true if a media item was echoed.
 */
async function echoMediaItem(
  client: WeChatClient,
  from: string,
  item: MessageItem,
  caption?: string,
): Promise<boolean> {
  const downloaded = await client.downloadMedia(item);
  if (!downloaded) return false;

  const tempPath = writeTempFile(downloaded.data, downloaded.kind, downloaded.fileName);
  try {
    await client.sendMedia(from, tempPath, caption);
    log(`--> [${from}] echoed ${downloaded.kind} (${downloaded.data.length} bytes)${caption ? ` + "${caption}"` : ""}`);
  } finally {
    cleanupTempFile(tempPath);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const forceFresh = process.argv.includes("--fresh");

  // --- Step 1: Try resuming from saved credentials -------------------------

  let client: WeChatClient | null = null;

  if (!forceFresh) {
    const creds = loadCredentials();
    if (creds) {
      client = new WeChatClient({
        accountId: creds.accountId,
        token: creds.token,
        baseUrl: creds.baseUrl,
      });
      log(`Resumed session for account: ${creds.accountId}`);
    }
  }

  // --- Step 2: If no session, run QR login ---------------------------------

  if (!client) {
    log("No saved session. Starting QR code login...");
    log("Scan the QR code with WeChat:\n");

    client = new WeChatClient();

    const result = await client.login({
      timeoutMs: 5 * 60_000,
      onQRCode: renderQRCode,
      onStatus(status) {
        switch (status) {
          case "scaned":
            log("QR scanned! Confirm on your phone...");
            break;
          case "expired":
            log("QR expired, refreshing...");
            break;
          case "confirmed":
            log("Login confirmed!");
            break;
        }
      },
    });

    if (!result.connected) {
      console.error(`Login failed: ${result.message}`);
      process.exit(1);
    }

    log(`Logged in as ${result.accountId}`);

    saveCredentials({
      accountId: normalizeAccountId(result.accountId!),
      token: result.botToken!,
      baseUrl: result.baseUrl,
      userId: result.userId,
    });
    log(`Credentials saved to ${credentialsPath()}`);
  }

  // --- Step 3: Set up message handler (echo) -------------------------------

  client.on("message", async (msg: WeixinMessage) => {
    const from = msg.from_user_id ?? "(unknown)";
    const items = msg.item_list ?? [];

    if (msg.message_type !== MessageType.USER) return;

    log(`<-- [${from}] ${describeItems(items)}`);

    const text = WeChatClient.extractText(msg);
    const mediaItems = items.filter((i) => WeChatClient.isMediaItem(i));

    try {
      if (mediaItems.length > 0) {
        // Echo each media item back, with text as caption on the first one
        for (let i = 0; i < mediaItems.length; i++) {
          const caption = i === 0 && text ? `Echo: ${text}` : undefined;
          const echoed = await echoMediaItem(client!, from, mediaItems[i], caption);
          if (!echoed) {
            // Download/upload failed for this item — fall back to text description
            log(`    [${from}] could not echo media item type=${mediaItems[i].type}, skipping`);
          }
        }
        // If there was text but no media was successfully echoed, send text reply
        if (text && !mediaItems.some((_, idx) => idx >= 0)) {
          await client!.sendText(from, `Echo: ${text}`);
        }
      } else if (text) {
        // Pure text message — echo it back
        const reply = `Echo: ${text}`;
        await client!.sendText(from, reply);
        log(`--> [${from}] ${reply}`);
      } else {
        // Empty message
        await client!.sendText(from, "Received an empty message.");
        log(`--> [${from}] (empty message ack)`);
      }
    } catch (err) {
      log(`Error replying to ${from}: ${err}`);
    }
  });

  client.on("error", (err: Error) => {
    log(`Poll error: ${err.message}`);
  });

  client.on("sessionExpired", () => {
    log("Session expired! Bot will pause and retry automatically.");
    log("If this persists, re-run with --fresh to re-login.");
  });

  // --- Step 4: Start the long-poll loop ------------------------------------

  log("Echo bot is running. Press Ctrl+C to stop.\n");

  const shutdown = () => {
    log("\nStopping...");
    client!.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await client.start({
    loadSyncBuf,
    saveSyncBuf,
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
