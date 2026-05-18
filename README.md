# 🔔 MikroTik Alert → Cloudflare Worker → Telegram

Push-based alert system. MikroTik triggers HTTP requests directly to a
Cloudflare Worker, which formats and sends Telegram messages.

```
MikroTik (Scheduler/Netwatch/PPP hooks)
    │
    └─► POST https://mikrotik-alert.*.workers.dev
              { type, data, X-Secret-Key }
                    │
                    └─► Telegram Bot API → Your chat/group
```

No server. No polling. No persistent connections.

---

## Alerts Included

| Event | Trigger |
|---|---|
| ⚠️ High CPU | Scheduler every 1 min |
| ⚠️ High RAM | Scheduler every 1 min |
| 🟢 PPPoE Connected | PPP profile on-up hook |
| 🔴 PPPoE Disconnected | PPP profile on-down hook |
| 🔴 Interface Down | Netwatch down-script |
| 🟢 Interface Up | Netwatch up-script |

---

## Setup — Step by Step

### Step 1 — Create Telegram Bot

1. Open Telegram → search **@BotFather**
2. Send `/newbot` → follow prompts → copy the **token**
3. Get your chat ID: add **@userinfobot** to your group or message it directly

---

### Step 2 — Deploy Cloudflare Worker

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy the worker
wrangler deploy

# Set secrets (never stored in code)
wrangler secret put TELEGRAM_BOT_TOKEN
# paste your bot token

wrangler secret put TELEGRAM_CHAT_ID
# paste your chat ID (e.g. -1001234567890 for groups)

wrangler secret put SECRET_KEY
# paste any strong random string e.g. openssl rand -hex 32
```

After deploy, Wrangler prints your Worker URL:
```
https://mikrotik-alert.YOUR-SUBDOMAIN.workers.dev
```

---

### Step 3 — Configure MikroTik Scripts

Open `mikrotik-scripts.rsc` and replace:
- `YOUR-SUBDOMAIN` → your actual workers.dev subdomain
- `YOUR_SECRET_KEY_HERE` → the same SECRET_KEY you set above

Then in RouterOS terminal (or Winbox > System > Scripts):

**Add each script** with the exact names:
- `alert-cpu-ram`
- `alert-pppoe-connect`
- `alert-pppoe-disconnect`
- `alert-interface-down`
- `alert-interface-up`

**Wire them up:**

```routeros
# CPU/RAM check every minute
/system scheduler add name=check-cpu-ram interval=1m on-event=alert-cpu-ram start-time=startup

# PPPoE hooks
/ppp profile set default on-up=alert-pppoe-connect on-down=alert-pppoe-disconnect

# Interface monitoring (adjust host/interface to match your WAN)
/tool netwatch add host=1.1.1.1 interface=ether1 interval=30s timeout=5s \
  down-script=alert-interface-down up-script=alert-interface-up
```

---

### Step 4 — Test It

Test the Worker directly with curl:

```bash
curl -X POST https://mikrotik-alert.YOUR-SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Secret-Key: YOUR_SECRET_KEY_HERE" \
  -d '{"type":"cpu_ram","data":{"identity":"MyRouter","cpu":95,"ram":90,"threshold_cpu":80,"threshold_ram":85}}'
```

You should immediately receive a Telegram message.

Test from MikroTik terminal:
```routeros
/system script run alert-cpu-ram
```

---

## Payload Reference

All requests to the Worker use this shape:

```json
{ "type": "<event_type>", "data": { ... } }
```

| type | data fields |
|---|---|
| `cpu_ram` | identity, cpu, ram, threshold_cpu, threshold_ram |
| `pppoe_connect` | identity, user, ip, caller_id |
| `pppoe_disconnect` | identity, user, ip, uptime, bytes_in, bytes_out |
| `interface_down` | identity, interface |
| `interface_up` | identity, interface |

---

## Security Notes

- The `X-Secret-Key` header authenticates every request — Worker rejects anything without it
- Secrets are stored in Cloudflare's encrypted secret store, never in `wrangler.toml`
- Worker only accepts POST requests
- MikroTik scripts use `/tool fetch` which supports HTTPS natively

---

## Customizing Thresholds

Edit directly in the `alert-cpu-ram` script on your router:

```routeros
:local cpuThreshold 80   # alert when CPU >= 80%
:local ramThreshold 85   # alert when RAM >= 85%
```

---

## Adding More Alerts

To add a new alert type (e.g. WAN IP change):

1. Add a new `case` in `src/index.js`
2. Add a formatter function
3. Deploy: `wrangler deploy`
4. Add the corresponding RouterOS script
