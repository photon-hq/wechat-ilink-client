# wechat-ilink-client

[简体中文](./README.zh_CN.md)

Standalone TypeScript client for the WeChat iLink bot protocol, reverse-engineered from [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin).

No dependency on the OpenClaw framework. Zero runtime dependencies. A pure, stateless library you can use to build your own WeChat bots.

## Design Principles

- **Stateless** — the library does NOT read or write files. Credential storage, sync buf persistence, and QR code rendering are entirely the caller's responsibility.
- **Zero runtime dependencies** — only Node.js built-ins.
- **Minimal API surface** — a single `WeChatClient` class for most use cases, with lower-level primitives exported for advanced usage.

## Features

- QR code login (returns the URL; caller handles rendering)
- Long-poll message receiving (`getUpdates`) with opt-in cursor persistence
- Send text, image, video, and file messages
- CDN media upload/download with AES-128-ECB encryption
- Typing indicator support
- EventEmitter-based API
- Full TypeScript types for the entire protocol

## Requirements

- Node.js >= 20

## Install

```bash
pnpm install
pnpm build
```

## Quick Start

```typescript
import { WeChatClient, MessageType } from "wechat-ilink-client";

const client = new WeChatClient();

// Step 1: Login via QR code
const result = await client.login({
  onQRCode(url) {
    // You handle QR rendering — print it, show it in a GUI, etc.
    console.log("Scan this QR code:", url);
  },
});
if (!result.connected) {
  console.error("Login failed:", result.message);
  process.exit(1);
}
// You handle persistence — save these yourself:
// result.botToken, result.accountId, result.baseUrl

// Step 2: Handle incoming messages
client.on("message", async (msg) => {
  if (msg.message_type !== MessageType.USER) return;

  const text = WeChatClient.extractText(msg);
  const from = msg.from_user_id!;

  await client.sendText(from, `Echo: ${text}`);
});

// Step 3: Start the long-poll loop (blocks until stop() is called)
await client.start();
```

On subsequent runs, construct the client directly from saved credentials:

```typescript
const client = new WeChatClient({
  accountId: savedAccountId,
  token: savedToken,
  baseUrl: savedBaseUrl,
});
// Ready — go straight to .on("message", ...) and .start()
```

### Persisting the Long-Poll Cursor

To resume from where you left off across restarts, pass `loadSyncBuf` / `saveSyncBuf` callbacks to `start()`:

```typescript
await client.start({
  loadSyncBuf: () => fs.readFileSync("sync.json", "utf-8"),
  saveSyncBuf: (buf) => fs.writeFileSync("sync.json", buf),
});
```

## Examples

### Echo Bot

A complete working bot with file-based persistence and QR rendering.

First, install `qrcode-terminal` to render QR codes inline in your terminal:

```bash
pnpm add qrcode-terminal
```

Then run:

```bash
pnpm tsx examples/echo-bot.ts          # first run — shows QR code
pnpm tsx examples/echo-bot.ts          # subsequent — resumes session
pnpm tsx examples/echo-bot.ts --fresh  # force re-login
```

Or via the script:

```bash
pnpm echo-bot
```

> Without `qrcode-terminal` the example still works — it prints the QR code URL instead.

The example stores credentials at `~/.wechat-echo-bot/` — this is the example's choice, not the library's.

## API Reference

### `WeChatClient`

The high-level client. Extends `EventEmitter`.

#### Constructor

```typescript
new WeChatClient(opts?: {
  baseUrl?: string;      // default: "https://ilinkai.weixin.qq.com"
  cdnBaseUrl?: string;   // default: "https://novac2c.cdn.weixin.qq.com/c2c"
  token?: string;        // bearer token
  accountId?: string;    // account ID
  channelVersion?: string;
  routeTag?: string;
})
```

#### Methods

| Method | Description |
|--------|-------------|
| `login(opts?)` | Run QR code login. Sets token/accountId in memory. Does NOT persist. |
| `start(opts?)` | Start the long-poll monitor. Emits `"message"` events. Blocks until `stop()`. |
| `stop()` | Stop the long-poll loop. |
| `sendText(to, text, contextToken?)` | Send a text message. Context token is auto-resolved from cache. |
| `sendMedia(to, filePath, caption?, contextToken?)` | Upload and send a file (image/video/file routed by MIME type). |
| `sendUploadedImage(to, uploaded, caption?, contextToken?)` | Send a previously uploaded image. |
| `sendUploadedVideo(to, uploaded, caption?, contextToken?)` | Send a previously uploaded video. |
| `sendUploadedFile(to, fileName, uploaded, caption?, contextToken?)` | Send a previously uploaded file. |
| `sendTyping(userId, typingTicket, status?)` | Send/cancel typing indicator. |
| `getTypingTicket(userId, contextToken?)` | Fetch the typing ticket for a user. |
| `uploadImage(filePath, toUserId)` | Upload an image to CDN. |
| `uploadVideo(filePath, toUserId)` | Upload a video to CDN. |
| `uploadFile(filePath, toUserId)` | Upload a file to CDN. |
| `downloadMedia(item)` | Download and decrypt a media `MessageItem`. |
| `getContextToken(userId)` | Get the cached context token for a user. |
| `getAccountId()` | Get the current account ID. |

#### `start()` Options

| Option | Type | Description |
|--------|------|-------------|
| `longPollTimeoutMs` | `number` | Long-poll timeout in ms. Server may override. |
| `signal` | `AbortSignal` | For external cancellation. |
| `loadSyncBuf` | `() => string \| undefined \| Promise<...>` | Called once at startup to load a persisted cursor. |
| `saveSyncBuf` | `(buf: string) => void \| Promise<void>` | Called after each poll with the new cursor. |

#### `login()` Options

| Option | Type | Description |
|--------|------|-------------|
| `timeoutMs` | `number` | Max wait for QR scan (default: 480_000). |
| `botType` | `string` | bot_type parameter (default: "3"). |
| `maxRefreshes` | `number` | Max QR refreshes on expiry (default: 3). |
| `onQRCode` | `(url: string) => void` | Called with the QR code URL. **Caller renders.** |
| `onStatus` | `(status) => void` | Called on status changes (wait/scaned/expired/confirmed). |
| `signal` | `AbortSignal` | For cancellation. |

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `WeixinMessage` | Inbound message from a user. |
| `error` | `Error` | Non-fatal poll/API error. |
| `sessionExpired` | _(none)_ | Server returned errcode -14. Bot pauses automatically. |
| `poll` | `GetUpdatesResp` | Raw response from each getUpdates call. |

#### Static Methods

| Method | Description |
|--------|-------------|
| `WeChatClient.extractText(msg)` | Extract text body from a `WeixinMessage`. |
| `WeChatClient.isMediaItem(item)` | Check if a `MessageItem` is image/voice/file/video. |

### `ApiClient`

Low-level HTTP client. Used internally by `WeChatClient`, also exported for direct use.

```typescript
const api = new ApiClient({ baseUrl, token });

await api.getUpdates(syncBuf, timeoutMs);
await api.sendMessage(req);
await api.getUploadUrl(req);
await api.getConfig(userId, contextToken);
await api.sendTyping(req);
await api.getQRCode(botType);
await api.pollQRCodeStatus(qrcode);
```

### `normalizeAccountId(raw)`

Converts a raw account ID (e.g. `"hex@im.bot"`) to a safe key (`"hex-im-bot"`).

## Protocol Overview

The WeChat iLink bot backend lives at `https://ilinkai.weixin.qq.com`. All API endpoints use `POST` with JSON bodies (except QR login which uses `GET`).

### Authentication

Every request includes these headers:

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `AuthorizationType` | `ilink_bot_token` |
| `Authorization` | `Bearer <token>` |
| `X-WECHAT-UIN` | Base64 of a random uint32 |

The token is obtained through QR code login:

1. `GET ilink/bot/get_bot_qrcode?bot_type=3` — returns a QR code URL
2. `GET ilink/bot/get_qrcode_status?qrcode=...` — long-poll until `"confirmed"`
3. Response includes `bot_token`, `ilink_bot_id`, `baseurl`

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `ilink/bot/getupdates` | Long-poll for inbound messages (cursor: `get_updates_buf`) |
| `ilink/bot/sendmessage` | Send a message (text/image/video/file) |
| `ilink/bot/getuploadurl` | Get CDN pre-signed upload parameters |
| `ilink/bot/getconfig` | Get account config (typing ticket) |
| `ilink/bot/sendtyping` | Send/cancel typing indicator |

### Message Structure

Messages use a `WeixinMessage` envelope containing an `item_list` of typed items:

| Type | Value | Item field |
|------|-------|------------|
| TEXT | 1 | `text_item.text` |
| IMAGE | 2 | `image_item` (CDN media ref + AES key) |
| VOICE | 3 | `voice_item` (CDN media ref, optional STT text) |
| FILE | 4 | `file_item` (CDN media ref + filename) |
| VIDEO | 5 | `video_item` (CDN media ref) |

The `context_token` field on inbound messages **must** be echoed back in all replies.

### CDN Media

All media is encrypted with **AES-128-ECB** (PKCS7 padding, random 16-byte key per file).

**Upload flow:**
1. Read file, compute MD5 and AES ciphertext size
2. Call `getUploadUrl` with file metadata
3. Encrypt with AES-128-ECB, POST to CDN URL
4. CDN returns `x-encrypted-param` header (the download param)

**Download flow:**
1. Build URL: `{cdnBaseUrl}/download?encrypted_query_param=...`
2. Fetch ciphertext
3. Decrypt with the `aes_key` from the `CDNMedia` reference

AES key encoding varies by media type:
- Images: `base64(raw 16 bytes)`
- Files/voice/video: `base64(hex string of 16 bytes)`

## Project Structure

```
src/
  index.ts                 Public API exports
  client.ts                WeChatClient (high-level, stateless)
  monitor.ts               Long-poll getUpdates loop with backoff
  api/
    types.ts               Protocol types (messages, CDN, requests/responses)
    client.ts              Low-level HTTP ApiClient
  auth/
    qr-login.ts            QR code login flow (returns URL, no rendering)
  cdn/
    aes-ecb.ts             AES-128-ECB encrypt/decrypt
    cdn-url.ts             CDN URL builders
    cdn-upload.ts          Encrypted upload to CDN
    cdn-download.ts        Download + decrypt from CDN
  media/
    upload.ts              File -> CDN upload pipeline
    download.ts            Download media from inbound messages
    send.ts                Build and send text/image/video/file messages
  util/
    mime.ts                MIME type <-> extension mapping
    random.ts              ID and filename generation
examples/
  echo-bot.ts              Complete echo bot (with its own persistence + QR rendering)
```

## License

MIT
