// Auto-assign ranking (D154, D199: the nearest eligible partner is assigned directly). Pure functions, no I/O.
// A partner is a candidate only with a fresh, complete location (lat AND lng AND a recent timestamp) inside the radius
// around the vendor's pickup point; no location, no candidate (D154 "nearest within a radius"; no PostGIS, D164).

export interface Point {
  lat: number;
  lng: number;
}

export interface CandidatePartner {
  id: string;
  name: string;
  currentOrders: number;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
}

export interface RankedCandidate {
  partner: CandidatePartner;
  distanceM: number;
}

const EARTH_RADIUS_M = 6_371_000;
/** A location stamped further in the future than this is a clock fault, not a fresh fix. */
const FUTURE_TOLERANCE_MS = 60_000;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in whole metres. */
export function haversineM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Located = both coordinates and a timestamp no older than maxAgeMinutes (a timestamp alone is not a location). */
export function locationOf(p: CandidatePartner, now: Date, maxAgeMinutes: number): Point | null {
  if (p.lastLat === null || p.lastLng === null || p.lastLocationAt === null) return null;
  const age = now.getTime() - p.lastLocationAt.getTime();
  if (age > maxAgeMinutes * 60_000 || age < -FUTURE_TOLERANCE_MS) return null;
  return { lat: p.lastLat, lng: p.lastLng };
}

/** Candidates inside the radius, nearest first; ties go to the less loaded partner, then the id (stable). */
export function rankCandidates(
  pickup: Point | null,
  partners: readonly CandidatePartner[],
  rules: { radiusKm: number; locationMaxAgeMinutes: number },
  now: Date,
): RankedCandidate[] {
  if (!pickup) return [];
  const radiusM = rules.radiusKm * 1000;
  const ranked: RankedCandidate[] = [];
  for (const partner of partners) {
    const at = locationOf(partner, now, rules.locationMaxAgeMinutes);
    if (!at) continue;
    const distanceM = haversineM(pickup, at);
    if (distanceM <= radiusM) ranked.push({ partner, distanceM });
  }
  return ranked.sort(
    (a, b) =>
      a.distanceM - b.distanceM ||
      a.partner.currentOrders - b.partner.currentOrders ||
      (a.partner.id < b.partner.id ? -1 : a.partner.id > b.partner.id ? 1 : 0),
  );
}

/** D173: a COD order never goes to a partner holding cash at or above the zone's limit. */
export function codBlocked(
  paymentMethod: string,
  cashInHandPaise: number,
  limitPaise: number | null,
): boolean {
  return paymentMethod === 'COD' && limitPaise !== null && cashInHandPaise >= limitPaise;
}

/** "1.2 km" / "850 m" for the audit and history note. */
export function distanceLabel(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
