// Writes test/fixtures/audio/kick-120.wav: a kick drum at 120 BPM over quiet noise, for the
// "follow the music" e2e test (Chrome plays it as a fake microphone).
import fs from 'node:fs';
const rate = 16000, seconds = 12, bpm = 120;
const n = rate * seconds, data = new Int16Array(n);
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
for (let i = 0; i < n; i++) {
  const t = i / rate, since = t % (60 / bpm);
  const kick = since < 0.25 ? Math.sin(2 * Math.PI * (60 - 40 * since) * since) * Math.exp(-since / 0.07) : 0;
  const hat = (t + 0.25) % (60 / bpm) < 0.02 ? rnd() * 0.15 : 0;      // offbeat hi-hat (no bass: shouldn't count)
  data[i] = Math.max(-32767, Math.min(32767, Math.round((kick * 0.85 + hat + rnd() * 0.01) * 32767)));
}
const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + n * 2, 4); head.write('WAVE', 8); head.write('fmt ', 12);
head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(n * 2, 40);
fs.mkdirSync('test/fixtures/audio', { recursive: true });
fs.writeFileSync('test/fixtures/audio/kick-120.wav', Buffer.concat([head, Buffer.from(data.buffer)]));
console.log('wrote test/fixtures/audio/kick-120.wav', n * 2 + 44, 'bytes');
