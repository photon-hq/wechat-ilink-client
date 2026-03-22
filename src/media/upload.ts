/**
 * High-level media upload pipeline for the WeChat CDN.
 *
 * Flow:
 *   1. Read file -> compute MD5, plaintext size, ciphertext size
 *   2. Generate random 16-byte AES key and filekey
 *   3. Call getUploadUrl to get upload_param
 *   4. Encrypt with AES-128-ECB and POST to CDN
 *   5. Return uploaded file info (download param, key, sizes)
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";

import type { ApiClient } from "../api/client.js";
import { UploadMediaType } from "../api/types.js";
import { aesEcbPaddedSize } from "../cdn/aes-ecb.js";
import { uploadBufferToCdn } from "../cdn/cdn-upload.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadedFileInfo {
  filekey: string;
  /** CDN download encrypted_query_param (fill into CDNMedia.encrypt_query_param). */
  downloadEncryptedQueryParam: string;
  /** AES-128-ECB key, hex-encoded; convert to base64 for CDNMedia.aes_key. */
  aeskey: string;
  /** Plaintext file size in bytes. */
  fileSize: number;
  /** Ciphertext file size in bytes (after AES-128-ECB + PKCS7). */
  fileSizeCiphertext: number;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function uploadMedia(params: {
  filePath: string;
  toUserId: string;
  api: ApiClient;
  cdnBaseUrl: string;
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType];
}): Promise<UploadedFileInfo> {
  const { filePath, toUserId, api, cdnBaseUrl, mediaType } = params;

  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto
    .createHash("md5")
    .update(plaintext)
    .digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadUrlResp = await api.getUploadUrl({
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadParam) {
    throw new Error(
      `getUploadUrl returned no upload_param: ${JSON.stringify(uploadUrlResp)}`,
    );
  }

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam,
    filekey,
    cdnBaseUrl,
    aeskey,
  });

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Upload a local image file to the WeChat CDN. */
export async function uploadImage(params: {
  filePath: string;
  toUserId: string;
  api: ApiClient;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMedia({ ...params, mediaType: UploadMediaType.IMAGE });
}

/** Upload a local video file to the WeChat CDN. */
export async function uploadVideo(params: {
  filePath: string;
  toUserId: string;
  api: ApiClient;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMedia({ ...params, mediaType: UploadMediaType.VIDEO });
}

/** Upload a local file attachment to the WeChat CDN. */
export async function uploadFile(params: {
  filePath: string;
  toUserId: string;
  api: ApiClient;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMedia({ ...params, mediaType: UploadMediaType.FILE });
}
