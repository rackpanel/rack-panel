import net from "node:net";
import http from "node:http";
import https from "node:https";
import { Client as SshClient } from "ssh2";
import type {
  SwitchModelPreset,
  TopologySwitchMetadata,
  TopologySwitchPortState,
} from "../../../shared/types.js";
import {
  snmpGet,
  snmpValToMac,
  snmpValToString,
  snmpWalk,
} from "./snmpClient.js";
import {
  parseRoutingAndConfigTranscript,
  type RoutingAnalysisResult,
} from "./routingAnalyzer.js";

export interface SwitchProbeRequest {
  host: string;
  protocol?: "auto" | "ssh" | "telnet" | "http" | "snmp";
  port?: number;
  username?: string;
  password?: string;
  enablePassword?: string;
  snmpCommunity?: string;
  modelPreset?: SwitchModelPreset;
}

export interface SwitchProbeResult {
  ok: boolean;
  reachable: boolean;
  protocolUsed: "ssh" | "telnet" | "snmp" | "http" | "preset";
  message: string;
  switchMeta: TopologySwitchMetadata;
  arpEntries?: Array<{ ip: string; mac: string }>;
  routingAnalysis?: RoutingAnalysisResult;
  rawTranscript?: string;
}

export const SWITCH_MODEL_SPECS: Record<
  string,
  {
    model: string;
    vendor: string;
    rj45PortCount: number;
    sfpPortCount: number;
    poeSupported: boolean;
    poeBudgetWatts?: number;
    portPrefix: string;
  }
> = {
  "T1600G-28TS": {
    model: "T1600G-28TS",
    vendor: "TP-Link JetStream",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: false,
    portPrefix: "Gi1/0/",
  },
  "T1600G-28PS": {
    model: "T1600G-28PS",
    vendor: "TP-Link JetStream",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: true,
    poeBudgetWatts: 192,
    portPrefix: "Gi1/0/",
  },
  "T2600G-28TS": {
    model: "T2600G-28TS",
    vendor: "TP-Link JetStream",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: false,
    portPrefix: "Gi1/0/",
  },
  "TL-SG3428": {
    model: "TL-SG3428",
    vendor: "TP-Link JetStream Omada",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: false,
    portPrefix: "Gi1/0/",
  },
  "TL-SG2428P": {
    model: "TL-SG2428P",
    vendor: "TP-Link JetStream Omada",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: true,
    poeBudgetWatts: 250,
    portPrefix: "Gi1/0/",
  },
  "CISCO-28P": {
    model: "SG300-28 / CBS350-24T-4G",
    vendor: "Cisco Systems",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: false,
    portPrefix: "Gi",
  },
  "UBIQUITI-24P": {
    model: "USW-24-PoE / EdgeSwitch 24",
    vendor: "Ubiquiti Inc.",
    rj45PortCount: 24,
    sfpPortCount: 2,
    poeSupported: true,
    poeBudgetWatts: 95,
    portPrefix: "0/",
  },
  "MIKROTIK-CRS326": {
    model: "CRS326-24G-2S+RM",
    vendor: "MikroTik",
    rj45PortCount: 24,
    sfpPortCount: 2,
    poeSupported: false,
    portPrefix: "ether",
  },
  "GENERIC-24P-4SFP": {
    model: "24-Port GbE + 4-SFP Managed Switch",
    vendor: "Managed Switch",
    rj45PortCount: 24,
    sfpPortCount: 4,
    poeSupported: false,
    portPrefix: "Port ",
  },
  "GENERIC-16P": {
    model: "16-Port GbE Managed Switch",
    vendor: "Managed Switch",
    rj45PortCount: 16,
    sfpPortCount: 2,
    poeSupported: false,
    portPrefix: "Port ",
  },
  "GENERIC-8P": {
    model: "8-Port GbE Compact Switch",
    vendor: "Managed Switch",
    rj45PortCount: 8,
    sfpPortCount: 2,
    poeSupported: false,
    portPrefix: "Port ",
  },
};

export function buildDefaultSwitchPorts(
  rj45Count: number,
  sfpCount: number,
  poeSupported: boolean,
  portPrefix = "Gi1/0/",
): TopologySwitchPortState[] {
  const total = rj45Count + sfpCount;
  const ports: TopologySwitchPortState[] = [];
  for (let i = 1; i <= total; i++) {
    const isSfp = i > rj45Count;
    ports.push({
      portNumber: i,
      name: `${portPrefix}${i}`,
      media: isSfp ? "sfp" : "rj45",
      linkStatus: "down",
      speed: "Down",
      duplex: "Auto",
      poeSupported: !isSfp && poeSupported,
      poeActive: false,
      poeWatts: 0,
      vlan: 1,
    });
  }
  return ports;
}

export function buildSwitchMetadataFromPreset(
  presetKey: string,
  overrides?: Partial<TopologySwitchMetadata>,
): TopologySwitchMetadata {
  const spec =
    SWITCH_MODEL_SPECS[presetKey] || SWITCH_MODEL_SPECS["T1600G-28TS"];
  const effectivePoeSupported = overrides?.poeSupported ?? spec.poeSupported;
  const ports =
    overrides?.ports && overrides.ports.length > 0
      ? overrides.ports
      : buildDefaultSwitchPorts(
          spec.rj45PortCount,
          spec.sfpPortCount,
          effectivePoeSupported,
          spec.portPrefix,
        );

  return {
    model: overrides?.model || spec.model,
    vendor: overrides?.vendor || spec.vendor,
    managementProtocol: overrides?.managementProtocol || "auto",
    managementPort: overrides?.managementPort,
    username: overrides?.username,
    hasPassword: overrides?.hasPassword,
    firmwareVersion: overrides?.firmwareVersion,
    hardwareVersion: overrides?.hardwareVersion,
    serialOrMac: overrides?.serialOrMac,
    uptimeStr: overrides?.uptimeStr,
    poeSupported: overrides?.poeSupported ?? spec.poeSupported,
    poeBudgetWatts: overrides?.poeBudgetWatts ?? spec.poeBudgetWatts,
    poeUsedWatts: overrides?.poeUsedWatts ?? 0,
    rj45PortCount: overrides?.rj45PortCount ?? spec.rj45PortCount,
    sfpPortCount: overrides?.sfpPortCount ?? spec.sfpPortCount,
    ports,
    lldpNeighbors: overrides?.lldpNeighbors || [],
    lastPolledAt: Date.now(),
  };
}

/**
 * Strips ANSI escape sequences and carriage returns from CLI transcripts.
 */
function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x08+/g, "")
    .replace(/\r/g, "");
}

/**
 * Parses TP-Link JetStream (`T1600G-28TS`, `T1600G-28PS`, `T2600G`, `TL-SG*`), Cisco IOS/SG300,
 * Ubiquiti EdgeSwitch, and MikroTik CLI output into a normalized `TopologySwitchMetadata` object.
 */
export function parseSwitchCliTranscript(
  rawTranscript: string,
  presetHint?: SwitchModelPreset,
): TopologySwitchMetadata {
  const clean = stripAnsi(rawTranscript);
  const lines = clean.split("\n").map((l) => l.trim());

  let detectedModel = "";
  let detectedVendor = "";
  let firmwareVersion = "";
  let hardwareVersion = "";
  let serialOrMac = "";
  let uptimeStr = "";

  // 1) Detect explicit model name in output (T1600G-28TS, T1600G-28PS, T2600G-28TS, TL-SG3428, TL-SG2428P, etc.)
  const modelRegex =
    /\b(T1600G-28PS|T1600G-28TS|T1600G-52PS|T1600G-52TS|T1600G-18TS|T2600G-28TS|T2600G-28MPS|T1500G-10PS|T1500G-8T|TL-SG3428MP|TL-SG3428|TL-SG2428P|TL-SG2218|TL-SG1016DE|TL-SG1024DE|CRS326-[0-9A-Z+]+|USW-[0-9A-Z-]+|ES-24-[0-9A-Z]+|SG300-[0-9A-Z]+|CBS350-[0-9A-Z-]+)\b/i;
  const modelMatch = clean.match(modelRegex);
  if (modelMatch) {
    detectedModel = modelMatch[1].toUpperCase();
  } else if (
    presetHint &&
    presetHint !== "auto" &&
    SWITCH_MODEL_SPECS[presetHint]
  ) {
    detectedModel = SWITCH_MODEL_SPECS[presetHint].model;
  }

  for (const line of lines) {
    const sysDesc = line.match(
      /^(?:System Description|Descr|board-name|Model)\s*[:=-]\s*(.+)$/i,
    );
    if (sysDesc) {
      const val = sysDesc[1].trim();
      if (!detectedModel) {
        const m = val.match(modelRegex);
        detectedModel = m ? m[1].toUpperCase() : val.slice(0, 36);
      }
      if (/jetstream|tp-link/i.test(val)) detectedVendor = "TP-Link JetStream";
      else if (/cisco/i.test(val)) detectedVendor = "Cisco Systems";
      else if (/ubiquiti|edgeswitch|unifi/i.test(val))
        detectedVendor = "Ubiquiti Inc.";
      else if (/mikrotik|routeros/i.test(val)) detectedVendor = "MikroTik";
    }

    const hwMatch = line.match(
      /^(?:Hardware Version|HW Version)\s*[:=-]\s*(.+)$/i,
    );
    if (hwMatch) {
      hardwareVersion = hwMatch[1].trim();
      const m = hardwareVersion.match(modelRegex);
      if (m && !detectedModel) detectedModel = m[1].toUpperCase();
    }

    const fwMatch = line.match(
      /^(?:Software Version|Firmware Version|SW Version|version)\s*[:=-]\s*(.+)$/i,
    );
    if (fwMatch && !firmwareVersion) {
      firmwareVersion = fwMatch[1].trim();
    }

    const macMatch = line.match(
      /^(?:Mac Address|Base ethernet MAC Address|System MAC)\s*[:=-]\s*([0-9A-Fa-f:-]{11,17})/i,
    );
    if (macMatch) {
      serialOrMac = macMatch[1].toUpperCase().replace(/-/g, ":");
    }

    const upMatch = line.match(
      /^(?:System Running Time|Uptime|uptime)\s*[:=-]\s*(.+)$/i,
    );
    if (upMatch) {
      uptimeStr = upMatch[1].trim();
    }
  }

  const knownSpec = detectedModel
    ? SWITCH_MODEL_SPECS[detectedModel]
    : undefined;
  const isPoEModel = knownSpec
    ? knownSpec.poeSupported
    : /28PS|52PS|10PS|MPS|2428P|3428MP|POE/i.test(detectedModel) ||
      presetHint === "T1600G-28PS" ||
      presetHint === "TL-SG2428P" ||
      presetHint === "UBIQUITI-24P";

  const specKey =
    detectedModel && SWITCH_MODEL_SPECS[detectedModel]
      ? detectedModel
      : presetHint && presetHint !== "auto" && SWITCH_MODEL_SPECS[presetHint]
        ? presetHint
        : isPoEModel
          ? "T1600G-28PS"
          : "T1600G-28TS";

  const baseMeta = buildSwitchMetadataFromPreset(specKey, {
    model: detectedModel || SWITCH_MODEL_SPECS[specKey].model,
    vendor:
      detectedVendor ||
      (/T1600G|T2600G|T1500G|TL-SG/i.test(detectedModel)
        ? "TP-Link JetStream"
        : SWITCH_MODEL_SPECS[specKey].vendor),
    firmwareVersion: firmwareVersion || undefined,
    hardwareVersion: hardwareVersion || undefined,
    serialOrMac: serialOrMac || undefined,
    uptimeStr: uptimeStr || undefined,
    poeSupported: isPoEModel,
    poeBudgetWatts: isPoEModel
      ? SWITCH_MODEL_SPECS[specKey]?.poeBudgetWatts || 192
      : undefined,
  });

  const portMap = new Map<number, TopologySwitchPortState>();
  for (const p of baseMeta.ports) {
    portMap.set(p.portNumber, p);
  }

  // 2) Parse `show interface status` / `show interfaces status` rows:
  // TP-Link JetStream format:
  // Port      Status      Speed     Duplex   FlowCtrl  Auto-Neg
  // ----      ------      -----     ------   --------  --------
  // Gi1/0/1   LinkUp      1000M     Full     Disable   Enable
  // Gi1/0/2   LinkDown    N/A       N/A      Disable   Enable
  // Gi1/0/25  LinkUp      1000M     Full     Disable   Disable
  // Also supports Cisco / EdgeSwitch: `Gi1/0/1  connected  1  a-full a-1000 10/100/1000BaseTX`
  for (const line of lines) {
    const portRow = line.match(
      /^(?:Gi(?:gabitEthernet)?\s*1\/0\/|Te(?:nGigabitEthernet)?\s*1\/0\/|Fa\s*1\/0\/|Gi|0\/|ether|Port\s*)(\d{1,2})\s+(.+)$/i,
    );
    if (!portRow) continue;
    const portNum = parseInt(portRow[1], 10);
    const rest = portRow[2].trim();
    if (portNum < 1 || portNum > 52) continue;

    // Skip lines that look like pure MAC table or PoE table rows unless they contain link state keywords
    const hasLinkKeyword =
      /\b(LinkUp|LinkDown|connected|notconnect|disabled|up|down|1000M|100M|10M|10G|Full|Half|Auto)\b/i.test(
        rest,
      );
    if (!hasLinkKeyword) continue;

    let entry = portMap.get(portNum);
    if (!entry) {
      entry = {
        portNumber: portNum,
        name: `Gi1/0/${portNum}`,
        media: portNum > baseMeta.rj45PortCount ? "sfp" : "rj45",
        linkStatus: "down",
        speed: "Down",
        duplex: "Auto",
        poeSupported:
          portNum <= baseMeta.rj45PortCount && baseMeta.poeSupported,
      };
      portMap.set(portNum, entry);
    }

    const isUp =
      /\b(LinkUp|connected|up)\b/i.test(rest) &&
      !/\b(LinkDown|notconnect|down|disabled)\b/i.test(rest);
    const isDisabled = /\b(disabled|err-disabled|admin-down)\b/i.test(rest);
    entry.linkStatus = isDisabled ? "disabled" : isUp ? "up" : "down";

    const speedMatch = rest.match(
      /\b(10G|2500M|2\.5G|1000M|1G|100M|10M|a-1000|a-100)\b/i,
    );
    if (speedMatch) {
      const rawSpd = speedMatch[1].toUpperCase();
      entry.speed =
        rawSpd === "A-1000" || rawSpd === "1G"
          ? "1000M"
          : rawSpd === "A-100"
            ? "100M"
            : rawSpd;
    } else {
      entry.speed = isUp ? "1000M" : "Down";
    }

    const dupMatch = rest.match(/\b(Full|Half|a-full|a-half)\b/i);
    if (dupMatch) {
      entry.duplex = /full/i.test(dupMatch[1]) ? "Full" : "Half";
    }
  }

  // 3) Parse PoE status (`show power inline` / `show poe power-status`) for T1600G-28PS / PoE switches:
  // Example TP-Link T1600G-28PS row:
  // Gi1/0/1   enable   normal   high   delivering   8.4     30.0   class3
  // or: `1   On   Delivering   7500 mW` or `Gi1/0/3  auto  on  12.4  Ieee PD  4  30.0`
  let totalPoeWatts = 0;
  if (!knownSpec || knownSpec.poeSupported) {
    for (const line of lines) {
      const budgetMatch = line.match(
        /(?:Total Power Limit|Nominal Power|PoE Budget|Max Power)\s*[:=-]?\s*([\d.]+)\s*W/i,
      );
      if (budgetMatch) {
        baseMeta.poeBudgetWatts = Math.round(parseFloat(budgetMatch[1]));
        baseMeta.poeSupported = true;
      }
      const usedMatch = line.match(
        /(?:Total Power Consumption|Consumed Power|Measured at the port)\s*[:=-]?\s*([\d.]+)\s*W/i,
      );
      if (usedMatch) {
        totalPoeWatts = Math.round(parseFloat(usedMatch[1]) * 10) / 10;
        baseMeta.poeSupported = true;
      }

      const poeRow = line.match(
        /^(?:Gi(?:gabitEthernet)?\s*1\/0\/|Gi|0\/|Port\s*)?(\d{1,2})\s+(?:enable|auto|on|normal|high|low|\s)+(?:delivering|power-on|on|feeding)\s+([\d.]+)\s*(mW|W)?/i,
      );
      if (poeRow) {
        const pNum = parseInt(poeRow[1], 10);
        const rawVal = parseFloat(poeRow[2]);
        const unit = (poeRow[3] || "W").toLowerCase();
        const watts =
          unit === "mw" || rawVal > 100
            ? Math.round((rawVal / 1000) * 10) / 10
            : Math.round(rawVal * 10) / 10;
        const port = portMap.get(pNum);
        if (port) {
          port.poeSupported = true;
          port.poeActive = watts > 0;
          port.poeWatts = watts;
          baseMeta.poeSupported = true;
        }
      }
    }
  }

  if (totalPoeWatts > 0) {
    baseMeta.poeUsedWatts = totalPoeWatts;
  } else if (baseMeta.poeSupported) {
    let sum = 0;
    for (const p of portMap.values()) {
      if (p.poeWatts) sum += p.poeWatts;
    }
    baseMeta.poeUsedWatts = Math.round(sum * 10) / 10;
  }

  // 4) Parse LLDP Neighbors, CDP Neighbors & MAC Address Table to associate ports with connected devices
  // Example MAC table row: `1    00:08:a2:11:22:33    Dynamic    Gi1/0/1` or `1   98-df-82-ca-24-a5   Dynamic   Gi1/0/12`
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const macRow = line.match(
      /\b([0-9a-fA-F]{2}(?:[:-][0-9a-fA-F]{2}){5})\b.*?\b(?:Gi(?:gabitEthernet)?\s*1\/0\/|Gi|0\/|ether|Port\s*)(\d{1,2})\b/i,
    );
    if (macRow) {
      const mac = macRow[1].toUpperCase().replace(/-/g, ":");
      const pNum = parseInt(macRow[2], 10);
      const port = portMap.get(pNum);
      if (port) {
        if (!port.connectedMac) port.connectedMac = mac;
        port.connectedMacs = port.connectedMacs || [];
        if (!port.connectedMacs.includes(mac)) port.connectedMacs.push(mac);
      }
    }

    // LLDP summary row: `Gi1/0/1   switch-core   ...   Gi0/1`
    const lldpRow = line.match(
      /^(?:Gi(?:gabitEthernet)?\s*1\/0\/|Gi|0\/|ether)(\d{1,2})\s+([A-Za-z0-9._-]+)(?:\s+\d+\s+[A-Z,]+\s+(\S+))?/i,
    );
    if (lldpRow) {
      const pNum = parseInt(lldpRow[1], 10);
      const remName = lldpRow[2];
      const remPort = lldpRow[3];
      if (
        !/^(LinkUp|LinkDown|enable|disable|auto|connected|notconnect|Dynamic|Static|N\/A)$/i.test(
          remName,
        )
      ) {
        const port = portMap.get(pNum);
        if (port) {
          port.connectedDeviceName = remName;
          baseMeta.lldpNeighbors = baseMeta.lldpNeighbors || [];
          if (
            !baseMeta.lldpNeighbors.some(
              (n) => n.localPort === pNum && n.remoteName === remName,
            )
          ) {
            baseMeta.lldpNeighbors.push({
              localPort: pNum,
              remoteName: remName,
            });
          }
        }
      }
      void remPort;
    }

    // CDP summary row: `sw-access-02   Gi 1/0/24   142   R S I   WS-C2960   Gi 0/1`
    const cdpRow = line.match(
      /^([A-Za-z0-9._-]+)\s+(?:Gi(?:gabitEthernet)?|Te(?:nGigabitEthernet)?|Fa(?:stEthernet)?|Eth)\s*(?:1\/0\/)?(\d{1,2})\s+\d+\s+[RTBSIHPC\s]+\s+\S+\s+(\S+)/i,
    );
    if (cdpRow) {
      const remName = cdpRow[1];
      const pNum = parseInt(cdpRow[2], 10);
      if (!/^(Device|Capability|Holdtme)$/i.test(remName)) {
        const port = portMap.get(pNum);
        if (port) {
          port.connectedDeviceName = remName;
          baseMeta.lldpNeighbors = baseMeta.lldpNeighbors || [];
          if (
            !baseMeta.lldpNeighbors.some(
              (n) => n.localPort === pNum && n.remoteName === remName,
            )
          ) {
            baseMeta.lldpNeighbors.push({
              localPort: pNum,
              remoteName: remName,
            });
          }
        }
      }
    }

    // LLDP / CDP detail block parsing: `Local Interface: Gi1/0/5` + `System Name:` / `Device ID:` + `Management Address:` / `IP address:`
    const localIfMatch = line.match(
      /(?:Local\s+(?:Intf|Interface|Port\s*id)|Interface)\s*:\s*(?:Gi(?:gabitEthernet)?\s*1\/0\/|Gi|0\/|ether)?(\d{1,2})/i,
    );
    if (localIfMatch) {
      const pNum = parseInt(localIfMatch[1], 10);
      let remName = "";
      let remIp = "";
      for (
        let j = Math.max(0, li - 3);
        j < Math.min(lines.length, li + 8);
        j++
      ) {
        const sub = lines[j];
        const devM = sub.match(
          /^(?:Device ID|System Name)\s*:\s*([A-Za-z0-9._-]+)/i,
        );
        if (devM && !remName) remName = devM[1];
        const ipM = sub.match(
          /(?:IP(?:v4)?\s*address|Management\s*Address)\s*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i,
        );
        if (ipM && !remIp) remIp = ipM[1];
      }
      if (remName || remIp) {
        const port = portMap.get(pNum);
        if (port && remName && !port.connectedDeviceName)
          port.connectedDeviceName = remName;
        baseMeta.lldpNeighbors = baseMeta.lldpNeighbors || [];
        const existingNbr = baseMeta.lldpNeighbors.find(
          (n) => n.localPort === pNum,
        );
        if (existingNbr) {
          if (remName) existingNbr.remoteName = remName;
          if (remIp) existingNbr.remoteIp = remIp;
        } else {
          baseMeta.lldpNeighbors.push({
            localPort: pNum,
            remoteName: remName || remIp,
            remoteIp: remIp || undefined,
          });
        }
      }
    }
  }

  baseMeta.ports = Array.from(portMap.values()).sort(
    (a, b) => a.portNumber - b.portNumber,
  );
  return baseMeta;
}

/**
 * Connects to a managed switch (such as TP-Link T1600G-28TS or T1600G-28PS) over SSH
 * using broad legacy + modern KEX/Cipher algorithms and executes non-destructive `show` commands.
 */
function querySwitchOverSsh(
  req: SwitchProbeRequest,
  timeoutMs = 7500,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    let transcript = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        // ignore
      }
      if (transcript.trim().length > 40) {
        resolve(transcript);
      } else {
        reject(new Error("SSH switch query timed out"));
      }
    }, timeoutMs);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        // ignore
      }
      if (err && transcript.trim().length < 40) {
        reject(err);
      } else {
        resolve(transcript);
      }
    };

    conn
      .on("ready", () => {
        conn.shell({ term: "vt100", cols: 160, rows: 48 }, (err, stream) => {
          if (err) {
            finish(err);
            return;
          }

          const commands = [
            "enable",
            req.enablePassword || "",
            "terminal length 0",
            "no clipaging",
            "show system-info",
            "show version",
            "show interface status",
            "show interfaces status",
            "show power inline",
            "show poe power-status",
            "show lldp neighbor-information interface",
            "show lldp neighbors detail",
            "show cdp neighbors detail",
            "show mac address-table",
            "show vlan brief",
            "show ip route",
            "show ip bgp summary",
            "show ip ospf neighbor",
            "exit",
            "exit",
          ];

          let cmdIdx = 0;
          const stepTimer = setInterval(() => {
            if (cmdIdx < commands.length) {
              try {
                stream.write(commands[cmdIdx] + "\n");
              } catch {
                // ignore write errors
              }
              cmdIdx++;
            } else {
              clearInterval(stepTimer);
              setTimeout(() => finish(), 450);
            }
          }, 260);

          stream.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            transcript += text;
            // Handle TP-Link JetStream "--More--" or "Press any key to continue" pager prompts automatically
            if (/--More--|Press any key to continue/i.test(text)) {
              try {
                stream.write(" ");
              } catch {
                // ignore
              }
            }
          });

          stream.on("close", () => {
            clearInterval(stepTimer);
            finish();
          });
        });
      })
      .on("error", (err) => {
        finish(err);
      })
      .connect({
        host: req.host,
        port: req.port || 22,
        username: req.username || "admin",
        password: req.password || "admin",
        readyTimeout: 4500,
        // Include legacy + modern KEX, HostKey & Ciphers required by TP-Link T1600G-28TS / T1600G-28PS firmware
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group-exchange-sha256",
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group14-sha1",
            "diffie-hellman-group1-sha1",
          ],
          serverHostKey: [
            "rsa-sha2-512",
            "rsa-sha2-256",
            "ssh-rsa",
            "ecdsa-sha2-nistp256",
            "ssh-ed25519",
            "ssh-dss",
          ],
          cipher: [
            "aes128-ctr",
            "aes192-ctr",
            "aes256-ctr",
            "aes128-gcm@openssh.com",
            "aes256-gcm@openssh.com",
            "aes128-cbc",
            "aes256-cbc",
            "3des-cbc",
          ],
        },
      });
  });
}

/**
 * Connects to a managed switch (such as TP-Link T1600G-28TS or T1600G-28PS) over Telnet (TCP port 23),
 * negotiates RFC 854 IAC options, logs in with username/password, escalates to `enable`, and runs `show` commands.
 */
function querySwitchOverTelnet(
  req: SwitchProbeRequest,
  timeoutMs = 10000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let transcript = "";
    let settled = false;
    let sentUser = false;
    let sentPass = false;
    let sentCommands = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err && transcript.trim().length < 25) {
        reject(err);
      } else {
        resolve(transcript);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error("Telnet switch query timed out"));
    }, timeoutMs);

    socket.on("connect", () => {
      // Some switches wait for initial CRLF before sending login banner
      setTimeout(() => {
        if (!sentUser && transcript.length === 0) {
          socket.write("\r\n");
        }
      }, 350);
    });

    socket.on("data", (buf: Buffer) => {
      // Reply WONT / DONT to Telnet IAC (0xFF) negotiation bytes and extract printable text
      const textBytes: number[] = [];
      let i = 0;
      while (i < buf.length) {
        if (buf[i] === 0xff && i + 1 < buf.length) {
          const cmd = buf[i + 1];
          if (
            (cmd === 0xfb || cmd === 0xfc || cmd === 0xfd || cmd === 0xfe) &&
            i + 2 < buf.length
          ) {
            const opt = buf[i + 2];
            // If server sends DO (0xFD), reply WONT (0xFC); if server sends WILL (0xFB), reply DONT (0xFE)
            if (cmd === 0xfd) {
              socket.write(Buffer.from([0xff, 0xfc, opt]));
            } else if (cmd === 0xfb) {
              socket.write(Buffer.from([0xff, 0xfe, opt]));
            }
            i += 3;
            continue;
          }
          i += 2;
          continue;
        }
        textBytes.push(buf[i]);
        i++;
      }

      const chunk = Buffer.from(textBytes).toString("utf8");
      transcript += chunk;

      if (/--More--|Press any key to continue/i.test(chunk)) {
        socket.write(" ");
      }

      if (!sentUser && /(?:User(?:name)?|Login)\s*:/i.test(transcript)) {
        sentUser = true;
        socket.write(`${req.username || "admin"}\r\n`);
        return;
      }

      if (!sentPass && /Password\s*:/i.test(chunk)) {
        sentPass = true;
        socket.write(`${req.password || "admin"}\r\n`);
        return;
      }

      if (
        !sentCommands &&
        (/[>#]\s*$/.test(chunk.trim()) || (sentPass && transcript.length > 60))
      ) {
        sentCommands = true;
        const cmds = [
          "enable",
          req.enablePassword || "",
          "terminal length 0",
          "no clipaging",
          "show system-info",
          "show version",
          "show interface status",
          "show power inline",
          "show poe power-status",
          "show lldp neighbor-information interface",
          "show mac address-table",
          "exit",
        ];
        cmds.forEach((cmd, idx) => {
          setTimeout(() => {
            if (!settled) {
              socket.write(`${cmd}\r\n`);
            }
            if (idx === cmds.length - 1) {
              setTimeout(() => {
                clearTimeout(timer);
                finish();
              }, 1400);
            }
          }, idx * 320);
        });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish(err);
    });

    socket.on("close", () => {
      clearTimeout(timer);
      finish();
    });

    socket.connect(req.port || 23, req.host);
  });
}

/**
 * Fingerprints a switch's HTTP / HTTPS Web management UI to detect TP-Link JetStream
 * T1600G-28TS, T1600G-28PS, T2600G, TL-SG*, MikroTik SwOS, Cisco, or Ubiquiti models
 * even before SSH/Telnet credentials are entered.
 */
export function fingerprintSwitchHttpBanner(
  host: string,
  port = 80,
  useHttps = false,
): Promise<{
  reachable: boolean;
  model?: string;
  vendor?: string;
  title?: string;
}> {
  return new Promise((resolve) => {
    const client = useHttps ? https : http;
    const req = client.request(
      {
        hostname: host,
        port,
        path: "/",
        method: "GET",
        timeout: 2200,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          if (body.length < 16384) body += chunk.toString("utf8");
        });
        res.on("end", () => {
          const combined = `${JSON.stringify(res.headers)} ${body}`;
          const modelMatch = combined.match(
            /\b(T1600G-28PS|T1600G-28TS|T1600G-52PS|T1600G-52TS|T2600G-28TS|T1500G-10PS|TL-SG3428|TL-SG2428P|TL-SG1016DE|TL-SG1024DE|CRS326|SG300|CBS350|EdgeSwitch)\b/i,
          );
          const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : undefined;
          let vendor: string | undefined;
          if (
            /tp-link|jetstream|T1600G|T2600G|TL-SG|web switch|themes\/steel_gray\/css\/layout\.css/i.test(
              combined,
            )
          ) {
            vendor = "TP-Link JetStream";
          } else if (/mikrotik|swos|routeros/i.test(combined)) {
            vendor = "MikroTik";
          } else if (/cisco/i.test(combined)) {
            vendor = "Cisco Systems";
          } else if (/ubiquiti|edgeswitch|unifi/i.test(combined)) {
            vendor = "Ubiquiti Inc.";
          }
          resolve({
            reachable: true,
            model: modelMatch ? modelMatch[1].toUpperCase() : undefined,
            vendor,
            title,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ reachable: false });
    });
    req.on("error", () => {
      resolve({ reachable: false });
    });
    req.end();
  });
}

/**
 * Queries a managed switch or router over SNMP v2c (UDP :161):
 * - System MIB (`sysDescr`, `sysName`)
 * - IF-MIB (`ifDescr`, `ifSpeed`, `ifOperStatus`)
 * - BRIDGE-MIB (`dot1dBasePortIfIndex`, `dot1dTpFdbAddress`, `dot1dTpFdbPort`) for MAC-to-Port mapping
 * - IP-MIB (`ipNetToMediaPhysAddress`, `ipNetToMediaNetAddress`) for ARP table discovery
 * - LLDP-MIB (`lldpRemSysName`) for Layer-2 LLDP neighbor discovery
 */
async function querySwitchOverSnmp(
  host: string,
  community = "public",
  port = 161,
  presetHint?: SwitchModelPreset,
): Promise<{
  meta: TopologySwitchMetadata;
  arpEntries: Array<{ ip: string; mac: string }>;
} | null> {
  const sysDescrVb = await snmpGet(host, community, "1.3.6.1.2.1.1.1.0", port);
  if (!sysDescrVb) return null;

  const sysDescr = snmpValToString(sysDescrVb.value);
  const sysNameVb = await snmpGet(host, community, "1.3.6.1.2.1.1.5.0", port);
  const sysName = sysNameVb ? snmpValToString(sysNameVb.value) : "";

  const modelRegex =
    /\b(T1600G-28PS|T1600G-28TS|T1600G-52PS|T1600G-52TS|T2600G-28TS|TL-SG3428|TL-SG2428P|CRS326|USW-[0-9A-Z-]+|SG300-[0-9A-Z]+|CBS350-[0-9A-Z-]+)\b/i;
  const m = `${sysDescr} ${sysName}`.match(modelRegex);
  const detectedModel = m ? m[1].toUpperCase() : undefined;
  const specKey =
    detectedModel && SWITCH_MODEL_SPECS[detectedModel]
      ? detectedModel
      : presetHint && presetHint !== "auto" && SWITCH_MODEL_SPECS[presetHint]
        ? presetHint
        : /poe|28ps/i.test(sysDescr)
          ? "T1600G-28PS"
          : "T1600G-28TS";

  const meta = buildSwitchMetadataFromPreset(specKey, {
    model: detectedModel || SWITCH_MODEL_SPECS[specKey].model,
    vendor: /tp-link|jetstream|t1600g/i.test(sysDescr)
      ? "TP-Link JetStream"
      : /cisco/i.test(sysDescr)
        ? "Cisco Systems"
        : /mikrotik/i.test(sysDescr)
          ? "MikroTik"
          : /ubiquiti/i.test(sysDescr)
            ? "Ubiquiti Inc."
            : SWITCH_MODEL_SPECS[specKey].vendor,
    firmwareVersion: sysDescr.slice(0, 48),
    managementProtocol: "snmp",
    managementPort: port,
  });

  // 1) IF-MIB: interface descriptions, speeds, and operStatus (1=up, 2=down)
  const [ifDescrs, ifSpeeds, ifOperStats] = await Promise.all([
    snmpWalk(host, community, "1.3.6.1.2.1.2.2.1.2", port, 64),
    snmpWalk(host, community, "1.3.6.1.2.1.2.2.1.5", port, 64),
    snmpWalk(host, community, "1.3.6.1.2.1.2.2.1.8", port, 64),
  ]);

  const ifIndexToPort = new Map<number, number>();
  const portByNum = new Map<number, TopologySwitchPortState>();
  for (const p of meta.ports) portByNum.set(p.portNumber, p);

  for (const vb of ifDescrs) {
    const idx = parseInt(vb.oid.split(".").pop() || "0", 10);
    const descr = snmpValToString(vb.value);
    const portMatch = descr.match(
      /(?:Gi(?:gabitEthernet)?\s*1\/0\/|Te\s*1\/0\/|ether|port\s*)(\d{1,2})\b/i,
    );
    const pNum = portMatch
      ? parseInt(portMatch[1], 10)
      : idx <= meta.ports.length
        ? idx
        : 0;
    if (pNum >= 1 && pNum <= meta.ports.length) {
      ifIndexToPort.set(idx, pNum);
      const pObj = portByNum.get(pNum);
      if (pObj && descr) pObj.name = descr;
    }
  }

  for (const vb of ifOperStats) {
    const idx = parseInt(vb.oid.split(".").pop() || "0", 10);
    const pNum = ifIndexToPort.get(idx);
    if (!pNum) continue;
    const pObj = portByNum.get(pNum);
    if (pObj) {
      const up = Number(vb.value) === 1;
      pObj.linkStatus = up ? "up" : "down";
      pObj.speed = up ? "1000M" : "Down";
    }
  }

  for (const vb of ifSpeeds) {
    const idx = parseInt(vb.oid.split(".").pop() || "0", 10);
    const pNum = ifIndexToPort.get(idx);
    if (!pNum) continue;
    const pObj = portByNum.get(pNum);
    if (pObj && pObj.linkStatus === "up") {
      const bps = Number(vb.value) || 0;
      pObj.speed =
        bps >= 10_000_000_000
          ? "10G"
          : bps >= 1_000_000_000
            ? "1000M"
            : bps >= 100_000_000
              ? "100M"
              : "10M";
    }
  }

  // 2) BRIDGE-MIB + Q-BRIDGE-MIB: dot1dBasePortIfIndex + dot1dTpFdbPort / dot1qTpFdbPort (MAC -> Switch Port)
  const [basePortIfs, fdbMacs, fdbPorts, qFdbPorts] = await Promise.all([
    snmpWalk(host, community, "1.3.6.1.2.1.17.1.4.1.2", port, 64),
    snmpWalk(host, community, "1.3.6.1.2.1.17.4.3.1.1", port, 128),
    snmpWalk(host, community, "1.3.6.1.2.1.17.4.3.1.2", port, 128),
    snmpWalk(host, community, "1.3.6.1.2.1.17.7.1.2.2.1.2", port, 128),
  ]);

  const bridgePortToSwitchPort = new Map<number, number>();
  for (const vb of basePortIfs) {
    const bPort = parseInt(vb.oid.split(".").pop() || "0", 10);
    const ifIdx = Number(vb.value) || 0;
    const swPort =
      ifIndexToPort.get(ifIdx) || (ifIdx <= meta.ports.length ? ifIdx : 0);
    if (bPort > 0 && swPort > 0) bridgePortToSwitchPort.set(bPort, swPort);
  }

  const fdbSuffixToMac = new Map<string, string>();
  for (const vb of fdbMacs) {
    const suffix = vb.oid.replace("1.3.6.1.2.1.17.4.3.1.1.", "");
    const mac = snmpValToMac(vb.value);
    if (mac) fdbSuffixToMac.set(suffix, mac);
  }
  const addMacToPort = (swPort: number, mac: string) => {
    const pObj = portByNum.get(swPort);
    if (!mac || !pObj) return;
    if (!pObj.connectedMac) pObj.connectedMac = mac;
    pObj.connectedMacs = pObj.connectedMacs || [];
    if (!pObj.connectedMacs.includes(mac)) pObj.connectedMacs.push(mac);
  };
  for (const vb of fdbPorts) {
    const suffix = vb.oid.replace("1.3.6.1.2.1.17.4.3.1.2.", "");
    const mac = fdbSuffixToMac.get(suffix);
    const bPort = Number(vb.value) || 0;
    const swPort = bridgePortToSwitchPort.get(bPort) || bPort;
    if (mac) addMacToPort(swPort, mac);
  }
  for (const vb of qFdbPorts) {
    const parts = vb.oid.split(".");
    if (parts.length < 7) continue;
    const macBytes = parts.slice(-6).map((n) => parseInt(n, 10));
    if (macBytes.some((b) => !Number.isFinite(b) || b < 0 || b > 255)) continue;
    const mac = macBytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    const bPort = Number(vb.value) || 0;
    const swPort = bridgePortToSwitchPort.get(bPort) || bPort;
    addMacToPort(swPort, mac);
  }

  // 3) IP-MIB ARP Table (`ipNetToMediaPhysAddress` .4.22.1.2)
  const arpEntries: Array<{ ip: string; mac: string }> = [];
  const arpWalk = await snmpWalk(
    host,
    community,
    "1.3.6.1.2.1.4.22.1.2",
    port,
    128,
  );
  for (const vb of arpWalk) {
    const parts = vb.oid.split(".");
    if (parts.length >= 4) {
      const ip = parts.slice(-4).join(".");
      const mac = snmpValToMac(vb.value);
      if (ip && mac) arpEntries.push({ ip, mac });
    }
  }

  // 4) LLDP-MIB (`lldpRemSysName` 1.0.8802.1.1.2.1.4.1.1.9)
  const lldpWalk = await snmpWalk(
    host,
    community,
    "1.0.8802.1.1.2.1.4.1.1.9",
    port,
    64,
  );
  for (const vb of lldpWalk) {
    const parts = vb.oid.split(".");
    const remName = snmpValToString(vb.value);
    if (parts.length >= 3 && remName) {
      const localPortNum = parseInt(parts[parts.length - 2], 10);
      const swPort = ifIndexToPort.get(localPortNum) || localPortNum;
      const pObj = portByNum.get(swPort);
      if (pObj && !pObj.connectedDeviceName) {
        pObj.connectedDeviceName = remName;
        meta.lldpNeighbors = meta.lldpNeighbors || [];
        meta.lldpNeighbors.push({ localPort: swPort, remoteName: remName });
      }
    }
  }

  meta.ports = Array.from(portByNum.values()).sort(
    (a, b) => a.portNumber - b.portNumber,
  );
  return { meta, arpEntries };
}

/**
 * Main entry point: probes a switch using SSH, Telnet, SNMP (:161), and/or HTTP banner fingerprinting
 * and returns complete 28-port (24x RJ45 + 4x SFP) + PoE + LLDP/CDP + Routing metadata.
 */
export async function probeManagedSwitch(
  req: SwitchProbeRequest,
): Promise<SwitchProbeResult> {
  const host = String(req.host || "").trim();
  const mode = req.protocol || "auto";
  const preset = req.modelPreset || "auto";

  if (!host) {
    const meta = buildSwitchMetadataFromPreset(
      preset === "auto" ? "T1600G-28TS" : preset,
    );
    return {
      ok: true,
      reachable: false,
      protocolUsed: "preset",
      message: `Initialized ${meta.vendor} ${meta.model} (${meta.rj45PortCount}x RJ45 + ${meta.sfpPortCount}x SFP)`,
      switchMeta: meta,
    };
  }

  // 1) Try SSH CLI first when mode is 'auto' or 'ssh'
  if (mode === "auto" || mode === "ssh") {
    try {
      const sshOut = await querySwitchOverSsh({
        ...req,
        port: mode === "ssh" && req.port ? req.port : 22,
      });
      if (sshOut.trim().length > 30) {
        const meta = parseSwitchCliTranscript(sshOut, preset);
        const routingAnalysis = parseRoutingAndConfigTranscript(sshOut);
        meta.managementProtocol = "ssh";
        meta.managementPort = mode === "ssh" && req.port ? req.port : 22;
        meta.username = req.username || "admin";
        meta.hasPassword = Boolean(req.password);
        const upPorts = meta.ports.filter((p) => p.linkStatus === "up").length;
        return {
          ok: true,
          reachable: true,
          protocolUsed: "ssh",
          message: `Polled ${meta.vendor} ${meta.model} via SSH (${upPorts}/${meta.ports.length} ports UP${meta.poeSupported ? ` · PoE ${meta.poeUsedWatts || 0}W/${meta.poeBudgetWatts || 192}W` : ""})`,
          switchMeta: meta,
          routingAnalysis,
          rawTranscript: sshOut.slice(0, 4000),
        };
      }
    } catch {
      // Fall through to Telnet / SNMP / HTTP if in 'auto' mode
    }
  }

  // 2) Try Telnet CLI (port 23) when mode is 'auto' or 'telnet'
  if (mode === "auto" || mode === "telnet") {
    try {
      const telnetOut = await querySwitchOverTelnet({
        ...req,
        port: mode === "telnet" && req.port ? req.port : 23,
      });
      if (telnetOut.trim().length > 25) {
        const meta = parseSwitchCliTranscript(telnetOut, preset);
        const routingAnalysis = parseRoutingAndConfigTranscript(telnetOut);
        meta.managementProtocol = "telnet";
        meta.managementPort = mode === "telnet" && req.port ? req.port : 23;
        meta.username = req.username || "admin";
        meta.hasPassword = Boolean(req.password);
        const upPorts = meta.ports.filter((p) => p.linkStatus === "up").length;
        return {
          ok: true,
          reachable: true,
          protocolUsed: "telnet",
          message: `Polled ${meta.vendor} ${meta.model} via Telnet (${upPorts}/${meta.ports.length} ports UP${meta.poeSupported ? ` · PoE ${meta.poeUsedWatts || 0}W/${meta.poeBudgetWatts || 192}W` : ""})`,
          switchMeta: meta,
          routingAnalysis,
          rawTranscript: telnetOut.slice(0, 4000),
        };
      }
    } catch {
      // Fall through to SNMP / HTTP banner fingerprint
    }
  }

  // 3) Try SNMP v2c (UDP :161) when mode is 'auto' or 'snmp'
  if (mode === "auto" || mode === "snmp") {
    try {
      const snmpRes = await querySwitchOverSnmp(
        host,
        req.snmpCommunity || "public",
        mode === "snmp" && req.port ? req.port : 161,
        preset,
      );
      if (snmpRes) {
        const { meta, arpEntries } = snmpRes;
        const upPorts = meta.ports.filter((p) => p.linkStatus === "up").length;
        return {
          ok: true,
          reachable: true,
          protocolUsed: "snmp",
          message: `Polled ${meta.vendor} ${meta.model} via SNMP (${upPorts}/${meta.ports.length} ports UP, ${arpEntries.length} ARP entries)`,
          switchMeta: meta,
          arpEntries,
        };
      }
    } catch {
      // Fall through to HTTP banner fingerprint
    }
  }

  // 3) Try HTTP / HTTPS Web UI banner fingerprinting
  const httpFp = await fingerprintSwitchHttpBanner(host, req.port || 80, false);
  const httpsFp = !httpFp.reachable
    ? await fingerprintSwitchHttpBanner(host, 443, true)
    : { reachable: false };
  const activeFp = httpFp.reachable ? httpFp : httpsFp;

  const resolvedKey =
    (activeFp.model && SWITCH_MODEL_SPECS[activeFp.model]
      ? activeFp.model
      : undefined) || (preset !== "auto" ? preset : "T1600G-28TS");

  const meta = buildSwitchMetadataFromPreset(resolvedKey, {
    model: activeFp.model || SWITCH_MODEL_SPECS[resolvedKey].model,
    vendor: activeFp.vendor || SWITCH_MODEL_SPECS[resolvedKey].vendor,
    managementProtocol: activeFp.reachable
      ? "http"
      : mode === "auto"
        ? "ssh"
        : mode,
    managementPort: req.port || (mode === "telnet" ? 23 : 22),
    username: req.username || "admin",
    hasPassword: Boolean(req.password),
  });

  return {
    ok: true,
    reachable: activeFp.reachable,
    protocolUsed: activeFp.reachable ? "http" : "preset",
    message: activeFp.reachable
      ? `Detected ${meta.vendor} ${meta.model} Web UI at ${host}. Enable SSH or Telnet on the switch for live per-port CLI telemetry.`
      : `Configured ${meta.vendor} ${meta.model} (${meta.rj45PortCount}x GbE RJ45 + ${meta.sfpPortCount}x SFP${meta.poeSupported ? " · 192W PoE+" : ""}) at ${host}.`,
    switchMeta: meta,
  };
}
