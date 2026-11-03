// Getting LuxDMX Link: which file this computer gets, from what its browser says.
import { describe, it, expect } from 'vitest';
import { computerFrom, downloadsFor, thisComputer, archName, type LinkManifest } from './link';

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  pi: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  pi32: 'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const m: LinkManifest = { version: '1.1.0', files: ([
  ['luxdmx-link-windows-amd64.exe', 'windows', 'amd64'], ['luxdmx-link-windows-arm64.exe', 'windows', 'arm64'],
  ['luxdmx-link-macos-arm64.zip', 'macos', 'arm64'], ['luxdmx-link-macos-amd64.zip', 'macos', 'amd64'],
  ['luxdmx-link-linux-amd64', 'linux', 'amd64'], ['luxdmx-link-linux-arm64', 'linux', 'arm64'],
] as const).map(([file, os, arch]) => ({ file, os, arch, size: 6e6, sha256: '', version: '1.1.0' })) };
const mine = (ua: string, platform = '', arch = '', touch = 0) => downloadsFor(m, computerFrom(ua, platform, arch, touch)).mine.map((f) => f.file);

describe('the right LuxDMX Link for this computer', () => {
  it('Chromium says the system and the chip', () => {
    expect(mine(UA.win, 'Windows', 'x86')).toEqual(['luxdmx-link-windows-amd64.exe']);
    expect(mine(UA.win, 'Windows', 'arm')).toEqual(['luxdmx-link-windows-arm64.exe']);   // (an ARM laptop's Chrome still says x64 in its user agent)
    expect(mine(UA.macSafari, 'macOS', 'arm')).toEqual(['luxdmx-link-macos-arm64.zip']);
    expect(mine(UA.macSafari, 'macOS', 'x86')).toEqual(['luxdmx-link-macos-amd64.zip']);
    expect(mine(UA.linux, 'Linux', 'x86')).toEqual(['luxdmx-link-linux-amd64']);
    expect(mine(UA.pi, 'Linux', 'arm')).toEqual(['luxdmx-link-linux-arm64']);
  });

  it('without it: a Mac gets both to pick from, Windows the usual one, Linux by its user agent', () => {
    expect(mine(UA.macSafari)).toEqual(['luxdmx-link-macos-arm64.zip', 'luxdmx-link-macos-amd64.zip']);
    expect(mine(UA.winFirefox)).toEqual(['luxdmx-link-windows-amd64.exe']);
    expect(mine(UA.linux)).toEqual(['luxdmx-link-linux-amd64']);
    expect(mine(UA.pi)).toEqual(['luxdmx-link-linux-arm64']);
    expect(mine(UA.pi32)).toEqual(['luxdmx-link-linux-amd64', 'luxdmx-link-linux-arm64']);
  });

  it('phones, tablets and Chromebooks get nothing of their own (Link runs on a computer)', () => {
    expect(mine(UA.android)).toEqual([]);
    expect(mine(UA.iphone)).toEqual([]);
    expect(mine(UA.chromebook)).toEqual([]);
    expect(mine(UA.macSafari, '', '', 5)).toEqual([]);    // an iPad asking for the desktop site
    expect(mine(UA.android, 'Android', 'arm')).toEqual([]);
    expect(downloadsFor(m, computerFrom(UA.android)).others).toHaveLength(6);
  });

  it('every file is either mine or under the others, once', () => {
    for (const ua of Object.values(UA)) {
      const d = downloadsFor(m, computerFrom(ua));
      expect([...d.mine, ...d.others].map((f) => f.file).sort()).toEqual(m.files.map((f) => f.file).sort());
    }
  });

  it('asks the browser for the chip where it can', async () => {
    const nav = { userAgent: UA.macSafari, maxTouchPoints: 0, userAgentData: { platform: 'macOS', getHighEntropyValues: async () => ({ architecture: 'arm', bitness: '64' }) } } as unknown as Navigator;
    expect(await thisComputer(nav)).toEqual({ os: 'macos', arch: 'arm64' });
    const refuses = { userAgent: UA.win, maxTouchPoints: 0, userAgentData: { platform: 'Windows', getHighEntropyValues: () => Promise.reject(new Error('no')) } } as unknown as Navigator;
    expect(await thisComputer(refuses)).toEqual({ os: 'windows' });
    expect(await thisComputer({ userAgent: UA.macSafari, maxTouchPoints: 0 } as Navigator)).toEqual({ os: 'macos' });
  });

  it('names the chips in plain words', () => {
    expect(m.files.map(archName)).toEqual(['Intel / AMD', 'ARM', 'Apple chip (M1 and newer)', 'Intel', 'PC, Intel / AMD', 'ARM 64-bit, Raspberry Pi 4 / 5']);
  });
});
