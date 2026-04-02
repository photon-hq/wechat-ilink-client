#!/usr/bin/env npx tsx
/**
 * wechat-claude-bridge — Bridge WeChat messages to Claude Code via stream-json.
 *
 * Architecture:
 *   WeChat message -> JSON to claude child stdin
 *   claude stdout -> filter assistant text + result -> sendText back to WeChat
 *
 * Each assistant message with text content is sent immediately to WeChat,
 * giving the user incremental feedback across multi-turn agent loops.
 * The final "result" message is sent only if it differs from the last
 * assistant text (avoiding duplicates).
 *
 * Usage:
 *   npx tsx scripts/wechat-claude-bridge.ts --token xxx --account-id xxx
 *   # or via env: ILINK_TOKEN=xxx ILINK_ACCOUNT_ID=xxx npx tsx scripts/wechat-claude-bridge.ts
 */

import { spawn, type ChildProcess } from "child_process"
import { createInterface } from "readline"
import { parseArgs } from "node:util"
import { WeChatClient } from "wechat-ilink-client"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    token: { type: "string" },
    "account-id": { type: "string" },
  },
  strict: true,
})

const TOKEN = values.token ?? process.env.ILINK_TOKEN
const ACCOUNT_ID = values["account-id"] ?? process.env.ILINK_ACCOUNT_ID

if (!TOKEN || !ACCOUNT_ID) {
  console.error(
    "Error: --token and --account-id are required (or set ILINK_TOKEN / ILINK_ACCOUNT_ID env vars)",
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Claude child process management
// ---------------------------------------------------------------------------

let child: ChildProcess | null = null

function spawnClaude(): ChildProcess {
  const args = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--verbose",
  ]

  console.error(`[bridge] spawning: claude ${args.join(" ")}`)

  const proc = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
  })

  const rl = createInterface({ input: proc.stdout! })
  rl.on("line", (line) => {
    if (!line.trim()) return
    try {
      const msg = JSON.parse(line)
      handleClaudeOutput(msg)
    } catch {
      console.error(`[bridge] non-json stdout: ${line.slice(0, 200)}`)
    }
  })

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim()
    if (text) console.error(`[claude-stderr] ${text}`)
  })

  proc.on("exit", (code) => {
    console.error(`[bridge] claude exited with code ${code}`)
    child = null
  })

  return proc
}

function ensureClaude(): ChildProcess {
  if (!child || child.exitCode !== null) {
    child = spawnClaude()
  }
  return child
}

// ---------------------------------------------------------------------------
// Send user message to Claude stdin
// ---------------------------------------------------------------------------

function sendToClaude(text: string): void {
  const proc = ensureClaude()
  const msg = JSON.stringify({
    type: "user",
    content: text,
    message: { role: "user", content: text },
  }) + "\n"
  proc.stdin!.write(msg)
  console.error(`[bridge] -> claude: ${text.slice(0, 100)}`)
}

// ---------------------------------------------------------------------------
// Handle Claude output -> WeChat
// ---------------------------------------------------------------------------

let fromUserId: string | null = null
let lastSentText = ""  // dedup: track what we already sent

function extractTextContent(raw: unknown): string {
  if (typeof raw === "string") return raw
  if (Array.isArray(raw)) {
    return (raw as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("")
  }
  return ""
}

async function sendToWechat(text: string): Promise<void> {
  if (!text.trim() || !fromUserId || !wechat) return
  try {
    await wechat.sendText(fromUserId, text)
    lastSentText = text
    console.error(`[bridge] -> wechat: sent (${text.length} chars)`)
  } catch (err: unknown) {
    console.error(`[bridge] wechat send error:`, err)
  }
}

async function handleClaudeOutput(msg: Record<string, unknown>): Promise<void> {
  // Assistant message with text content -> send immediately
  if (msg.type === "assistant") {
    const content = extractTextContent(msg.content)
    if (content) {
      console.error(`[bridge] <- claude assistant: ${content.slice(0, 100)}`)
      await sendToWechat(content)
    }
    // tool_use only (no text) -> skip silently
    return
  }

  // System / tool_progress -> skip
  if (msg.type === "system" || msg.type === "tool_progress") {
    return
  }

  // Final result -> send only if different from last assistant text
  if (msg.type === "result") {
    const isError = msg.subtype === "error" || !!msg.error
    const text = isError
      ? `Error: ${(msg.error as string) || "unknown error"}`
      : ((msg.result as string) || "")

    if (text && text !== lastSentText) {
      console.error(`[bridge] <- claude result (new): ${text.slice(0, 100)}`)
      await sendToWechat(text)
    } else if (isError) {
      await sendToWechat(text)
    } else {
      console.error(`[bridge] <- claude result (duplicate, skip)`)
    }

    lastSentText = ""  // reset for next user turn
    return
  }
}

// ---------------------------------------------------------------------------
// WeChat client
// ---------------------------------------------------------------------------

const wechat = new WeChatClient({
  token: TOKEN,
  accountId: ACCOUNT_ID,
})

wechat.on("message", (msg: Record<string, unknown>) => {
  const text = WeChatClient.extractText(msg as any)
  if (!text?.trim()) return

  fromUserId = msg.from_user_id as string
  console.error(`[bridge] <- wechat (${fromUserId}): ${text.slice(0, 100)}`)

  sendToClaude(text)
})

wechat.on("error", (err: Error) => {
  console.error(`[bridge] wechat error:`, err.message)
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("[bridge] starting WeChat-Claude bridge...")

  ensureClaude()

  await wechat.start()
  console.error("[bridge] wechat monitor started, waiting for messages...")
}

main().catch((err) => {
  console.error("[bridge] fatal:", err)
  process.exit(1)
})
