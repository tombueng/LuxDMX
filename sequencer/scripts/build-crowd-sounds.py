# The crowd's sounds for the sequencer, from real recordings (credits in SONGS.md, "The crowd"):
# people chatting in a hall before the show (Wikimedia Commons) and a crowd cheering (Pixabay). No
# applause, no clapping: they sounded ugly. Writes small MP3s into public/sounds/crowd/:
#   chatter.mp3   the hall chatting, a loop at the level audio/crowd.ts expects
#   cheering.mp3  a crowd cheering, a loop: newly put together from slices of the cheer's loud part,
#                 each at its own pitch, left and right different (a bigger crowd, in stereo)
#   cheer-1.mp3, cheer-2.mp3  the cheer whole (up, held, dying away), each made stereo its own way
#                 (the second a little deeper and longer)
# The loops are made seamless in the browser (a crossfade), so an MP3's padding never clicks.
#   python3 -I build-crowd-sounds.py <sequencer dir>     (in a folder with the recordings in raw/)
import os, subprocess, sys
import numpy as np

RATE = 44100
CHATTER = ('Algemeen rumoer en geroezemoes - SoundCloud - Beeld en Geluid.ogg', 30, 92, 0.10)
CHEER = 'storegraphic-crowd-cheering-312831.mp3'     # the cheer (mono)
HOLD = (1.0, 8.3)                                    # its loud part (seconds), the loop is made from it
out_dir = os.path.join(sys.argv[1], 'public/sounds/crowd')
os.makedirs(out_dir, exist_ok=True)
os.makedirs('work', exist_ok=True)
rnd = np.random.default_rng(11)

def load(name, a=0.0, b=None, rate=1.0, ch=2):
    af = [] if rate == 1 else ['-af', f'asetrate={RATE * rate:.0f},aresample={RATE}']
    args = ['ffmpeg', '-v', 'error', '-ss', str(a)] + (['-t', str(b - a)] if b else []) + ['-i', 'raw/' + name, '-ac', str(ch), '-ar', str(RATE)] + af + ['-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, np.float32).reshape(-1, ch).copy()

def rms(x): return float(np.sqrt((x ** 2).mean()))

def fade(x, i=0.05, o=0.05):
    k = np.ones(len(x))
    a, b = int(i * RATE), int(o * RATE)
    if a: k[:a] = np.linspace(0, 1, a)
    if b: k[-b:] = np.minimum(k[-b:], np.linspace(1, 0, b))
    return x * k[:, None]

def write(name, x, kbps=112):
    peak = np.abs(x).max()
    if peak > 0.98: x = x * (0.98 / peak)
    raw = f'work/{name}.f32'
    x.astype(np.float32).tofile(raw)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-i', raw, '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', f'{out_dir}/{name}.mp3'], check=True)
    print(f'{name}.mp3  {len(x) / RATE:5.1f} s  rms {rms(x):.3f}  {os.path.getsize(f"{out_dir}/{name}.mp3") // 1024} KB')

# a mono sound made stereo: each side the sound plus its own short smear of echoes (decaying noise,
# 25 ms), so the two sides differ like two ears in a hall and nothing combs
def stereo(m, seed):
    r = np.random.default_rng(seed)
    n = int(0.025 * RATE)
    sides = []
    for _ in range(2):
        h = r.standard_normal(n) * np.exp(-np.arange(n) / (0.006 * RATE))
        h /= np.sqrt((h ** 2).sum())
        sides.append(0.72 * m + 0.7 * np.convolve(m, h)[:len(m)])
    return np.stack(sides, 1)

# the chatter: as it was
src, a, b, level = CHATTER
x = load(src, a, b)
write('chatter', fade(x * (level / rms(x)), 0.02, 0.02))

# the cheer whole, twice: at its pitch, and a little deeper and longer; the loudest second of each
# at 0.16 RMS (crowd.ts plays it over the cheering)
for k, (rate, seed) in enumerate([(1.0, 3), (0.95, 8)]):
    m = load(CHEER, rate=rate, ch=1)[:, 0]
    x = stereo(m, seed)
    if k: x = x[:, ::-1]
    loudest = max(rms(x[i:i + RATE]) for i in range(0, len(x) - RATE, RATE // 4))
    write(f'cheer-{k + 1}', fade(x * (0.16 / loudest), 0.01, 0.8))

# the cheering loop: 20 s of slices (2.5 to 4 s) from the cheer's loud part, each at its own pitch
# (0.94 to 1.06), crossfaded into each other (0.8 s); left and right their own slices
rates = [0.94, 0.97, 1.0, 1.03, 1.06]
held = {r: load(CHEER, HOLD[0], HOLD[1] + 1, rate=r, ch=1)[:, 0] for r in rates}
LEN, X = 20 * RATE, int(0.8 * RATE)
def lane():
    out, at = np.zeros(LEN + 6 * RATE), 0
    while at < LEN + RATE:
        r = rates[rnd.integers(len(rates))]
        src = held[r][:int((HOLD[1] - HOLD[0]) / r * RATE)]
        n = int(rnd.uniform(2.5, 4.0) * RATE)
        s0 = int(rnd.integers(0, max(1, len(src) - n)))
        g = src[s0:s0 + n].copy()
        u = np.linspace(0, 1, X)
        g[:X] *= np.sin(u * np.pi / 2); g[-X:] *= np.cos(u * np.pi / 2)
        out[at:at + len(g)] += g
        at += len(g) - X
    return out[RATE // 2: RATE // 2 + LEN]
x = np.stack([lane(), lane()], 1)
write('cheering', fade(x * (0.12 / rms(x)), 0.02, 0.02))
