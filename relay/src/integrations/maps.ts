import type { ServerResponse } from 'node:http';
import type { RouteInfo } from '../../../shared/protocol.ts';
import { config } from '../config.ts';

/**
 * Google Routes API for directions + Maps Static API for the map picture.
 * The key never leaves the relay: the lens loads /api/maps/static?... and
 * the relay fetches the image. Both APIs have a monthly free allowance.
 */
let lastPolyline = '';

export async function route(destination: string, from?: { lat: number; lng: number }): Promise<RouteInfo> {
  if (!config.mapsKey) throw new Error('GOOGLE_MAPS_KEY is not set');
  if (!from) throw new Error('No location from the glasses yet');
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': config.mapsKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { address: destination },
      travelMode: 'WALK',
    }),
  });
  if (!res.ok) throw new Error(`routes ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  const r = data.routes?.[0];
  if (!r) throw new Error('No route found');
  lastPolyline = r.polyline?.encodedPolyline ?? '';
  const steps = (r.legs?.[0]?.steps ?? [])
    .filter((s: any) => s.navigationInstruction?.instructions)
    .slice(0, 12)
    .map((s: any) => ({ text: s.navigationInstruction.instructions as string, distanceM: s.distanceMeters ?? 0 }));
  return {
    destination,
    durationMin: Math.round(parseInt(String(r.duration ?? '0'), 10) / 60),
    distanceKm: Math.round((r.distanceMeters ?? 0) / 100) / 10,
    steps,
    mapUrl: lastPolyline ? `/api/maps/static?v=${Date.now()}` : null,
  };
}

/** Dark-styled static map of the last route, sized for the lens. */
export async function staticMap(res: ServerResponse) {
  if (!config.mapsKey || !lastPolyline) {
    res.writeHead(404).end();
    return;
  }
  const u = new URL('https://maps.googleapis.com/maps/api/staticmap');
  const p = u.searchParams;
  p.set('size', '560x300');
  p.set('scale', '1');
  p.set('key', config.mapsKey);
  p.append('path', `color:0xFF6188ff|weight:5|enc:${lastPolyline}`);
  for (const s of [
    'element:geometry|color:0x272822',
    'element:labels.text.fill|color:0xa39e87',
    'element:labels.text.stroke|color:0x1e1f1c',
    'feature:road|element:geometry|color:0x3e3d32',
    'feature:water|element:geometry|color:0x1e1f1c',
    'feature:poi|visibility:off',
    'feature:transit|visibility:off',
  ])
    p.append('style', s);
  const img = await fetch(u);
  res.writeHead(img.status, { 'content-type': img.headers.get('content-type') ?? 'image/png', 'cache-control': 'no-store' });
  res.end(Buffer.from(await img.arrayBuffer()));
}
