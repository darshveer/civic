/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Free, keyless, billing-free geocoding via Photon (OpenStreetMap / Komoot).
 *
 * Google Maps Platform's Places + Geocoding APIs require a billing account, so
 * this provides forward search (autocomplete) and reverse geocoding WITHOUT any
 * Google API or key. Photon is CORS-enabled and runs entirely client-side. The
 * Google map tiles are unaffected — only place search + address lookup moved.
 *
 * Photon endpoints:
 *   search  → https://photon.komoot.io/api/?q=<query>
 *   reverse → https://photon.komoot.io/reverse?lat=<lat>&lon=<lng>
 */

export interface GeoResult {
  lat: number;
  lng: number;
  address: string;
  ward: string;
  city: string;
  state: string;
}

const PHOTON = "https://photon.komoot.io";

/** Normalises a Photon feature's properties into our geo shape. */
function fromPhoton(p: any, lat: number, lng: number): GeoResult {
  const ward =
    p.suburb || p.neighbourhood || p.district || p.locality || p.city || "";
  const city = p.city || p.town || p.village || p.county || "";
  const state = p.state || "";
  const parts = [
    p.name,
    p.street,
    p.district || p.locality,
    p.city,
    p.state,
    p.country,
  ].filter(Boolean);
  const address =
    Array.from(new Set(parts)).join(", ") ||
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return { lat, lng, address, ward, city, state };
}

/**
 * Forward search / autocomplete. Returns up to 5 ranked matches. Empty for
 * very short queries. Throws on a network/HTTP error (callers handle gracefully).
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const res = await fetch(
    `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`,
    { signal },
  );
  if (!res.ok) throw new Error(`Geocoder ${res.status}`);
  const data = await res.json();
  return (data.features || [])
    .filter((f: any) => Array.isArray(f?.geometry?.coordinates))
    .map((f: any) => {
      const [lon, la] = f.geometry.coordinates;
      return fromPhoton(f.properties || {}, la, lon);
    });
}

/** Reverse geocode a coordinate into an address. Returns null if none found. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeoResult | null> {
  const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&lang=en`, {
    signal,
  });
  if (!res.ok) throw new Error(`Geocoder ${res.status}`);
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  return fromPhoton(f.properties || {}, lat, lng);
}
