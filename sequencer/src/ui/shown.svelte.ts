// App.svelte keeps a view built (hidden) while another one is shown. Each view says whether it's
// the one shown through the 'view-shown' context (ProgramView, LiveView, TimelineView). Hidden, its
// parts needn't follow the show frame by frame: `whileShown(read)` gives what `read` gives while
// the view is shown, and holds the last value while it's hidden (it reads again the moment the view
// is shown). Outside a view (a dialog, the phone remote) it's always live.
import { getContext, untrack } from 'svelte';

export function viewShown(): () => boolean {
  return getContext<(() => boolean) | undefined>('view-shown') ?? (() => true);
}

export function whileShown<T>(read: () => T): () => T {
  const shown = viewShown();
  const value = $derived(shown() ? read() : untrack(read));
  return () => value;
}
