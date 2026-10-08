// River library. Built-in rivers ship in data/rivers/*.json; rivers added or
// edited in the app live in the store (state.rivers) and win over built-ins.
import grandCanyon from '../data/rivers/grand-canyon.json';
import smith from '../data/rivers/smith.json';
import rogue from '../data/rivers/rogue.json';

export const DEFAULT_RIVER = 'grand-canyon';

export const BUILTIN_RIVERS = {
  'grand-canyon': { id: 'grand-canyon', days: 19, ...grandCanyon },
  smith: { id: 'smith', ...smith },
  rogue: { id: 'rogue', ...rogue },
};

// Fill every field the views read, so a bare-bones river (just a name, reach
// and access points) renders without special cases.
export function normalizeRiver(r) {
  const miles = Array.isArray(r.miles) && r.miles.length === 2 ? r.miles.map(Number) : [0, 1];
  const coords = Array.isArray(r.coords) && r.coords.length === 2 ? r.coords.map(Number) : [39.5, -105];
  return {
    name: 'Untitled river',
    reach: '',
    agency: '',
    note: '',
    tz: 'America/Denver',
    camps: [],
    rapids: [],
    hikes: [],
    geology: [],
    guide: [],
    rules: [],
    landmarks: [],
    clusters: [],
    access: [],
    roads: [],
    ...r,
    miles: miles[1] > miles[0] ? miles : [0, Math.max(1, miles[0] + 1)],
    coords,
    almanac: r.almanac || {},
    notes: { camp: '', hike: '', ...(r.notes || {}) },
    hdiff: r.hdiff || {},
  };
}
