/**
 * WeChat iLink bot protocol types.
 *
 * Reverse-engineered from @tencent-weixin/openclaw-weixin.
 * The backend API uses JSON over HTTP; byte fields are base64 strings in JSON.
 */

// ---------------------------------------------------------------------------
// Enums / constants
// ---------------------------------------------------------------------------

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;
export type UploadMediaType = (typeof UploadMediaType)[keyof typeof UploadMediaType];

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;
export type MessageItemType = (typeof MessageItemType)[keyof typeof MessageItemType];

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;
export type MessageState = (typeof MessageState)[keyof typeof MessageState];

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;
export type TypingStatus = (typeof TypingStatus)[keyof typeof TypingStatus];

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

/** Metadata attached to every outgoing CGI request. */
export interface BaseInfo {
  channel_version?: string;
}

// ---------------------------------------------------------------------------
// CDN / Media references
// ---------------------------------------------------------------------------

/** CDN media reference; aes_key is base64-encoded bytes in JSON. */
export interface CDNMedia {
  /** Encrypted parameters for CDN download/upload. */
  encrypt_query_param?: string;
  /** Base64-encoded AES-128 key. */
  aes_key?: string;
  /** 0 = only encrypt fileid, 1 = packed thumb/mid info. */
  encrypt_type?: number;
}

export interface TextItem {
  text?: string;
}

export interface ImageItem {
  /** Original image CDN reference. */
  media?: CDNMedia;
  /** Thumbnail CDN reference. */
  thumb_media?: CDNMedia;
  /** Raw AES-128 key as hex string (16 bytes); preferred over media.aes_key for inbound decryption. */
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  /** Voice encoding: 1=pcm, 2=adpcm, 3=feature, 4=speex, 5=amr, 6=silk, 7=mp3, 8=ogg-speex */
  encode_type?: number;
  bits_per_sample?: number;
  /** Sample rate in Hz. */
  sample_rate?: number;
  /** Duration in milliseconds. */
  playtime?: number;
  /** Speech-to-text content (if available). */
  text?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  /** File size as string. */
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  /** Summary text. */
  title?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

// ---------------------------------------------------------------------------
// WeixinMessage — the unified message envelope
// ---------------------------------------------------------------------------

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  /** 1 = USER, 2 = BOT */
  message_type?: number;
  /** 0 = NEW, 1 = GENERATING, 2 = FINISH */
  message_state?: number;
  item_list?: MessageItem[];
  /** Conversation context token — must be echoed verbatim in replies. */
  context_token?: string;
}

// ---------------------------------------------------------------------------
// getUpdates (long-poll)
// ---------------------------------------------------------------------------

export interface GetUpdatesReq {
  /** Full context buf cached locally; send "" on first request. */
  get_updates_buf?: string;
  base_info?: BaseInfo;
}

export interface GetUpdatesResp {
  ret?: number;
  /** Error code from server (e.g. -14 = session timeout). */
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  /** Full context buf to cache locally and send on next request. */
  get_updates_buf?: string;
  /** Server-suggested timeout (ms) for the next long-poll. */
  longpolling_timeout_ms?: number;
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

export interface SendMessageReq {
  msg?: WeixinMessage;
  base_info?: BaseInfo;
}

export interface SendMessageResp {
  ret?: number;
  errmsg?: string;
}

// ---------------------------------------------------------------------------
// getUploadUrl
// ---------------------------------------------------------------------------

export interface GetUploadUrlReq {
  filekey?: string;
  /** See UploadMediaType: 1=IMAGE, 2=VIDEO, 3=FILE, 4=VOICE */
  media_type?: number;
  to_user_id?: string;
  /** Original file plaintext size. */
  rawsize?: number;
  /** Original file plaintext MD5 (hex). */
  rawfilemd5?: string;
  /** Ciphertext size after AES-128-ECB encryption. */
  filesize?: number;
  /** Thumbnail plaintext size (IMAGE/VIDEO). */
  thumb_rawsize?: number;
  /** Thumbnail plaintext MD5 (IMAGE/VIDEO). */
  thumb_rawfilemd5?: string;
  /** Thumbnail ciphertext size (IMAGE/VIDEO). */
  thumb_filesize?: number;
  /** Skip thumbnail upload URL. */
  no_need_thumb?: boolean;
  /** AES key (hex). */
  aeskey?: string;
  base_info?: BaseInfo;
}

export interface GetUploadUrlResp {
  /** Original image upload encrypted parameters. */
  upload_param?: string;
  /** Thumbnail upload encrypted parameters. */
  thumb_upload_param?: string;
}

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

export interface GetConfigReq {
  ilink_user_id?: string;
  context_token?: string;
  base_info?: BaseInfo;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  /** Base64-encoded typing ticket for sendTyping. */
  typing_ticket?: string;
}

// ---------------------------------------------------------------------------
// sendTyping
// ---------------------------------------------------------------------------

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1 = typing, 2 = cancel typing */
  status?: number;
  base_info?: BaseInfo;
}

export interface SendTypingResp {
  ret?: number;
  errmsg?: string;
}

// ---------------------------------------------------------------------------
// QR code login
// ---------------------------------------------------------------------------

export interface QRCodeResponse {
  /** Opaque QR code identifier (pass to get_qrcode_status). */
  qrcode: string;
  /** URL that renders/encodes the QR image. */
  qrcode_img_content: string;
}

export interface QRCodeStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  /** Bot account identifier (e.g. "hex@im.bot"). */
  ilink_bot_id?: string;
  /** API base URL returned on successful login. */
  baseurl?: string;
  /** User ID of the person who scanned the QR code. */
  ilink_user_id?: string;
}
