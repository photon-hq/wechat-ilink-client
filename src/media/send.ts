/**
 * High-level message sending helpers.
 *
 * Builds SendMessageReq payloads for text, image, video, and file messages,
 * and dispatches them through the ApiClient.
 */
import path from "node:path";

import type { ApiClient } from "../api/client.js";
import type {
  MessageItem,
  SendMessageReq,
} from "../api/types.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
} from "../api/types.js";
import { getMimeFromFilename } from "../util/mime.js";
import type { UploadedFileInfo } from "./upload.js";
import { uploadImage, uploadVideo, uploadFile } from "./upload.js";
import { generateId } from "../util/random.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateClientId(): string {
  return generateId("wechat-ilink");
}

function buildReq(params: {
  to: string;
  contextToken?: string;
  items: MessageItem[];
}): SendMessageReq {
  return {
    msg: {
      from_user_id: "",
      to_user_id: params.to,
      client_id: generateClientId(),
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: params.items.length ? params.items : undefined,
      context_token: params.contextToken ?? undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Public send helpers
// ---------------------------------------------------------------------------

/**
 * Send a text message. contextToken is required (echoed from getUpdates).
 */
export async function sendText(
  api: ApiClient,
  to: string,
  text: string,
  contextToken: string,
): Promise<string> {
  const clientId = generateClientId();
  const req: SendMessageReq = {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: text
        ? [{ type: MessageItemType.TEXT, text_item: { text } }]
        : undefined,
      context_token: contextToken,
    },
  };
  await api.sendMessage(req);
  return clientId;
}

/**
 * Send an image message with a previously uploaded file.
 */
export async function sendImage(
  api: ApiClient,
  to: string,
  uploaded: UploadedFileInfo,
  contextToken: string,
  caption?: string,
): Promise<string> {
  const items: MessageItem[] = [];
  if (caption) {
    items.push({
      type: MessageItemType.TEXT,
      text_item: { text: caption },
    });
  }
  items.push({
    type: MessageItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      mid_size: uploaded.fileSizeCiphertext,
    },
  });

  // Send each item as its own request (text first, then image)
  let lastClientId = "";
  for (const item of items) {
    const req = buildReq({ to, contextToken, items: [item] });
    lastClientId = req.msg?.client_id ?? lastClientId;
    await api.sendMessage(req);
  }
  return lastClientId;
}

/**
 * Send a video message with a previously uploaded file.
 */
export async function sendVideo(
  api: ApiClient,
  to: string,
  uploaded: UploadedFileInfo,
  contextToken: string,
  caption?: string,
): Promise<string> {
  const items: MessageItem[] = [];
  if (caption) {
    items.push({
      type: MessageItemType.TEXT,
      text_item: { text: caption },
    });
  }
  items.push({
    type: MessageItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      video_size: uploaded.fileSizeCiphertext,
    },
  });

  let lastClientId = "";
  for (const item of items) {
    const req = buildReq({ to, contextToken, items: [item] });
    lastClientId = req.msg?.client_id ?? lastClientId;
    await api.sendMessage(req);
  }
  return lastClientId;
}

/**
 * Send a file attachment with a previously uploaded file.
 */
export async function sendFileMessage(
  api: ApiClient,
  to: string,
  fileName: string,
  uploaded: UploadedFileInfo,
  contextToken: string,
  caption?: string,
): Promise<string> {
  const items: MessageItem[] = [];
  if (caption) {
    items.push({
      type: MessageItemType.TEXT,
      text_item: { text: caption },
    });
  }
  items.push({
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
        encrypt_type: 1,
      },
      file_name: fileName,
      len: String(uploaded.fileSize),
    },
  });

  let lastClientId = "";
  for (const item of items) {
    const req = buildReq({ to, contextToken, items: [item] });
    lastClientId = req.msg?.client_id ?? lastClientId;
    await api.sendMessage(req);
  }
  return lastClientId;
}

/**
 * Upload and send a local file as a media message. Routing by MIME type:
 *   - video/*  -> video message
 *   - image/*  -> image message
 *   - else     -> file attachment
 */
export async function sendMediaFile(
  api: ApiClient,
  to: string,
  filePath: string,
  contextToken: string,
  caption?: string,
): Promise<string> {
  const mime = getMimeFromFilename(filePath);
  const cdnBaseUrl = api.cdnBaseUrl;

  if (mime.startsWith("video/")) {
    const uploaded = await uploadVideo({
      filePath,
      toUserId: to,
      api,
      cdnBaseUrl,
    });
    return sendVideo(api, to, uploaded, contextToken, caption);
  }

  if (mime.startsWith("image/")) {
    const uploaded = await uploadImage({
      filePath,
      toUserId: to,
      api,
      cdnBaseUrl,
    });
    return sendImage(api, to, uploaded, contextToken, caption);
  }

  // File attachment
  const fileName = path.basename(filePath);
  const uploaded = await uploadFile({
    filePath,
    toUserId: to,
    api,
    cdnBaseUrl,
  });
  return sendFileMessage(
    api,
    to,
    fileName,
    uploaded,
    contextToken,
    caption,
  );
}
