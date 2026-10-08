import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BUILTIN_RIVERS, DEFAULT_RIVER, normalizeRiver } from './rivers.js';
import GENERAL from '../data/general.json';
import GEAR from '../data/gear.json';
import SEED from '../data/trip.json';
import GC_REF from '../data/trips/gc2026-ref.json';

// read-only reference material per trip (imported from the planning sheet)
const REFS = { [GC_REF.id]: GC_REF };

/* ---------- active river ---------- */
// The views read these module-level bindings. selectRiver() points them at one
// river; App calls it during render (and re-keys <main>) so a switch remounts
// everything that cached the old river's data.
let RIVER, ACCESS, YARD, MAXMILE;
let SRC = null;
function selectRiver(rec) {
  if (rec === SRC) return;
  SRC = rec;
  RIVER = normalizeRiver(rec);
  ACCESS = (RIVER.access || []).map((p, i) => ({ ...p, id: 'r' + i, fixed: true }));
  YARD = { id: 'yard', name: 'Outfitter', yard: true, grid: RIVER.yardGrid };
  MAXMILE = RIVER.miles[1];
}
selectRiver(BUILTIN_RIVERS[DEFAULT_RIVER]);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const KINDS = ['crew', 'boats', 'cars', 'places', 'gear', 'meals', 'log', 'pay', 'plans'];
const SLOTS = ['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Happy hour'];
const EVAC = { 1: '#6b6154', 2: '#a8722a', 3: '#c0562f', 4: '#9c3326' };

/* dates */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00Z'));
const today = () => new Date().toISOString().slice(0, 10);

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmt(iso) {
  if (!okDate(iso)) return iso;
  const d = new Date(iso + 'T12:00:00Z');
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function tripDays(trip) {
  return Array.from({ length: trip.days + 1 }, (_, i) => ({
    i,
    date: okDate(trip.start) ? addDays(trip.start, i) : '',
    label: okDate(trip.start) ? `Day ${i + 1} · ${fmt(addDays(trip.start, i))}` : `Day ${i + 1}`,
  }));
}

/* sun — NOAA, flat horizon */
function sun(iso, lat, lon) {
  const r = Math.PI / 180;
  const mid = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const t = (mid / 86400000 + 2440587.5 + 0.5 - 2451545) / 36525;
  const L = (280.46646 + t * 36000.76983) % 360;
  const M = 357.52911 + t * 35999.05029;
  const e = 0.016708634 - t * 0.000042037;
  const ctr =
    Math.sin(M * r) * (1.914602 - t * 0.004817) + Math.sin(2 * M * r) * 0.019993 + Math.sin(3 * M * r) * 0.000289;
  const lam = L + ctr - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * r);
  const obl = 23.439291 - t * 0.0130042;
  const dec = Math.asin(Math.sin(obl * r) * Math.sin(lam * r)) / r;
  const y = Math.tan((obl / 2) * r) ** 2;
  const eq =
    (4 *
      (y * Math.sin(2 * L * r) -
        2 * e * Math.sin(M * r) +
        4 * e * y * Math.sin(M * r) * Math.cos(2 * L * r) -
        0.5 * y * y * Math.sin(4 * L * r) -
        1.25 * e * e * Math.sin(2 * M * r))) /
    r;
  const noon = 720 - 4 * lon - eq;
  const cosH = (Math.cos(90.833 * r) - Math.sin(lat * r) * Math.sin(dec * r)) / (Math.cos(lat * r) * Math.cos(dec * r));
  if (cosH < -1 || cosH > 1) return null;
  const h = (Math.acos(cosH) / r) * 4;
  const at = (m) => new Date(mid + m * 60000);
  return { rise: at(noon - h), set: at(noon + h) };
}
const clock = (d) => (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: RIVER.tz }) : '—');

const clean = (h) =>
  String(h)
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&deg;/g, '°')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/* ---------- store ---------- */
// Local state is authoritative while you type. `db`, when the viewer can
// run it, mirrors every record so the crew sees each other's edits live.

const LOCAL = 'riverguide.v1';

function mergeSeed(have) {
  if ((have.at || 0) <= 2) return SEED;
  const next = { ...have };
  ['gear', 'meals', 'pay'].forEach((k) => {
    if (!(have[k] || []).length) next[k] = SEED[k];
  });
  next.plans = { ...have.plans };
  Object.entries(SEED.plans).forEach(([d, p]) => (next.plans[d] = { ...p, ...(have.plans || {})[d] }));
  if (!(have.boats || []).some((b) => b.id === 'b4')) next.boats = [...(have.boats || []), ...SEED.boats.filter((b) => b.id === 'b4')];
  return { ...next, at: now() };
}

function useStore() {
  const [state, setState] = useState(() => {
    let st = { trips: [], active: null, rivers: {} };
    try {
      st = JSON.parse(localStorage.getItem(LOCAL)) || st;
    } catch {}
    try {
      // .seed3: the seeded trip now carries the planning-sheet data. A copy nobody has edited
      // (at <= 2) is replaced outright; an edited copy keeps its own data and only gets the
      // sheet's gear, menu, payments and day notes where it has none.
      if (!localStorage.getItem(LOCAL + '.seed3')) {
        localStorage.setItem(LOCAL + '.seed3', SEED.id);
        localStorage.setItem(LOCAL + '.seed2', SEED.id);
        const have = st.trips.find((x) => x.id === SEED.id);
        st = {
          ...st,
          trips: [have ? mergeSeed(have) : SEED, ...st.trips.filter((x) => x.id !== SEED.id)],
          active: have ? st.active || SEED.id : SEED.id,
        };
        localStorage.setItem(LOCAL, JSON.stringify(st));
      }
    } catch {}
    st.rivers = st.rivers || {};
    return st;
  });
  const [db, setDb] = useState(null);
  const [shared, setShared] = useState(false);
  const seen = useRef(new Set());

  const persist = useCallback((next) => {
    setState(next);
    try {
      localStorage.setItem(LOCAL, JSON.stringify(next));
    } catch {}
  }, []);

  useEffect(() => {
    let off = [];
    window.claude?.use?.('db').then((d) => {
      if (!d) return;
      setDb(d);
      setShared(true);
      off.push(
        d.collection('trips').onSnapshot((snap) => {
          setState((s) => {
            const byId = new Map(s.trips.map((t) => [t.id, t]));
            snap.docs.forEach((doc) => {
              const remote = doc.data();
              const local = byId.get(remote.id);
              if (!local || (remote.at || 0) > (local.at || 0)) byId.set(remote.id, { ...local, ...remote });
            });
            const next = { ...s, trips: [...byId.values()] };
            next.active = next.active || next.trips[0]?.id || null;
            try {
              localStorage.setItem(LOCAL, JSON.stringify(next));
            } catch {}
            return next;
          });
        }, () => {}),
        d.collection('rivers').onSnapshot((snap) => {
          setState((s) => {
            const rivers = { ...s.rivers };
            snap.docs.forEach((doc) => {
              const remote = doc.data();
              if (!rivers[remote.id] || (remote.at || 0) > (rivers[remote.id].at || 0)) rivers[remote.id] = remote;
            });
            const next = { ...s, rivers };
            try {
              localStorage.setItem(LOCAL, JSON.stringify(next));
            } catch {}
            return next;
          });
        }, () => {})
      );
    });
    return () => off.forEach((f) => f && f());
  }, []);

  const trips = state.trips;
  const trip = trips.find((t) => t.id === state.active) || null;

  const write = (t) => {
    if (db) db.doc('trips/' + t.id).set(t).catch(() => {});
  };

  const edit = (fn) => {
    if (!trip) return;
    const next = { ...fn({ ...trip }), at: now() };
    persist({ ...state, trips: trips.map((t) => (t.id === next.id ? next : t)) });
    write(next);
  };

  return {
    trips,
    trip,
    shared,
    rivers: state.rivers,
    // all rivers (built-in + added/edited), built-ins first
    riverList: () => {
      const ids = [...Object.keys(BUILTIN_RIVERS), ...Object.keys(state.rivers).filter((k) => !BUILTIN_RIVERS[k])];
      return ids.map((id) => ({ id, ...(state.rivers[id] || BUILTIN_RIVERS[id]), custom: !BUILTIN_RIVERS[id], edited: !!(BUILTIN_RIVERS[id] && state.rivers[id]) }));
    },
    riverRec: (id) => state.rivers[id] || BUILTIN_RIVERS[id] || { id, name: 'Unknown river' },
    saveRiver: (r) => {
      const rec = { ...r, id: r.id || uid(), at: now() };
      persist({ ...state, rivers: { ...state.rivers, [rec.id]: rec } });
      if (db) db.doc('rivers/' + rec.id).set(rec).catch(() => {});
      return rec.id;
    },
    dropRiver: (id) => {
      const { [id]: _gone, ...rest } = state.rivers;
      persist({ ...state, rivers: rest });
      if (db) db.doc('rivers/' + id).delete().catch(() => {});
    },
    activate: (id) => persist({ ...state, active: id }),
    create: (t) => {
      const next = {
        id: uid(),
        code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        crew: [],
        boats: [],
        cars: [],
        places: [],
        gear: [],
        meals: [],
        log: [],
        pay: [],
        plans: {},
        at: now(),
        ...t,
      };
      persist({ ...state, trips: [next, ...trips], active: next.id });
      write(next);
    },
    remove: (id) => {
      const list = trips.filter((t) => t.id !== id);
      persist({ ...state, trips: list, active: id === state.active ? list[0]?.id ?? null : state.active });
      if (db) db.doc('trips/' + id).delete().catch(() => {});
    },
    set: (patch) => edit((t) => ({ ...t, ...patch })),
    push: (key, item) => edit((t) => ({ ...t, [key]: [...(t[key] || []), { id: uid(), ...item }] })),
    patch: (key, id, p) => edit((t) => ({ ...t, [key]: (t[key] || []).map((x) => (x.id === id ? { ...x, ...p } : x)) })),
    drop: (key, id) =>
      edit((t) => ({
        ...t,
        [key]: (t[key] || []).filter((x) => x.id !== id),
        gear: key === 'crew' ? t.gear.map((g) => (g.by === id ? { ...g, by: '' } : g)) : t.gear,
      })),
    plan: (i, p) => edit((t) => ({ ...t, plans: { ...t.plans, [i]: { ...t.plans[i], ...p } } })),
  };
}

/* ---------- ui ---------- */

const Tabs = ({ items, value, onChange, tint }) => (
  <div className="tabs">
    {items.map((t) => (
      <button
        key={t}
        className={'tab' + (t === value ? ' on' : '')}
        style={t === value ? { background: tint, borderColor: tint } : null}
        onClick={() => onChange(t)}
      >
        {t}
      </button>
    ))}
  </div>
);

function Acc({ title, note, tag, children, open: start }) {
  const [open, setOpen] = useState(!!start);
  return (
    <div className="acc">
      <button className="accHead" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="accText">
          <span className="accTitle">{title}</span>
          {note ? <span className="muted">{note}</span> : null}
        </span>
        {tag}
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="accBody">{children}</div> : null}
    </div>
  );
}

const Tag = ({ label, tint }) => (
  <span className="tag" style={{ borderColor: tint, color: tint }}>
    {label}
  </span>
);

const Field = ({ label, area, ...p }) => (
  <label className="field">
    {label ? <span className="label">{label}</span> : null}
    {area ? <textarea {...p} /> : <input {...p} />}
  </label>
);

/* ---------- trip ---------- */

function Trip({ s }) {
  const [tab, setTab] = useState('Itinerary');
  if (!s.trip) return <NewTrip s={s} />;
  const panels = { Itinerary, 'Crew & Crafts': Crew, Meals, Gear, Shuttle, Ledger, Log, Info, Trip: Settings };
  const P = panels[tab];
  return (
    <>
      <Tabs items={['Itinerary', 'Crew & Crafts', 'Meals', 'Gear', 'Shuttle', 'Ledger', 'Log', 'Info', 'Trip']} value={tab} onChange={setTab} tint="#7a3b28" />
      <div className="pad">
        <P s={s} />
      </div>
    </>
  );
}

function Stats({ s }) {
  const t = s.trip;
  const cells = [
    ['Days', t.days],
    ['Crew', t.crew.length],
    ['Camps set', Object.values(t.plans).filter((p) => p.camp).length],
    ['Vehicles', (t.cars || []).length],
  ];
  return (
    <div className="stats">
      {cells.map(([k, v]) => (
        <div className="stat" key={k}>
          <div className="statNum">{v}</div>
          <div className="statKey">{k}</div>
        </div>
      ))}
    </div>
  );
}

function Itinerary({ s }) {
  const t = s.trip;
  const ramps = ACCESS.filter((p) => p.mile != null);
  const L = ramps.find((p) => p.id === t.launch) || ramps[0];
  const O = ramps.find((p) => p.id === t.out) || ramps[ramps.length - 1];
  return (
    <>
      <div className="serif">{t.name}</div>
      <div className="muted mb">
        {L ? L.name : 'Launch'} → {O ? O.name : 'take-out'} · {RIVER.name}
      </div>
      <Stats s={s} />
      <div className="row">
        <Field label="Launch" type="date" value={t.start} onChange={(e) => okDate(e.target.value) && s.set({ start: e.target.value })} />
        <Field
          label="Take-out"
          type="date"
          value={okDate(t.start) ? addDays(t.start, t.days) : ''}
          onChange={(e) => {
            const n = dnum(e.target.value, t.start);
            if (n > 0 && n <= 60) s.set({ days: n });
          }}
        />
      </div>
      <div className="row mb">
        <Sel label="Put in at" value={t.launch || ramps[0]?.id} onChange={(v) => s.set({ launch: v })}>
          {ramps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
        <Sel label="Take out at" value={t.out || ramps[ramps.length - 1]?.id} onChange={(v) => s.set({ out: v })}>
          {ramps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Sel>
      </div>
      {tripDays(t).map((d) => {
        const p = t.plans[d.i] || {};
        const prev = t.plans[d.i - 1] || {};
        const from = d.i === 0 ? RIVER.miles[0] : prev.mile;
        const leg = from != null && p.mile != null ? Math.round((p.mile - from) * 10) / 10 : null;
        const runs = from != null && p.mile != null ? RIVER.rapids.filter((r) => r.mile > from && r.mile <= p.mile) : [];
        const sn = d.date && sun(d.date, RIVER.coords[0], RIVER.coords[1]);
        const meals = t.meals.filter((m) => m.day === d.i);
        return (
          <Acc
            key={d.i}
            title={d.label}
            note={p.camp ? `${p.camp}${leg != null ? ` · ${leg} mi` : ''}` : null}
            tag={sn ? <Tag label={`${clock(sn.rise)}–${clock(sn.set)}`} tint="#9d9385" /> : null}
          >
            <CampPick min={from} current={p.camp} onPick={(c) => s.plan(d.i, { camp: c.name, mile: c.mile })} />
            {runs.length > 0 && (
              <div className="mt">
                {runs.map((r) => (
                  <div className="line" key={r.name + r.mile}>
                    <span className="mile">{r.mile.toFixed(1)}</span> {r.name}{' '}
                    <span style={{ color: r.diff >= 6 ? '#9c3326' : '#9d9385' }}>{r.diff}</span>
                  </div>
                ))}
              </div>
            )}
            {meals.length > 0 && <div className="line mt">{meals.map((m) => m.name || m.slot).join(' · ')}</div>}
            <Sky t={t} date={d.date} />
            <Field
              area
              className="mt"
              value={p.note ?? ''}
              onChange={(e) => s.plan(d.i, { note: e.target.value })}
              placeholder="Notes"
            />
          </Acc>
        );
      })}
    </>
  );
}

// Sunrise-to-sunrise sky log (stars, planets, moon) from the trip's reference data
function Sky({ t, date }) {
  const ev = ((REFS[t.id] || {}).celestial || []).filter((e) => e[0].startsWith(date));
  if (!ev.length) return null;
  return (
    <Acc title="Sky" note={`${ev.length} events`}>
      {ev.map((e, i) => (
        <div className="line" key={i}>
          <span className="mile">{e[0].slice(11)}</span> {e[1]}
          {e[2] ? ` · ${e[2]}°` : ''}
          {e[3] ? <span className="muted"> {e[3]}</span> : null}
        </div>
      ))}
    </Acc>
  );
}

function CampPick({ min, current, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const hits = useMemo(
    () =>
      RIVER.camps
        .filter((c) => (min == null ? true : c.mile > min))
        .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.mile - b.mile)
        .slice(0, 30),
    [q, min]
  );
  if (!open)
    return (
      <button className="btn ghost" onClick={() => setOpen(true)}>
        {current ? 'Change camp' : 'Camp'}
      </button>
    );
  return (
    <div>
      <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder="Camp" autoFocus />
      {hits.map((c) => (
        <button
          className="pick"
          key={c.name + c.mile}
          onClick={() => {
            onPick(c);
            setOpen(false);
            setQ('');
          }}
        >
          <span className="mile">{c.mile.toFixed(1)}</span>
          <span>
            {c.name} <span className="muted">{c.bank} · {c.size}</span>
          </span>
        </button>
      ))}
      <button className="btn ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

const CRAFT = {
  raft: { label: 'Raft / cataraft', cap: 4 },
  kayak: { label: 'Whitewater kayak', cap: 1 },
  ik: { label: 'Inflatable kayak / packraft', cap: 1 },
  sup: { label: 'SUP', cap: 1 },
};

const CraftPaths = ({ type }) => (
  <>

    {type === 'raft' ? (
      <>
        <path d="M11 2.5h24a4.6 4.6 0 0 1 0 13H11a4.6 4.6 0 0 1 0-13z" />
        <path d="M18 2.5v13M28 2.5v13" />
        <path d="M9 5.5H2M37 12.5h7" />
      </>
    ) : type === 'sup' ? (
      <>
        <path d="M23 3.6c11 0 19 3.1 19 5.4s-8 5.4-19 5.4S4 11.3 4 9s8-5.4 19-5.4z" />
        <path d="M26 6.2l-3 5.6" />
      </>
    ) : (
      <>
        <path d="M23 2.4c9.4 1.6 17.6 4.6 20 6.6-2.4 2-10.6 5-20 6.6C13.6 14 5.4 11 3 9c2.4-2 10.6-5 20-6.6z" />
        {type === 'ik' ? <path d="M23 4.6c7 1.2 13.4 3.4 15.4 4.4-2 1-8.4 3.2-15.4 4.4-7-1.2-13.4-3.4-15.4-4.4 2-1 8.4-3.2 15.4-4.4z" /> : <ellipse cx="23" cy="9" rx="4.4" ry="2.6" />}
      </>
    )}
  </>
);

const CraftIcon = ({ type }) => (
  <svg className="carIcon" viewBox="0 0 46 18" aria-hidden="true">
    <CraftPaths type={type} />
  </svg>
);

function Crew({ s }) {
  const t = s.trip;
  const boats = t.boats || [];
  const [name, setName] = useState('');
  const [craft, setCraft] = useState('');
  const [open, setOpen] = useState(null);
  const aboard = (id) => t.crew.filter((m) => m.boat === id);

  return (
    <>
      <div className="row">
        <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <button
          className="btn"
          disabled={!name.trim()}
          onClick={() => {
            s.push('crew', { name: name.trim(), role: '', boat: '', ice: '', diet: '', days: '' });
            setName('');
          }}
        >
          Add
        </button>
      </div>
      {t.crew.map((m) => (
        <Acc key={m.id} title={m.name} note={[m.role, boats.find((b) => b.id === m.boat)?.name].filter(Boolean).join(' · ') || null}>
          <Field label="Role" value={m.role} onChange={(e) => s.patch('crew', m.id, { role: e.target.value })} />
          <Sel label="Craft" value={m.boat} onChange={(v) => s.patch('crew', m.id, { boat: v })}>
            <option value="">—</option>
            {boats.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Sel>
          <Field
            label="Days on the river"
            value={m.days ?? ''}
            inputMode="decimal"
            placeholder={String(t.days)}
            onChange={(e) => s.patch('crew', m.id, { days: e.target.value })}
          />
          <Field label="Emergency contact" value={m.ice} onChange={(e) => s.patch('crew', m.id, { ice: e.target.value })} />
          <Field label="Diet / meds" value={m.diet} onChange={(e) => s.patch('crew', m.id, { diet: e.target.value })} />
          <button className="btn ghost danger" onClick={() => s.drop('crew', m.id)}>
            Remove
          </button>
        </Acc>
      ))}

      <span className="label mt">Crafts</span>
      {boats.map((b) => {
        const on = aboard(b.id);
        const cap = num(b.cap);
        return (
          <div className={'grItem' + (open === b.id ? ' open' : '')} key={b.id}>
            <button className="car" onClick={() => setOpen(open === b.id ? null : b.id)}>
              <span className="carIconWrap">
                <CraftIcon type={b.type} />
              </span>
              <span className="carText">
                <span className="carName">{b.name}</span>
                <span className="muted">
                  {CRAFT[b.type]?.label || 'Craft'}
                  {on.length ? ` · ${on.map((m) => m.name).join(', ')}` : ''}
                </span>
              </span>
              <span className={'grAmt' + (cap && on.length > cap ? ' over' : '')}>{cap ? `${on.length}/${cap}` : on.length || ''}</span>
            </button>
            {open === b.id && (
              <div className="grBody">
                <Field label="Name" value={b.name} onChange={(e) => s.patch('boats', b.id, { name: e.target.value })} />
                <span className="label">Type</span>
                <div className="chips">
                  {Object.entries(CRAFT).map(([k, v]) => (
                    <button
                      key={k}
                      className={'chip' + (b.type === k ? ' on' : '')}
                      onClick={() => s.patch('boats', b.id, { type: k, cap: !num(b.cap) || num(b.cap) === CRAFT[b.type]?.cap ? v.cap : b.cap })}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className="numRow">
                  <Num label="Capacity" value={b.cap} onChange={(v) => s.patch('boats', b.id, { cap: v })} />
                </div>
                {cap && on.length > cap ? <div className="warn">{on.length} on a {cap}-person craft.</div> : null}
                <button className="btn ghost danger mt-s" onClick={() => s.drop('boats', b.id)}>
                  Remove
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="row mt">
        <Field value={craft} onChange={(e) => setCraft(e.target.value)} placeholder="Add a craft" />
        <button
          className="btn"
          disabled={!craft.trim()}
          onClick={() => {
            s.push('boats', { name: craft.trim(), type: 'raft', cap: CRAFT.raft.cap });
            setCraft('');
          }}
        >
          Add
        </button>
      </div>
    </>
  );
}

function Meals({ s }) {
  const [shop, setShop] = useState(false);
  const t = s.trip;
  const list = useMemo(() => {
    const m = new Map();
    t.meals.forEach((x) =>
      (x.items || '')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => m.set(v.toLowerCase(), v))
    );
    return [...m.values()].sort();
  }, [t.meals]);

  if (shop)
    return (
      <>
        <button className="btn ghost" onClick={() => setShop(false)}>
          ← Menu
        </button>
        <div className="mt">
          {list.length ? list.map((x) => <div className="shop" key={x}>{x}</div>) : <div className="muted">Nothing listed yet.</div>}
        </div>
      </>
    );

  return (
    <>
      <button className="btn ghost" onClick={() => setShop(true)}>
        Shopping list ({list.length})
      </button>
      <div className="mt" />
      {tripDays(t).map((d) => {
        const meals = t.meals.filter((m) => m.day === d.i);
        return (
          <Acc key={d.i} title={d.label} note={meals.map((m) => m.name).filter(Boolean).join(' · ') || null}>
            {SLOTS.map((slot) => {
              const m = meals.find((x) => x.slot === slot);
              if (!m)
                return (
                  <button className="addSlot" key={slot} onClick={() => s.push('meals', { day: d.i, slot, name: '', cook: '', items: '' })}>
                    + {slot}
                  </button>
                );
              return (
                <div className="mealBlock" key={slot}>
                  <span className="label">{slot}</span>
                  <Field value={m.name} onChange={(e) => s.patch('meals', m.id, { name: e.target.value })} placeholder="Dish" />
                  <div className="chips">
                    {t.crew.map((c) => (
                      <button
                        key={c.id}
                        className={'chip' + (m.cook === c.id ? ' on' : '')}
                        onClick={() => s.patch('meals', m.id, { cook: m.cook === c.id ? '' : c.id })}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                  <Field
                    area
                    value={m.items}
                    onChange={(e) => s.patch('meals', m.id, { items: e.target.value })}
                    placeholder={'3 lb ground beef\n2 onions'}
                  />
                  <button className="btn ghost danger" onClick={() => s.drop('meals', m.id)}>
                    Remove
                  </button>
                </div>
              );
            })}
          </Acc>
        );
      })}
    </>
  );
}

const SPLITS = { even: 'Even split', nights: 'Person-nights', users: 'By users', personal: 'Personal' };
const REQ = { req: ['Required', '#9c3326'], rec: ['Recommended', '#a8722a'], maybe: ['Maybe', '#6b6154'] };
const usd = (n) => (n >= 0.005 ? '$' + n.toFixed(2) : '');
const usd0 = (n) => '$' + Math.round(n).toLocaleString();
const num = (v) => (Number.isFinite(+v) ? +v : 0);

const norm = (g) => ({
  name: g.n ?? g.name ?? '',
  cat: g.c ?? g.cat ?? 'Gear',
  split: g.s || 'personal',
  req: g.r || '',
  flat: num(g.f),
  day: num(g.d),
  qty: num(g.q),
  e: g.e || {},
});

function ledger(t) {
  const D = Math.max(1, num(t.days) || 1);
  const crew = t.crew;
  const span = (c) => (okDate(c.onDate) && okDate(c.offDate) ? Math.round((new Date(c.offDate + 'T12:00:00Z') - new Date(c.onDate + 'T12:00:00Z')) / 864e5) : 0);
  const nights = (c) => (num(c.days) > 0 ? num(c.days) : span(c) > 0 ? span(c) : D);
  const allNights = crew.reduce((a, c) => a + nights(c), 0);
  const items = (t.gear || []).map((g) => {
    const it = norm(g);
    const unit = Math.max(it.flat, it.day * D);
    let have = 0,
      need = 0,
      lend = 0;
    crew.forEach((c) => {
      const e = it.e[c.id] || {};
      have += num(e.have);
      need += num(e.need);
      lend += num(e.lend);
    });
    const target = it.split === 'personal' ? need : it.split === 'users' ? it.qty || need : it.qty;
    const rent = Math.max(0, target - lend);
    const total = unit * rent;
    const share = {};
    crew.forEach((c) => {
      const e = it.e[c.id] || {};
      const v =
        it.split === 'even'
          ? crew.length
            ? total / crew.length
            : 0
          : it.split === 'nights'
            ? allNights
              ? (total * nights(c)) / allNights
              : 0
            : need
              ? (total * num(e.need)) / need
              : 0;
      if (v) share[c.id] = v;
    });
    const assigned = Object.values(share).reduce((a, b) => a + b, 0);
    return { id: g.id, raw: g, ...it, unit, have, need, lend, target, rent, total, share, loose: total - assigned };
  });
  const by = {};
  crew.forEach((c) => (by[c.id] = { even: 0, nights: 0, users: 0, personal: 0, total: 0, nightsCount: nights(c) }));
  let total = 0,
    loose = 0;
  items.forEach((it) => {
    total += it.total;
    loose += it.loose;
    crew.forEach((c) => {
      const v = it.share[c.id] || 0;
      by[c.id][it.split] += v;
      by[c.id].total += v;
    });
  });
  return { items, by, total, loose, allNights, days: D };
}

const Num = ({ label, value, onChange }) => (
  <label className="num">
    <span className="numKey">{label}</span>
    <input inputMode="decimal" value={value ?? ''} placeholder="0" onChange={(e) => onChange(e.target.value)} />
  </label>
);

function Gear({ s }) {
  const t = s.trip;
  const [me, setMe] = useState('');
  const [cat, setCat] = useState('All');
  const [find, setFind] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const L = useMemo(() => ledger(t), [t]);

  if (!t.gear.length)
    return (
      <>
        <button className="btn" onClick={() => s.set({ gear: GEAR.map((g) => ({ id: uid(), ...g, e: {} })) })}>
          Load gear catalog ({GEAR.length})
        </button>
        <div className="muted mt">Or add items one at a time.</div>
        <AddGear s={s} onDone={() => {}} />
      </>
    );

  const cats = ['All', ...new Set(L.items.map((i) => i.cat))];
  const q = find.trim().toLowerCase();
  const shown = L.items.filter(
    (i) => (cat === 'All' || i.cat === cat) && (!q || i.name.toLowerCase().includes(q))
  );
  const mine = me ? L.by[me] : null;

  return (
    <>
      {t.crew.length === 0 ? (
        <div className="muted mb">Add crew on the Crew tab to split costs.</div>
      ) : (
        <div className="chips">
          {t.crew.map((c) => (
            <button key={c.id} className={'chip' + (me === c.id ? ' on' : '')} onClick={() => setMe(me === c.id ? '' : c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="stats mt">
        <div className="stat">
          <div className="statNum">{usd0(L.total)}</div>
          <div className="statKey">Trip gear cost</div>
        </div>
        <div className="stat">
          <div className="statNum">{mine ? usd0(mine.total) : '—'}</div>
          <div className="statKey">{mine ? 'Your share' : 'Pick your name'}</div>
        </div>
      </div>

      <div className="row">
        <Field value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Search ${L.items.length} items`} />
        <button className="btn ghost" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add'}
        </button>
      </div>
      {adding && <AddGear s={s} onDone={() => setAdding(false)} />}
      <div className="chips">
        {cats.map((c) => (
          <button key={c} className={'chip' + (cat === c ? ' on river' : '')} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="muted mt">Nothing matches.</div>}
      {shown.map((it) => (
        <GearRow key={it.id} it={it} s={s} me={me} open={open === it.id} onOpen={() => setOpen(open === it.id ? null : it.id)} />
      ))}
    </>
  );
}

function GearRow({ it, s, me, open, onOpen }) {
  const mine = it.share[me] || 0;
  const e = it.e[me] || {};
  const set = (k, v) =>
    s.patch('gear', it.id, { e: { ...it.e, [me]: { ...e, [k]: v } } });
  const tag = REQ[it.req];
  const flag = it.unit > 0 && it.rent > 0;
  return (
    <div className={'grItem' + (open ? ' open' : '')}>
      <button className="grHead" onClick={onOpen}>
        <span className="grText">
          <span className="grName">{it.name}</span>
          <span className="muted">
            {SPLITS[it.split]}
            {it.unit ? ` · ${usd(it.unit)}/item` : ''}
            {flag ? ` · renting ${+it.rent.toFixed(2)}` : ''}
          </span>
        </span>
        {tag && !open ? <Tag label={tag[0]} tint={tag[1]} /> : null}
        <span className="grAmt">{mine ? usd(mine) : ''}</span>
      </button>
      {open && (
        <div className="grBody">
          {it.split !== 'personal' && (
            <div className="numRow">
              <Num label="Group needs" value={it.raw.q} onChange={(v) => s.patch('gear', it.id, { q: v })} />
              <Num label="Flat fee" value={it.raw.f} onChange={(v) => s.patch('gear', it.id, { f: v })} />
              <Num label="Per day" value={it.raw.d} onChange={(v) => s.patch('gear', it.id, { d: v })} />
            </div>
          )}
          {it.split === 'personal' && (
            <div className="numRow">
              <Num label="Flat fee" value={it.raw.f} onChange={(v) => s.patch('gear', it.id, { f: v })} />
              <Num label="Per day" value={it.raw.d} onChange={(v) => s.patch('gear', it.id, { d: v })} />
            </div>
          )}
          {me ? (
            <div className="numRow">
              {it.split === 'personal' && <Num label="I have" value={e.have} onChange={(v) => set('have', v)} />}
              {it.split !== 'even' && it.split !== 'nights' && (
                <Num label={it.split === 'users' ? 'I’m using' : 'I need'} value={e.need} onChange={(v) => set('need', v)} />
              )}
              <Num label="I can lend" value={e.lend} onChange={(v) => set('lend', v)} />
            </div>
          ) : (
            <div className="muted">Pick your name above to enter quantities.</div>
          )}
          <div className="rule" />
          <div className="grMath">
            <span>{it.split === 'personal' ? `${+it.need.toFixed(2)} needed` : `${+it.target.toFixed(2)} needed`}</span>
            <span>{+it.lend.toFixed(2)} lent</span>
            <span>{+it.rent.toFixed(2)} rented</span>
            <span className="grTotal">{it.total ? usd(it.total) : '$0'}</span>
          </div>
          {it.raw.note ? <div className="muted">{it.raw.note}</div> : null}
          {it.loose > 0.005 && <div className="muted">{usd(it.loose)} unassigned — nobody has claimed this item.</div>}
          <button className="btn ghost danger mt-s" onClick={() => s.drop('gear', it.id)}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function AddGear({ s, onDone }) {
  const [f, setF] = useState({ n: '', c: '', s: 'personal', f: '', d: '', q: '' });
  const up = (k, v) => setF({ ...f, [k]: v });
  return (
    <div className="card mt mb">
      <Field label="Item" value={f.n} onChange={(e) => up('n', e.target.value)} />
      <Field label="Category" value={f.c} onChange={(e) => up('c', e.target.value)} placeholder="Kitchen" />
      <span className="label">Cost split</span>
      <div className="chips">
        {Object.entries(SPLITS).map(([k, v]) => (
          <button key={k} className={'chip' + (f.s === k ? ' on' : '')} onClick={() => up('s', k)}>
            {v}
          </button>
        ))}
      </div>
      <div className="numRow">
        <Num label="Flat fee" value={f.f} onChange={(v) => up('f', v)} />
        <Num label="Per day" value={f.d} onChange={(v) => up('d', v)} />
        {f.s !== 'personal' && <Num label="Group needs" value={f.q} onChange={(v) => up('q', v)} />}
      </div>
      <button
        className="btn"
        disabled={!f.n.trim()}
        onClick={() => {
          s.push('gear', { n: f.n.trim(), c: f.c.trim() || 'Gear', s: f.s, r: '', f: num(f.f), d: num(f.d), q: num(f.q), e: {} });
          setF({ n: '', c: f.c, s: f.s, f: '', d: '', q: '' });
          onDone();
        }}
      >
        Add item
      </button>
    </div>
  );
}

const emile = (p) => (p && p.mile != null ? +p.mile : p && p.toMile != null ? +p.toMile : -1);
const TRACK = ['#7a3b28', '#2f5d62', '#a8722a', '#6b6154', '#95331a', '#4a6b3a', '#8a5a9c'];
const dnum = (iso, from) => (okDate(iso) && okDate(from) ? Math.round((new Date(iso + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 864e5) : 0);
const short = (n, k = 13) => (n.length > k ? n.slice(0, k - 1) + '…' : n);

const CarPaths = ({ trailer }) => (
  <>
    <path d="M2 12h22M4.5 12a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0M17 12a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0" />
    <path d="M2 12V8.2c0-.7.5-1.2 1.2-1.2h2.4l2.6-3c.4-.5 1-.8 1.7-.8h5.3c.7 0 1.3.3 1.7.9L20 7h3c.7 0 1.2.5 1.2 1.2V12" />
    <path d="M9.6 7h4.8" />
    {trailer ? <path d="M24.2 10h2.6M28 12.8V6.6c0-.5.4-.9.9-.9h12.5c.5 0 .9.4.9.9v6.2zM31 12.8a2 2 0 1 0 4 0 2 2 0 1 0-4 0M28 12.8h14.3" /> : null}
</>
);

const CarIcon = ({ trailer }) => (
  <svg className="carIcon" viewBox="0 0 46 18" aria-hidden="true">
    <CarPaths trailer={trailer} />
  </svg>
);

const Car = ({ c, crew, tint, onClick }) => (
  <button className="car" onClick={onClick} disabled={!onClick}>
    <span className="carIconWrap" style={tint ? { color: tint } : null}>
      <CarIcon trailer={c.trailer} />
    </span>
    <span className="carText">
      <span className="carName">{c.name}</span>
      <span className="muted">
        {crew.find((x) => x.id === c.owner)?.name || 'No owner'}
        {num(c.seats) ? ` · ${num(c.seats)} seats` : ''}
        {c.trailer ? ' · trailer' : ''}
      </span>
    </span>
  </button>
);

const Sel = ({ label, value, onChange, children }) => (
  <label className="field">
    {label ? <span className="label">{label}</span> : null}
    <select className="sel" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  </label>
);

const COLS = 12,
  ROWS = 7;
const hm = (h) => {
  if (h == null) return '';
  const m = Math.round(h * 60);
  return [Math.floor(m / 60) ? Math.floor(m / 60) + 'h' : '', m % 60 ? (m % 60) + 'm' : ''].filter(Boolean).join(' ') || '0m';
};
const legsOf = (t) => {
  if (t.legs) return t.legs;
  const out = [];
  (t.cars || []).forEach((c, ci) => {
    const k = {};
    (c.legs || []).forEach((l) => out.push({ ...l, car: c.id, _o: (k[l.date] = (k[l.date] || 0) + 1), _c: ci }));
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._o - b._o || a._c - b._c));
  return out.map(({ _o, _c, ...l }, i) => ({ ...l, par: i > 0 && out[i - 1].date === l.date && out[i - 1]._o === _o }));
};

function story(t) {
  const start = okDate(t.start) ? t.start : today();
  const N = num(t.days) || 1;
  const acc = ACCESS;
  const user = (t.places || []).filter((p) => !acc.some((a) => a.name === p.name));
  const places = [...acc, ...user, YARD];
  const byId = {};
  places.forEach((p) => (byId[p.id] = p));
  const byName = {};
  places.forEach((p) => (byName[p.name] = p.id));
  const alias = {};
  (t.places || []).forEach((p) => (byId[p.id] ? null : (alias[p.id] = byName[p.name])));
  const fix = (id) => (byId[id] ? id : alias[id] || id);

  const dates = [];
  for (let d = -2; d <= N + 2; d++) dates.push(addDays(start, d));
  const T = (iso) => dnum(iso, start);
  const cars = (t.cars || []).map((c, i) => ({ ...c, tint: TRACK[i % TRACK.length] }));

  const launch = byId[t.launch] || acc.find((p) => p.mile != null);
  const out = byId[t.out] || [...acc.filter((p) => p.mile != null)].pop();
  const onD = (m) => (okDate(m.onDate) ? T(m.onDate) : 0);
  const offD = (m) => (okDate(m.offDate) ? T(m.offDate) : N);
  const onP = (m) => fix(m.on) || launch?.id;
  const offP = (m) => fix(m.off) || out?.id;

  const byDay = {};
  legsOf(t).forEach((l) => {
    const c = cars.find((x) => x.id === l.car);
    if (!c) return;
    const d = T(l.date);
    (byDay[d] = byDay[d] || []).push({ ...l, from: fix(l.from), to: fix(l.to), car: c });
  });
  const loc = {},
    afloat = {};
  const legs = [];
  Object.keys(byDay)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((d) => {
      t.crew.forEach((m) => {
        if (!afloat[m.id] && onD(m) < d && (loc[m.id] == null || loc[m.id] === onP(m))) (loc[m.id] = 'river'), (afloat[m.id] = 1);
        if (loc[m.id] === 'river' && offD(m) <= d) loc[m.id] = offP(m);
      });
      (t.boats || []).forEach((b) => {
        if (!afloat[b.id] && d > 0 && loc[b.id] === launch?.id) (loc[b.id] = 'river'), (afloat[b.id] = 1);
        if (loc[b.id] === 'river' && d >= N) loc[b.id] = out?.id;
      });
      const rounds = [];
      byDay[d].forEach((l, i) => {
        if (!i || !l.par) rounds.push([]);
        rounds[rounds.length - 1].push(l);
      });
      rounds.forEach((go) => {
        go.forEach((l) => (l.stray = [...(l.who || []), ...(l.boats || [])].filter((x) => loc[x] != null && loc[x] !== l.from)));
        go.forEach((l) => [...(l.who || []), ...(l.boats || [])].forEach((x) => (loc[x] = l.to)));
      });
      const slot = 0.76 / rounds.length;
      rounds.forEach((go, r) => go.forEach((l) => legs.push({ ...l, t0: d + 0.12 + r * slot, t1: d + 0.12 + r * slot + slot * 0.9 })));
    });
  legs.sort((a, b) => a.t1 - b.t1);

  const mileAt = (tt) => {
    const f = Math.max(0, Math.min(N, tt));
    const at = (d) => {
      const p = t.plans?.[d];
      return p && p.mile != null && p.mile !== '' ? num(p.mile) : emile(launch) + ((emile(out) - emile(launch)) * d) / N;
    };
    const i = Math.floor(f);
    return at(i) + (at(Math.min(N, i + 1)) - at(i)) * (f - i);
  };

  const carried = (kind, id) => legs.filter((l) => (kind === 'who' ? l.who || [] : l.boats || []).includes(id));
  const seg = (l) => ({ t0: l.t0, t1: l.t1, from: l.from, to: l.to, leg: l });
  const track = (segs) => segs.sort((a, b) => a.t0 - b.t0);

  const people = t.crew.map((m) => {
    const segs = carried('who', m.id).map(seg);
    segs.push({ t0: onD(m) + 0.9, t1: onD(m) + 0.98, from: onP(m), to: 'river' });
    segs.push({ t0: offD(m) + 0.02, t1: offD(m) + 0.1, from: 'river', to: offP(m) });
    return { ...m, kind: 'person', segs: track(segs) };
  });
  const boats = (t.boats || []).map((b) => {
    const segs = carried('boats', b.id).map(seg);
    const atLaunch = segs.filter((x) => x.t1 <= 0.89).pop();
    if (atLaunch && atLaunch.to === launch?.id) {
      segs.push({ t0: 0.9, t1: 0.98, from: launch.id, to: 'river' });
      const off = segs.find((x) => x.t0 > 1 && x.from !== 'river');
      const endT = off ? Math.min(N + 0.1, off.t0 - 0.01) : N + 0.1;
      segs.push({ t0: endT - 0.08, t1: endT, from: 'river', to: off ? off.from : out?.id });
    }
    return { ...b, kind: 'boat', segs: track(segs) };
  });
  const rigs = cars.map((c) => ({ ...c, kind: 'car', segs: track(legs.filter((l) => l.car.id === c.id).map(seg)) }));

  const at = (e, tt) => {
    const S = e.segs;
    if (!S.length) return null;
    if (tt <= S[0].t0) return { at: S[0].from };
    for (let i = 0; i < S.length; i++) {
      if (tt <= S[i].t1) {
        if (tt >= S[i].t0) return { at: S[i].from, to: S[i].to, f: (tt - S[i].t0) / (S[i].t1 - S[i].t0 || 1), leg: S[i].leg };
        return { at: S[i - 1] ? S[i - 1].to : S[0].from };
      }
    }
    return { at: S[S.length - 1].to };
  };
  const used = new Set();
  legs.forEach((l) => {
    used.add(l.from);
    used.add(l.to);
  });
  [launch, out].forEach((p) => p && used.add(p.id));
  t.crew.forEach((m) => {
    used.add(onP(m));
    used.add(offP(m));
  });

  const grid = {};
  const taken = new Set();
  const claim = (id, c) => {
    grid[id] = c;
    taken.add(c.join());
  };
  const free = ([c0, r0]) => {
    let best = [c0, r0],
      bd = Infinity;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const d = Math.abs(c - c0) + Math.abs(r - r0) * 1.01;
        if (!taken.has(c + ',' + r) && d < bd) (bd = d), (best = [c, r]);
      }
    return best;
  };
  places.forEach((p) => t.grid?.[p.id] && claim(p.id, t.grid[p.id]));
  places.forEach((p) => !grid[p.id] && p.grid && claim(p.id, free(p.grid)));
  let k = 0;
  places.forEach((p) => !grid[p.id] && claim(p.id, free(emile(p) >= 0 ? [Math.round((emile(p) / RIVER.miles[1]) * (COLS - 1)), ROWS - 1] : [(k++ * 4) % COLS, 0])));

  const roads = (t.roads || (RIVER.roads || []).map((r, i) => ({ id: 'd' + i, a: byName[r.a], b: byName[r.b], h: r.h })))
    .map((r) => ({ ...r, a: fix(r.a), b: fix(r.b) }))
    .filter((r) => byId[r.a] && byId[r.b] && r.a !== r.b);
  const memo = {};
  const drive = (a, b) => {
    a = fix(a);
    b = fix(b);
    const k = a + '|' + b;
    if (k in memo) return memo[k];
    if (!byId[a] || !byId[b]) return (memo[k] = null);
    const dist = { [a]: 0 },
      prev = {},
      done = new Set();
    for (;;) {
      let v = null;
      for (const q in dist) if (!done.has(q) && (v == null || dist[q] < dist[v])) v = q;
      if (v == null || v === b) break;
      done.add(v);
      roads.forEach((r) => {
        const w = r.a === v ? r.b : r.b === v ? r.a : null;
        if (w == null) return;
        const c = dist[v] + (num(r.h) > 0 ? num(r.h) : 3);
        if (dist[w] == null || c < dist[w]) (dist[w] = c), (prev[w] = [v, r]);
      });
    }
    if (dist[b] == null) return (memo[k] = null);
    const path = [b];
    let h = 0,
      known = true;
    for (let v = b; prev[v]; v = prev[v][0]) {
      path.unshift(prev[v][0]);
      num(prev[v][1].h) > 0 ? (h += num(prev[v][1].h)) : (known = false);
    }
    return (memo[k] = { path, h: known ? h : null });
  };
  const net = { grid, roads, drive };

  const spans = [];
  [...rigs, ...people, ...boats].forEach((e) => e.segs.forEach((x) => spans.push([x.t0, x.t1])));
  spans.sort((a, b) => a[0] - b[0]);
  const busy = [];
  spans.forEach(([a, b]) => {
    const last = busy[busy.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else busy.push([a, b]);
  });
  const knots = [];
  let u = 0;
  if (busy.length) {
    knots.push({ u: 0, t: busy[0][0] - 0.1 });
    u = 0.4;
    busy.forEach(([a, b], i) => {
      if (i) u += Math.min(3, 0.35 + 0.12 * (a - busy[i - 1][1]));
      knots.push({ u, t: a, go: true });
      u += b - a < 0.09 ? 0.9 : 2.8;
      knots.push({ u, t: b });
    });
    knots.push({ u: u + 0.5, t: busy[busy.length - 1][1] + 0.1 });
  } else knots.push({ u: 0, t: 0 }, { u: 1, t: N });
  const U = knots[knots.length - 1].u;
  const tOf = (uu) => {
    for (let i = 1; i < knots.length; i++)
      if (uu <= knots[i].u) {
        const a = knots[i - 1],
          b = knots[i];
        return a.t + ((b.t - a.t) * (uu - a.u)) / (b.u - a.u || 1);
      }
    return knots[knots.length - 1].t;
  };
  const stops = knots.filter((k) => k.go).map((k) => k.u);

  return { start, N, dates, T, byId, places, used, legs, cars: rigs, boats, people, launch, out, mileAt, at, net, U, tOf, stops };
}

function plan(S, all) {
  const { places, used, net, byId } = S;
  const W = 340,
    M = 22,
    T = 20;
  const C = (W - 2 * M) / (COLS - 1);
  const RY = T + (ROWS - 1) * C + 24,
    H = RY + 24;
  const X = (c) => M + c * C,
    Y = (r) => T + r * C;
  const rx = (mile) => M + (Math.max(0, Math.min(MAXMILE, mile)) / MAXMILE) * (W - 2 * M);
  const ry = (x) => RY + Math.sin(x / 17) * 4;
  const linked = new Set();
  net.roads.forEach((r) => (linked.add(r.a), linked.add(r.b)));
  const pos = {};
  places
    .filter((p) => all || used.has(p.id) || linked.has(p.id))
    .forEach((p) => {
      const [c, r] = net.grid[p.id];
      pos[p.id] = { x: X(c), y: Y(r), riv: emile(p) >= 0, foot: p.mile == null, mile: emile(p) };
    });
  const boxes = [];
  Object.keys(pos)
    .sort((a, b) => pos[a].x - pos[b].x)
    .forEach((id) => {
      const q = pos[id];
      const w = textW(short(byId[id]?.name || id, 18)) + 4;
      const x0 = q.x < 40 ? q.x - 4 : q.x > W - 40 ? q.x + 4 - w : q.x - w / 2;
      q.dy = [-7, 13, -16].find((dy) => !boxes.some((b) => x0 < b.x1 && x0 + w > b.x0 && Math.abs(q.y + dy - b.y) < 8)) ?? -7;
      boxes.push({ x0, x1: x0 + w, y: q.y + q.dy });
    });
  const edges = net.roads.filter((r) => pos[r.a] && pos[r.b]);
  const route = (from, to) => {
    const a = pos[from],
      b = pos[to];
    if (!a || !b) return null;
    const d = net.drive(from, to);
    const pts = d && d.path.every((id) => pos[id]) ? d.path.map((id) => pos[id]) : [a, b];
    const cum = [0];
    pts.forEach((q, i) => i && cum.push(cum[i - 1] + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y)));
    return { pts, cum, len: cum[cum.length - 1] };
  };
  const along = (r, d) => {
    const dd = Math.max(0, Math.min(r.len, d));
    let i = 1;
    while (i < r.pts.length - 1 && r.cum[i] < dd) i++;
    const a = r.pts[i - 1],
      b = r.pts[i] || a;
    const f = (dd - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: b.x - a.x };
  };
  let water = '';
  for (let x = M - 12; x <= W - M + 12; x += 3) water += `${water ? 'L' : 'M'}${x} ${ry(x).toFixed(1)}`;
  return { W, H, M, T, C, RY, X, Y, pos, edges, route, along, rx, ry, water, byId };
}

const ease = (f) => f * f * (3 - 2 * f);
const textW = (s) => s.length * 4.3;

function Story({ S, L, tt }) {
  const { byId, cars, boats, people, mileAt, at } = S;
  const { W, H, edges, pos, route, along, rx, ry, water } = L;
  const fx = rx(mileAt(tt));
  const xy = (a) => (a === 'river' ? { x: fx, y: ry(fx) } : pos[a]);

  const rolling = [];
  const parked = {};
  cars.forEach((c) => {
    const a = at(c, tt);
    if (!a) return;
    if (a.to == null) return (parked[a.at] = parked[a.at] || []).push(c);
    rolling.push({ c, a, r: route(a.at, a.to) });
  });
  const lane = {};
  rolling.forEach((m) => {
    if (!m.r) return;
    const k = m.a.at + '|' + m.a.to + '|' + m.a.leg.t0;
    m.k = lane[k] = (lane[k] || 0) + 1;
  });
  rolling.forEach((m) => {
    if (!m.r) return;
    const back = (lane[m.a.at + '|' + m.a.to + '|' + m.a.leg.t0] - m.k) * 20;
    const q = along(m.r, ease(m.a.f) * (m.r.len + back) - back);
    const end = m.r.pts[m.r.pts.length - 1];
    m.q = q;
    m.flip = (q.dx || end.x - m.r.pts[0].x) < 0;
  });

  const here = {},
    moving = {};
  const tally = (e, key) => {
    const a = at(e, tt);
    if (!a) return;
    if (a.leg) return;
    if (a.to == null) return ((here[a.at] = here[a.at] || { who: 0, boats: 0, type: null })[key]++, e.type && (here[a.at].type = here[a.at].type || e.type));
    const k = a.at + '>' + a.to;
    const g = (moving[k] = moving[k] || { a, who: 0, boats: 0, type: null });
    g[key]++;
    if (e.type) g.type = g.type || e.type;
  };
  people.forEach((m) => tally(m, 'who'));
  boats.forEach((b) => tally(b, 'boats'));

  const Pod = ({ x, y, n }) => (
    <g transform={`translate(${x} ${y})`}>
      <circle className="pod" r="5.6" />
      <text className="podN" y="2.6">
        {n}
      </text>
    </g>
  );
  const Fleet = ({ x, y, n, type }) => (
    <g className="fleet" transform={`translate(${x} ${y})`}>
      <g className="glyph boat" transform="translate(0 -3) scale(0.36)">
        <CraftPaths type={type || 'raft'} />
      </g>
      {n > 1 ? (
        <text className="fleetN" x="18" y="2.6">
          ×{n}
        </text>
      ) : null}
    </g>
  );
  const Rig = ({ c, x, y, flip }) => (
    <g style={{ color: c.tint }} transform={`translate(${x} ${y})`}>
      <g className="glyph rig" transform={`translate(${flip ? 8 : -8} -5.5) scale(${flip ? -0.36 : 0.36} 0.36)`}>
        {c.kind === 'outfitter' ? <TruckPaths /> : <CarPaths trailer={c.trailer} />}
      </g>
    </g>
  );
  const load = (x, y, d, g) => {
    const out = [];
    let cx = x;
    if (g.boats) {
      const w = g.boats > 1 ? 30 : 18;
      out.push(<Fleet key="f" x={d > 0 ? cx : cx - w} y={y} n={g.boats} type={g.type} />);
      cx += d * (w + 3);
    }
    if (g.who) out.push(<Pod key="p" x={cx + d * 6} y={y} n={g.who} />);
    return out;
  };

  return (
    <svg className="stage" viewBox={`0 0 ${W} ${H}`}>
      <path className="water" d={water} />
      <Roads L={L} />
      {rolling.map((m, i) => (m.r ? <polyline key={m.c.id} className="way" style={{ stroke: m.c.tint }} transform={`translate(${(i - (rolling.length - 1) / 2) * 1.7} ${(i - (rolling.length - 1) / 2) * 1.7})`} points={m.r.pts.map((q) => `${q.x},${q.y}`).join(' ')} /> : null))}

      {Object.entries(pos).map(([id, q]) => {
        const lot = parked[id] || [];
        const g = here[id] || { who: 0, boats: 0 };
        const many = lot.length > 3;
        const target = rolling.some((m) => m.a.to === id);
        const d = q.x < 60 ? -1 : 1;
        const carAt = (i) => ({ x: q.x - d * (14 + i * 19), y: q.y });
        return (
          <g key={id}>
            <circle className={'lot' + (q.riv ? ' riv' : '') + (target ? ' target' : '')} cx={q.x} cy={q.y} r="3.6" />
            <NodeKey q={q} name={byId[id]?.name || id} W={W} />
            {many ? (
              <g>
                <Rig c={{ tint: 'var(--ink-dim)', trailer: false }} {...carAt(0)} flip={d < 0} />
                <text className="fleetN cars" x={carAt(0).x - d * 10} y={q.y + 2.6} style={{ textAnchor: d < 0 ? 'start' : 'end' }}>
                  ×{lot.length}
                </text>
              </g>
            ) : (
              lot.map((c, i) => <Rig key={c.id} c={c} {...carAt(i)} flip={d < 0} />)
            )}
            {d < 0 ? load(q.x + 10 + (many ? 1 : lot.length) * 19, q.y, 1, g) : load(q.x + 8, q.y, 1, g)}
          </g>
        );
      })}

      {Object.entries(moving).map(([k, g]) => {
        const p1 = xy(g.a.at),
          p2 = xy(g.a.to);
        if (!p1 || !p2) return null;
        const f = ease(g.a.f);
        return <g key={k}>{load(p1.x + (p2.x - p1.x) * f + 8, p1.y + (p2.y - p1.y) * f - 1, 1, g)}</g>;
      })}
      {here.river ? (
        <g className="flotilla">
          <circle className="buoy" cx={fx} cy={ry(fx)} r="3" />
          {load(Math.max(4, Math.min(W - 50, fx - 20)), ry(fx) + 13, 1, here.river)}
        </g>
      ) : null}

      {rolling.map((m, i) => {
        if (!m.q) return null;
        const who = (m.a.leg.who || []).length,
          nb = (m.a.leg.boats || []).length;
        const up = i % 2 === 0;
        const type = boats.find((b) => b.id === (m.a.leg.boats || [])[0])?.type;
        return (
          <g key={m.c.id}>
            <Rig c={m.c} x={m.q.x} y={m.q.y} flip={m.flip} />
            <g transform={`translate(${Math.max(34, Math.min(W - 34, m.q.x))} ${m.q.y + (up ? -11 : 15)})`}>
              <text className="tagName" style={{ fill: m.c.tint }} y="0">
                {short(m.c.name)}
              </text>
              <g transform={`translate(${-((nb ? (nb > 1 ? 33 : 21) : 0) + (who ? 12 : 0)) / 2} ${up ? -11 : 11})`}>{load(0, 0, 1, { who, boats: nb, type })}</g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

const NodeKey = ({ q, name, W }) => {
  const a = q.x < 40 ? 'start' : q.x > W - 40 ? 'end' : 'middle';
  return (
    <text className="nodeKey" x={a === 'start' ? q.x - 4 : a === 'end' ? q.x + 4 : q.x} y={q.y + (q.dy ?? -7)} style={{ textAnchor: a }}>
      {short(name, 18)}
    </text>
  );
};

const Roads = ({ L, sel, hot, onRoad }) => (
  <>
    {Object.entries(L.pos).map(([id, q]) => (q.riv ? <line key={id} className={q.foot ? 'trail' : 'ramp'} x1={q.x} y1={q.y} x2={L.rx(q.mile)} y2={L.ry(L.rx(q.mile))} /> : null))}
    {L.edges.map((r) => {
      const a = hot?.(r.a) || L.pos[r.a],
        b = hot?.(r.b) || L.pos[r.b];
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const label = num(r.h) > 0 ? hm(num(r.h)) : onRoad ? '?' : '';
      const w = textW(label) + 8;
      return (
        <g key={r.id} className={'road' + (sel === r.id ? ' on' : '')} onPointerDown={onRoad ? (e) => (e.stopPropagation(), onRoad(r.id)) : undefined}>
          {onRoad ? <line className="roadHit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null}
          <line className="rd" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          {label ? (
            <g transform={`translate(${mx} ${my})`}>
              <rect className="hrsBox" x={-w / 2} y="-5.5" width={w} height="11" rx="5.5" />
              <text className="hrs" y="2.4">
                {label}
              </text>
            </g>
          ) : null}
        </g>
      );
    })}
  </>
);

function Board({ S, s, onDone }) {
  const t = s.trip;
  const L = useMemo(() => plan(S, true), [S]);
  const { net, byId, places } = S;
  const [sel, setSel] = useState(null);
  const [drag, setDrag0] = useState(null);
  const [name, setName] = useState('');
  const svg = useRef(null);
  const dr = useRef(null);
  const setDrag = (v) => setDrag0((dr.current = v));
  const pt = (e) => {
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current.getScreenCTM().inverse());
  };
  const roads = net.roads;
  const mine = (id) => (t.places || []).some((p) => p.id === id);
  const hot = (id) => (drag?.moved && drag.id === id ? drag : null);
  const cell = (x, y) => [Math.max(0, Math.min(COLS - 1, Math.round((x - L.M) / L.C))), Math.max(0, Math.min(ROWS - 1, Math.round((y - L.T) / L.C)))];

  const grab = (id) => (e) => {
    e.stopPropagation();
    svg.current.setPointerCapture?.(e.pointerId);
    const p = pt(e);
    setDrag({ id, x: p.x, y: p.y, sx: e.clientX, sy: e.clientY, moved: false });
  };
  const move = (e) => {
    const drag = dr.current;
    if (!drag) return;
    const p = pt(e);
    setDrag({ ...drag, x: p.x, y: p.y, moved: drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6 });
  };
  const drop = () => {
    const drag = dr.current;
    if (!drag) return;
    const id = drag.id;
    setDrag(null);
    if (drag.moved) {
      const c = cell(drag.x, drag.y);
      const clash = places.find((q) => q.id !== id && net.grid[q.id][0] === c[0] && net.grid[q.id][1] === c[1]);
      return s.set({ grid: { ...net.grid, [id]: c, ...(clash ? { [clash.id]: net.grid[id] } : {}) } });
    }
    if (sel?.node && sel.node !== id) {
      const ex = roads.find((r) => (r.a === sel.node && r.b === id) || (r.b === sel.node && r.a === id));
      if (ex) return setSel({ road: ex.id });
      const r = { id: uid(), a: sel.node, b: id, h: '' };
      s.set({ roads: [...roads, r] });
      return setSel({ road: r.id });
    }
    setSel(sel?.node === id ? null : { node: id });
  };

  const road = sel?.road && roads.find((r) => r.id === sel.road);
  const node = sel?.node && byId[sel.node];
  const setH = (r, h, m) => s.set({ roads: roads.map((x) => (x.id === r.id ? { ...x, h: num(h) + num(m) / 60 || '' } : x)) });
  const hrs = road ? Math.floor(num(road.h)) : 0;
  const mins = road ? Math.round((num(road.h) - hrs) * 60) : 0;

  return (
    <>
      <svg ref={svg} className="stage board" viewBox={`0 0 ${L.W} ${L.H}`} onPointerMove={move} onPointerUp={drop} onPointerCancel={() => setDrag(null)}>
        <rect className="boardBg" width={L.W} height={L.H} onPointerDown={() => setSel(null)} />
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <circle key={i} className="dot" cx={L.X(i % COLS)} cy={L.Y(Math.floor(i / COLS))} r="0.9" />
        ))}
        <path className="water" d={L.water} />
        <Roads L={L} sel={sel?.road} hot={hot} onRoad={(id) => setSel({ road: id })} />
        {Object.entries(L.pos).map(([id, q0]) => {
          const q = hot(id) || q0;
          const on = sel?.node === id || (road && (road.a === id || road.b === id));
          return (
            <g key={id} onPointerDown={grab(id)} className="pin">
              <circle className="hit" cx={q.x} cy={q.y} r="12" />
              <circle className={'lot' + (q0.riv ? ' riv' : '') + (on ? ' target' : '')} cx={q.x} cy={q.y} r={on ? 5 : 4.2} />
              <NodeKey q={q} name={byId[id]?.name || id} W={L.W} />
            </g>
          );
        })}
      </svg>

      <div className="boardPanel">
        {road ? (
          <>
            <div className="carName">
              {byId[road.a]?.name} — {byId[road.b]?.name}
            </div>
            <div className="numRow">
              <Num label="Hours" value={road.h === '' ? '' : hrs} onChange={(v) => setH(road, v, mins)} />
              <Num label="Minutes" value={road.h === '' ? '' : mins} onChange={(v) => setH(road, hrs, v)} />
            </div>
            <button className="btn ghost danger mt-s" onClick={() => (s.set({ roads: roads.filter((r) => r.id !== road.id) }), setSel(null))}>
              Remove road
            </button>
          </>
        ) : node ? (
          <>
            {mine(node.id) ? (
              <div className="row">
                <Field label="Name" value={node.name} onChange={(e) => s.patch('places', node.id, { name: e.target.value })} />
                <div className="numRow">
                  <Num label="River mile" value={node.mile ?? ''} onChange={(v) => s.patch('places', node.id, { mile: v === '' ? null : v })} />
                </div>
              </div>
            ) : (
              <div className="carName">
                {node.name}
                {emile(node) >= 0 ? <span className="muted"> · mile {emile(node)}</span> : null}
              </div>
            )}
            <div className="chips">
              {roads
                .filter((r) => r.a === node.id || r.b === node.id)
                .map((r) => (
                  <button key={r.id} className="chip" onClick={() => setSel({ road: r.id })}>
                    {byId[r.a === node.id ? r.b : r.a]?.name}
                    {num(r.h) > 0 ? ` · ${hm(num(r.h))}` : ''}
                  </button>
                ))}
            </div>
            <span className="muted">Tap another place to add a road</span>
            {mine(node.id) ? (
              <button
                className="btn ghost danger mt-s"
                onClick={() => {
                  const { [node.id]: _, ...g } = net.grid;
                  s.set({ places: t.places.filter((p) => p.id !== node.id), roads: roads.filter((r) => r.a !== node.id && r.b !== node.id), grid: g });
                  setSel(null);
                }}
              >
                Remove place
              </button>
            ) : null}
          </>
        ) : (
          <span className="muted">Drag to move · tap two places to connect</span>
        )}
        <div className="row mt-s">
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a place" />
          <button
            className="btn"
            disabled={!name.trim()}
            onClick={() => {
              s.push('places', { name: name.trim() });
              setName('');
            }}
          >
            Add
          </button>
        </div>
        <button className="btn mt-s" onClick={onDone}>
          Done
        </button>
      </div>
    </>
  );
}

const TruckPaths = () => (
  <>
    <path d="M2 13h28M4.5 13a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0M21 13a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0" />
    <path d="M2 13V3.5h20V13M22 6.5h6l4 4V13" />
    <path d="M32 13h12M34 13a2 2 0 1 0 4 0 2 2 0 1 0-4 0" />
    <path d="M32 12.5V7h11v5.5z" />
</>
);

const TruckIcon = () => (
  <svg className="carIcon" viewBox="0 0 46 18" aria-hidden="true">
    <TruckPaths />
  </svg>
);

function Stage({ S, s }) {
  const [u, setU] = useState(0);
  const [play, setPlay] = useState(false);
  const [edit, setEdit] = useState(false);
  const { U, tOf, stops, start, N, legs, byId, people, mileAt, at } = S;
  const L = useMemo(() => plan(S), [S]);
  useEffect(() => {
    if (!play) return;
    let last = performance.now();
    let id = 0;
    const step = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setU((v) => {
        if (v + dt >= U) {
          setPlay(false);
          return U;
        }
        return v + dt;
      });
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [play, U]);

  const tt = tOf(Math.min(u, U));
  const iso = addDays(start, Math.floor(tt));
  const rolling = legs.filter((l) => tt >= l.t0 && tt <= l.t1);
  const afloat = people.filter((m) => {
    const a = at(m, tt);
    return a && a.at === 'river' && a.to == null;
  }).length;
  const idle = afloat ? `Mile ${mileAt(tt).toFixed(1)} · ${afloat} on the water` : tt < 0 ? 'Heading for the river' : tt > N ? 'Heading home' : '';
  const jump = (dir) => {
    const to = dir > 0 ? stops.find((x) => x > u + 0.05) : [...stops].reverse().find((x) => x < u - 0.6);
    setU(to == null ? (dir > 0 ? U : 0) : to);
  };

  if (edit)
    return (
      <div className="stageWrap">
        <Board S={S} s={s} onDone={() => setEdit(false)} />
      </div>
    );

  return (
    <div className="stageWrap">
      <Story S={S} L={L} tt={tt} />
      <div className="playRow">
        <button className="skip" onClick={() => jump(-1)} aria-label="Previous move">
          ‹
        </button>
        <button
          className="play"
          onClick={() => {
            if (!play && u >= U) setU(0);
            setPlay(!play);
          }}
          aria-label={play ? 'Pause' : 'Play'}
        >
          {play ? '❙❙' : '▶'}
        </button>
        <button className="skip" onClick={() => jump(1)} aria-label="Next move">
          ›
        </button>
        <input
          className="scrub"
          type="range"
          min="0"
          max={U}
          step="0.02"
          value={u}
          onChange={(e) => {
            setPlay(false);
            setU(+e.target.value);
          }}
        />
        <button className="skip" onClick={() => (setPlay(false), setEdit(true))} aria-label="Edit roads">
          ✎
        </button>
      </div>
      <div className="dayKey">
        <span>{fmt(iso)}</span>
        {rolling.map((l) => {
          const who = (l.who || []).length;
          const bo = (l.boats || []).length;
          const tail = [who ? `${who} aboard` : l.pro ? 'shuttle service' : null, bo ? `${bo} boat${bo > 1 ? 's' : ''}` : null, l.gear ? 'gear' : null].filter(Boolean).join(' · ');
          return (
            <span className="move" key={l.car.id + l.t0}>
              <i style={{ background: l.car.tint }} />
              <b>{l.car.name}</b> {byId[l.from]?.name} → {byId[l.to]?.name}
              {tail ? <em> {tail}</em> : null}
            </span>
          );
        })}
        {!rolling.length && idle ? <span className="muted">{idle}</span> : null}
      </div>
    </div>
  );
}

function Shuttle({ s }) {
  const t = s.trip;
  const [openLeg, setOpenLeg] = useState(null);
  const [openCar, setOpenCar] = useState(null);
  const [carName, setCarName] = useState('');
  const S = useMemo(() => story(t), [t]);
  const { byId, places, launch, out, dates, start, N } = S;
  const cars = t.cars || [];
  const boats = t.boats || [];
  const legs = legsOf(t);
  const tint = (id) => S.cars.find((x) => x.id === id)?.tint;
  const carOf = (id) => cars.find((c) => c.id === id);
  const pname = (id) => byId[id]?.name || '—';
  const dtag = (d) => (d === start ? ' · launch' : d === addDays(start, N) ? ' · take-out' : '');
  const river = places.filter((p) => p.mile != null || p.toMile != null);
  const off = places.filter((p) => p.mile == null && p.toMile == null);
  const save = (list) => s.set({ legs: list, cars: cars.map(({ legs: _, ...c }) => c) });
  const setLeg = (id, patch) => save(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const dropLeg = (id) => save(legs.filter((l) => l.id !== id));
  const swap = (a, b) => {
    const i = legs.findIndex((l) => l.id === a),
      j = legs.findIndex((l) => l.id === b);
    const next = [...legs];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const addLeg = () => {
    const last = legs[legs.length - 1];
    const car = last?.car || cars[0]?.id || '';
    const prev = [...legs].reverse().find((l) => l.car === car);
    const l = { id: uid(), car, from: prev ? prev.to : off[0]?.id || '', to: '', date: last ? last.date : start, who: [], boats: [], gear: false, pro: false, par: false };
    save([...legs, l]);
    setOpenLeg(l.id);
  };

  const warn = [];
  boats.forEach((b) => {
    const e = S.boats.find((x) => x.id === b.id);
    const last = e && e.segs[e.segs.length - 1];
    if (!e || !e.segs.length) warn.push(`${b.name} never leaves the yard.`);
    else if (last && last.to === 'river') warn.push(`${b.name} is still on the river at the end.`);
  });
  if (launch && !S.legs.some((l) => l.to === launch.id && (l.boats || []).length)) warn.push(`No boats delivered to ${launch.name}.`);
  S.legs.forEach((l) => (l.stray || []).forEach((x) => warn.push(`${t.crew.find((m) => m.id === x)?.name || boats.find((b) => b.id === x)?.name} isn't at ${pname(l.from)} for the ${l.car.name} on ${fmt(l.date)}.`)));
  const gap = {};
  t.crew.forEach((m) => {
    const d = okDate(m.offDate) ? m.offDate : addDays(start, N);
    const p = m.off || out?.id;
    const there = legs.some((l) => l.date === d && (l.from === p || l.to === p));
    if (p && !there) (gap[`${p}|${d}`] = gap[`${p}|${d}`] || []).push(m.name);
  });
  Object.entries(gap).forEach(([k, who]) => {
    const [p, d] = k.split('|');
    warn.push(`Nothing at ${pname(p)} on ${fmt(d)} for ${who.length > 2 ? who.length + ' people getting off' : who.join(' and ')}.`);
  });
  const gone = new Set();
  S.legs.forEach((l) => {
    const k = [l.from, l.to].sort().join('|');
    if (l.from === l.to || gone.has(k) || S.net.drive(l.from, l.to)) return;
    gone.add(k);
    warn.push(`No road between ${pname(l.from)} and ${pname(l.to)}.`);
  });
  legs.forEach((l) => {
    const c = carOf(l.car);
    if (c && num(c.seats) && (l.who || []).length > num(c.seats)) warn.push(`${l.who.length} in the ${c.name} (${num(c.seats)} seats) on ${fmt(l.date)}.`);
  });

  const opts = (
    <>
      <option value="">—</option>
      <optgroup label="Off river">
        {off.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </optgroup>
      <optgroup label={RIVER.name}>
        {river.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </>
  );

  const days = [...new Set(legs.map((l) => l.date))].sort();

  return (
    <>
      <Stage S={S} s={s} />
      {warn.map((w, i) => (
        <div className="warn mt-s" key={i}>
          {w}
        </div>
      ))}

      <span className="label mt">Plan</span>
      {days.map((d) => {
        const mine = legs.filter((l) => l.date === d);
        const step = mine.map((l, i) => (i ? (l.par ? 0 : 1) : 1)).map((v, i, arr) => arr.slice(0, i + 1).reduce((x, y) => x + y, 0));
        return (
          <div key={d} className="dayBlock">
            <div className="dayHead">
              {fmt(d)}
              <span className="muted">{dtag(d)}</span>
            </div>
            {mine.map((l, i) => {
              const c = carOf(l.car);
              const isOpen = openLeg === l.id;
              const who = (l.who || []).length,
                nb = (l.boats || []).length;
              return (
                <div className={'grItem' + (isOpen ? ' open' : '')} key={l.id}>
                  <button className="leg" onClick={() => setOpenLeg(isOpen ? null : l.id)}>
                    <span className="legSeq">{l.par && i ? '‖' : step[i]}</span>
                    <span className="legDot" style={{ background: tint(l.car) }} />
                    <span className="carText">
                      <span className="carName">
                        {c?.name || 'No vehicle'} <span className="legWay">{pname(l.from)} → {pname(l.to)}</span>
                      </span>
                      <span className="muted">
                        {[hm(S.net.drive(l.from, l.to)?.h), who ? `${who} aboard` : l.pro ? 'shuttle service' : 'empty', nb ? `${nb} boat${nb > 1 ? 's' : ''}` : null, l.gear ? 'gear' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="grBody">
                      <div className="row">
                        <Sel label="Vehicle" value={l.car} onChange={(v) => setLeg(l.id, { car: v })}>
                          <option value="">—</option>
                          {cars.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </Sel>
                        <Sel label="Date" value={l.date} onChange={(v) => setLeg(l.id, { date: v })}>
                          {dates.map((x) => (
                            <option key={x} value={x}>
                              {fmt(x)}
                              {dtag(x)}
                            </option>
                          ))}
                        </Sel>
                      </div>
                      <div className="row">
                        <Sel label="From" value={l.from} onChange={(v) => setLeg(l.id, { from: v })}>
                          {opts}
                        </Sel>
                        <Sel label="To" value={l.to} onChange={(v) => setLeg(l.id, { to: v })}>
                          {opts}
                        </Sel>
                      </div>
                      <div className="chips">
                        {i > 0 && (
                          <button className={'chip' + (l.par ? ' on' : '')} onClick={() => setLeg(l.id, { par: !l.par })}>
                            Same time as the leg above
                          </button>
                        )}
                        {c?.kind !== 'outfitter' && (
                          <button className={'chip' + (l.pro ? ' on' : '')} onClick={() => setLeg(l.id, { pro: !l.pro })}>
                            Shuttle service drives
                          </button>
                        )}
                        <button className={'chip' + (l.gear ? ' on' : '')} onClick={() => setLeg(l.id, { gear: !l.gear })}>
                          Gear aboard
                        </button>
                      </div>
                      {c?.kind !== 'outfitter' && (
                        <>
                          <span className="label">Riding along</span>
                          <div className="chips">
                            {t.crew.map((m) => {
                              const on = (l.who || []).includes(m.id);
                              return (
                                <button key={m.id} className={'chip' + (on ? ' on' : '')} onClick={() => setLeg(l.id, { who: on ? l.who.filter((q) => q !== m.id) : [...(l.who || []), m.id] })}>
                                  {m.name}
                                </button>
                              );
                            })}
                            {!t.crew.length && <span className="muted">Add people on the Crew tab</span>}
                          </div>
                        </>
                      )}
                      <span className="label">Boats aboard</span>
                      <div className="chips">
                        {boats.map((b) => {
                          const on = (l.boats || []).includes(b.id);
                          return (
                            <button key={b.id} className={'chip' + (on ? ' on river' : '')} onClick={() => setLeg(l.id, { boats: on ? l.boats.filter((q) => q !== b.id) : [...(l.boats || []), b.id] })}>
                              {b.name}
                            </button>
                          );
                        })}
                        {!boats.length && <span className="muted">Add boats on the Crew tab</span>}
                      </div>
                      <div className="legTools">
                        <button className="btn ghost" disabled={i === 0} onClick={() => swap(l.id, mine[i - 1].id)}>
                          ▲
                        </button>
                        <button className="btn ghost" disabled={i === mine.length - 1} onClick={() => swap(l.id, mine[i + 1].id)}>
                          ▼
                        </button>
                        <button className="btn ghost danger" onClick={() => dropLeg(l.id)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <button className="btn ghost mt-s" onClick={addLeg} disabled={!cars.length}>
        Add leg
      </button>

      <span className="label mt">Vehicles</span>
      {cars.map((c) => (
        <div className={'grItem' + (openCar === c.id ? ' open' : '')} key={c.id}>
          <button className="car" onClick={() => setOpenCar(openCar === c.id ? null : c.id)}>
            <span className="carIconWrap" style={{ color: tint(c.id) }}>
              {c.kind === 'outfitter' ? <TruckIcon /> : <CarIcon trailer={c.trailer} />}
            </span>
            <span className="carText">
              <span className="carName">{c.name}</span>
              <span className="muted">
                {t.crew.find((x) => x.id === c.owner)?.name || (c.kind === 'outfitter' ? 'Delivers and collects boats' : 'No owner')}
                {num(c.seats) ? ` · ${num(c.seats)} seats` : ''}
                {c.trailer && c.kind !== 'outfitter' ? ' · trailer' : ''}
                {` · ${legs.filter((l) => l.car === c.id).length} legs`}
              </span>
            </span>
          </button>
          {openCar === c.id && (
            <div className="grBody">
              <Field label="Name" value={c.name} onChange={(e) => s.patch('cars', c.id, { name: e.target.value })} />
              {c.kind !== 'outfitter' && (
                <>
                  <span className="label">Owner</span>
                  <div className="chips">
                    {t.crew.map((x) => (
                      <button key={x.id} className={'chip' + (c.owner === x.id ? ' on' : '')} onClick={() => s.patch('cars', c.id, { owner: c.owner === x.id ? '' : x.id })}>
                        {x.name}
                      </button>
                    ))}
                  </div>
                  <div className="numRow">
                    <Num label="Seats" value={c.seats} onChange={(v) => s.patch('cars', c.id, { seats: v })} />
                  </div>
                  <div className="chips">
                    <button className={'chip' + (c.trailer ? ' on' : '')} onClick={() => s.patch('cars', c.id, { trailer: !c.trailer })}>
                      Towing a trailer
                    </button>
                  </div>
                </>
              )}
              <button
                className="btn ghost danger mt-s"
                onClick={() => {
                  save(legs.filter((l) => l.car !== c.id));
                  s.drop('cars', c.id);
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="row mt">
        <Field value={carName} onChange={(e) => setCarName(e.target.value)} placeholder="Add a vehicle" />
        <button
          className="btn"
          disabled={!carName.trim()}
          onClick={() => {
            s.push('cars', { name: carName.trim(), owner: '', seats: '', trailer: false });
            setCarName('');
          }}
        >
          Add
        </button>
      </div>
      {!cars.some((c) => c.kind === 'outfitter') && (
        <button className="btn ghost mt-s" onClick={() => s.push('cars', { name: 'Outfitter', kind: 'outfitter', owner: '', seats: '', trailer: true })}>
          Add an outfitter
        </button>
      )}

    </>
  );
}

function Ledger({ s }) {
  const t = s.trip;
  const pay = t.pay || [];
  const L = useMemo(() => ledger(t), [t]);
  const [what, setWhat] = useState('');
  const [by, setBy] = useState('');
  const [amt, setAmt] = useState('');
  const paid = {};
  t.crew.forEach((c) => (paid[c.id] = 0));
  pay.forEach((p) => (paid[p.by] = (paid[p.by] || 0) + num(p.amt)));
  const col = (k) => t.crew.reduce((a, c) => a + L.by[c.id][k], 0);
  const sum = { even: col('even'), personal: col('personal'), group: col('nights') + col('users') };
  const potted = Object.values(paid).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="tbl">
        <div className="tr th">
          <span className="tName">Crew</span>
          <span>Even</span>
          <span>Rental</span>
          <span>Group</span>
          <span>Total</span>
        </div>
        {t.crew.map((c) => {
          const b = L.by[c.id];
          return (
            <div className="tr" key={c.id}>
              <span className="tName">{c.name}</span>
              <span>{usd0(b.even)}</span>
              <span>{usd0(b.personal)}</span>
              <span>{usd0(b.nights + b.users)}</span>
              <span className="tSum">{usd0(b.total)}</span>
            </div>
          );
        })}
        <div className="tr tf">
          <span className="tName">{t.crew.length} on the river</span>
          <span>{usd0(sum.even)}</span>
          <span>{usd0(sum.personal)}</span>
          <span>{usd0(sum.group)}</span>
          <span className="tSum">{usd0(sum.even + sum.personal + sum.group)}</span>
        </div>
      </div>
      {L.loose > 0.005 && <div className="muted">{usd0(L.loose)} unassigned — no one has claimed those items.</div>}

      <span className="label mt">Paid in</span>
      <div className="tbl">
        <div className="tr2 th">
          <span className="tName">Crew</span>
          <span>Paid</span>
          <span>Owed</span>
          <span>Balance</span>
        </div>
        {t.crew.map((c) => {
          const d = (paid[c.id] || 0) - L.by[c.id].total;
          return (
            <div className="tr2" key={c.id}>
              <span className="tName">{c.name}</span>
              <span>{usd0(paid[c.id] || 0)}</span>
              <span>{usd0(L.by[c.id].total)}</span>
              <span className={'tSum' + (d < -0.5 ? ' owes' : '')}>{(d < 0 ? '−' : '+') + usd0(Math.abs(d))}</span>
            </div>
          );
        })}
      </div>

      {pay.map((p) => (
        <div className="gearRow" key={p.id}>
          <span className="gearName">
            {p.what}
            <span className="muted"> {t.crew.find((c) => c.id === p.by)?.name || '—'}</span>
          </span>
          <span className="grAmt">{usd0(num(p.amt))}</span>
          <button className="x" onClick={() => s.drop('pay', p.id)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      {pay.length > 0 && <div className="muted">{usd0(potted)} paid in so far</div>}

      <div className="mt">
        <Field value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Expense" />
        <div className="chips">
          {t.crew.map((c) => (
            <button key={c.id} className={'chip' + (by === c.id ? ' on' : '')} onClick={() => setBy(by === c.id ? '' : c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="row">
          <label className="field narrow">
            <input inputMode="decimal" value={amt} placeholder="0" onChange={(e) => setAmt(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={!what.trim() || !by || !num(amt)}
            onClick={() => {
              s.push('pay', { what: what.trim(), by, amt: num(amt) });
              setWhat('');
              setAmt('');
            }}
          >
            Add
          </button>
        </div>
      </div>
    </>
  );
}

const REF_NOTE = {
  'Shopping list': 'Draft list from the sheet. The day names (Friday, Saturday...) predate the current menu dates, so match items to meals by name.',
  'Crew Council': 'Notes are kept as recorded; plans changed over time, so check the Itinerary and Shuttle tabs for the current plan.',
};

function InfoSection({ sec }) {
  return (
    <Acc title={sec.title} note={sec.kv ? null : sec.rows ? `${sec.rows.length}` : null}>
      {sec.kv && <Pairs data={sec.kv} />}
      {sec.rows &&
        sec.rows.map((r, i) => (
          <div className="pair" key={i}>
            <div className="pairKey">{r[0]}</div>
            {sec.cols.slice(1).map((c, j) =>
              r[j + 1] ? (
                <div className="line" key={j}>
                  <span className="muted">{c}: </span>
                  {r[j + 1]}
                </div>
              ) : null
            )}
          </div>
        ))}
      {sec.text && <div className="line pre">{sec.text}</div>}
      {sec.foot ? <div className="muted mt">{sec.foot}</div> : null}
    </Acc>
  );
}

function Info({ s }) {
  const ref = REFS[s.trip.id];
  const groups = ref ? [...new Set(ref.sections.map((x) => x.group))] : [];
  const [g, setG] = useState(groups[0]);
  if (!ref) return <div className="muted">No reference notes for this trip.</div>;
  return (
    <>
      <div className="chips">
        {groups.map((x) => (
          <button key={x} className={'chip' + (g === x ? ' on' : '')} onClick={() => setG(x)}>
            {x}
          </button>
        ))}
      </div>
      {REF_NOTE[g] ? <div className="muted mt">{REF_NOTE[g]}</div> : null}
      <div className="mt">
        {ref.sections.filter((x) => x.group === g).map((x, i) => (
          <InfoSection sec={x} key={g + i} />
        ))}
      </div>
    </>
  );
}

function Log({ s }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(today());
  return (
    <>
      <Field area value={text} onChange={(e) => setText(e.target.value)} placeholder="Today" />
      <div className="row">
        <Field value={date} onChange={(e) => setDate(e.target.value)} className="narrow" />
        <button
          className="btn"
          disabled={!text.trim()}
          onClick={() => {
            s.push('log', { date, text: text.trim() });
            setText('');
          }}
        >
          Save
        </button>
      </div>
      {[...s.trip.log].reverse().map((e) => (
        <div className="entry" key={e.id}>
          <div className="entryHead">
            <span className="label">{fmt(e.date)}</span>
            <button className="x" onClick={() => s.drop('log', e.id)} aria-label="Remove">
              ✕
            </button>
          </div>
          <div className="line">{e.text}</div>
        </div>
      ))}
    </>
  );
}

function Settings({ s }) {
  const t = s.trip;
  return (
    <>
      <Field label="Name" value={t.name} onChange={(e) => s.set({ name: e.target.value })} />
      <Field label="Permit holder" value={t.permit ?? ''} onChange={(e) => s.set({ permit: e.target.value })} />
      <Sel
        label="River"
        value={riverOf(t)}
        onChange={(v) => {
          const planned = Object.values(t.plans || {}).some((p) => p.camp);
          if (planned && !window.confirm('Switching rivers clears the launch, take-out and camp picks for this trip. Continue?')) return;
          const plans = Object.fromEntries(Object.entries(t.plans || {}).map(([k, p]) => [k, { ...p, camp: undefined }]));
          s.set({ river: v, launch: undefined, out: undefined, plans });
        }}
      >
        {s.riverList().map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Sel>

      {s.trips.length > 1 && (
        <div className="mt">
          <span className="label">Trips</span>
          {s.trips.map((x) => (
            <button className="pick" key={x.id} onClick={() => s.activate(x.id)}>
              <span style={x.id === t.id ? { fontWeight: 700 } : null}>{x.name}</span>
            </button>
          ))}
        </div>
      )}

      {t.id === SEED.id && (
        <div className="mt">
          <button
            className="btn ghost"
            onClick={() =>
              window.confirm('Replace crew, boats, cars, gear, meals, payments and day notes with the planning-sheet data? Your log entries are kept.') &&
              s.set({ crew: SEED.crew, boats: SEED.boats, cars: SEED.cars, places: SEED.places, gear: SEED.gear, meals: SEED.meals, pay: SEED.pay, plans: SEED.plans })
            }
          >
            Reload planning-sheet data
          </button>
        </div>
      )}

      <div className="row mt">
        <button className="btn ghost" onClick={() => s.create({ name: 'Untitled', start: today(), days: 7, river: riverOf(t) })}>
          New trip
        </button>
        <button className="btn ghost danger" onClick={() => s.remove(t.id)}>
          Delete
        </button>
      </div>
    </>
  );
}

/* ---------- river ---------- */

function River({ s, browse, onBrowse, onPlan }) {
  const [tab, setTab] = useState('Map');
  const P = { Rapids, Camps, Hikes, Geology, Guide, Almanac, Rules }[tab];
  // the trip's camp plan only means something on the trip's own river
  const sm = riverOf(s.trip) === RIVER.id ? s : { ...s, trip: null };
  const empty = {
    Rapids: !RIVER.rapids.length,
    Camps: !RIVER.camps.length,
    Hikes: !RIVER.hikes.length,
    Geology: !RIVER.geology.length,
    Guide: !RIVER.guide.length,
    Almanac: !Object.keys(RIVER.almanac).length,
    Rules: !RIVER.rules.length,
  }[tab];
  return (
    <>
      <Tabs
        items={['Rivers', 'Map', 'Rapids', 'Camps', 'Hikes', 'Geology', 'Guide', 'Almanac', 'Rules']}
        value={tab}
        onChange={setTab}
        tint="#2f5d62"
      />
      {tab === 'Rivers' ? (
        <Rivers
          s={s}
          browse={RIVER.id}
          onBrowse={(id) => {
            onBrowse(id);
            setTab('Map');
          }}
          onPlan={onPlan}
        />
      ) : tab === 'Map' ? (
        <RiverMap s={sm} />
      ) : empty ? (
        <div className="pad">
          <div className="serif">{RIVER.name}</div>
          <div className="muted mt">Nothing recorded here yet. Add entries from Rivers → Edit, or import a river JSON.</div>
        </div>
      ) : (
        <div className="pad"><P /></div>
      )}
    </>
  );
}

/* ---------- map — ported from the original HTML app ---------- */

const PPM = 21;
const TOPPAD = 22;
const BOTPAD = 30;
const QCOLORS = ['#cbbf9a', '#bdba84', '#aab472', '#96ac62', '#82a455', '#6f9a4e', '#5b8a48', '#477841', '#33653a'];
const HQCOLORS = ['#dcb096', '#c98b66', '#b26840', '#9a4a28', '#74301a'];
const RAPIDCOL = '#3a6f92';

const clamp15 = (v) => Math.max(1, Math.min(5, v));
const clamp19 = (v) => Math.max(1, Math.min(9, v));
const qColor = (q) => (q == null ? '#b4a98f' : QCOLORS[clamp19(q) - 1]);
const hColor = (q) => (q == null ? '#c9a68f' : HQCOLORS[clamp15(q) - 1]);
const hStars = (q) => (q == null ? '—' : '★'.repeat(clamp15(q)) + '☆'.repeat(5 - clamp15(q)));
const hBank = (b) => (b === 'R' ? 'River Right' : b === 'L' ? 'River Left' : '—');
const hTime = (t) => {
  if (t == null) return '—';
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  return m === 60 ? h + 1 + ':00' : h + ':' + String(m).padStart(2, '0');
};
const sizeWord = (s) => (s == null ? '' : s <= 2 ? 'small' : s <= 5 ? 'mid-sized' : s <= 7 ? 'large' : 'very large');
const qualWord = (q) => (q == null ? '' : q <= 3 ? 'basic' : q <= 6 ? 'good' : q <= 8 ? 'excellent' : 'premier');

// mile 0 at the bottom, downstream up the page
const y = (m) => TOPPAD + (MAXMILE - m) * PPM;

const FMAX = { q: 9, s: 9, d: 9, hq: 5, hd: 5 };
const FCAT = { q: 'c', s: 'c', d: 'r', hq: 'h', hd: 'h' };
const FNAME = { q: 'camp qual', s: 'camp size', d: 'rapid diff', hq: 'hike qual', hd: 'hike diff' };
const CATNAME = { c: 'camps', r: 'rapids', h: 'hikes' };
const full = (k) => new Set(Array.from({ length: FMAX[k] }, (_, i) => i + 1));
const allOn = () => ({ q: full('q'), s: full('s'), d: full('d'), hq: full('hq'), hd: full('hd') });

function RiverMap({ s }) {
  const [sets, setSets] = useState(allOn);
  const [hide, setHide] = useState({ c: false, r: false, h: false });
  const [sheet, setSheet] = useState(null);
  const [sel, setSel] = useState(null);
  const [filters, setFilters] = useState(false);
  const [mile, setMile] = useState(0);
  const [width, setWidth] = useState(0);
  const scroller = useRef(null);
  const chart = useRef(null);

  const planned = useMemo(
    () => new Set(Object.values(s.trip?.plans || {}).filter((p) => p.camp).map((p) => p.camp)),
    [s.trip]
  );

  useEffect(() => {
    const measure = () => setWidth(chart.current ? chart.current.clientWidth : 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // open at mile 0 — the bottom of the chart, where the trip starts
  useEffect(() => {
    const el = scroller.current;
    if (el && width) el.scrollTop = el.scrollHeight;
  }, [width]);

  const riverX = Math.round(width * 0.5);
  const barMaxR = width - riverX - 15;
  const barMaxL = riverX - 30;

  const onScroll = (e) => {
    const el = e.currentTarget;
    const ref = el.clientHeight * 0.75;
    const m = MAXMILE - (el.scrollTop + ref - TOPPAD) / PPM;
    setMile(Math.max(0, Math.min(MAXMILE, m)));
  };

  const toggle = (kind, d) =>
    setSets((prev) => {
      const next = { ...prev, [kind]: new Set(prev[kind]) };
      if (next[kind].has(d)) next[kind].delete(d);
      else {
        next[kind].add(d);
        setHide((h) => ({ ...h, [FCAT[kind]]: false }));
      }
      return next;
    });

  const groupAll = (kinds) => {
    setSets((prev) => {
      const next = { ...prev };
      kinds.forEach((k) => (next[k] = full(k)));
      return next;
    });
    setHide((h) => {
      const n = { ...h };
      kinds.forEach((k) => (n[FCAT[k]] = false));
      return n;
    });
  };
  const groupNone = (kinds) => {
    setSets((prev) => {
      const next = { ...prev };
      kinds.forEach((k) => (next[k] = new Set()));
      return next;
    });
    setHide((h) => {
      const n = { ...h };
      kinds.forEach((k) => (n[FCAT[k]] = true));
      return n;
    });
  };

  const badge = useMemo(() => {
    const parts = [];
    let n = 0;
    Object.keys(hide).forEach((c) => {
      if (hide[c]) {
        n++;
        parts.push(CATNAME[c] + ' hidden');
      }
    });
    Object.keys(sets).forEach((k) => {
      if (hide[FCAT[k]]) return;
      const set = sets[k];
      if (set.size < FMAX[k]) {
        n++;
        const v = [...set].sort((a, b) => a - b);
        const contiguous = v.length > 1 && v[v.length - 1] - v[0] === v.length - 1;
        parts.push(FNAME[k] + ' ' + (v.length === 0 ? 'none' : contiguous ? v[0] + '–' + v[v.length - 1] : v.join(',')));
      }
    });
    return { n, text: n === 0 ? 'Showing everything' : parts.join(' · ') };
  }, [sets, hide]);

  const geoLabels = useMemo(() => {
    let prevTop = Infinity;
    let slot = 0;
    return RIVER.geology.map((g) => {
      const hi = Math.min(g.e, MAXMILE);
      const cy = y((g.s + hi) / 2);
      const estW = g.n.length * 5.2 + 12;
      if (cy + estW / 2 > prevTop + 2) slot = slot ? 0 : 1;
      else slot = 0;
      prevTop = cy - estW / 2;
      return { g, hi, cy, slot };
    });
  }, []);

  // stack markers that share a mile so each stays tappable
  const rapidNudge = useMemo(() => {
    const cnt = {};
    RIVER.rapids.forEach((d) => (cnt[d.mile] = (cnt[d.mile] || 0) + 1));
    const seen = {};
    return RIVER.rapids.map((d) => {
      if (cnt[d.mile] < 2) return 0;
      const i = seen[d.mile] || 0;
      seen[d.mile] = i + 1;
      return (i - (cnt[d.mile] - 1) / 2) * 6;
    });
  }, []);

  const campNudge = useMemo(() => {
    const side = (c) => (c.bank === 'R' ? 'R' : 'L');
    const cnt = {};
    RIVER.camps.forEach((c) => {
      const k = c.mile + side(c);
      cnt[k] = (cnt[k] || 0) + 1;
    });
    const seen = {};
    return RIVER.camps.map((c) => {
      const k = c.mile + side(c);
      if (cnt[k] < 2) return 0;
      const i = seen[k] || 0;
      seen[k] = i + 1;
      return (i - (cnt[k] - 1) / 2) * 6;
    });
  }, []);

  const hikeTops = useMemo(() => {
    const last = { L: -1e9, R: -1e9 };
    const sorted = RIVER.hikes.map((h, i) => ({ h, i })).sort((a, b) => b.h.mile - a.h.mile);
    const tops = new Array(RIVER.hikes.length);
    sorted.forEach(({ h, i }) => {
      const side = h.bank === 'R' ? 'R' : 'L';
      let top = y(h.mile);
      if (Math.abs(top - last[side]) < 8) top = last[side] + 8;
      last[side] = top;
      tops[i] = top;
    });
    return tops;
  }, []);

  const campVis = (c) =>
    !hide.c && (c.qual == null || sets.q.has(clamp19(c.qual))) && (c.size == null || sets.s.has(clamp19(c.size)));
  const hikeVis = (h) =>
    !hide.h && (h.qual == null || sets.hq.has(clamp15(h.qual))) && (h.diff == null || sets.hd.has(clamp15(h.diff)));

  const open = (kind, item, key) => {
    setSel(key);
    setSheet({ kind, item });
  };

  return (
    <div className="gcmap">
      <header id="mapHeader">
        <div className="htop">
          <div className="htitle">{/river/i.test(RIVER.name) ? RIVER.name : RIVER.name + " River"} Map</div>
          <div className="hreach">
            <span id="hmile">Mile {Math.round(mile)}</span>
          </div>
        </div>
        <div className="keys">
          <div className="kgrp">
            <span className="klabel">Camps</span>
            <div className="kbar kqual" />
            <span className="knote">bank · color = quality · length = size</span>
          </div>
          <div className="kgrp">
            <span className="klabel">Rapids</span>
            <div className="kbar krapid" />
            <span className="knote">both banks · width = difficulty</span>
          </div>
          <div className="kgrp">
            <span className="klabel">Hikes</span>
            <div className="kbar khike" />
            <span className="knote">bank · length = difficulty · darker = quality</span>
          </div>
        </div>
        <div className="fbar">
          <button className={'fbtn' + (badge.n ? ' on' : '')} type="button" onClick={() => setFilters(true)}>
            <span className="fico">☰</span>
            <span>Filters</span>
            <span className="fcount">{badge.n}</span>
          </button>
          <span className="fsum">{badge.text}</span>
        </div>
      </header>

      <div className="mapWindow" ref={scroller} onScroll={onScroll}>
        <div className="plot">
          <div className="chart" ref={chart} style={{ height: TOPPAD + MAXMILE * PPM + BOTPAD }}>
            {RIVER.clusters.map((cl) => (
              <React.Fragment key={cl.n}>
                <div className="cluster" style={{ top: y(cl.e), height: (cl.e - cl.s) * PPM, left: riverX, right: 0 }} />
                <div className="clusterLabel" style={{ right: 11, top: y((cl.s + cl.e) / 2) }}>
                  {cl.n}
                </div>
              </React.Fragment>
            ))}

            {geoLabels.map(({ g, hi, cy, slot }, i) => (
              <React.Fragment key={i}>
                <div
                  className={'gband' + (sel === 'g' + i ? ' sel' : '')}
                  style={{
                    top: y(hi),
                    height: (hi - g.s) * PPM,
                    left: 0,
                    width: riverX,
                    background: `color-mix(in srgb, ${g.c} 14%, transparent)`,
                    borderTop: `1.5px dashed color-mix(in srgb, ${g.c} 42%, transparent)`,
                    borderBottom: `1.5px dashed color-mix(in srgb, ${g.c} 42%, transparent)`,
                  }}
                  onClick={() => open('geo', { ...g, hi }, 'g' + i)}
                />
                <div className="gbandLabel" style={{ left: 11 + slot * 15, top: cy }}>
                  {g.n}
                </div>
              </React.Fragment>
            ))}

            <div className="river" style={{ left: riverX - 5.5, width: 11, top: y(MAXMILE), height: MAXMILE * PPM }} />
            {Array.from({ length: Math.floor((MAXMILE - 10) / 13) + 1 }, (_, i) => 6 + i * 13).map((m) => (
              <div className="flow" key={m} style={{ left: riverX, top: y(m) - 3 }} />
            ))}

            {!hide.r &&
              RIVER.rapids.map((d, i) => {
                if (!sets.d.has(d.diff)) return null;
                const armL = Math.max(7, (barMaxL * d.diff) / 9);
                const armR = Math.max(7, (barMaxR * d.diff) / 9);
                const light = `color-mix(in srgb, ${RAPIDCOL} 78%, #dceaf1 22%)`;
                return (
                  <div
                    key={'r' + i}
                    className={'bar rapid' + (sel === 'r' + i ? ' sel' : '')}
                    style={{ left: riverX - armL, width: armL + armR, top: y(d.mile) - 7 + rapidNudge[i], height: 14 }}
                    onClick={() => open('rapid', d, 'r' + i)}
                  >
                    <div
                      className="stick"
                      style={{ background: `linear-gradient(to right, ${light}, ${RAPIDCOL} 50%, ${light})` }}
                    />
                  </div>
                );
              })}

            {RIVER.camps.map((c, i) => {
              if (!campVis(c)) return null;
              const right = c.bank === 'R';
              const len = c.size == null ? 11 : Math.max(8, (((right ? barMaxR : barMaxL) - 4) * c.size) / 9);
              const col = qColor(c.qual);
              const light = `color-mix(in srgb, ${col} 78%, #f3efd6 22%)`;
              return (
                <div
                  key={'c' + i}
                  className={'bar camp ' + (right ? 'bright' : 'bleft') + (sel === 'c' + i ? ' sel' : '')}
                  style={{
                    left: right ? riverX + 4 : riverX - 4 - len,
                    width: len,
                    top: y(c.mile) - 7 + campNudge[i],
                    height: 14,
                  }}
                  onClick={() => open('camp', c, 'c' + i)}
                >
                  <div
                    className="stick"
                    style={{
                      background: `linear-gradient(to ${right ? 'right' : 'left'}, ${col}, ${light})`,
                      boxShadow: planned.has(c.name) ? '0 0 0 1.4px #2c1b0f' : undefined,
                    }}
                  />
                </div>
              );
            })}

            {RIVER.landmarks.map((d, i) => (
              <div
                key={'l' + i}
                className={'lm' + (sel === 'l' + i ? ' sel' : '')}
                style={{ left: riverX - 5, top: y(d.mile) - 11 }}
                onClick={() => open('rapid', d, 'l' + i)}
              >
                <span className="ld" />
                <span className="lpill">{d.name.replace(/ Boat Ramp| - Water Refill/, '')}</span>
              </div>
            ))}

            {RIVER.hikes.map((h, i) => {
              if (!hikeVis(h)) return null;
              const right = h.bank === 'R';
              const w = h.diff == null ? 11 : Math.max(8, (((right ? barMaxR : barMaxL) - 4) * clamp15(h.diff)) / 5);
              return (
                <div
                  key={'h' + i}
                  className={'hike ' + (right ? 'bright' : 'bleft') + (sel === 'h' + i ? ' sel' : '')}
                  style={{ left: right ? riverX + 4 : riverX - 4 - w, width: w, top: hikeTops[i] - 9, height: 18 }}
                  onClick={() => open('hike', h, 'h' + i)}
                >
                  <div className="hdash" style={{ background: hColor(h.qual) }} />
                </div>
              );
            })}
          </div>
          <div className="foot">Scroll up to travel downstream — tap any marker</div>
        </div>
      </div>

      <div className={'fsheetWrap' + (filters ? ' show' : '')} onClick={(e) => e.target === e.currentTarget && setFilters(false)}>
        <div className="fsheet">
          <div className="fshead">
            <div className="fstitle">Map Filters</div>
            <div className="fsclose" onClick={() => setFilters(false)}>
              ×
            </div>
          </div>

          <FSec title="Camps" onAll={() => groupAll(['q', 's'])} onNone={() => groupNone(['q', 's'])}>
            <FGrp name="Quality" kind="q" sets={sets} toggle={toggle} />
            <FGrp name="Size" kind="s" sets={sets} toggle={toggle} />
          </FSec>
          <FSec title="Rapids" onAll={() => groupAll(['d'])} onNone={() => groupNone(['d'])}>
            <FGrp name="Difficulty" kind="d" sets={sets} toggle={toggle} />
          </FSec>
          <FSec title="Hikes" onAll={() => groupAll(['hq', 'hd'])} onNone={() => groupNone(['hq', 'hd'])}>
            <FGrp name="Quality" kind="hq" sets={sets} toggle={toggle} />
            <FGrp name="Difficulty" kind="hd" sets={sets} toggle={toggle} />
          </FSec>

          <div className="fshint">
            Tap a number to hide it · camp quality &amp; size run 1–9, hikes run 1–5. Items with no rating stay on the
            map unless you use Hide all, which clears the whole category.
          </div>

          <div className="fsfoot">
            <button
              className="tsbtn"
              type="button"
              onClick={() => {
                setSets(allOn());
                setHide({ c: false, r: false, h: false });
              }}
            >
              Reset all
            </button>
            <button className="tsbtn solid" type="button" onClick={() => setFilters(false)}>
              Done
            </button>
          </div>
        </div>
      </div>

      <DetailSheet
        sheet={sheet}
        onClose={() => {
          setSheet(null);
          setSel(null);
        }}
      />
    </div>
  );
}

const FSec = ({ title, onAll, onNone, children }) => (
  <div className="fsec">
    <div className="fseckicker">
      {title}
      <span className="fsecbtns">
        <span className="fseclink" onClick={onAll}>
          Show all
        </span>
        <span className="fseclink hide" onClick={onNone}>
          Hide all
        </span>
      </span>
    </div>
    {children}
  </div>
);

function FGrp({ name, kind, sets, toggle }) {
  const max = FMAX[kind];
  return (
    <div className="fgrp">
      <span className="fgname">{name}</span>
      <div className="fgchips chips">
        {Array.from({ length: max }, (_, i) => i + 1).map((d) => {
          const off = !sets[kind].has(d);
          const style =
            kind === 'q'
              ? { background: QCOLORS[d - 1], color: d <= 4 ? '#3a2818' : '#f3efd6' }
              : kind === 'd'
                ? { background: RAPIDCOL, color: '#f3e6cf' }
                : kind === 'hq'
                  ? { background: HQCOLORS[d - 1], color: d <= 2 ? '#3a2818' : '#f3efd6' }
                  : kind === 'hd'
                    ? { background: '#c9a68f', color: '#3a2818' }
                    : { background: '#b3a585', color: '#3a2818' };
          return (
            <div
              key={d}
              className={'chip' + (max === 9 ? '' : ' sm') + (off ? ' off' : '')}
              style={style}
              onClick={() => toggle(kind, d)}
            >
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailSheet({ sheet, onClose }) {
  if (!sheet) return <div className="sheet" />;
  const { kind, item: d } = sheet;
  let name = '';
  let meta = null;
  let desc = null;
  let foot = '';

  if (kind === 'rapid') {
    name = d.name;
    meta = d.civ ? (
      <>
        <span>
          River Mile <b>{d.mile}</b>
        </span>
        <span>Landmark</span>
      </>
    ) : (
      <>
        <span>
          River Mile <b>{d.mile}</b>
        </span>
        <span>
          Difficulty <b>{d.diff}/9</b>
        </span>
        <span>{d.tier}</span>
      </>
    );
    desc = d.desc || '';
  } else if (kind === 'camp') {
    name = d.name;
    const sw = sizeWord(d.size);
    const qw = qualWord(d.qual);
    meta = (
      <>
        <span>
          River Mile <b>{d.mile}</b>
        </span>
        <span>
          <span className="qdot" style={{ background: qColor(d.qual) }} />
          Quality <b>{d.qual == null ? '—' : d.qual + '/9'}</b>
        </span>
        <span>
          Size <b>{d.size == null ? '—' : d.size + '/9'}</b>
        </span>
        <span>
          River <b>{d.bank === 'R' ? 'right' : 'left'}</b>
        </span>
      </>
    );
    desc = sw && qw ? `A ${sw}, ${qw} campsite.` : 'Camp size and quality not recorded for this site.';
    if (/Hualapai Permit/i.test(d.name)) desc += ' Requires a Hualapai permit.';
    foot = RIVER.notes.camp;
  } else if (kind === 'geo') {
    name = d.full;
    meta = (
      <>
        <span>
          River Mile <b>{d.s}–{d.hi}</b>
        </span>
        <span>{d.era}</span>
        <span>{d.age}</span>
      </>
    );
    desc = d.d;
  } else if (kind === 'hike') {
    name = d.name;
    meta = (
      <>
        <span>
          River Mile <b>{d.mile}</b>
        </span>
        <span>{hBank(d.bank)}</span>
        <span>
          Est. Time: <b>{hTime(d.time)}</b>*
        </span>
        <span>
          <span className="qdot" style={{ background: hColor(d.qual) }} />
          Quality <b className="stars">{hStars(d.qual)}</b>
        </span>
      </>
    );
    desc = (
      <>
        <div className="hdiff">
          <b>Difficulty {d.diff}/5</b> — {RIVER.hdiff[d.diff] || ''}
        </div>
        <div>{d.desc || ''}</div>
      </>
    );
    foot = RIVER.notes.hike;
  }

  return (
    <div className="sheet show">
      <div className="grab" />
      <span className="close" onClick={onClose}>
        ×
      </span>
      <div className="iname">{name}</div>
      <div className="imeta">{meta}</div>
      <div className="idesc">{desc}</div>
      <div className="ifoot" style={{ whiteSpace: 'pre-line' }}>
        {foot}
      </div>
    </div>
  );
}

function Search({ data, placeholder, render }) {
  const [q, setQ] = useState('');
  const hits = useMemo(
    () => data.filter((x) => x.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.mile - b.mile),
    [q, data]
  );
  return (
    <>
      <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {hits.map(render)}
    </>
  );
}

const Rapids = () => (
  <Search
    data={RIVER.rapids}
    placeholder="Rapid"
    render={(r, i) => (
      <Acc
        key={i}
        title={`${r.mile.toFixed(1)}  ${r.name}`}
        note={`${r.tier} · ${r.diff}`}
        tag={r.diff >= 8 ? <Tag label="major" tint="#9c3326" /> : null}
      >
        <div className="line">{r.desc}</div>
      </Acc>
    )}
  />
);

const Camps = () => (
  <Search
    data={RIVER.camps}
    placeholder="Camp"
    render={(c, i) => (
      <div className="listRow" key={i}>
        <span className="mile">{c.mile.toFixed(1)}</span>
        <span>
          {c.name} <span className="muted">{c.bank} · size {c.size} · qual {c.qual}</span>
        </span>
      </div>
    )}
  />
);

const Hikes = () => (
  <Search
    data={RIVER.hikes}
    placeholder="Hike"
    render={(h, i) => (
      <Acc key={i} title={`${h.mile.toFixed(1)}  ${h.name}`} note={[h.bank, h.time, h.diff].filter(Boolean).join(' · ')}>
        <div className="line">{h.desc}</div>
      </Acc>
    )}
  />
);

const Geology = () =>
  RIVER.geology.map((g, i) => (
    <Acc key={i} title={g.full || g.n} note={`${g.s}–${g.e} · ${g.age}`}>
      <div className="swatch" style={{ background: g.c }} />
      <div className="line">{g.d}</div>
    </Acc>
  ));

function Guide() {
  const [g, setG] = useState(0);
  return (
    <>
      <div className="chips">
        {RIVER.guide.map((x, i) => (
          <button key={x.name} className={'chip' + (g === i ? ' on river' : '')} onClick={() => setG(i)}>
            {x.name}
          </button>
        ))}
      </div>
      {(RIVER.guide[g]?.subs || []).map((sub) => (
        <Acc key={sub.name} title={sub.name} note={String(sub.items.length)}>
          {sub.items.map((it, i) => (
            <div className="line mb-s" key={i}>
              <b>{it.n}</b> {it.d}
            </div>
          ))}
        </Acc>
      ))}
    </>
  );
}

function Almanac() {
  const keys = Object.keys(RIVER.almanac);
  const [k, setK] = useState(keys[0]);
  return (
    <>
      <div className="chips">
        {keys.map((x) => (
          <button key={x} className={'chip' + (k === x ? ' on river' : '')} onClick={() => setK(x)}>
            {x}
          </button>
        ))}
      </div>
      {(RIVER.almanac[k] || []).map(([title, body], i) => (
        <Acc key={i} title={title}>
          <div className="line pre">{clean(body)}</div>
        </Acc>
      ))}
    </>
  );
}

const Rules = () =>
  RIVER.rules.map((g) => (
    <div className="mt" key={g.name}>
      <span className="label">{g.name}</span>
      {g.rules.map((r, i) => (
        <Acc key={i} title={r.t}>
          <div className="line">{clean(r.d)}</div>
        </Acc>
      ))}
    </div>
  ));

/* ---------- general ---------- */

function General({ s }) {
  const [tab, setTab] = useState('Medical');
  return (
    <>
      <Tabs items={['Medical', 'Signals', 'Rescue', 'Swim', 'Gear', 'Card']} value={tab} onChange={setTab} tint="#9c3326" />
      <div className="pad">
        {tab === 'Medical' && <Medical />}
        {tab === 'Signals' && <Pairs data={GENERAL.signals} />}
        {tab === 'Rescue' && <Pairs data={GENERAL.rescue} numbered />}
        {tab === 'Swim' && <Pairs data={GENERAL.swim} />}
        {tab === 'Gear' && <GearRef />}
        {tab === 'Card' && <Card s={s} />}
      </div>
    </>
  );
}

function Medical() {
  const [q, setQ] = useState('');
  const groups = useMemo(
    () =>
      GENERAL.medical
        .map((g) => ({
          ...g,
          conditions: g.conditions.filter(
            (c) =>
              c.title.toLowerCase().includes(q.toLowerCase()) ||
              c.recognize.some((r) => r.toLowerCase().includes(q.toLowerCase()))
          ),
        }))
        .filter((g) => g.conditions.length),
    [q]
  );
  return (
    <>
      <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symptom or condition" />
      {groups.map((g) => (
        <div className="mt" key={g.name}>
          <span className="label">{g.name}</span>
          {g.conditions.map((c) => (
            <Acc key={c.title} title={c.title} tag={<Tag label={`E${c.evac}`} tint={EVAC[c.evac]} />}>
              {c.recognize.map((r, i) => (
                <div className="line" key={i}>• {r}</div>
              ))}
              <div className="rule" />
              {c.treat.map((r, i) => (
                <div className="line" key={i}>• {r}</div>
              ))}
            </Acc>
          ))}
        </div>
      ))}
    </>
  );
}

const Pairs = ({ data, numbered }) =>
  data.map(([a, b], i) => (
    <div className="pair" key={a}>
      <div className="pairKey">{numbered ? `${i + 1}. ${a}` : a}</div>
      <div className="line">{b}</div>
    </div>
  ));

const GearRef = () =>
  Object.entries(GENERAL.gear).map(([cat, items]) => (
    <div className="mt" key={cat}>
      <span className="label">{cat}</span>
      {items.map((x) => (
        <div className="line" key={x}>{x}</div>
      ))}
    </div>
  ));

const Card = ({ s }) => (
  <>
    <div className="card red">
      <div className="line">{RIVER.name} — {RIVER.reach}</div>
      <div className="line">{RIVER.coords[0].toFixed(5)}, {RIVER.coords[1].toFixed(5)}</div>
      <div className="line">{RIVER.agency}</div>
      <div className="muted mt">River mile and bank first.</div>
    </div>
    {s.trip && (
      <div className="card mt">
        <span className="label">{s.trip.name}</span>
        <div className="line">
          {s.trip.start} · {s.trip.days} days · {s.trip.crew.length} people
        </div>
        {s.trip.crew.map((c) => (
          <div className="mt-s" key={c.id}>
            <div className="line">
              <b>{c.name}</b>
              {c.boat ? ` · ${c.boat}` : ''}
            </div>
            {c.ice ? <div className="muted">{c.ice}</div> : null}
            {c.diet ? <div className="muted">{c.diet}</div> : null}
          </div>
        ))}
      </div>
    )}
  </>
);

/* ---------- trips list ---------- */

const riverOf = (t) => (t && t.river) || DEFAULT_RIVER;
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'river';

function NewTrip({ s, preset, onDone, onCancel }) {
  const rivers = s.riverList();
  const [rid, setRid] = useState(preset || (s.trip && riverOf(s.trip)) || DEFAULT_RIVER);
  const rec = rivers.find((r) => r.id === rid) || rivers[0];
  const [name, setName] = useState('');
  const [start, setStart] = useState(today());
  const [len, setLen] = useState(String(rec.days || 7));
  const [touched, setTouched] = useState(false);
  const n = parseInt(len, 10);
  const ok = okDate(start) && n > 0 && n <= 60;
  const fallback = `${rec.name} ${start.slice(0, 4)}`;
  return (
    <div className="pad">
      <h1>New trip</h1>
      <Sel
        label="River"
        value={rid}
        onChange={(v) => {
          setRid(v);
          if (!touched) setLen(String(rivers.find((r) => r.id === v)?.days || 7));
        }}
      >
        {rivers.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.reach ? ` — ${r.reach}` : ''}
          </option>
        ))}
      </Sel>
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={fallback} />
      <div className="row">
        <Field label="Launch" value={start} onChange={(e) => setStart(e.target.value)} placeholder="YYYY-MM-DD" />
        <Field
          label="Days"
          value={len}
          onChange={(e) => {
            setTouched(true);
            setLen(e.target.value);
          }}
          inputMode="numeric"
          className="narrow"
        />
      </div>
      <div className="row">
        <button
          className="btn"
          disabled={!ok}
          onClick={() => {
            s.create({ name: name.trim() || fallback, start, days: n, river: rid });
            onDone && onDone();
          }}
        >
          Create
        </button>
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Trips({ s, preset, clearPreset, onOpen }) {
  const [adding, setAdding] = useState(!!preset);
  useEffect(() => {
    if (preset) setAdding(true);
  }, [preset]);
  const rivers = s.riverList();
  const rname = (id) => rivers.find((r) => r.id === id)?.name || 'Unknown river';
  const groups = [...new Set(s.trips.map(riverOf))];
  const done = () => {
    setAdding(false);
    clearPreset();
  };
  return (
    <div className="pad">
      {adding ? (
        <NewTrip
          s={s}
          preset={preset}
          onCancel={done}
          onDone={() => {
            done();
            onOpen();
          }}
        />
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          + New trip
        </button>
      )}
      {!s.trips.length && !adding ? <div className="muted mt">No trips yet. Create one to start planning.</div> : null}
      {groups.map((g) => (
        <div className="mt" key={g}>
          <span className="label">{rname(g)}</span>
          {s.trips
            .filter((t) => riverOf(t) === g)
            .sort((a, b) => (a.start < b.start ? 1 : -1))
            .map((t) => (
              <div className="card mt" key={t.id}>
                <div className="serif" style={t.id === s.trip?.id ? { fontWeight: 700 } : null}>
                  {t.name}
                </div>
                <div className="muted">
                  {okDate(t.start) ? `${fmt(t.start)} ${t.start.slice(0, 4)} → ${fmt(addDays(t.start, t.days))}` : t.start} · {t.days} days · {(t.crew || []).length} people
                </div>
                <div className="row mt">
                  <button
                    className="btn"
                    onClick={() => {
                      s.activate(t.id);
                      onOpen();
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      const { id: _i, code: _c, at: _a, ...rest } = t;
                      s.create({ ...rest, name: t.name + ' (copy)' });
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    className="btn ghost danger"
                    onClick={() => window.confirm(`Delete "${t.name}"? This cannot be undone.`) && s.remove(t.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- rivers library ---------- */

const ENTRY = {
  rapids: {
    label: 'Rapids',
    fields: [
      ['name', 'Name', 'text'],
      ['mile', 'Mile', 'num'],
      ['diff', 'Difficulty (1–10)', 'num'],
      ['tier', 'Class / tier', 'text'],
      ['desc', 'Notes', 'area'],
    ],
    defaults: { civ: false },
  },
  camps: {
    label: 'Camps',
    fields: [
      ['name', 'Name', 'text'],
      ['mile', 'Mile', 'num'],
      ['bank', 'Bank', 'bank'],
      ['size', 'Size (1–9)', 'num'],
      ['qual', 'Quality (1–9)', 'num'],
    ],
    defaults: {},
  },
  hikes: {
    label: 'Hikes',
    fields: [
      ['name', 'Name', 'text'],
      ['mile', 'Mile', 'num'],
      ['bank', 'Bank', 'bank'],
      ['time', 'Hours', 'num'],
      ['diff', 'Difficulty (1–5)', 'num'],
      ['qual', 'Quality (1–5)', 'num'],
      ['desc', 'Notes', 'area'],
    ],
    defaults: {},
  },
};

function EntryList({ kind, items, onChange }) {
  const spec = ENTRY[kind];
  const blank = Object.fromEntries(spec.fields.map(([k, , t]) => [k, t === 'bank' ? 'R' : '']));
  const [draft, setDraft] = useState(blank);
  const mile = parseFloat(draft.mile);
  const ok = draft.name.trim() && isFinite(mile);
  const add = () => {
    const e = { ...spec.defaults };
    spec.fields.forEach(([k, , t]) => {
      const v = draft[k];
      if (t === 'num') {
        if (v !== '' && isFinite(parseFloat(v))) e[k] = parseFloat(v);
      } else if (v !== '') e[k] = k === 'name' ? v.trim() : v;
    });
    onChange([...items, e].sort((a, b) => a.mile - b.mile));
    setDraft(blank);
  };
  return (
    <Acc title={spec.label} note={String(items.length)}>
      {items.map((e, i) => (
        <div className="listRow" key={i}>
          <span className="mile">{e.mile.toFixed(1)}</span>
          <span style={{ flex: 1 }}>{e.name}</span>
          <button className="btn ghost danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <div className="mt">
        {spec.fields.map(([k, label, t]) =>
          t === 'bank' ? (
            <Sel key={k} label={label} value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })}>
              <option value="R">River right</option>
              <option value="L">River left</option>
            </Sel>
          ) : (
            <Field
              key={k}
              label={label}
              area={t === 'area'}
              inputMode={t === 'num' ? 'decimal' : undefined}
              value={draft[k]}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          )
        )}
        <button className="btn" disabled={!ok} onClick={add}>
          Add
        </button>
      </div>
    </Acc>
  );
}

function RiverEditor({ s, id, onClose }) {
  const base = id ? s.riverRec(id) : {};
  const norm = normalizeRiver(base);
  const [f, setF] = useState({
    name: id ? norm.name : '',
    reach: norm.reach,
    agency: norm.agency,
    note: norm.note,
    tz: norm.tz,
    lat: id ? String(norm.coords[0]) : '',
    lon: id ? String(norm.coords[1]) : '',
    m0: id ? String(norm.miles[0]) : '0',
    m1: id ? String(norm.miles[1]) : '',
    days: base.days ? String(base.days) : '',
  });
  const [access, setAccess] = useState(norm.access);
  const [lists, setLists] = useState({ rapids: norm.rapids, camps: norm.camps, hikes: norm.hikes });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [acc, setAcc] = useState({ name: '', mile: '', hub: false });
  const used = id ? s.trips.filter((t) => riverOf(t) === id).length : 0;

  const save = () => {
    const miles = [parseFloat(f.m0), parseFloat(f.m1)];
    const lat = parseFloat(f.lat);
    const lon = parseFloat(f.lon);
    let tzOk = true;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: f.tz });
    } catch {
      tzOk = false;
    }
    if (!f.name.trim()) return setErr('Give the river a name.');
    if (!isFinite(miles[0]) || !isFinite(miles[1]) || miles[1] <= miles[0]) return setErr('Mile range needs an end greater than the start.');
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return setErr('Put-in latitude / longitude look wrong (used for sunrise and sunset).');
    if (!tzOk) return setErr('Unknown time zone. Use a name like America/Denver.');
    const rid = id || (s.riverList().some((r) => r.id === slug(f.name)) ? slug(f.name) + '-' + uid().slice(-4) : slug(f.name));
    const days = parseInt(f.days, 10);
    s.saveRiver({
      ...base,
      id: rid,
      name: f.name.trim(),
      reach: f.reach.trim(),
      agency: f.agency.trim(),
      note: f.note.trim(),
      tz: f.tz.trim(),
      coords: [lat, lon],
      miles,
      days: days > 0 ? days : undefined,
      access,
      ...lists,
    });
    onClose();
  };
  const builtin = id && BUILTIN_RIVERS[id];
  return (
    <div className="pad">
      <h1>{id ? 'Edit river' : 'Add river'}</h1>
      <Field label="Name" value={f.name} onChange={set('name')} placeholder="Salmon River" />
      <Field label="Reach" value={f.reach} onChange={set('reach')} placeholder="Corn Creek to Carey Creek" />
      <Field label="Managing agency / permits" value={f.agency} onChange={set('agency')} />
      <div className="row">
        <Field label="Start mile" value={f.m0} onChange={set('m0')} inputMode="decimal" />
        <Field label="End mile" value={f.m1} onChange={set('m1')} inputMode="decimal" />
        <Field label="Typical days" value={f.days} onChange={set('days')} inputMode="numeric" />
      </div>
      <div className="row">
        <Field label="Put-in latitude" value={f.lat} onChange={set('lat')} inputMode="decimal" placeholder="45.2" />
        <Field label="Put-in longitude" value={f.lon} onChange={set('lon')} inputMode="decimal" placeholder="-114.5" />
      </div>
      <Field label="Time zone" value={f.tz} onChange={set('tz')} placeholder="America/Denver" />
      <Field label="Notes" area value={f.note} onChange={set('note')} />

      <div className="mt">
        <span className="label">Put-ins, take-outs &amp; hubs</span>
        <div className="muted">Used by the trip's launch / take-out pickers and the Shuttle planner. Add them in river order; deleting one renumbers those after it.</div>
        {access.map((p, i) => (
          <div className="listRow" key={i}>
            <span className="mile">{p.mile != null ? p.mile : p.hub ? 'hub' : '—'}</span>
            <span style={{ flex: 1 }}>{p.name}</span>
            <button className="btn ghost danger" onClick={() => setAccess(access.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <Field label="Name" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} placeholder="Corn Creek" />
        <div className="row">
          <Field label="River mile" value={acc.mile} onChange={(e) => setAcc({ ...acc, mile: e.target.value })} inputMode="decimal" placeholder="blank for a town / hub" />
          <label className="check">
            <input type="checkbox" checked={acc.hub} onChange={(e) => setAcc({ ...acc, hub: e.target.checked })} /> Hub / town
          </label>
        </div>
        <button
          className="btn ghost"
          disabled={!acc.name.trim() || (!acc.hub && !isFinite(parseFloat(acc.mile)))}
          onClick={() => {
            const m = parseFloat(acc.mile);
            const p = { name: acc.name.trim(), road: true, park: !acc.hub };
            if (acc.hub) p.hub = true;
            if (isFinite(m)) p.mile = m;
            setAccess([...access, p]);
            setAcc({ name: '', mile: '', hub: false });
          }}
        >
          Add access point
        </button>
      </div>

      <div className="mt">
        <EntryList kind="rapids" items={lists.rapids} onChange={(v) => setLists({ ...lists, rapids: v })} />
        <EntryList kind="camps" items={lists.camps} onChange={(v) => setLists({ ...lists, camps: v })} />
        <EntryList kind="hikes" items={lists.hikes} onChange={(v) => setLists({ ...lists, hikes: v })} />
      </div>

      {err ? <div className="warn mt">{err}</div> : null}
      <div className="row mt">
        <button className="btn" onClick={save}>
          Save river
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {id && (builtin ? s.rivers[id] : true) ? (
          <button
            className="btn ghost danger"
            onClick={() => {
              const msg = builtin
                ? 'Reset this river to the built-in version? Your edits are lost.'
                : used
                ? `Delete this river? ${used} trip(s) use it and will lose their river data.`
                : 'Delete this river?';
              if (window.confirm(msg)) {
                s.dropRiver(id);
                onClose();
              }
            }}
          >
            {builtin ? 'Reset' : 'Delete'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Rivers({ s, browse, onBrowse, onPlan }) {
  const [edit, setEdit] = useState(null); // river id | 'new' | null
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState('');
  if (edit) return <RiverEditor s={s} id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />;

  const importJson = () => {
    try {
      const raw = JSON.parse(json);
      const list = Array.isArray(raw) ? raw : raw.rivers || [raw];
      list.forEach((r) => {
        if (!r || typeof r.name !== 'string' || !Array.isArray(r.miles)) throw new Error('Each river needs a "name" and "miles": [start, end].');
      });
      list.forEach((r) => s.saveRiver({ ...r, id: r.id || (s.riverList().some((x) => x.id === slug(r.name)) ? slug(r.name) + '-' + uid().slice(-4) : slug(r.name)) }));
      setJson('');
      setMsg(`Imported ${list.length} river${list.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setMsg('Could not import: ' + e.message);
    }
  };

  return (
    <div className="pad">
      <button className="btn" onClick={() => setEdit('new')}>
        + Add river
      </button>
      {s.riverList().map((r) => {
        const n = normalizeRiver(r);
        const trips = s.trips.filter((t) => riverOf(t) === r.id).length;
        return (
          <div className="card mt" key={r.id}>
            <div className="serif">{n.name}</div>
            <div className="muted">
              {n.reach ? n.reach + ' · ' : ''}
              {+(n.miles[1] - n.miles[0]).toFixed(1)} mi
            </div>
            <div className="muted">
              {n.rapids.length} rapids · {n.camps.length} camps · {n.hikes.length} hikes · {trips} trip{trips === 1 ? '' : 's'}
              {r.edited ? ' · edited' : ''}
            </div>
            {n.note ? <div className="muted mt">{n.note}</div> : null}
            <div className="row mt">
              <button className="btn" onClick={() => onBrowse(r.id)}>
                {browse === r.id ? 'Open map' : 'View'}
              </button>
              <button className="btn ghost" onClick={() => onPlan(r.id)}>
                Plan trip
              </button>
              {r.id !== DEFAULT_RIVER && (
                <button className="btn ghost" onClick={() => setEdit(r.id)}>
                  Edit
                </button>
              )}
              <button
                className="btn ghost"
                onClick={() => {
                  const { custom: _c, edited: _e, ...rec } = r;
                  navigator.clipboard?.writeText(JSON.stringify(rec)).then(
                    () => setMsg(`Copied ${n.name} JSON.`),
                    () => setMsg('Copy failed.')
                  );
                }}
              >
                Copy JSON
              </button>
            </div>
          </div>
        );
      })}
      <Acc title="Import river JSON" note="paste a river record, or { rivers: [...] }">
        <Field area value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"name":"Salmon River","miles":[0,53],"coords":[45.2,-114.5],"tz":"America/Boise","access":[...]}' />
        <button className="btn" disabled={!json.trim()} onClick={importJson}>
          Import
        </button>
      </Acc>
      {msg ? <div className="muted mt">{msg}</div> : null}
    </div>
  );
}

/* ---------- shell ---------- */

const TABS = [
  {
    id: 'Trips',
    tab: 'roster',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    id: 'Trip',
    tab: 'itinerary',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    id: 'River',
    tab: 'map',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M2 8c2.2-2.4 4.5-2.4 6.7 0s4.4 2.4 6.6 0 4.5-2.4 6.7 0" />
        <path d="M2 13c2.2-2.4 4.5-2.4 6.7 0s4.4 2.4 6.6 0 4.5-2.4 6.7 0" />
        <path d="M2 18c2.2-2.4 4.5-2.4 6.7 0s4.4 2.4 6.6 0 4.5-2.4 6.7 0" />
      </svg>
    ),
  },
  {
    id: 'General',
    tab: 'safety',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
        <path d="M12 9v6M9 12h6" />
      </svg>
    ),
  },
];

function App() {
  const s = useStore();
  const [tab, setTab] = useState('Trip');
  const [browse, setBrowse] = useState(null); // river being browsed on the River tab (null = the trip's own)
  const [preset, setPreset] = useState(null); // river chosen from the library for a new trip
  const onMap = tab === 'River';

  useEffect(() => setBrowse(null), [s.trip?.id]);

  // Trip screens use the trip's river; the River tab can browse any river.
  const tripRid = riverOf(s.trip);
  const rid = onMap ? browse || tripRid : tripRid;
  selectRiver(s.riverRec(rid));

  // the rock-art motif behind the page is keyed off body[data-tab]
  useEffect(() => {
    document.body.dataset.tab = TABS.find((t) => t.id === tab).tab;
  }, [tab]);

  return (
    <div className={'shell rg' + (onMap ? ' onmap' : '')}>
      <div id="bgmotif" aria-hidden="true" />

      {!onMap && (
        <div className="pageHeader" style={{ display: 'flex' }}>
          <div className="phtitle">{tab === 'Trip' ? s.trip?.name || 'Trip' : tab === 'Trips' ? 'Trips' : 'Rafting & Safety'}</div>
        </div>
      )}

      <main key={rid}>
        {tab === 'Trips' && <Trips s={s} preset={preset} clearPreset={() => setPreset(null)} onOpen={() => setTab('Trip')} />}
        {tab === 'Trip' && <Trip s={s} />}
        {tab === 'River' && (
          <River
            s={s}
            browse={rid}
            onBrowse={setBrowse}
            onPlan={(id) => {
              setPreset(id);
              setTab('Trips');
            }}
          />
        )}
        {tab === 'General' && <General s={s} />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={'tabbtn' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            {t.icon}
            <span className="tlabel">{t.id}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
