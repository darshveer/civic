/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolves a coordinate to its OFFICIAL BBMP ward + zone by point-in-polygon
 * against the ward boundary GeoJSON (served from /public). This makes staff
 * scoping reliable: a report's `ward`/`zone` come from the actual boundary it
 * falls inside — not from fuzzy geocoder neighbourhood names — so they match the
 * official ward/zone names the admin assigns to officers.
 *
 * Pure ray-casting (no turf dependency). The GeoJSON is fetched once and cached.
 */

interface WardFeature {
  properties: { wardName: string; zone: string; wardNo?: string };
  geometry: { type: string; coordinates: any };
}

let cache: { features: WardFeature[] } | null = null;
let loading: Promise<{ features: WardFeature[] } | null> | null = null;

async function loadWards(): Promise<{ features: WardFeature[] } | null> {
  if (cache) return cache;
  if (!loading) {
    loading = fetch("/bbmp-wards.geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((gj) => {
        cache = gj;
        return gj;
      })
      .catch(() => null);
  }
  return loading;
}

/** Ray-casting: is (x=lng, y=lat) inside this linear ring? */
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** rings = [outer, hole1, hole2, ...] */
function pointInPolygon(x: number, y: number, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++)
    if (pointInRing(x, y, rings[k])) return false; // inside a hole
  return true;
}

function pointInGeom(x: number, y: number, geom: WardFeature["geometry"]): boolean {
  if (geom.type === "Polygon") return pointInPolygon(x, y, geom.coordinates);
  if (geom.type === "MultiPolygon")
    return geom.coordinates.some((p: number[][][]) => pointInPolygon(x, y, p));
  return false;
}

/** The official ward + zone containing (lat, lng), or null if outside BBMP. */
export async function wardZoneAtPoint(
  lat: number,
  lng: number,
): Promise<{ ward: string; zone: string } | null> {
  const gj = await loadWards();
  if (!gj) return null;
  for (const f of gj.features) {
    if (pointInGeom(lng, lat, f.geometry))
      return { ward: f.properties.wardName, zone: f.properties.zone };
  }
  return null;
}

/** Pushes every [lng, lat] vertex of a geometry into `acc`. */
function collectCoords(geom: WardFeature["geometry"], acc: number[][]): void {
  if (geom.type === "Polygon")
    for (const ring of geom.coordinates as number[][][])
      for (const p of ring) acc.push(p);
  else if (geom.type === "MultiPolygon")
    for (const poly of geom.coordinates as number[][][][])
      for (const ring of poly) for (const p of ring) acc.push(p);
}

/** Bounding-box centre of every feature matching `pred`, or null if none. */
async function centerOf(
  pred: (p: WardFeature["properties"]) => boolean,
): Promise<{ lat: number; lng: number } | null> {
  const gj = await loadWards();
  if (!gj) return null;
  const pts: number[][] = [];
  for (const f of gj.features) if (pred(f.properties)) collectCoords(f.geometry, pts);
  if (!pts.length) return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/** Centre point of a whole zone (for zonal supervisors), or null. */
export function zoneCenter(
  zone: string | undefined,
): Promise<{ lat: number; lng: number } | null> {
  if (!zone) return Promise.resolve(null);
  return centerOf((p) => p.zone === zone);
}

/** Centre point covering a ward officer's assigned ward(s), or null. */
export function wardsCenter(
  wards: string[],
): Promise<{ lat: number; lng: number } | null> {
  if (!wards.length) return Promise.resolve(null);
  const set = new Set(wards.map((w) => w.toLowerCase()));
  return centerOf((p) => set.has((p.wardName || "").toLowerCase()));
}

/** zone -> sorted ward names (for the admin's cascading dropdowns). */
export async function getZoneToWards(): Promise<Record<string, string[]>> {
  const gj = await loadWards();
  const out: Record<string, string[]> = {};
  if (gj)
    for (const f of gj.features) {
      const z = f.properties.zone;
      if (!z) continue;
      (out[z] = out[z] || []).push(f.properties.wardName);
    }
  for (const z of Object.keys(out)) out[z].sort((a, b) => a.localeCompare(b));
  return out;
}
