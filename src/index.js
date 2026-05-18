/**
 * MikroTik Alert → Cloudflare Worker → Telegram
 *
 * Receives HTTP POST from MikroTik scripts and forwards
 * formatted alerts to Telegram.
 *
 * Environment variables (set in wrangler.toml or CF dashboard):
 *   TELEGRAM_BOT_TOKEN  - from @BotFather
 *   TELEGRAM_CHAT_ID    - target chat/group ID
 *   SECRET_KEY          - shared secret to authenticate MikroTik requests
 */

export default {
  async fetch(request, env) {
    // Only accept POST
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Validate secret key from header
    const secret = request.headers.get("X-Secret-Key");
    if (!secret || secret !== env.SECRET_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const { type, data } = body;

    if (!type || !data) {
      return new Response("Missing type or data", { status: 400 });
    }

    let message;

    switch (type) {
      case "cpu_ram":
        message = formatCpuRam(data);
        break;
      case "pppoe_connect":
        message = formatPPPoEConnect(data);
        break;
      case "pppoe_disconnect":
        message = formatPPPoEDisconnect(data);
        break;
      case "interface_up":
        message = formatInterfaceUp(data);
        break;
      case "interface_down":
        message = formatInterfaceDown(data);
        break;
      default:
        return new Response("Unknown type", { status: 400 });
    }

    try {
      await sendTelegram(env, message);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Telegram error:", err);
      return new Response("Telegram send failed", { status: 500 });
    }
  },
};

// ─── Message Formatters ───────────────────────────────────────────────────────

function formatCpuRam({ identity, cpu, ram, threshold_cpu, threshold_ram }) {
  const lines = [`⚠️ *Resource Alert — ${esc(identity)}*`, ""];

  if (cpu !== undefined && cpu >= (threshold_cpu ?? 80)) {
    lines.push(`🔴 *CPU:* ${cpu}% (threshold: ${threshold_cpu ?? 80}%)`);
  }
  if (ram !== undefined && ram >= (threshold_ram ?? 85)) {
    lines.push(`🔴 *RAM:* ${ram}% (threshold: ${threshold_ram ?? 85}%)`);
  }

  lines.push("", `🕐 ${timestamp()}`);
  return lines.join("\n");
}

function formatPPPoEConnect({ identity, user, ip, caller_id }) {
  return [
    `🟢 *PPPoE Connected — ${esc(identity)}*`,
    "",
    `👤 User: \`${esc(user)}\``,
    `🌐 IP: \`${ip ?? "N/A"}\``,
    `📍 Caller ID: \`${caller_id ?? "N/A"}\``,
    "",
    `🕐 ${timestamp()}`,
  ].join("\n");
}

function formatPPPoEDisconnect({
  identity,
  user,
  ip,
  uptime,
  bytes_in,
  bytes_out,
}) {
  return [
    `🔴 *PPPoE Disconnected — ${esc(identity)}*`,
    "",
    `👤 User: \`${esc(user)}\``,
    `🌐 Last IP: \`${ip ?? "N/A"}\``,
    `⏱️ Session uptime: ${uptime ?? "N/A"}`,
    `⬇️ Downloaded: ${formatBytes(bytes_in)}`,
    `⬆️ Uploaded: ${formatBytes(bytes_out)}`,
    "",
    `🕐 ${timestamp()}`,
  ].join("\n");
}

function formatInterfaceDown({ identity, interface: iface }) {
  return [
    `🔴 *Interface DOWN — ${esc(identity)}*`,
    "",
    `🔌 \`${esc(iface)}\` is *DOWN*`,
    "",
    `🕐 ${timestamp()}`,
  ].join("\n");
}

function formatInterfaceUp({ identity, interface: iface }) {
  return [
    `🟢 *Interface UP — ${esc(identity)}*`,
    "",
    `🔌 \`${esc(iface)}\` is back *UP*`,
    "",
    `🕐 ${timestamp()}`,
  ].join("\n");
}

// ─── Telegram Sender ──────────────────────────────────────────────────────────

async function sendTelegram(env, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${err}`);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? "").replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

function timestamp() {
  return new Date().toUTCString();
}

function formatBytes(bytes) {
  const n = parseInt(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
