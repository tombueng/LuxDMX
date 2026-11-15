import type { Plugin } from 'vite';

// While a page renders a video or records a take, the dev server holds its hot updates: a code
// change swapped the 3D stage out under the render (or reloaded the page) and the render was
// gone. The page says when it's busy ('luxdmx:busy' over the hot-update socket, ui.svelte.ts);
// what changed meanwhile comes as one reload when it isn't any more, or its tab is closed.
export function holdWhileBusy(): Plugin {
  const busy = new Map<string, unknown>();
  let held = false;
  const release = (send: (p: { type: 'full-reload' }) => void) => { if (!busy.size && held) { held = false; send({ type: 'full-reload' }); } };
  return {
    name: 'luxdmx-hold-while-busy', apply: 'serve',
    configureServer(server) {
      server.ws.on('luxdmx:busy', (data: { id: string; on: boolean }, client: { socket?: { once?: (e: string, f: () => void) => void } }) => {
        if (data?.on) {
          if (!busy.has(data.id)) client?.socket?.once?.('close', () => { busy.delete(data.id); release((p) => server.ws.send(p)); });
          busy.set(data.id, client);
        } else { busy.delete(data?.id); release((p) => server.ws.send(p)); }
      });
    },
    handleHotUpdate() { if (busy.size) { held = true; return []; } },
  };
}

// base './' so the build works from any sub-path (GitHub Pages serves it under /LuxDMX/...).
