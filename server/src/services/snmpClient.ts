import dgram from 'node:dgram';

/**
 * Lightweight, zero-dependency SNMP v1/v2c UDP (:161) client implementing ASN.1 BER encoding/decoding
 * for GET and GETNEXT walks across System MIB, IF-MIB, IP-MIB (ARP), BRIDGE-MIB (MAC FDB), and LLDP-MIB.
 */

export interface SnmpVarBind {
  oid: string;
  type: number;
  value: string | number | Buffer | null;
}

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let tmp = len;
  while (tmp > 0) {
    bytes.unshift(tmp & 0xff);
    tmp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function encodeInteger(val: number): Buffer {
  if (val === 0) return encodeTlv(0x02, Buffer.from([0x00]));
  const bytes: number[] = [];
  let tmp = val;
  while (tmp > 0) {
    bytes.unshift(tmp & 0xff);
    tmp >>= 8;
  }
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return encodeTlv(0x02, Buffer.from(bytes));
}

function encodeOid(oidStr: string): Buffer {
  const parts = oidStr
    .replace(/^\./, '')
    .split('.')
    .map((n) => parseInt(n, 10))
    .filter((n) => !Number.isNaN(n));
  if (parts.length < 2) return encodeTlv(0x06, Buffer.from([0x00]));
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    if (v === 0) {
      out.push(0);
      continue;
    }
    const enc: number[] = [];
    while (v > 0) {
      enc.unshift((v & 0x7f) | (enc.length > 0 ? 0x80 : 0));
      v >>>= 7;
    }
    out.push(...enc);
  }
  return encodeTlv(0x06, Buffer.from(out));
}

function buildSnmpPacket(pduType: number, requestId: number, community: string, oid: string, version = 1): Buffer {
  const verBuf = encodeInteger(version); // 0 = v1, 1 = v2c
  const commBuf = encodeTlv(0x04, Buffer.from(community, 'utf8'));
  const reqIdBuf = encodeInteger(requestId);
  const errStatusBuf = encodeInteger(0);
  const errIdxBuf = encodeInteger(0);
  const varBind = encodeTlv(0x30, Buffer.concat([encodeOid(oid), Buffer.from([0x05, 0x00])]));
  const varBindList = encodeTlv(0x30, varBind);
  const pdu = encodeTlv(pduType, Buffer.concat([reqIdBuf, errStatusBuf, errIdxBuf, varBindList]));
  return encodeTlv(0x30, Buffer.concat([verBuf, commBuf, pdu]));
}

function readLength(buf: Buffer, offset: number): { length: number; next: number } {
  const first = buf[offset];
  if ((first & 0x80) === 0) {
    return { length: first, next: offset + 1 };
  }
  const numBytes = first & 0x7f;
  let len = 0;
  for (let i = 0; i < numBytes; i++) {
    len = (len << 8) | buf[offset + 1 + i];
  }
  return { length: len, next: offset + 1 + numBytes };
}

function decodeOid(buf: Buffer): string {
  if (buf.length === 0) return '';
  const first = buf[0];
  const parts: number[] = [Math.floor(first / 40), first % 40];
  let i = 1;
  while (i < buf.length) {
    let val = 0;
    while (i < buf.length) {
      const b = buf[i++];
      val = (val << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    parts.push(val);
  }
  return parts.join('.');
}

function decodeInteger(buf: Buffer): number {
  let val = 0;
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i];
  }
  return val;
}

function parseSnmpResponse(buf: Buffer): { requestId: number; errorStatus: number; varBinds: SnmpVarBind[] } {
  let pos = 0;
  if (buf[pos++] !== 0x30) throw new Error('Invalid SNMP SEQUENCE');
  pos = readLength(buf, pos).next;

  // Version
  if (buf[pos++] !== 0x02) throw new Error('Invalid SNMP version');
  const verLen = readLength(buf, pos);
  pos = verLen.next + verLen.length;

  // Community
  if (buf[pos++] !== 0x04) throw new Error('Invalid SNMP community');
  const commLen = readLength(buf, pos);
  pos = commLen.next + commLen.length;

  // GetResponse PDU (0xA2)
  const pduTag = buf[pos++];
  if (pduTag !== 0xa2) throw new Error(`Unexpected SNMP PDU tag 0x${pduTag.toString(16)}`);
  pos = readLength(buf, pos).next;

  // Request ID
  if (buf[pos++] !== 0x02) throw new Error('Invalid request-id');
  const reqLen = readLength(buf, pos);
  const requestId = decodeInteger(buf.subarray(reqLen.next, reqLen.next + reqLen.length));
  pos = reqLen.next + reqLen.length;

  // Error Status
  if (buf[pos++] !== 0x02) throw new Error('Invalid error-status');
  const errLen = readLength(buf, pos);
  const errorStatus = decodeInteger(buf.subarray(errLen.next, errLen.next + errLen.length));
  pos = errLen.next + errLen.length;

  // Error Index
  if (buf[pos++] !== 0x02) throw new Error('Invalid error-index');
  const errIdxLen = readLength(buf, pos);
  pos = errIdxLen.next + errIdxLen.length;

  // VarBindList
  if (buf[pos++] !== 0x30) throw new Error('Invalid VarBindList');
  const vblLen = readLength(buf, pos);
  pos = vblLen.next;
  const vblEnd = pos + vblLen.length;

  const varBinds: SnmpVarBind[] = [];
  while (pos < vblEnd && pos < buf.length) {
    if (buf[pos++] !== 0x30) break;
    const vbLen = readLength(buf, pos);
    pos = vbLen.next;
    if (buf[pos++] !== 0x06) break;
    const oidLen = readLength(buf, pos);
    const oid = decodeOid(buf.subarray(oidLen.next, oidLen.next + oidLen.length));
    pos = oidLen.next + oidLen.length;

    const valType = buf[pos++];
    const valLen = readLength(buf, pos);
    const rawVal = buf.subarray(valLen.next, valLen.next + valLen.length);
    pos = valLen.next + valLen.length;

    let value: SnmpVarBind['value'] = null;
    if (valType === 0x02 || valType === 0x41 || valType === 0x42 || valType === 0x43) {
      value = decodeInteger(rawVal);
    } else if (valType === 0x04) {
      value = Buffer.from(rawVal);
    } else if (valType === 0x40 && rawVal.length === 4) {
      value = `${rawVal[0]}.${rawVal[1]}.${rawVal[2]}.${rawVal[3]}`;
    } else if (valType === 0x06) {
      value = decodeOid(rawVal);
    } else if (valType === 0x80 || valType === 0x81 || valType === 0x82) {
      value = null; // noSuchObject / noSuchInstance / endOfMibView
    }
    varBinds.push({ oid, type: valType, value });
  }

  return { requestId, errorStatus, varBinds };
}

function snmpRequest(
  host: string,
  port: number,
  community: string,
  oid: string,
  pduType: number,
  timeoutMs = 1800,
): Promise<SnmpVarBind | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const reqId = Math.floor(Math.random() * 0x7fffffff);
    const pkt = buildSnmpPacket(pduType, reqId, community, oid, 1);
    let settled = false;

    const done = (val: SnmpVarBind | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(val);
    };

    const timer = setTimeout(() => done(null), timeoutMs);

    socket.on('message', (msg) => {
      try {
        const parsed = parseSnmpResponse(msg);
        if (parsed.errorStatus !== 0 || parsed.varBinds.length === 0) {
          done(null);
          return;
        }
        const vb = parsed.varBinds[0];
        if (vb.type === 0x80 || vb.type === 0x81 || vb.type === 0x82) {
          done(null);
          return;
        }
        done(vb);
      } catch {
        done(null);
      }
    });

    socket.on('error', () => done(null));
    socket.send(pkt, port, host);
  });
}

export function snmpGet(host: string, community: string, oid: string, port = 161): Promise<SnmpVarBind | null> {
  return snmpRequest(host, port, community, oid, 0xa0);
}

export async function snmpWalk(
  host: string,
  community: string,
  rootOid: string,
  port = 161,
  maxRows = 128,
): Promise<SnmpVarBind[]> {
  const cleanRoot = rootOid.replace(/^\./, '');
  const results: SnmpVarBind[] = [];
  let currentOid = cleanRoot;

  for (let i = 0; i < maxRows; i++) {
    const vb = await snmpRequest(host, port, community, currentOid, 0xa1, 1400);
    if (!vb || !vb.oid.startsWith(cleanRoot + '.')) break;
    if (vb.oid === currentOid) break;
    results.push(vb);
    currentOid = vb.oid;
  }
  return results;
}

export function snmpValToString(val: SnmpVarBind['value']): string {
  if (val === null || val === undefined) return '';
  if (Buffer.isBuffer(val)) return val.toString('utf8').replace(/\0/g, '').trim();
  return String(val);
}

export function snmpValToMac(val: SnmpVarBind['value']): string {
  if (!Buffer.isBuffer(val) || val.length !== 6) return '';
  return Array.from(val)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}
