// RDM (ANSI E1.20): the lights on the rig answering for themselves on the DMX line. Who they are
// (a unique id, maker, model), where they listen (universe, start address, how many channels), in
// which mode (personality), how they're doing (sensors, status messages, hours), and a few things
// to set (address, mode, label, identify). The same model whichever way we reach them: a LuxDMX box's
// own RDM controller through its bridge page, or Art-Net nodes through LuxDMX Link.

export interface RdmSensor { name: string; value: number; lo: number; hi: number; unit: string; type: number }
// a mode the device offers: its number (1..), name and channel count, when the device said
export interface RdmMode { n: number; name: string; footprint: number }

export interface RdmDevice {
  uid: string;              // "MMMM:DDDDDDDD": maker (ESTA id) and the device's own number, hex
  via: string;              // the box (its host) or the Art-Net node that reached it
  uni: number;              // the universe of the line it's on
  addr: number;             // start address (1..512; 0: it uses no channels)
  footprint: number;        // channels in its current mode
  maker: string;            // manufacturer label
  model: string;            // model description
  modelId: number;
  label: string;            // its own name (what you set)
  category: number;
  mode: number;             // personality now (1..)
  modes: number;            // how many it has
  modeList?: RdmMode[];     // their names and footprints, when known
  software: string; softwareId: number;
  identify: boolean;
  sensors: RdmSensor[];
  status: { type: number; id: number; count: number };   // the last status message (type 0: none)
  hours?: number; lampHours?: number;
}

// what a page asks a transport for, and what it answers
export type RdmRequest =
  | { op: 'list' }
  | { op: 'scan'; line?: number }
  | { op: 'identify'; uid: string; on: boolean }
  | { op: 'address'; uid: string; addr: number }
  | { op: 'mode'; uid: string; mode: number }
  | { op: 'label'; uid: string; label: string };
export interface RdmReply { ok: boolean; status?: number; data?: unknown; error?: 'timeout' | 'unreachable' | 'unsupported' | 'refused' | string }

// how far a transport's scan has got
export interface RdmScanState { busy: boolean; found: number; stage: 'idle' | 'search' | 'details' | 'done' }
// what one transport (a box, Link) says about RDM
export interface RdmSource {
  key: string;              // the box's host, or 'link'
  name: string;
  can: 'yes' | 'no' | 'unknown';
  why?: string;             // why not, in plain words
  scan: RdmScanState;
  lines: { line: number; uni: number }[];
  devices: RdmDevice[];
  at: number;               // when this was last read (ms)
}

export const uidMaker = (uid: string) => parseInt(uid.split(':')[0] ?? '0', 16) || 0;
export const isUid = (s: unknown): s is string => typeof s === 'string' && /^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}$/.test(s);
// Status message types (E1.20 table A-4): what a light says is wrong
export const STATUS_LEVEL = (t: number): 'ok' | 'advice' | 'warning' | 'error' =>
  t === 0 ? 'ok' : t === 2 || t === 0x12 ? 'advice' : t === 3 || t === 0x13 ? 'warning' : t === 4 || t === 0x14 ? 'error' : 'advice';
