/**
 * Shared pieces for the Leaflet maps rendered through components/MapFrame
 * (a WebView on native, an iframe on web): PinMap, SafetyMap, staff/CoverageMap.
 */

/** Milwaukee, roughly downtown: where every map starts. */
export const MILWAUKEE = { latitude: 43.045, longitude: -87.95 };

export const LEAFLET_CSS = '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />';
export const LEAFLET_JS = '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>';
export const OSM_TILES = `L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'})`;

/** In-page helper that escapes text before it goes into popup HTML. */
export const ESCAPE_HTML_JS =
  'function escapeHtml(text){return String(text).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"}[c]));}';

/** JSON that is safe to inline inside a <script> tag. */
export function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/&/g, '\\u0026');
}
