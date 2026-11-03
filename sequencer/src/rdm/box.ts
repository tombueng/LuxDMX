// What a LuxDMX box's RDM controller says (its /rdm.json, through the bridge page), in our model.
// Anything missing or odd becomes a plain default: an older firmware says less, never breaks this.
import { isUid, type RdmDevice, type RdmMode, type RdmScanState, type RdmSensor } from './types';

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function fromBox(via: string, j: unknown): { devices: RdmDevice[]; scan: RdmScanState; lines: { line: number; uni: number }[]; available: boolean } {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const stage = num(o.discStage);
  const scan: RdmScanState = {
    busy: !!o.busy || !!o.discovering,
    found: num(o.discFound, Array.isArray(o.devices) ? o.devices.length : 0),
    stage: stage === 1 ? 'search' : stage === 2 ? 'details' : o.scanned ? 'done' : 'idle',
  };
  const lines = (Array.isArray(o.rdmLines) ? o.rdmLines : []).map((l) => ({ line: num((l as Record<string, unknown>).line), uni: num((l as Record<string, unknown>).uni) }));
  const devices: RdmDevice[] = [];
  for (const raw of Array.isArray(o.devices) ? o.devices : []) {
    const d = raw as Record<string, unknown>;
    if (!isUid(d.uid)) continue;
    const sensors: RdmSensor[] = (Array.isArray(d.sensors) ? d.sensors : []).map((s) => {
      const x = s as Record<string, unknown>;
      return { name: str(x.name) || 'Sensor', value: num(x.value), lo: num(x.lo), hi: num(x.hi), unit: str(x.unit), type: num(x.type) };
    });
    const modeList: RdmMode[] | undefined = Array.isArray(d.modes)
      ? d.modes.map((m, i) => { const x = m as Record<string, unknown>; return { n: num(x.n, i + 1), name: str(x.name) || `Mode ${i + 1}`, footprint: num(x.footprint) }; })
      : undefined;
    devices.push({
      uid: (d.uid as string).toUpperCase(), via, uni: num(d.uni), addr: num(d.addr), footprint: num(d.footprint),
      maker: str(d.mfg), model: str(d.modelName), modelId: num(d.model), label: str(d.label), category: num(d.cat),
      mode: num(d.pers, 1), modes: num(d.persCount, 1), ...(modeList ? { modeList } : {}),
      software: str(d.sw), softwareId: num(d.swVer), identify: !!d.identify, sensors,
      status: { type: num(d.stType), id: num(d.stId), count: num(d.stCount) },
      ...(typeof d.hours === 'number' ? { hours: d.hours } : {}), ...(typeof d.lampHours === 'number' ? { lampHours: d.lampHours } : {}),
    });
  }
  return { devices, scan, lines, available: o.available !== false };
}
