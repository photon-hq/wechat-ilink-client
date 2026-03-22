/**
 * Upload encrypted media to the WeChat CDN.
 */
import { encryptAesEcb } from "./aes-ecb.js";
import { buildCdnUploadUrl } from "./cdn-url.js";

const UPLOAD_MAX_RETRIES = 3;

/**
 * Upload one buffer to the WeChat CDN with AES-128-ECB encryption.
 * Returns the download encrypted_query_param from the CDN `x-encrypted-param` header.
 */
export async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadParam: string;
  filekey: string;
  cdnBaseUrl: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadParam, filekey, cdnBaseUrl, aeskey } = params;
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });

      if (res.status >= 400 && res.status < 500) {
        const errMsg =
          res.headers.get("x-error-message") ?? (await res.text());
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }
      if (res.status !== 200) {
        const errMsg =
          res.headers.get("x-error-message") ?? `status ${res.status}`;
        throw new Error(`CDN upload server error: ${errMsg}`);
      }

      downloadParam = res.headers.get("x-encrypted-param") ?? undefined;
      if (!downloadParam) {
        throw new Error(
          "CDN upload response missing x-encrypted-param header",
        );
      }
      break;
    } catch (err) {
      lastError = err;
      if (
        err instanceof Error &&
        err.message.includes("client error")
      ) {
        throw err;
      }
      if (attempt >= UPLOAD_MAX_RETRIES) {
        break;
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(
          `CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`,
        );
  }
  return { downloadParam };
}
