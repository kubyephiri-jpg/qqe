import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import polyline from '@mapbox/polyline';

import {
  abicyclebDataUri, abicycleblDataUri, abicyclerDataUri,
  amotorbikebDataUri, amotorbikeblDataUri, amotorbikerDataUri,
  abusbDataUri, abusblDataUri, abusgDataUri, abuswDataUri,
  acarbDataUri, acarblDataUri, acargDataUri, acarrDataUri, acarwDataUri,
  aclosedbDataUri, aclosedblDataUri, aclosedgDataUri, aclosedrDataUri, aclosedwDataUri,
  aopenbDataUri, aopenblDataUri, aopengDataUri, aopenrDataUri, aopenwDataUri,
  atruckbDataUri, atruckblDataUri, atruckgDataUri, atruckrDataUri, atruckwDataUri,
} from './vehicleIconsBase64';

// Johannesburg default center
const DEFAULT_LAT = -15.3875;
const DEFAULT_LNG = 28.3228;

const VEHICLE_IMAGE_MAP: Record<string, Record<string, string>> = {
  bicycle: { b: abicyclebDataUri, bl: abicycleblDataUri, r: abicyclerDataUri },
  motorbike: { b: amotorbikebDataUri, bl: amotorbikeblDataUri, r: amotorbikerDataUri },
  bus: { b: abusbDataUri, bl: abusblDataUri, g: abusgDataUri, w: abuswDataUri },
  xxl: { b: abusbDataUri, bl: abusblDataUri, g: abusgDataUri, w: abuswDataUri },
  economy: { b: acarbDataUri, bl: acarblDataUri, g: acargDataUri, r: acarrDataUri, w: acarwDataUri },
  car: { b: acarbDataUri, bl: acarblDataUri, g: acargDataUri, r: acarrDataUri, w: acarwDataUri },
  truck: { b: aclosedbDataUri, bl: aclosedblDataUri, g: aclosedgDataUri, r: aclosedrDataUri, w: aclosedwDataUri },
  closed_truck: { b: aclosedbDataUri, bl: aclosedblDataUri, g: aclosedgDataUri, r: aclosedrDataUri, w: aclosedwDataUri },
  open_truck: { b: aopenbDataUri, bl: aopenblDataUri, g: aopengDataUri, r: aopenrDataUri, w: aopenwDataUri },
  refrigerated_truck: { b: atruckbDataUri, bl: atruckblDataUri, g: atruckgDataUri, r: atruckrDataUri, w: atruckwDataUri },
};
const DEFAULT_VEHICLE = VEHICLE_IMAGE_MAP.economy.b;

export interface DemandZone {
  id: string; name: string; lat: number; lng: number; radiusM: number;
  percent: number; level: 'high' | 'medium' | 'low'; color: string;
}

// Circle as a polygon (works on every WebView, no extra plugin).
const circlePolygon = (lat: number, lng: number, radiusM: number, steps = 48): [number, number][] => {
  const out: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
};

// picture name (from utils/vehicleIcon) -> image, e.g. 'abicyclebl' = blue bicycle
const ICON_BY_NAME: Record<string, string> = {
  abicycleb: abicyclebDataUri, abicyclebl: abicycleblDataUri, abicycler: abicyclerDataUri,
  amotorbikeb: amotorbikebDataUri, amotorbikebl: amotorbikeblDataUri, amotorbiker: amotorbikerDataUri,
  abusb: abusbDataUri, abusbl: abusblDataUri, abusg: abusgDataUri, abusw: abuswDataUri,
  acarb: acarbDataUri, acarbl: acarblDataUri, acarg: acargDataUri, acarr: acarrDataUri, acarw: acarwDataUri,
  aclosedb: aclosedbDataUri, aclosedbl: aclosedblDataUri, aclosedg: aclosedgDataUri, aclosedr: aclosedrDataUri, aclosedw: aclosedwDataUri,
  aopenb: aopenbDataUri, aopenbl: aopenblDataUri, aopeng: aopengDataUri, aopenr: aopenrDataUri, aopenw: aopenwDataUri,
  atruckb: atruckbDataUri, atruckbl: atruckblDataUri, atruckg: atruckgDataUri, atruckr: atruckrDataUri, atruckw: atruckwDataUri,
  aletwende1: acargDataUri, // no separate Aletwende picture bundled in this app
};

export interface MapMarker {
  id: string;
  type: string; // pickup | dropoff | stop | store
  lat: number;
  lng: number;
}

interface DriverMapProps {
  polyline?: string;
  trimmedPolyline?: string;
  vehiclePosition?: { lat: number; lng: number; heading: number };
  vehicleType?: string;
  vehicleColor?: string;
  vehicleIcon?: string;
  zones?: DemandZone[];
  markers?: MapMarker[];
  arrivalTime?: string | null;
  arrivalPosition?: { lat: number; lng: number } | null;
  // When true a trip is active: the map shows the route (fitBounds) and disables
  // the 20s idle auto-recenter. When false it centers on the vehicle on load and
  // auto-recenters after 20s idle. The user can always zoom/pan freely.
  hasActiveTrip?: boolean;
  // false = keep centring on the driver but hide the vehicle (driver is offline)
  showVehicle?: boolean;
  onMapReady?: () => void;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

// Per-vehicle-type rotation offset (deg). Icons are authored north-up, so 0
// means heading 0 renders correctly. Mirror of DriverMapHtml.ts.
const VEHICLE_ROTATION_OFFSET: Record<string, number> = {
  bicycle: 0,
  motorbike: 0,
  economy: 0,
  car: 0,
  truck: 0,
  closed_truck: 0,
  open_truck: 0,
  refrigerated_truck: 0,
  bus: 0,
  xxl: 0,
};

const IDLE_RECENTER_MS = 20000;
const DEFAULT_FOLLOW_ZOOM = 16;

export default function DriverMap({
  polyline: encodedPolyline,
  vehiclePosition,
  vehicleType,
  vehicleColor,
  vehicleIcon,
  zones,
  markers,
  arrivalTime,
  arrivalPosition,
  hasActiveTrip,
  showVehicle,
  onMapReady,
}: DriverMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isReadyRef = useRef(false);

  // Keep the decoded route immutable; derive each trimmed view from it.
  const fullCoordsRef = useRef<[number, number][]>([]);
  const currentCoordsRef = useRef<[number, number][]>([]);

  // Vehicle marker state
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const vehicleImgRef = useRef<HTMLImageElement | null>(null);
  const vehicleAnimRef = useRef<number | null>(null);
  const currentRotationRef = useRef<number | null>(null);
  const smoothedHeadingRef = useRef<number | null>(null);
  const lastVehicleHeadingRef = useRef(0);
  const routeProgressRef = useRef(0);
  const lastVehicleTypeRef = useRef<string | undefined>(undefined);

  // Map of active markers keyed by id
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});

  // Arrival "Arrive by ..." card marker
  const arrivalCardRef = useRef<maplibregl.Marker | null>(null);

  // ---- Camera / interaction state ----
  const lastVehicleLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const didInitialCenterRef = useRef(false);
  const lastUserInteractionRef = useRef(0);
  const hasActiveTripRef = useRef(false);
  const zonesActiveRef = useRef(false);
  const zonesFittedRef = useRef(false);

  // Keep the trip-active flag in a ref the idle timer can read. Reset the idle
  // clock on entering a trip so we don't recenter the instant it ends.
  useEffect(() => {
    hasActiveTripRef.current = !!hasActiveTrip;
    if (hasActiveTrip) lastUserInteractionRef.current = Date.now();
  }, [hasActiveTrip]);

  const applyVehicleRotation = (heading?: number, type?: string) => {
    const img = vehicleImgRef.current;
    const map = mapRef.current;
    if (!img || !map || typeof heading !== 'number' || !Number.isFinite(heading)) return;
    const norm = (angle: number) => ((angle % 360) + 360) % 360;
    const offset = type && typeof VEHICLE_ROTATION_OFFSET[type] === 'number' ? VEHICLE_ROTATION_OFFSET[type] : 0;
    const target = norm(heading + offset - map.getBearing());
    if (smoothedHeadingRef.current === null) smoothedHeadingRef.current = target;
    const filterDelta = ((target - norm(smoothedHeadingRef.current) + 540) % 360) - 180;
    if (Math.abs(filterDelta) < 3) return;
    smoothedHeadingRef.current = norm(smoothedHeadingRef.current + 0.35 * filterDelta);
    if (currentRotationRef.current === null) currentRotationRef.current = smoothedHeadingRef.current;
    else currentRotationRef.current += ((norm(smoothedHeadingRef.current) - norm(currentRotationRef.current) + 540) % 360) - 180;
    img.style.transform = `rotate(${currentRotationRef.current}deg)`;
  };

  // Create / update / remove the arrival card pill marker
  const createArrivalCard = (time: string) => {
    const wrapper = document.createElement('div');
    wrapper.style.width = 'fit-content';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.style.pointerEvents = 'none';

    const pill = document.createElement('div');
    pill.style.background = '#5B2EFF';
    pill.style.color = '#fff';
    pill.style.fontFamily = '-apple-system, system-ui, sans-serif';
    pill.style.fontSize = '14px';
    pill.style.fontWeight = '700';
    pill.style.padding = '8px 14px';
    pill.style.borderRadius = '9999px';
    pill.style.whiteSpace = 'nowrap';
    pill.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';
    pill.textContent = `Arrive by ${time}`;

    const pointer = document.createElement('div');
    pointer.style.width = '0';
    pointer.style.height = '0';
    pointer.style.borderLeft = '6px solid transparent';
    pointer.style.borderRight = '6px solid transparent';
    pointer.style.borderTop = '7px solid #5B2EFF';
    pointer.style.marginTop = '-1px';

    wrapper.appendChild(pill);
    wrapper.appendChild(pointer);
    return wrapper;
  };

  // ---- Init map once ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [DEFAULT_LNG, DEFAULT_LAT],
      zoom: 14,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      isReadyRef.current = true;
      onMapReady?.();
    });

    // Treat gesture-driven moves as interactions (e.originalEvent is set only on
    // user gestures, not programmatic camera moves) so idle-recenter backs off.
    const markInteraction = (e: any) => {
      if (e && e.originalEvent) lastUserInteractionRef.current = Date.now();
    };
    map.on('movestart', markInteraction);
    map.on('zoomstart', markInteraction);
    map.on('rotatestart', markInteraction);
    map.on('rotate', () => applyVehicleRotation(lastVehicleHeadingRef.current, lastVehicleTypeRef.current));
    map.on('dragstart', markInteraction);

    // Idle auto-recenter: no active trip + 20s without interaction -> ease back.
    const idleTimer = setInterval(() => {
      if (hasActiveTripRef.current) return;
      if (zonesActiveRef.current) return; // demand map is open: do not pull the camera back
      if (!didInitialCenterRef.current || !lastVehicleLatLngRef.current) return;
      if (Date.now() - lastUserInteractionRef.current >= IDLE_RECENTER_MS) {
        lastUserInteractionRef.current = Date.now();
        map.easeTo({
          center: [lastVehicleLatLngRef.current.lng, lastVehicleLatLngRef.current.lat],
          zoom: DEFAULT_FOLLOW_ZOOM,
          duration: 800,
        });
      }
    }, 1000);

    return () => {
      if (vehicleAnimRef.current) cancelAnimationFrame(vehicleAnimRef.current);
      clearInterval(idleTimer);
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
      isReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Draw / clear polyline + fit bounds ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (encodedPolyline) {
        const decoded = polyline.decode(encodedPolyline); // [[lat, lng], ...]
        const coords = decoded.map((p) => [p[1], p[0]]) as [number, number][];
        fullCoordsRef.current = coords;
        currentCoordsRef.current = coords;
        routeProgressRef.current = 0;

        // If the same route is sent again while the vehicle is already on it, draw it already
        // trimmed from the vehicle forward. Otherwise the part behind the vehicle flashes back
        // until the next GPS update.
        let drawCoords = coords;
        const here = lastVehicleLatLngRef.current;
        if (here && coords.length > 1) {
          const cosLat = Math.cos((here.lat * Math.PI) / 180);
          const toXY = (c: [number, number]) => ({ x: c[0] * cosLat * 111320, y: c[1] * 111320 });
          const p = toXY([here.lng, here.lat]);
          let bestSeg = 0, bestT = 0, bestDist = Infinity;
          for (let i = 0; i < coords.length - 1; i++) {
            const a0 = toXY(coords[i]);
            const b0 = toXY(coords[i + 1]);
            const dx = b0.x - a0.x, dy = b0.y - a0.y;
            const len2 = dx * dx + dy * dy;
            let t = len2 === 0 ? 0 : ((p.x - a0.x) * dx + (p.y - a0.y) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(a0.x + t * dx - p.x, a0.y + t * dy - p.y);
            if (d < bestDist) { bestDist = d; bestSeg = i; bestT = t; }
          }
          if (bestDist <= 120) {
            const A = coords[bestSeg], B = coords[bestSeg + 1];
            drawCoords = [[A[0] + (B[0] - A[0]) * bestT, A[1] + (B[1] - A[1]) * bestT], ...coords.slice(bestSeg + 1)];
            routeProgressRef.current = bestSeg;
            currentCoordsRef.current = drawCoords;
          }
        }

        const data: GeoJSON.Feature = {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: drawCoords },
        };

        const src = map.getSource('route-source') as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
        } else {
          map.addSource('route-source', { type: 'geojson', data });
          map.addLayer({
            id: 'route-layer',
            type: 'line',
            source: 'route-source',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#5B2EFF', 'line-width': 5 },
          });
        }

        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((c) => bounds.extend(c as [number, number]));
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: { top: 100, bottom: 320, left: 60, right: 60 },
            maxZoom: 15,
          });
        }
      } else {
        if (map.getLayer('route-layer')) map.removeLayer('route-layer');
        if (map.getSource('route-source')) map.removeSource('route-source');
        currentCoordsRef.current = [];
      }
    };

    if (isReadyRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedPolyline]);

  // Hide the vehicle while offline (the map still centres on the driver).
  useEffect(() => {
    const marker = vehicleMarkerRef.current;
    if (marker) marker.getElement().style.display = showVehicle === false ? 'none' : '';
  }, [showVehicle, vehiclePosition]);

  // ---- Update vehicle position (animated) + trim route ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vehiclePosition) return;

    const run = () => {
      const { lat, lng } = vehiclePosition;
      // Face along the road ahead when there is a route; otherwise use the GPS heading.
      let heading = vehiclePosition.heading;
      {
        const ahead = currentCoordsRef.current;
        const cosLat = Math.cos((lat * Math.PI) / 180);
        for (let i = 0; i < ahead.length; i++) {
          const dx = (ahead[i][0] - lng) * cosLat * 111320;
          const dy = (ahead[i][1] - lat) * 111320;
          if (Math.hypot(dx, dy) > 8) {
            heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
            break;
          }
        }
      }
      lastVehicleHeadingRef.current = heading;
      lastVehicleTypeRef.current = vehicleType;
      const typeMap = VEHICLE_IMAGE_MAP[vehicleType || 'economy'] || VEHICLE_IMAGE_MAP.economy;
    const imgUrl = (vehicleIcon && ICON_BY_NAME[vehicleIcon]) || typeMap[vehicleColor || 'b'] || typeMap.b || DEFAULT_VEHICLE;

      // Track latest position for the camera logic.
      lastVehicleLatLngRef.current = { lat, lng };

      // Center once on the vehicle when its position first becomes known.
      const centerOnce = () => {
        if (didInitialCenterRef.current || !lastVehicleLatLngRef.current) return;
        didInitialCenterRef.current = true;
        lastUserInteractionRef.current = Date.now();
        map.easeTo({
          center: [lastVehicleLatLngRef.current.lng, lastVehicleLatLngRef.current.lat],
          zoom: DEFAULT_FOLLOW_ZOOM,
          duration: 700,
        });
      };

      // Create marker on first update
      if (!vehicleMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '44px';
        el.style.height = '44px';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.style.width = '44px';
        img.style.height = '44px';
        img.style.objectFit = 'contain';
        img.style.transition = 'transform 0.2s ease';
        el.appendChild(img);
        vehicleImgRef.current = img;
        vehicleMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);
        if (showVehicle === false) vehicleMarkerRef.current.getElement().style.display = 'none';
        applyVehicleRotation(heading, vehicleType);
        centerOnce();
      } else {
        // keep image in sync if vehicle type changed
        if (vehicleImgRef.current && vehicleImgRef.current.src !== imgUrl) {
          vehicleImgRef.current.src = imgUrl;
        }

        // Rotate to face the direction of travel.
        applyVehicleRotation(heading, vehicleType);
        centerOnce();

        // Animate from current to new position over 1000ms ease-out-cubic
        const start = vehicleMarkerRef.current.getLngLat();
        const startLng = start.lng;
        const startLat = start.lat;
        const duration = 1000;
        let startTime: number | null = null;

        if (vehicleAnimRef.current) cancelAnimationFrame(vehicleAnimRef.current);

        const step = (ts: number) => {
          if (startTime === null) startTime = ts;
          const elapsed = ts - startTime;
          const t = Math.min(elapsed / duration, 1);
          const e = easeOutCubic(t);
          const curLng = startLng + (lng - startLng) * e;
          const curLat = startLat + (lat - startLat) * e;
          vehicleMarkerRef.current?.setLngLat([curLng, curLat]);
          if (t < 1) {
            vehicleAnimRef.current = requestAnimationFrame(step);
          }
        };
        vehicleAnimRef.current = requestAnimationFrame(step);
      }

      // Eat the route as the vehicle moves: snap to the nearest point on the road SEGMENTS
      // (never the nearest vertex, which jumps back on long straight roads) and only ever move forward.
      const coords = fullCoordsRef.current;
      if (coords.length > 1) {
        const cosLat = Math.cos((lat * Math.PI) / 180);
        const toXY = (c: [number, number]) => ({ x: c[0] * cosLat * 111320, y: c[1] * 111320 });
        const p = toXY([lng, lat]);
        const from = Math.max(0, Math.min(routeProgressRef.current, coords.length - 2));
        let bestSeg = from;
        let bestT = 0;
        let bestDist = Infinity;
        const to = Math.min(coords.length - 1, from + 80); // look ahead only
        for (let i = from; i < to; i++) {
          const a0 = toXY(coords[i]);
          const b0 = toXY(coords[i + 1]);
          const dx = b0.x - a0.x;
          const dy = b0.y - a0.y;
          const len2 = dx * dx + dy * dy;
          let t = len2 === 0 ? 0 : ((p.x - a0.x) * dx + (p.y - a0.y) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(a0.x + t * dx - p.x, a0.y + t * dy - p.y);
          if (d < bestDist) { bestDist = d; bestSeg = i; bestT = t; }
        }
        // Only trim when the vehicle is really on the road (GPS drift tolerance 120 m).
        if (bestDist <= 120) {
          routeProgressRef.current = bestSeg;
          const A = coords[bestSeg];
          const B = coords[bestSeg + 1];
          const snapped: [number, number] = [A[0] + (B[0] - A[0]) * bestT, A[1] + (B[1] - A[1]) * bestT];
          const trimmed = [snapped, ...coords.slice(bestSeg + 1)];
          currentCoordsRef.current = trimmed;
          const src = map.getSource('route-source') as maplibregl.GeoJSONSource | undefined;
          if (src) {
            src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trimmed } });
          }
        }
      }

      // Camera is handled by the initial center + idle auto-recenter timer. We
      // no longer snap on every update, so the user can freely pan and zoom.
    };

    if (isReadyRef.current) {
      run();
    } else {
      map.once('load', run);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclePosition, vehicleType, vehicleColor, vehicleIcon]);

  // ---- Demand zones: shaded areas + "Name 7%" labels (red = busiest, yellow = medium, green = quiet) ----
  const zoneLabelsRef = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      zoneLabelsRef.current.forEach((m) => m.remove());
      zoneLabelsRef.current = [];
      const list = zones || [];
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: list.map((z) => ({
          type: 'Feature',
          properties: { color: z.color },
          geometry: { type: 'Polygon', coordinates: [circlePolygon(z.lat, z.lng, z.radiusM)] },
        })),
      };
      const src = map.getSource('zones-source') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else if (list.length) {
        map.addSource('zones-source', { type: 'geojson', data });
        const before = map.getLayer('route-layer') ? 'route-layer' : undefined;
        map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones-source', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 } }, before);
        map.addLayer({ id: 'zones-line', type: 'line', source: 'zones-source', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.7 } }, before);
      }
      list.forEach((z) => {
        const el = document.createElement('div');
        el.style.cssText = 'pointer-events:none;text-align:center;font-family:sans-serif;line-height:1.15;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;';
        el.innerHTML = `<div style="font-size:12px;font-weight:700;color:#222">${z.name.replace(/</g, '&lt;')}</div><div style="font-size:13px;font-weight:800;color:${z.color}">${z.percent}%</div>`;
        zoneLabelsRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([z.lng, z.lat]).addTo(map));
      });
    };
    if (isReadyRef.current) apply(); else map.once('load', apply);

    // First time busy areas appear: zoom OUT so the whole mapped area (and the driver) is visible.
    const list = zones || [];
    zonesActiveRef.current = list.length > 0;
    if (list.length === 0) {
      zonesFittedRef.current = false;
    } else if (!zonesFittedRef.current) {
      zonesFittedRef.current = true;
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      const grow = (lat: number, lng: number, rM = 0) => {
        const dLat = rM / 111320;
        const dLng = rM / (111320 * Math.cos((lat * Math.PI) / 180));
        minLat = Math.min(minLat, lat - dLat); maxLat = Math.max(maxLat, lat + dLat);
        minLng = Math.min(minLng, lng - dLng); maxLng = Math.max(maxLng, lng + dLng);
      };
      list.forEach((z) => grow(z.lat, z.lng, z.radiusM));
      if (lastVehicleLatLngRef.current) grow(lastVehicleLatLngRef.current.lat, lastVehicleLatLngRef.current.lng, 300);
      const doFit = () => {
        lastUserInteractionRef.current = Date.now();
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: { top: 120, bottom: 320, left: 60, right: 70 }, duration: 900, maxZoom: 14 });
      };
      if (isReadyRef.current) doFit(); else map.once('load', doFit);
    }
    return () => { /* labels are replaced on the next run */ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  // ---- Diff + render markers ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const next = markers || [];
      const nextIds = new Set(next.map((m) => m.id));

      // Remove stale markers
      Object.keys(markersRef.current).forEach((id) => {
        if (!nextIds.has(id)) {
          markersRef.current[id].remove();
          delete markersRef.current[id];
        }
      });

      // Add new markers
      next.forEach((m) => {
        if (markersRef.current[m.id]) return; // already present

        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';

        const inner = document.createElement('div');
        inner.style.border = '3px solid #fff';
        inner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';

        if (m.type === 'dropoff') {
          inner.style.width = '26px';
          inner.style.height = '26px';
          inner.style.background = '#5B2EFF';
          inner.style.borderRadius = '50% 50% 50% 0';
          inner.style.transform = 'rotate(-45deg)';
        } else if (m.type === 'store') {
          inner.style.width = '22px';
          inner.style.height = '22px';
          inner.style.background = '#F59E0B';
          inner.style.borderRadius = '50%';
        } else if (m.type === 'stop') {
          inner.style.width = '24px';
          inner.style.height = '24px';
          inner.style.background = '#5B2EFF';
          inner.style.borderRadius = '50%';
          inner.style.color = '#fff';
          inner.style.fontSize = '12px';
          inner.style.fontWeight = '700';
          inner.style.fontFamily = '-apple-system, system-ui, sans-serif';
          inner.style.display = 'flex';
          inner.style.alignItems = 'center';
          inner.style.justifyContent = 'center';
          inner.textContent = (m.id || '').toString().replace('stop-', '') || '';
        } else {
          // pickup (default)
          inner.style.width = '22px';
          inner.style.height = '22px';
          inner.style.background = '#5B2EFF';
          inner.style.borderRadius = '50%';
        }

        el.appendChild(inner);
        markersRef.current[m.id] = new maplibregl.Marker({ element: el })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
      });
    };

    if (isReadyRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  // ---- Arrival card: create / update / remove ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // Remove existing card first
      if (arrivalCardRef.current) {
        arrivalCardRef.current.remove();
        arrivalCardRef.current = null;
      }
      if (!arrivalTime || !arrivalPosition) return;

      const el = createArrivalCard(arrivalTime);
      arrivalCardRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([arrivalPosition.lng, arrivalPosition.lat])
        .addTo(map);
    };

    if (isReadyRef.current) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalTime, arrivalPosition?.lat, arrivalPosition?.lng]);

  const btn: React.CSSProperties = {
    width: 44, height: 44, borderRadius: 12, border: 'none', background: '#ffffff', color: '#18201b',
    fontSize: 26, fontWeight: 600, lineHeight: '44px', padding: 0, cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)', display: 'block',
  };
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* zoom in / out, right side like Uber and Yango */}
      <div style={{ position: 'absolute', right: 12, top: '38%', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 5 }}>
        <button type="button" aria-label="Zoom in" style={btn} onClick={() => { lastUserInteractionRef.current = Date.now(); mapRef.current?.zoomIn({ duration: 250 }); }}>+</button>
        <button type="button" aria-label="Zoom out" style={btn} onClick={() => { lastUserInteractionRef.current = Date.now(); mapRef.current?.zoomOut({ duration: 250 }); }}>−</button>
      </div>
    </div>
  );
}
