import { execFile, exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import type { LocalTailscaleHostStatus, TailscaleActionResult } from '../../../shared/types.js';

const CANDIDATE_BINARIES = [
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

function execCmd(cmd: string, timeoutMs = 120000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
      resolve({
        stdout: stdout || '',
        stderr: stderr || (err ? err.message : ''),
        code,
      });
    });
  });
}

function execBin(bin: string, args: string[], timeoutMs = 20000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
      resolve({
        stdout: stdout || '',
        stderr: stderr || (err ? err.message : ''),
        code,
      });
    });
  });
}

export async function findTailscaleBinary(): Promise<string> {
  for (const bin of CANDIDATE_BINARIES) {
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {
      // ignore
    }
  }
  const whichRes = await execCmd('command -v tailscale 2>/dev/null || true', 4000);
  const found = whichRes.stdout.trim();
  return found || '';
}

export async function getLocalTailscaleHostStatus(): Promise<LocalTailscaleHostStatus> {
  const platform = os.platform();
  const binaryPath = await findTailscaleBinary();
  const canAutoInstall = platform === 'linux' || platform === 'darwin';
  const installHint =
    platform === 'linux'
      ? 'Installs via official Tailscale script (curl -fsSL https://tailscale.com/install.sh | sh) and enables tailscaled.'
      : platform === 'darwin'
        ? 'Installs via Homebrew (brew install --cask tailscale) when available.'
        : 'Install Tailscale from https://tailscale.com/download for this OS.';

  if (!binaryPath) {
    return {
      platform,
      installed: false,
      binaryPath: '',
      backendState: 'NotInstalled',
      running: false,
      selfIp: '',
      selfHostname: '',
      tailnetName: '',
      authUrl: '',
      canAutoInstall,
      installHint,
    };
  }

  const res = await execBin(binaryPath, ['status', '--json'], 8000);
  if (res.code !== 0 && !res.stdout.trim().startsWith('{')) {
    return {
      platform,
      installed: true,
      binaryPath,
      backendState: 'Stopped',
      running: false,
      selfIp: '',
      selfHostname: '',
      tailnetName: '',
      authUrl: '',
      canAutoInstall,
      installHint,
    };
  }

  try {
    const raw = JSON.parse(res.stdout);
    const backendState = String(raw.BackendState || 'Unknown');
    const ips: string[] = Array.isArray(raw.Self?.TailscaleIPs) ? raw.Self.TailscaleIPs.map(String) : [];
    const selfIp = ips.find((ip) => ip.includes('.') && !ip.includes(':')) || ips[0] || '';
    const selfHostname = String(raw.Self?.HostName || '');
    const tailnetName = String(raw.CurrentTailnet?.Name || raw.MagicDNSSuffix || '').replace(/\.$/, '');
    const authUrl = String(raw.AuthURL || '');
    return {
      platform,
      installed: true,
      binaryPath,
      backendState,
      running: backendState === 'Running',
      selfIp,
      selfHostname,
      tailnetName,
      authUrl,
      canAutoInstall,
      installHint,
    };
  } catch {
    return {
      platform,
      installed: true,
      binaryPath,
      backendState: 'Unknown',
      running: false,
      selfIp: '',
      selfHostname: '',
      tailnetName: '',
      authUrl: '',
      canAutoInstall,
      installHint,
    };
  }
}

export async function installLocalTailscale(): Promise<TailscaleActionResult> {
  const existing = await getLocalTailscaleHostStatus();
  if (existing.installed) {
    return {
      ok: true,
      message: `Tailscale is already installed at ${existing.binaryPath}`,
      output: `Already installed (${existing.backendState})`,
      status: existing,
    };
  }

  const platform = os.platform();
  if (platform === 'linux') {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const prefix = isRoot ? '' : 'sudo -n ';
    const cmd = `
      set -e
      if ! command -v tailscale >/dev/null 2>&1; then
        curl -fsSL https://tailscale.com/install.sh | ${prefix}sh
      fi
      if command -v systemctl >/dev/null 2>&1; then
        ${prefix}systemctl enable --now tailscaled || true
      fi
      command -v tailscale || true
    `;
    const res = await execCmd(cmd, 180000);
    const status = await getLocalTailscaleHostStatus();
    const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
    if (status.installed) {
      return {
        ok: true,
        message: `Tailscale installed at ${status.binaryPath}`,
        output,
        status,
      };
    }
    return {
      ok: false,
      message: isRoot
        ? 'Tailscale installation failed — check command output.'
        : 'Tailscale installation failed (requires root or passwordless sudo on Linux host).',
      output,
      status,
    };
  }

  if (platform === 'darwin') {
    const brewCheck = await execCmd('command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -n 1', 5000);
    const brewBin = brewCheck.stdout.trim();
    if (!brewBin) {
      return {
        ok: false,
        message: 'Homebrew not found on macOS. Install Tailscale from https://tailscale.com/download/mac.',
        output: 'Homebrew binary not found.',
        status: existing,
      };
    }
    const res = await execCmd(`"${brewBin}" install --cask tailscale`, 180000);
    const status = await getLocalTailscaleHostStatus();
    const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: status.installed,
      message: status.installed
        ? `Tailscale installed via Homebrew (${status.binaryPath})`
        : 'Homebrew install completed — open Tailscale.app once to finish setup.',
      output,
      status,
    };
  }

  return {
    ok: false,
    message: `Automatic installation is not supported on ${platform}.`,
    output: '',
    status: existing,
  };
}

export async function bringUpLocalTailscale(opts: {
  authKey?: string;
  hostname?: string;
  enableSsh?: boolean;
}): Promise<TailscaleActionResult> {
  const bin = await findTailscaleBinary();
  if (!bin) {
    return {
      ok: false,
      message: 'Tailscale is not installed yet. Click Install Tailscale first.',
      output: '',
    };
  }

  const platform = os.platform();
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const args: string[] = ['up'];

  if (opts.authKey && opts.authKey.trim()) {
    args.push(`--auth-key=${opts.authKey.trim()}`);
  }
  if (opts.hostname && opts.hostname.trim()) {
    args.push(`--hostname=${opts.hostname.trim()}`);
  }
  if (opts.enableSsh && platform === 'linux') {
    args.push('--ssh');
  }

  const useSudo = platform === 'linux' && !isRoot;
  const res = useSudo
    ? await execBin('sudo', ['-n', bin, ...args], 25000)
    : await execBin(bin, args, 25000);

  const combined = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
  const status = await getLocalTailscaleHostStatus();
  const urlMatch = combined.match(/https:\/\/login\.tailscale\.com\/a\/[^\s]+/i);
  const authUrl = (urlMatch ? urlMatch[0] : '') || status.authUrl;

  if (status.running) {
    return {
      ok: true,
      message: `Connected host to Tailnet ${status.tailnetName || ''} (${status.selfIp})`,
      output: combined || 'Tailscale is running.',
      tailscaleIp: status.selfIp,
      status,
    };
  }

  if (authUrl) {
    return {
      ok: true,
      message: 'Open the Tailscale login URL to finish connecting this host.',
      output: combined,
      authUrl,
      status,
    };
  }

  return {
    ok: false,
    message: res.stderr.trim() || 'Could not bring Tailscale up (check privileges or auth key).',
    output: combined,
    status,
  };
}

function shellEscapeSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteTailscaleInstallScript(opts: {
  authKey?: string;
  enableSsh?: boolean;
}): string {
  const enableSsh = opts.enableSsh !== false;
  const authKey = (opts.authKey || '').trim();
  const authArg = authKey ? `--auth-key=${shellEscapeSingle(authKey)}` : '';
  const sshArg = enableSsh ? '--ssh' : '';

  return `
set -e
OS=$(uname -s 2>/dev/null || echo Linux)
if [ "$OS" != "Linux" ]; then
  echo "ERROR: Remote auto-install currently supports Linux hosts (detected $OS)."
  exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo -n"
  else
    echo "ERROR: Must run as root or have passwordless sudo to install/configure Tailscale."
    exit 1
  fi
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo ">>> Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | $SUDO sh
else
  echo ">>> Tailscale already installed: $(command -v tailscale)"
fi

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl enable --now tailscaled >/dev/null 2>&1 || true
fi

if [ -n ${shellEscapeSingle(authKey)} ]; then
  echo ">>> Joining Tailnet with Auth Key..."
  $SUDO tailscale up ${authArg} ${sshArg} --accept-routes || $SUDO tailscale up ${authArg} ${sshArg}
else
  STATE=$(tailscale status --json 2>/dev/null | grep -m1 '"BackendState"' | cut -d'"' -f4 || echo "")
  if [ "$STATE" = "Running" ]; then
    if [ "${enableSsh ? '1' : '0'}" = "1" ]; then
      echo ">>> Enabling Tailscale SSH on running node..."
      $SUDO tailscale set --ssh
    fi
  else
    echo ">>> Tailscale is installed but needs login (provide a tskey-auth-... key or run 'sudo tailscale up --ssh' on the server)."
  fi
fi

TS_IP=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
echo "===TS_IP==="
echo "$TS_IP"
`;
}
