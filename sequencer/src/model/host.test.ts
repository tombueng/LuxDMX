import { describe, expect, it } from 'vitest';
import { cleanHost, hostProblem } from './host';

describe('a box\'s address', () => {
  it('takes IPs, names on the network, ports and IPv6', () => {
    for (const h of ['192.168.1.50', '10.0.0.1:8080', 'dmx-gateway.local', 'dmx-gateway', 'http://192.168.4.1/', 'luxdmx-3f2a.fritz.box', '[fe80::1]', '[fe80::1]:80', 'localhost:8295'])
      expect(hostProblem(h), h).toBeUndefined();
  });
  it('says so for what isn\'t one', () => {
    expect(hostProblem('not a host!!')).toMatch(/isn't an address/);
    expect(hostProblem('192.168.1.300')).toMatch(/isn't an address/);
    expect(hostProblem('-box.local')).toMatch(/isn't an address/);
    expect(hostProblem('box:99999')).toMatch(/isn't a port/);
    expect(hostProblem('   ')).toMatch(/first/);
  });
});

describe('what\'s typed, cleaned', () => {
  it('without http:// in any case (a tablet writes "Http://") and without a path', () => {
    for (const h of ['Http://192.168.1.50', 'HTTPS://192.168.1.50/bridge', '  http://192.168.1.50/  ', '192.168.1.50']) expect(cleanHost(h), h).toBe('192.168.1.50');
  });
});
