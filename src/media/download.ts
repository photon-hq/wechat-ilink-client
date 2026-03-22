/**
 * High-level media download from inbound messages.
 *
 * Downloads and decrypts CDN media referenced in MessageItem fields.
 */
import type { MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import {
  downloadAndDecrypt,
  downloadPlain,
} from "../cdn/cdn-download.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DownloadedMedia {
  /** Decrypted file content. */
  data: Buffer;
  /** Media type hint: "image", "voice", "file", "video". */
  kind: "image" | "voice" | "file" | "video";
  /** Original filename (file items only). */
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download and decrypt media from a single MessageItem.
 * Returns null if the item has no downloadable media.
 */
export async function downloadMediaFromItem(
  item: MessageItem,
  cdnBaseUrl: string,
): Promise<DownloadedMedia | null> {
  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param) return null;
    // Prefer hex aeskey from image_item, fall back to media.aes_key
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media.aes_key;

    const data = aesKeyBase64
      ? await downloadAndDecrypt(
          img.media.encrypt_query_param,
          aesKeyBase64,
          cdnBaseUrl,
        )
      : await downloadPlain(
          img.media.encrypt_query_param,
          cdnBaseUrl,
        );
    return { data, kind: "image" };
  }

  if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    if (
      !voice?.media?.encrypt_query_param ||
      !voice.media.aes_key
    )
      return null;
    const data = await downloadAndDecrypt(
      voice.media.encrypt_query_param,
      voice.media.aes_key,
      cdnBaseUrl,
    );
    return { data, kind: "voice" };
  }

  if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if (
      !fileItem?.media?.encrypt_query_param ||
      !fileItem.media.aes_key
    )
      return null;
    const data = await downloadAndDecrypt(
      fileItem.media.encrypt_query_param,
      fileItem.media.aes_key,
      cdnBaseUrl,
    );
    return {
      data,
      kind: "file",
      fileName: fileItem.file_name ?? undefined,
    };
  }

  if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item;
    if (
      !videoItem?.media?.encrypt_query_param ||
      !videoItem.media.aes_key
    )
      return null;
    const data = await downloadAndDecrypt(
      videoItem.media.encrypt_query_param,
      videoItem.media.aes_key,
      cdnBaseUrl,
    );
    return { data, kind: "video" };
  }

  return null;
}
