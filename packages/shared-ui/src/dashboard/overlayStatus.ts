// The TV app registers how to read the breaking-news overlay status, so the dashboard can
// show a problem with it. Platforms without the overlay leave it unregistered.
export type OverlayStatus = { ok: true } | { ok: false; message: string };

let source: (() => OverlayStatus) | null = null;

export function registerOverlayStatus(read: () => OverlayStatus) {
  source = read;
}

export function readOverlayStatus(): OverlayStatus | null {
  return source ? source() : null;
}
