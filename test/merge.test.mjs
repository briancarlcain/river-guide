import assert from 'node:assert/strict';
import { canon, mergeTrips, stamp, strip } from '../src/merge.js';

const base = {
  id: 't1', name: 'Trip', start: '2027-01-01', days: 5, at: 1,
  crew: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }],
  gear: [{ id: 'g1', n: 'Stove', s: 'nights', e: {} }, { id: 'g2', n: 'Tent', s: 'personal', e: {} }],
  meals: [{ id: 'm1', day: 0, slot: 'Dinner', name: 'Chili' }],
  plans: { 0: { camp: 'X', mile: 1 } },
};
let T = 1000;
const edit = (t, fn) => { T += 10; return stamp(t, { ...fn(structuredClone(t)), at: T }, T); };
const sync = (a, b) => { // one round trip: each side merges the other's copy
  const A2 = mergeTrips(a, b, T), B2 = mergeTrips(b, a, T);
  return [A2, B2];
};
const converge = (a, b) => { for (let i = 0; i < 4; i++) [a, b] = sync(a, b); return [a, b]; };

// 1. Concurrent edits to different things are all kept
{
  let A = edit(base, (t) => { t.name = 'Grand Trip'; return t; });
  let B = edit(base, (t) => { t.days = 7; t.crew.push({ id: 'c', name: 'Cy' }); return t; });
  A = edit(A, (t) => { t.meals.push({ id: 'm2', day: 1, slot: 'Lunch', name: 'Wraps' }); return t; });
  const [a, b] = converge(A, B);
  assert.equal(canon(a), canon(b), 'devices converge');
  assert.equal(a.name, 'Grand Trip'); assert.equal(a.days, 7);
  assert.deepEqual(a.crew.map((c) => c.id).sort(), ['a', 'b', 'c']);
  assert.equal(a.meals.length, 2);
}
// 2. Two people fill in their own gear quantities on the same item at once
{
  let A = edit(base, (t) => { t.gear[0].e.a = { have: 1 }; return t; });
  let B = edit(base, (t) => { t.gear[0].e.b = { lend: 2 }; return t; });
  const [a, b] = converge(A, B);
  assert.deepEqual(strip(a.gear[0].e), { a: { have: 1 }, b: { lend: 2 } });
  assert.equal(canon(a), canon(b));
}
// 3. Same field edited by both: later edit wins
{
  let A = edit(base, (t) => { t.name = 'Early'; return t; });
  let B = edit(base, (t) => { t.name = 'Late'; return t; });
  const [a] = converge(A, B);
  assert.equal(a.name, 'Late');
}
// 4. Deletes are not undone by a stale copy, but a later edit revives the item
{
  let A = edit(base, (t) => { t.crew = t.crew.filter((c) => c.id !== 'b'); return t; });
  const [a, b] = converge(A, base);
  assert.deepEqual(a.crew.map((c) => c.id), ['a']);
  assert.equal(canon(a), canon(b));
  const B = edit(base, (t) => { t.crew[1].name = 'Bo Peep'; return t; });
  const [r] = converge(A, B);
  assert.equal(r.crew.find((c) => c.id === 'b')?.name, 'Bo Peep');
}
// 5. Edits to the same item: later one wins; different items both survive
{
  let A = edit(base, (t) => { t.gear[0].n = 'Big stove'; t.gear[1].n = 'Big tent'; return t; });
  let B = edit(base, (t) => { t.gear[0].n = 'Tiny stove'; return t; });
  const [a] = converge(A, B);
  assert.equal(a.gear[0].n, 'Tiny stove'); assert.equal(a.gear[1].n, 'Big tent');
}
// 6. Plans merge per day
{
  let A = edit(base, (t) => { t.plans[1] = { camp: 'Y', mile: 9 }; return t; });
  let B = edit(base, (t) => { t.plans[2] = { camp: 'Z', mile: 20 }; return t; });
  const [a] = converge(A, B);
  assert.deepEqual(Object.keys(a.plans).sort(), ['0', '1', '2']);
}
// 7. Merging is idempotent and an untouched copy produces no change (no push ping-pong)
{
  const A = edit(base, (t) => { t.name = 'N'; return t; });
  const m1 = mergeTrips(base, A, T);
  const m2 = mergeTrips(m1, A, T);
  assert.equal(canon(m1), canon(m2));
  assert.equal(canon(mergeTrips(A, A, T)), canon(A));
}
console.log('merge tests passed');
