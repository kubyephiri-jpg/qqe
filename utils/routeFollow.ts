/**
 * Route following helpers shared by the driver and client maps (identical file in both apps).
 *
 * The vehicle is NOT drawn at the raw GPS point. It is snapped onto the route and moved along the
 * route's own shape (so it follows corners instead of cutting straight across), faces the direction of
 * the road ahead (so it never looks bent or sideways), and the line is trimmed to exactly where the
 * vehicle is drawn (so no line ever shows behind it).
 */
export type LngLat = [number, number];

export interface RouteModel {
  pts: LngLat[];
  x: number[];
  y: number[];
  cum: number[]; // distance in metres from the start to each vertex
  total: number;
  cosLat: number;
}

const M_PER_DEG = 111320;
const toRad = Math.PI / 180;

export function buildRoute(pts: LngLat[]): RouteModel {
  const cosLat = Math.cos((pts[0]?.[1] ?? 0) * toRad);
  const x: number[] = [];
  const y: number[] = [];
  const cum: number[] = [];
  let total = 0;
  pts.forEach((p, i) => {
    x.push(p[0] * cosLat * M_PER_DEG);
    y.push(p[1] * M_PER_DEG);
    if (i > 0) total += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    cum.push(total);
  });
  return { pts, x, y, cum, total, cosLat };
}

export interface Projection {
  s: number; // metres along the route
  off: number; // metres from the route
  seg: number;
}

/** Nearest point on the route. Searches forward from `fromS` first; falls back to the whole route. */
export function projectOnRoute(r: RouteModel, lng: number, lat: number, fromS = 0, aheadM = 500): Projection {
  const px = lng * r.cosLat * M_PER_DEG;
  const py = lat * M_PER_DEG;
  const n = r.pts.length;
  const run = (from: number, to: number): Projection => {
    let best: Projection = { s: 0, off: Infinity, seg: 0 };
    for (let i = from; i < to && i < n - 1; i++) {
      const dx = r.x[i + 1] - r.x[i];
      const dy = r.y[i + 1] - r.y[i];
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((px - r.x[i]) * dx + (py - r.y[i]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const off = Math.hypot(r.x[i] + t * dx - px, r.y[i] + t * dy - py);
      if (off < best.off) best = { s: r.cum[i] + t * Math.sqrt(len2), off, seg: i };
    }
    return best;
  };
  if (n < 2) return { s: 0, off: Infinity, seg: 0 };
  // window: a little behind and `aheadM` in front of where we already are
  let a = 0;
  while (a < n - 2 && r.cum[a + 1] < fromS - 30) a++;
  let b = a;
  while (b < n - 1 && r.cum[b] < fromS + aheadM) b++;
  const local = run(a, b + 1);
  if (local.off <= 60 || (a === 0 && b >= n - 1)) return local;
  const all = run(0, n - 1);
  return all.off < local.off ? all : local;
}

function segmentAt(r: RouteModel, s: number): number {
  const n = r.pts.length;
  if (s <= 0) return 0;
  if (s >= r.total) return Math.max(0, n - 2);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid] <= s) lo = mid; else hi = mid;
  }
  return lo;
}

export function pointAt(r: RouteModel, s: number): LngLat {
  const n = r.pts.length;
  if (n === 0) return [0, 0];
  if (n === 1 || s <= 0) return r.pts[0];
  if (s >= r.total) return r.pts[n - 1];
  const i = segmentAt(r, s);
  const len = r.cum[i + 1] - r.cum[i];
  const t = len === 0 ? 0 : (s - r.cum[i]) / len;
  const a = r.pts[i];
  const b = r.pts[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Compass bearing of the road at `s`, looking `lookM` metres ahead (anticipates corners smoothly). */
export function bearingAt(r: RouteModel, s: number, lookM = 18): number {
  const total = r.total;
  let from = Math.min(Math.max(0, s), total);
  let to = Math.min(total, from + lookM);
  if (to - from < 4) { // at the very end: use the last stretch of road
    to = total;
    from = Math.max(0, total - Math.max(lookM, 6));
  }
  const a = pointAt(r, from);
  const b = pointAt(r, to);
  const dx = (b[0] - a[0]) * r.cosLat * M_PER_DEG;
  const dy = (b[1] - a[1]) * M_PER_DEG;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return NaN;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** The part of the route from `s` to the end (first vertex is the exact point at `s`). */
export function sliceFrom(r: RouteModel, s: number): LngLat[] {
  const n = r.pts.length;
  if (n < 2) return r.pts;
  if (s <= 0) return r.pts;
  if (s >= r.total) return [r.pts[n - 1], r.pts[n - 1]];
  const i = segmentAt(r, s);
  return [pointAt(r, s), ...r.pts.slice(i + 1)];
}

export function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dx = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * toRad) * M_PER_DEG;
  const dy = (lat2 - lat1) * M_PER_DEG;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dx = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * toRad) * M_PER_DEG;
  const dy = (lat2 - lat1) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** Turn `cur` toward `want` (degrees) by at most `maxStep`, the short way round. Returns the new angle (unbounded). */
export function turnToward(cur: number, want: number, maxStep: number): number {
  const d = ((((want - cur) % 360) + 540) % 360) - 180;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
