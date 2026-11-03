// Sunrise and sunset for a place, worked out here (no internet at the venue): a shop window that
// comes on at dusk, the church's floodlights, a Halloween window. The sunrise equation (NOAA's
// simplified form), good to a minute or two away from the poles.

export interface Place { lat: number; lon: number; name?: string }

const RAD = Math.PI / 180;
const JD_UNIX = 2440587.5, J2000 = 2451545;

// When the sun rises and sets on the calendar day of `day` (its local date), as timestamps. None
// for a day it doesn't (midsummer or midwinter far north).
export function sunTimes(day: Date, p: Place): { rise?: number; set?: number } {
  const n = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12) / 864e5 + JD_UNIX - J2000;
  const js = n - p.lon / 360;                                      // mean solar noon there
  const m = (357.5291 + 0.98560028 * js) % 360;                    // the sun's mean anomaly
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const l = (m + c + 180 + 102.9372) % 360;                        // ecliptic longitude
  const transit = J2000 + js + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * l * RAD);
  const dec = Math.asin(Math.sin(l * RAD) * Math.sin(23.4397 * RAD));
  // -0.833°: the sun's disc and the air bending its light (the top edge on the horizon)
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(p.lat * RAD) * Math.sin(dec)) / (Math.cos(p.lat * RAD) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return {};
  const w = Math.acos(cosW) / RAD / 360;
  const ms = (j: number) => Math.round((j - JD_UNIX) * 864e5);
  return { rise: ms(transit - w), set: ms(transit + w) };
}

// Where the show probably is, from the time zone the browser is set to (its city), until someone
// says (the device's location, or by hand). Rough, but within a quarter of an hour or so for most.
const ZONES: Record<string, [number, number]> = {
  'Europe/Berlin': [52.52, 13.4], 'Europe/Vienna': [48.21, 16.37], 'Europe/Zurich': [47.38, 8.54], 'Europe/Paris': [48.86, 2.35],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26], 'Europe/Amsterdam': [52.37, 4.9], 'Europe/Brussels': [50.85, 4.35],
  'Europe/Luxembourg': [49.61, 6.13], 'Europe/Copenhagen': [55.68, 12.57], 'Europe/Oslo': [59.91, 10.75], 'Europe/Stockholm': [59.33, 18.07],
  'Europe/Helsinki': [60.17, 24.94], 'Europe/Warsaw': [52.23, 21.01], 'Europe/Prague': [50.08, 14.44], 'Europe/Budapest': [47.5, 19.04],
  'Europe/Madrid': [40.42, -3.7], 'Europe/Lisbon': [38.72, -9.14], 'Europe/Rome': [41.9, 12.5], 'Europe/Athens': [37.98, 23.73],
  'Europe/Istanbul': [41.01, 28.98], 'Europe/Kyiv': [50.45, 30.52], 'Europe/Kiev': [50.45, 30.52], 'Europe/Bucharest': [44.43, 26.1],
  'Europe/Sofia': [42.7, 23.32], 'Europe/Belgrade': [44.79, 20.45], 'Europe/Zagreb': [45.81, 15.98], 'Europe/Ljubljana': [46.06, 14.51],
  'Europe/Bratislava': [48.15, 17.11], 'Europe/Vilnius': [54.69, 25.28], 'Europe/Riga': [56.95, 24.11], 'Europe/Tallinn': [59.44, 24.75],
  'Europe/Moscow': [55.76, 37.62], 'Atlantic/Reykjavik': [64.15, -21.94],
  'America/New_York': [40.71, -74.01], 'America/Chicago': [41.88, -87.63], 'America/Denver': [39.74, -104.99], 'America/Phoenix': [33.45, -112.07],
  'America/Los_Angeles': [34.05, -118.24], 'America/Anchorage': [61.22, -149.9], 'America/Toronto': [43.65, -79.38], 'America/Vancouver': [49.28, -123.12],
  'America/Halifax': [44.65, -63.57], 'America/Mexico_City': [19.43, -99.13], 'America/Sao_Paulo': [-23.55, -46.63], 'America/Buenos_Aires': [-34.6, -58.38],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38], 'America/Santiago': [-33.45, -70.67], 'America/Bogota': [4.71, -74.07], 'America/Lima': [-12.05, -77.04],
  'Pacific/Honolulu': [21.31, -157.86], 'Pacific/Auckland': [-36.85, 174.76],
  'Australia/Sydney': [-33.87, 151.21], 'Australia/Melbourne': [-37.81, 144.96], 'Australia/Brisbane': [-27.47, 153.03], 'Australia/Adelaide': [-34.93, 138.6],
  'Australia/Perth': [-31.95, 115.86], 'Asia/Tokyo': [35.68, 139.69], 'Asia/Seoul': [37.57, 126.98], 'Asia/Shanghai': [31.23, 121.47],
  'Asia/Hong_Kong': [22.32, 114.17], 'Asia/Taipei': [25.03, 121.57], 'Asia/Singapore': [1.35, 103.82], 'Asia/Bangkok': [13.76, 100.5],
  'Asia/Jakarta': [-6.2, 106.85], 'Asia/Manila': [14.6, 120.98], 'Asia/Kolkata': [22.57, 88.36], 'Asia/Calcutta': [22.57, 88.36],
  'Asia/Dubai': [25.2, 55.27], 'Asia/Jerusalem': [31.77, 35.21], 'Asia/Tel_Aviv': [32.09, 34.78],
  'Africa/Johannesburg': [-26.2, 28.05], 'Africa/Cairo': [30.04, 31.24], 'Africa/Lagos': [6.52, 3.38], 'Africa/Nairobi': [-1.29, 36.82],
};
export function guessPlace(zone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = new Date()): Place & { guessed: true } {
  const z = ZONES[zone];
  const city = (zone ?? '').split('/').pop()?.replace(/_/g, ' ') || 'your time zone';
  if (z) return { lat: z[0], lon: z[1], name: city, guessed: true };
  // an unknown zone: its standard offset puts it on a meridian (15° an hour); mid-latitude north
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset(), jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  return { lat: 45, lon: -Math.max(jan, jul) / 4, name: city, guessed: true };
}
