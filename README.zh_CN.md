# wechat-ilink-client

[English](./README.md)

独立的 TypeScript 微信 iLink 机器人协议客户端，通过逆向 [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) 实现。

不依赖 OpenClaw 框架。零运行时依赖。一个纯粹的、无状态的库，可直接用于构建你自己的微信机器人。

## 设计原则

- **无状态** — 库本身不读写任何文件。凭据存储、游标持久化、二维码渲染完全由调用者负责。
- **零运行时依赖** — 仅使用 Node.js 内置模块。
- **最小 API** — 一个 `WeChatClient` 类覆盖大多数场景，同时导出底层原语供高级使用。

## 功能

- 二维码扫码登录（返回 URL；调用者自行渲染）
- 长轮询消息接收（`getUpdates`），游标持久化可选
- 发送文本、图片、视频、文件消息
- CDN 媒体上传/下载，AES-128-ECB 加密
- 输入状态指示器（正在输入...）
- 基于 EventEmitter 的 API
- 完整的 TypeScript 协议类型定义

## 环境要求

- Node.js >= 20

## 安装

```bash
pnpm install
pnpm build
```

## 快速开始

```typescript
import { WeChatClient, MessageType } from "wechat-ilink-client";

const client = new WeChatClient();

// 第 1 步：二维码登录
const result = await client.login({
  onQRCode(url) {
    // 你来处理二维码渲染 — 打印、显示在 GUI 中等
    console.log("请扫描此二维码:", url);
  },
});
if (!result.connected) {
  console.error("登录失败:", result.message);
  process.exit(1);
}
// 你来处理持久化 — 自行保存以下信息：
// result.botToken, result.accountId, result.baseUrl

// 第 2 步：处理收到的消息
client.on("message", async (msg) => {
  if (msg.message_type !== MessageType.USER) return;

  const text = WeChatClient.extractText(msg);
  const from = msg.from_user_id!;

  await client.sendText(from, `Echo: ${text}`);
});

// 第 3 步：启动长轮询循环（阻塞直到调用 stop()）
await client.start();
```

后续运行时，直接从已保存的凭据构造客户端：

```typescript
const client = new WeChatClient({
  accountId: savedAccountId,
  token: savedToken,
  baseUrl: savedBaseUrl,
});
// 已就绪 — 直接设置 .on("message", ...) 并调用 .start()
```

### 持久化长轮询游标

若要在重启后从上次位置恢复，向 `start()` 传入 `loadSyncBuf` / `saveSyncBuf` 回调：

```typescript
await client.start({
  loadSyncBuf: () => fs.readFileSync("sync.json", "utf-8"),
  saveSyncBuf: (buf) => fs.writeFileSync("sync.json", buf),
});
```

## 示例

### Echo Bot（回声机器人）

一个完整的示例，带有文件持久化和二维码渲染。

首先安装 `qrcode-terminal` 以在终端内渲染二维码：

```bash
pnpm add qrcode-terminal
```

然后运行：

```bash
pnpm tsx examples/echo-bot.ts          # 首次运行 — 显示二维码
pnpm tsx examples/echo-bot.ts          # 后续运行 — 恢复会话
pnpm tsx examples/echo-bot.ts --fresh  # 强制重新登录
```

或通过脚本：

```bash
pnpm echo-bot
```

> 未安装 `qrcode-terminal` 时示例仍可运行 — 会直接打印二维码 URL。

示例将凭据存储在 `~/.wechat-echo-bot/` — 这是示例自己的选择，不是库的行为。

## API 参考

### `WeChatClient`

高级客户端，继承自 `EventEmitter`。

#### 构造函数

```typescript
new WeChatClient(opts?: {
  baseUrl?: string;      // 默认: "https://ilinkai.weixin.qq.com"
  cdnBaseUrl?: string;   // 默认: "https://novac2c.cdn.weixin.qq.com/c2c"
  token?: string;        // Bearer token
  accountId?: string;    // 账户 ID
  channelVersion?: string;
  routeTag?: string;
})
```

#### 方法

| 方法 | 说明 |
|------|------|
| `login(opts?)` | 执行二维码登录。仅在内存中设置 token/accountId。**不持久化。** |
| `start(opts?)` | 启动长轮询监听。触发 `"message"` 事件。阻塞直到调用 `stop()`。 |
| `stop()` | 停止长轮询循环。 |
| `sendText(to, text, contextToken?)` | 发送文本消息。context token 自动从缓存中获取。 |
| `sendMedia(to, filePath, caption?, contextToken?)` | 上传并发送文件（根据 MIME 类型自动路由为图片/视频/文件）。 |
| `sendUploadedImage(to, uploaded, caption?, contextToken?)` | 发送已上传的图片。 |
| `sendUploadedVideo(to, uploaded, caption?, contextToken?)` | 发送已上传的视频。 |
| `sendUploadedFile(to, fileName, uploaded, caption?, contextToken?)` | 发送已上传的文件。 |
| `sendTyping(userId, typingTicket, status?)` | 发送/取消输入状态指示器。 |
| `getTypingTicket(userId, contextToken?)` | 获取用户的 typing ticket。 |
| `uploadImage(filePath, toUserId)` | 上传图片到 CDN。 |
| `uploadVideo(filePath, toUserId)` | 上传视频到 CDN。 |
| `uploadFile(filePath, toUserId)` | 上传文件到 CDN。 |
| `downloadMedia(item)` | 下载并解密 `MessageItem` 中的媒体内容。 |
| `getContextToken(userId)` | 获取用户的缓存 context token。 |
| `getAccountId()` | 获取当前账户 ID。 |

#### `start()` 选项

| 选项 | 类型 | 说明 |
|------|------|------|
| `longPollTimeoutMs` | `number` | 长轮询超时（毫秒），服务器可能覆盖此值。 |
| `signal` | `AbortSignal` | 用于外部取消。 |
| `loadSyncBuf` | `() => string \| undefined \| Promise<...>` | 启动时调用一次，加载已持久化的游标。 |
| `saveSyncBuf` | `(buf: string) => void \| Promise<void>` | 每次轮询后调用，传入新的游标值。 |

#### `login()` 选项

| 选项 | 类型 | 说明 |
|------|------|------|
| `timeoutMs` | `number` | 等待扫码的最大时间（默认: 480_000）。 |
| `botType` | `string` | bot_type 参数（默认: "3"）。 |
| `maxRefreshes` | `number` | 二维码过期后最大刷新次数（默认: 3）。 |
| `onQRCode` | `(url: string) => void` | 收到二维码 URL 时调用。**调用者自行渲染。** |
| `onStatus` | `(status) => void` | 状态变化时调用（wait/scaned/expired/confirmed）。 |
| `signal` | `AbortSignal` | 用于取消。 |

#### 事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `message` | `WeixinMessage` | 收到用户消息。 |
| `error` | `Error` | 非致命的轮询/API 错误。 |
| `sessionExpired` | _(无)_ | 服务器返回 errcode -14。机器人会自动暂停。 |
| `poll` | `GetUpdatesResp` | 每次 getUpdates 调用的原始响应。 |

#### 静态方法

| 方法 | 说明 |
|------|------|
| `WeChatClient.extractText(msg)` | 从 `WeixinMessage` 中提取文本内容。 |
| `WeChatClient.isMediaItem(item)` | 判断 `MessageItem` 是否为图片/语音/文件/视频。 |

### `ApiClient`

底层 HTTP 客户端。`WeChatClient` 内部使用，也可直接使用。

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

将原始账户 ID（如 `"hex@im.bot"`）转换为安全 key（`"hex-im-bot"`）。

## 协议概述

微信 iLink 机器人后端地址为 `https://ilinkai.weixin.qq.com`。所有 API 端点使用 `POST` + JSON 请求体（二维码登录使用 `GET`）。

### 认证

每个请求包含以下 HTTP 头：

| 请求头 | 值 |
|--------|-----|
| `Content-Type` | `application/json` |
| `AuthorizationType` | `ilink_bot_token` |
| `Authorization` | `Bearer <token>` |
| `X-WECHAT-UIN` | 随机 uint32 的 Base64 编码 |

Token 通过二维码扫码登录获取：

1. `GET ilink/bot/get_bot_qrcode?bot_type=3` — 返回二维码 URL
2. `GET ilink/bot/get_qrcode_status?qrcode=...` — 长轮询直到状态为 `"confirmed"`
3. 响应包含 `bot_token`、`ilink_bot_id`、`baseurl`

### 端点列表

| 端点 | 说明 |
|------|------|
| `ilink/bot/getupdates` | 长轮询接收消息（游标：`get_updates_buf`） |
| `ilink/bot/sendmessage` | 发送消息（文本/图片/视频/文件） |
| `ilink/bot/getuploadurl` | 获取 CDN 预签名上传参数 |
| `ilink/bot/getconfig` | 获取账户配置（typing ticket） |
| `ilink/bot/sendtyping` | 发送/取消输入状态指示器 |

### 消息结构

消息使用 `WeixinMessage` 信封，包含 `item_list` 类型化消息项：

| 类型 | 值 | 对应字段 |
|------|----|----------|
| TEXT | 1 | `text_item.text` |
| IMAGE | 2 | `image_item`（CDN 媒体引用 + AES 密钥） |
| VOICE | 3 | `voice_item`（CDN 媒体引用，可选语音转文字） |
| FILE | 4 | `file_item`（CDN 媒体引用 + 文件名） |
| VIDEO | 5 | `video_item`（CDN 媒体引用） |

收到消息中的 `context_token` 字段**必须**在所有回复中原样返回。

### CDN 媒体

所有媒体文件使用 **AES-128-ECB** 加密（PKCS7 填充，每个文件随机 16 字节密钥）。

**上传流程：**
1. 读取文件，计算 MD5 和 AES 密文大小
2. 调用 `getUploadUrl` 获取上传参数
3. AES-128-ECB 加密后 POST 到 CDN URL
4. CDN 返回 `x-encrypted-param` 响应头（即下载参数）

**下载流程：**
1. 构建 URL：`{cdnBaseUrl}/download?encrypted_query_param=...`
2. 获取密文
3. 使用 `CDNMedia` 引用中的 `aes_key` 解密

AES 密钥编码因媒体类型而异：
- 图片：`base64(原始 16 字节)`
- 文件/语音/视频：`base64(16 字节的十六进制字符串)`

## 项目结构

```
src/
  index.ts                 公共 API 导出
  client.ts                WeChatClient（高级，无状态）
  monitor.ts               长轮询 getUpdates 循环（含退避策略）
  api/
    types.ts               协议类型（消息、CDN、请求/响应）
    client.ts              底层 HTTP ApiClient
  auth/
    qr-login.ts            二维码登录流程（仅返回 URL，不渲染）
  cdn/
    aes-ecb.ts             AES-128-ECB 加密/解密
    cdn-url.ts             CDN URL 构建器
    cdn-upload.ts          加密上传到 CDN
    cdn-download.ts        从 CDN 下载并解密
  media/
    upload.ts              文件 -> CDN 上传流水线
    download.ts            从收到的消息中下载媒体
    send.ts                构建并发送文本/图片/视频/文件消息
  util/
    mime.ts                MIME 类型 <-> 扩展名映射
    random.ts              ID 和文件名生成
examples/
  echo-bot.ts              完整的回声机器人（带有自己的持久化和二维码渲染）
```

## 许可证

MIT
