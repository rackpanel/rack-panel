<p align="center">
  <img src="assets/banner.png" alt="RACK//PANEL — Touchscreen Server Rack & Homelab Command Center" width="100%" />
</p>

<h1 align="center">RACK//PANEL</h1>

<p align="center">
  <strong>Touchscreen-first Server Rack, Proxmox VE, OPNsense &amp; Tailscale Command Center</strong><br />
  Real-time WebSocket telemetry, interactive fullscreen Terminal &amp; noVNC consoles, unified device deduplication, and native <strong>Android 4.4 KitKat+</strong> kiosk support.
</p>

<p align="center">
  <a href="https://github.com/rackpanel/rack-panel/releases"><img src="https://img.shields.io/github/v/release/rackpanel/rack-panel?color=22d3ee&label=release" alt="Latest Release" /></a>
  <a href="https://github.com/rackpanel/rack-panel/actions/workflows/ci.yml"><img src="https://github.com/rackpanel/rack-panel/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rackpanel/rack-panel/actions/workflows/docker.yml"><img src="https://github.com/rackpanel/rack-panel/actions/workflows/docker.yml/badge.svg" alt="Docker GHCR" /></a>
  <a href="https://github.com/rackpanel/rack-panel/pkgs/container/rack-panel"><img src="https://img.shields.io/badge/ghcr.io-rackpanel%2Frack--panel-22d3ee?logo=docker&logoColor=white" alt="GHCR" /></a>
  <img src="https://img.shields.io/badge/Android%204.4%2B-KitKat%20Ready-34d399?logo=android&logoColor=white" alt="Android 4.4+ Ready" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a78bfa" alt="MIT License" /></a>
</p>

---

## Highlights

- **Unified Homelab Telemetry (`/ws` Live Stream)** — Real-time fleet CPU, RAM, storage, network RX/TX gauges, rolling SVG sparklines, and consolidated health alerts pushed over WebSocket.
- **Any-Server SSH Monitoring (Linux & macOS)** — Connect via password, private key, or passwordless **Tailscale SSH**. Streams CPU %, load average, memory/swap, mounted disks, filtered physical NIC throughput, thermals, top processes, and systemd/Homebrew services.
- **Proxmox VE Cluster Control** — Connect via API Token or password ticket. Inspect nodes, QEMU VMs, LXC containers, storage pools, and recent tasks. Includes confirmation-gated **Start / Shutdown / Reboot / Force Stop** actions, **interactive `termproxy` shell**, and **full-color noVNC graphical console**.
- **OPNsense Firewall & Routing** — Supports OPNsense **23.x, 24.x, and 25.x** with automatic endpoint version fallback. Monitor CPU/RAM/load, PF state table, WAN gateways & latency, deduplicated interfaces with live throughput, WireGuard peers, live packet filter logs, and service start/stop/restart + system actions.
- **Tailscale Mesh Discovery & One-Tap Onboarding** — Connect via Local Daemon (`tailscale status --json`), API Key, or OAuth. Auto-detects Tailscale SSH readiness, installs/enables Tailscale on the host or remote Linux servers, and onboards devices in one tap.
- **Unified Device Deduplication** — Automatically links SSH, Proxmox, Tailscale, and OPNsense entries representing the same physical machine (by hardware `machine-id`, overlapping LAN/Tailscale IPs, or OS hostname — regardless of different IPs or credentials). Eliminates duplicate polling, supports automatic failover, and prevents double-counting fleet totals.
- **Touchscreen Kiosk, Fullscreen Consoles & Security**:
  - **User Accounts & Forever Persistent Login** (`scrypt` password hashing, encrypted non-expiring session tokens, admin user management).
  - **Idle Metrics Splash Screen + Quick 4-Digit PIN Lock** (enforced server-side with HTTP `423 Locked` on mutations, terminals, and VNC while keeping read-only splash metrics live).
  - **Touch-friendly Fullscreen Terminal & VNC** with collapsible control bars, floating touch exit pill, soft-keyboard input bar, and special key strips (`Ctrl+C`, `Ctrl+Alt+Del`, `Tab`, `Esc`).
  - **AES-256-GCM Encryption at Rest** for all SSH credentials, API keys, secrets, session tokens, and PINs in `server/data/config.json`.
  - **Android 4.4 KitKat (Chromium 30+) Compatible** — Vue 2.7 + Vue Router v3 + Tailwind CSS v3 + `@vitejs/plugin-legacy` + pure Flexbox layout (no CSS Grid or flex `gap`).

---

## Quick Start with Docker (GHCR)

### Option 1: Standalone Container

```bash
docker run -d \
  --name rack-panel \
  --restart unless-stopped \
  -p 3840:3840 \
  -v rack_panel_data:/app/server/data \
  ghcr.io/rackpanel/rack-panel:latest
```

Open **`http://<your-host-ip>:3840`** to create your initial administrator account and start connecting hosts.

### Option 2: Docker Compose (with Optional Tailscale Sidecar)

Create a `.env` file (optional):

```env
# Optional: custom encryption passphrase (otherwise auto-generated in /app/server/data/.secret.key)
RACK_PANEL_SECRET=change-me-to-a-long-random-secret

# Optional: Tailscale auth key to join the sidecar directly to your Tailnet
TS_AUTHKEY=tskey-auth-xxxxxxxxxxxx
```

Start with Docker Compose:

```bash
docker compose up -d
```

Multi-architecture images (`linux/amd64` and `linux/arm64`) are published automatically to **`ghcr.io/rackpanel/rack-panel`** via GitHub Actions.

---

## Local Development

**Requirements:** Node.js `20+` (tested on Node `22` / `26`).

```bash
# 1. Clone the repository
git clone https://github.com/rackpanel/rack-panel.git
cd rack-panel

# 2. Install server & client dependencies
npm run install:all

# 3. Start both backend (:3840) and Vite frontend (:5173)
npm run dev

# 4. Typecheck & build production bundle (single-port server on :3840)
npm run typecheck
npm run build
npm start
```

---

## Architecture

```
rack-panel/
├── client/                  # Vue 2.7 + Vue Router v3 + TypeScript + Tailwind CSS v3
│   ├── src/router/          # History-mode routes, auth guards & scroll-to-top
│   ├── src/views/           # Overview, Servers, Proxmox, OPNsense, Tailscale, Settings
│   ├── src/components/      # TerminalModal, VncModal (noVNC), IdleSplashScreen (PIN), AuthGate
│   └── vite.config.ts       # @vitejs/plugin-legacy targeting Android 4.4+ / Chromium 30+
├── server/                  # Node.js + Express + WebSocket + TypeScript
│   └── src/
│       ├── store/           # AES-256-GCM encrypted config, scrypt users & persistent sessions
│       └── services/        # sshCollector, proxmoxClient, opnsenseClient, tailscaleClient,
│                            # deviceRegistry (Union-Find dedup), terminalBridge, vncBridge
├── shared/                  # Shared TypeScript interfaces (types.ts)
└── .github/workflows/       # CI typecheck/build + Multi-arch GHCR Docker publish
```

---

## Setup Tips

### Proxmox VE API Token
1. In Proxmox VE, go to **Datacenter → Permissions → API Tokens → Add**.
2. Select your user (e.g., `root@pam`), set a Token ID (e.g., `rackpanel`), and grant `PVEAuditor`, `VM.PowerMgmt`, and `VM.Console` / `Sys.Console` (or uncheck *Privilege Separation*).
3. Add it in **RACK//PANEL → Proxmox → + Connect Proxmox VE** (self-signed TLS certificates on `:8006` are handled automatically by the backend).

### OPNsense API Key
1. In OPNsense, go to **System → Access → Users → Edit user → API keys (`+`)**.
2. Download the generated Key & Secret and enter them in **RACK//PANEL → OPNsense → + Connect OPNsense**.
3. Works seamlessly across both OPNsense **23.x** and **24.x / 25.x**.

### Android 4.4 Rack Kiosk Display
Point *Fully Kiosk Browser* (or Chromium/WebView) to `http://<your-server-ip>:3840`, sign in once (session persists until browser storage is cleared), enable **Idle Metrics Splash Screen** + **4-Digit PIN Unlock** in **Settings**, and tap **Kiosk** on the left touch rail.

---

## Versioning & Releases

RACK//PANEL uses **Semantic Versioning** (`vMAJOR.MINOR.PATCH`, e.g., `v1.1.1`).

Cut a new release locally:

```bash
# Bump patch (e.g. 1.0.0 -> 1.0.1), minor, major, or explicit semver (e.g. 1.1.1)
npm run release -- 1.1.1 --push
# or
npm run release -- patch --push
```

Or trigger a release directly in GitHub via **Actions → Release → Run workflow**.

Pushing a `v*.*.*` tag automatically:
1. Builds & publishes a **GitHub Release** with categorized changelog notes, production tarball (`rack-panel-vX.Y.Z.tar.gz`), and `SHA256SUMS.txt`.
2. Builds & publishes multi-arch (`linux/amd64`, `linux/arm64`) **GHCR Docker tags**: `:X.Y.Z`, `:X.Y`, `:X`, and `:latest`.

---

## License

Released under the [MIT License](LICENSE).
