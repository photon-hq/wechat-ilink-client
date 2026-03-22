/**
 * Download and optionally decrypt media from the WeChat CDN.
 */
import { decryptAesEcb } from "./aes-ecb.js";
import { buildCdnDownloadUrl } from "./cdn-url.js";

/**
 * Download raw bytes from the CDN (no decryption).
 */
async function fetchCdnBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`CDN download ${res.status} ${res.statusText}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Parse CDNMedia.aes_key into a raw 16-byte AES key.
 *
 * Two encodings are observed:
 *   - base64(raw 16 bytes)           -> images (aes_key from media field)
 *   - base64(hex string of 16 bytes) -> file / voice / video
 *
 * In the second case, base64-decoding yields 32 ASCII hex chars which must
 * then be parsed as hex to recover the actual 16-byte key.
 */
export function parseAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (
    decoded.length === 32 &&
    /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))
  ) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(
    `aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`,
  );
}

/**
 * Download and AES-128-ECB decrypt a CDN media file. Returns plaintext Buffer.
 */
export async function downloadAndDecrypt(
  encryptedQueryParam: string,
  aesKeyBase64: string,
  cdnBaseUrl: string,
): Promise<Buffer> {
  const key = parseAesKey(aesKeyBase64);
  const url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  const encrypted = await fetchCdnBytes(url);
  return decryptAesEcb(encrypted, key);
}

/**
 * Download plain (unencrypted) bytes from the CDN.
 */
export async function downloadPlain(
  encryptedQueryParam: string,
  cdnBaseUrl: string,
): Promise<Buffer> {
  const url = buildCdnDownloadUrl(encryptedQueryParam, cdnBaseUrl);
  return fetchCdnBytes(url);
}
