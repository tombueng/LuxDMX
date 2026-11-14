// What can be a box's address: an IPv4 address, a name on the network (dmx-gateway.local, a host
// name), or [an IPv6 address]; with a port or without. What isn't one is said in plain words
// before it's added, rather than a browser error page coming up on Connect.
// what's typed, without the http:// (any case: a tablet's keyboard writes "Http://") and a path
export const cleanHost = (raw: string) => raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
export function hostProblem(raw: string): string | undefined {
  const host = cleanHost(raw);
  if (!host) return 'Type the box\'s address first.';
  const say = `"${raw.trim()}" isn't an address: type the box's IP (like 192.168.1.50) or its name (like dmx-gateway.local).`;
  let name = host, port: string | undefined;
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(host);
  if (v6) { name = ''; port = v6[2]; }
  else { const m = /^([^:]+)(?::(\d+))?$/.exec(host); if (!m) return say; name = m[1]; port = m[2]; }
  if (port !== undefined && !(+port >= 1 && +port <= 65535)) return `${port} isn't a port (1 to 65535).`;
  if (v6) return undefined;
  if (/^\d+(\.\d+){3}$/.test(name)) return name.split('.').every((x) => +x <= 255) ? undefined : say;
  // a name: letters, digits and hyphens, in parts split by dots, none starting or ending with a hyphen
  return name.length <= 253 && name.split('.').every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l)) ? undefined : say;
}
