// The household state: schedule, to-dos, groceries that are probably still at home,
// and the records the news desk reports on (departures, finished chores, photos).
import { addDays, daysBetween, minutesOf } from './time.mjs';

let counter = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

// Bounds that keep the single state item well under DynamoDB's 400 KB limit.
export const MAX_CACHE_KEYS = 80;
export const MAX_SCANS = 30;
export const MAX_PHOTOS = 8;
export const MAX_DONE_TODOS = 60;

// Sample household used on first start, so the dashboard has something to show.
// "away" marks events the person has to leave the house for (used for departure countdowns).
export function seedState(today) {
  return {
    // Changes whenever the household is (re)seeded; the TV forgets what it has shown when it changes.
    epoch: `${today}-${Date.now().toString(36)}`,
    schedule: [
      { id: 'ev-seed-1', date: today, time: '07:30', title: 'Take out recycling', who: 'Dad', away: false },
      { id: 'ev-seed-2', date: today, time: '09:00', title: 'Dentist appointment', who: 'Mom', away: true },
      { id: 'ev-seed-3', date: today, time: '15:30', title: 'Soccer practice', who: 'Ken', away: true },
      { id: 'ev-seed-4', date: today, time: '18:00', title: 'Grocery pickup', who: 'Dad', away: true },
      { id: 'ev-seed-5', date: today, time: '19:30', title: 'Family movie night', who: 'Everyone', away: false },
    ],
    todos: [
      { id: 'td-seed-1', title: 'Buy milk and eggs', who: 'Mom', done: true, doneAt: `${today}T08:10:00`, doneBy: 'Mom' },
      { id: 'td-seed-2', title: 'Pay electricity bill', who: 'Dad', done: false },
      { id: 'td-seed-3', title: 'Finish math homework', who: 'Ken', done: false },
      { id: 'td-seed-4', title: 'Water the plants', who: 'Yui', done: false },
    ],
    pantry: [
      { id: 'pt-seed-1', name: 'Chicken breast', purchasedAt: addDays(today, -2), shelfLifeDays: 3, used: false },
      { id: 'pt-seed-2', name: 'Onions', purchasedAt: addDays(today, -6), shelfLifeDays: 21, used: false },
      { id: 'pt-seed-3', name: 'Eggs', purchasedAt: addDays(today, -4), shelfLifeDays: 14, used: false },
      { id: 'pt-seed-4', name: 'Milk', purchasedAt: addDays(today, -6), shelfLifeDays: 7, used: false },
      { id: 'pt-seed-5', name: 'Spinach', purchasedAt: addDays(today, -4), shelfLifeDays: 4, used: false },
    ],
    scans: [],
    // eventId -> { at: "HH:MM", date } once someone has left for it (or acknowledged the interruption).
    departures: {},
    // Small JPEG thumbnails (base64) attached to finished chores, keyed by todo id.
    photos: {},
    // Cached AI output, keyed so the model is asked again only when something changed.
    cache: {},
  };
}

// Older saved states may predate some fields.
export function upgradeState(state) {
  state.epoch ??= 'legacy';
  state.departures ??= {};
  state.photos ??= {};
  state.cache ??= {};
  state.scans ??= [];
  return state;
}

export function rememberCache(state, key, value) {
  state.cache[key] = value;
  const keys = Object.keys(state.cache);
  if (keys.length > MAX_CACHE_KEYS) {
    for (const k of keys.slice(0, keys.length - MAX_CACHE_KEYS)) delete state.cache[k];
  }
}

export function pruneState(state) {
  if (state.scans.length > MAX_SCANS) state.scans = state.scans.slice(-MAX_SCANS);
  const photoIds = Object.keys(state.photos);
  if (photoIds.length > MAX_PHOTOS) {
    for (const id of photoIds.slice(0, photoIds.length - MAX_PHOTOS)) delete state.photos[id];
  }
  const done = state.todos.filter((t) => t.done);
  if (done.length > MAX_DONE_TODOS) {
    const drop = new Set(done.slice(0, done.length - MAX_DONE_TODOS).map((t) => t.id));
    state.todos = state.todos.filter((t) => !drop.has(t.id));
  }
}

// "Probably still at home": fades from 1 to 0 over the item's shelf life.
export function kitchenItems(state, today) {
  return state.pantry
    .filter((p) => !p.used)
    .map((p) => {
      const age = daysBetween(p.purchasedAt, today);
      const daysLeft = p.shelfLifeDays - age;
      const likelihood = Math.max(0, Math.min(1, 1 - age / (p.shelfLifeDays + 2)));
      return { id: p.id, name: p.name, daysLeft, likelihood: Math.round(likelihood * 100) / 100 };
    })
    .filter((p) => p.likelihood > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function todaysSchedule(state, today) {
  return state.schedule
    .filter((e) => e.date === today)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
}

export function upcomingSchedule(state, today, days = 14) {
  const last = addDays(today, days);
  return state.schedule
    .filter((e) => e.date > today && e.date <= last)
    .sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`));
}

// When someone has to leave the house for an event: default travel time, plus a margin when rain is likely.
export const TRAVEL_MINUTES = 15;
export const RAIN_MARGIN_MINUTES = 5;

export function leaveAtMinutes(event, weather) {
  if (!event.away || !event.time) return null;
  const margin = weather && weather.rainChance >= 50 ? RAIN_MARGIN_MINUTES : 0;
  return minutesOf(event.time) - TRAVEL_MINUTES - margin;
}

// Monday-based week key, used for the chore scoreboard.
export function weekOf(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

// Points this week: 1 per finished chore, 2 when it came with a photo.
export function scoreboard(state, today) {
  const week = weekOf(today);
  const points = {};
  for (const t of state.todos) {
    if (!t.done || !t.doneAt || !t.doneBy) continue;
    if (weekOf(t.doneAt.slice(0, 10)) !== week) continue;
    points[t.doneBy] = (points[t.doneBy] ?? 0) + (state.photos[t.id] ? 2 : 1);
  }
  return Object.entries(points)
    .map(([who, score]) => ({ who, score }))
    .sort((a, b) => b.score - a.score || a.who.localeCompare(b.who));
}

export function scoreline(board) {
  return board.map((s) => `${s.who} ${s.score}`).join(' - ');
}
