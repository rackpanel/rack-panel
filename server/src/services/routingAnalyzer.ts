export interface ParsedBgpPeer {
  neighborIp: string;
  remoteAs: number;
  state: string;
  prefixesReceived: number;
  routerId?: string;
}

export interface ParsedOspfNeighbor {
  neighborId: string;
  address: string;
  interface: string;
  state: string;
  area?: string;
}

export interface ParsedRouteEntry {
  prefix: string;
  nextHop: string;
  protocol: 'connected' | 'static' | 'ospf' | 'bgp' | 'kernel' | 'local';
  interface: string;
  metric?: number;
}

export interface ParsedVlanEntry {
  id: number;
  name: string;
  ports: string[];
}

export interface ParsedRedundancyGroup {
  protocol: 'CARP' | 'VRRP' | 'HSRP' | 'LACP' | 'ECMP';
  group: string;
  state: string;
  detail: string;
}

export interface RoutingAnalysisResult {
  bgpPeers: ParsedBgpPeer[];
  ospfNeighbors: ParsedOspfNeighbor[];
  routes: ParsedRouteEntry[];
  vlans: ParsedVlanEntry[];
  redundancyGroups: ParsedRedundancyGroup[];
  summaryText: string;
}

/**
 * Parses routing tables, BGP/OSPF neighbor tables, VLANs, and HA/LACP redundancy blocks
 * from Cisco IOS, TP-Link JetStream, MikroTik RouterOS, FRRouting/Quagga, VyOS, or Linux (`ip route`).
 */
export function parseRoutingAndConfigTranscript(raw: string): RoutingAnalysisResult {
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const bgpPeers: ParsedBgpPeer[] = [];
  const ospfNeighbors: ParsedOspfNeighbor[] = [];
  const routes: ParsedRouteEntry[] = [];
  const vlans: ParsedVlanEntry[] = [];
  const redundancyGroups: ParsedRedundancyGroup[] = [];

  let currentBgpAs = 0;

  for (const line of lines) {
    // 1) BGP Summary rows: `192.168.10.2  4  65002  145  142  0  0  0  02:14:10  128`
    const bgpRow = line.match(
      /^(\d{1,3}(?:\.\d{1,3}){3})\s+4\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\S+\s+(\d+|Active|Idle|Connect|OpenSent|OpenConfirm|Established)/i,
    );
    if (bgpRow) {
      const rawState = bgpRow[3];
      const isNum = /^\d+$/.test(rawState);
      bgpPeers.push({
        neighborIp: bgpRow[1],
        remoteAs: parseInt(bgpRow[2], 10),
        state: isNum ? 'Established' : rawState,
        prefixesReceived: isNum ? parseInt(rawState, 10) : 0,
      });
      continue;
    }

    // BGP config stanza: `router bgp 65001` + `neighbor 10.0.0.2 remote-as 65002`
    const routerBgp = line.match(/^router\s+bgp\s+(\d+)/i);
    if (routerBgp) {
      currentBgpAs = parseInt(routerBgp[1], 10);
      continue;
    }
    const bgpNeighborCfg = line.match(/^neighbor\s+(\d{1,3}(?:\.\d{1,3}){3})\s+remote-as\s+(\d+)/i);
    if (bgpNeighborCfg) {
      if (!bgpPeers.some((p) => p.neighborIp === bgpNeighborCfg[1])) {
        bgpPeers.push({
          neighborIp: bgpNeighborCfg[1],
          remoteAs: parseInt(bgpNeighborCfg[2], 10),
          state: currentBgpAs ? `Configured (AS${currentBgpAs})` : 'Configured',
          prefixesReceived: 0,
        });
      }
      continue;
    }

    // 2) OSPF Neighbor rows: `10.255.0.2  1  FULL/DR  00:00:34  192.168.10.2  GigabitEthernet0/1`
    const ospfRow = line.match(
      /^(\d{1,3}(?:\.\d{1,3}){3})\s+\d+\s+(FULL\/\S+|2WAY\/\S+|EXSTART|EXCHANGE|LOADING|INIT|DOWN)\s+\S+\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\S+)/i,
    );
    if (ospfRow) {
      ospfNeighbors.push({
        neighborId: ospfRow[1],
        state: ospfRow[2],
        address: ospfRow[3],
        interface: ospfRow[4],
      });
      continue;
    }

    // 3) Routing Table rows (Cisco/FRR `O 10.20.0.0/24 [110/20] via 192.168.0.2, eth0`, `B>* ...`, `S* 0.0.0.0/0 ...`)
    const iosRoute = line.match(
      /^([BCOSKL])[*>]?\*?\s+(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)\s+(?:\[(\d+)\/\d+\]\s+)?(?:via\s+(\d{1,3}(?:\.\d{1,3}){3}))?(?:,\s*(\S+))?/i,
    );
    if (iosRoute) {
      const code = iosRoute[1].toUpperCase();
      const proto: ParsedRouteEntry['protocol'] =
        code === 'B'
          ? 'bgp'
          : code === 'O'
            ? 'ospf'
            : code === 'S'
              ? 'static'
              : code === 'C'
                ? 'connected'
                : code === 'L'
                  ? 'local'
                  : 'kernel';
      routes.push({
        prefix: iosRoute[2],
        nextHop: iosRoute[4] || 'direct',
        protocol: proto,
        interface: iosRoute[5] || '',
        metric: iosRoute[3] ? parseInt(iosRoute[3], 10) : undefined,
      });
      continue;
    }

    // Linux `ip route` rows: `default via 192.168.0.1 dev eth0` or `10.10.0.0/24 via 192.168.0.2 dev eth0`
    const linuxRoute = line.match(
      /^(default|\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})\s+dev\s+(\S+)/i,
    );
    if (linuxRoute) {
      routes.push({
        prefix: linuxRoute[1] === 'default' ? '0.0.0.0/0' : linuxRoute[1],
        nextHop: linuxRoute[2],
        protocol: /proto\s+bgp/i.test(line)
          ? 'bgp'
          : /proto\s+ospf/i.test(line)
            ? 'ospf'
            : /proto\s+static/i.test(line)
              ? 'static'
              : 'kernel',
        interface: linuxRoute[3],
      });
      continue;
    }

    // Static route config: `ip route 10.0.0.0 255.255.0.0 192.168.0.254`
    const staticCfg = line.match(/^ip\s+route\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})/i);
    if (staticCfg) {
      routes.push({
        prefix: `${staticCfg[1]}/${staticCfg[2]}`,
        nextHop: staticCfg[3],
        protocol: 'static',
        interface: '',
      });
      continue;
    }

    // 4) VLAN brief rows: `10   MGMT_VLAN   active   Gi1/0/1, Gi1/0/2`
    const vlanRow = line.match(/^(\d{1,4})\s+([A-Za-z0-9_.-]+)\s+(?:active|act\/unsup|static)\s*(.*)$/i);
    if (vlanRow) {
      vlans.push({
        id: parseInt(vlanRow[1], 10),
        name: vlanRow[2],
        ports: vlanRow[3]
          ? vlanRow[3]
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      });
      continue;
    }

    // 5) Redundancy & Link Aggregation (VRRP / HSRP / CARP / LACP Port-Channel)
    const redMatch = line.match(/\b(VRRP|HSRP|CARP|LACP|Port-channel\d+|Po\d+|lag\d+)\b/i);
    if (redMatch) {
      const proto = /vrrp/i.test(redMatch[1])
        ? 'VRRP'
        : /hsrp/i.test(redMatch[1])
          ? 'HSRP'
          : /carp/i.test(redMatch[1])
            ? 'CARP'
            : 'LACP';
      redundancyGroups.push({
        protocol: proto,
        group: redMatch[1].toUpperCase(),
        state: /master|active/i.test(line) ? 'ACTIVE' : /backup|standby/i.test(line) ? 'STANDBY' : 'UP',
        detail: line.slice(0, 90),
      });
    }
  }

  const parts: string[] = [];
  if (bgpPeers.length > 0) parts.push(`${bgpPeers.length} BGP peer(s)`);
  if (ospfNeighbors.length > 0) parts.push(`${ospfNeighbors.length} OSPF neighbor(s)`);
  if (routes.length > 0) parts.push(`${routes.length} route(s)`);
  if (vlans.length > 0) parts.push(`${vlans.length} VLAN(s)`);
  if (redundancyGroups.length > 0) parts.push(`${redundancyGroups.length} HA/LACP group(s)`);

  return {
    bgpPeers,
    ospfNeighbors,
    routes,
    vlans,
    redundancyGroups,
    summaryText: parts.length > 0 ? parts.join(' · ') : 'No BGP/OSPF/route entries detected',
  };
}
