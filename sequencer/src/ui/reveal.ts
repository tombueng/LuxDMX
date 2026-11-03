// Bring an element into view inside its own scrolling box only (scrollIntoView scrolls every box
// around it too, dragging a whole page along when a list shows its live row).
export function revealIn(box: HTMLElement | undefined | null, el: HTMLElement | undefined | null, smooth = true) {
  if (!box || !el) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  const behavior = smooth ? 'smooth' : 'auto';
  if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 8, behavior });
  else if (r.bottom > b.bottom) box.scrollBy({ top: r.bottom - b.bottom + 8, behavior });
  if (r.left < b.left) box.scrollBy({ left: r.left - b.left - 8, behavior });
  else if (r.right > b.right) box.scrollBy({ left: r.right - b.right + 8, behavior });
}
