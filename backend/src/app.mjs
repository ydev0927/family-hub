// The Family Hub API. Framework-free so it runs both in AWS Lambda and in the local dev server.
import QRCode from 'qrcode';
import { localNow, minutesOf, timeSlot, withTime } from './time.mjs';
import { getWeather } from './weather.mjs';
import {
  seedState, upgradeState, newId, rememberCache, pruneState,
  kitchenItems, todaysSchedule, upcomingSchedule,
  leaveAtMinutes, scoreboard, scoreline,
} from './state.mjs';
import {
  BRIEFING_SYSTEM, briefingInput,
  SCAN_SYSTEM, scanInput,
  RECIPE_SYSTEM, recipeInput,
  BREAKING_SYSTEM, breakingInput,
  CHORE_CHECK_SYSTEM, choreCheckInput,
} from './prompts.mjs';
import { ConflictError } from './store/conflict.mjs';
import { phonePage } from './upload-page.mjs';

const SOON_MINUTES = 60;
const BREAKING_SOON_MINUTES = 30;
const NEWS_MINUTES = 15;
// Departure countdown stages, in minutes before the time to leave.
const DEVELOPING_MINUTES = 15;
const URGENT_MINUTES = 5;
const INTERRUPT_GRACE_MINUTES = 45;
const SAVE_ATTEMPTS = 5;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Model answers are asked to be JSON; tolerate a code fence or a sentence around it.
export function parseModelJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`Model did not return valid JSON: ${text.slice(0, 200)}`);
  }
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function createApp({ store, model, config }) {
  async function load(now) {
    const doc = await store.load();
    if (doc) return { state: upgradeState(doc.state), version: doc.version };
    const seeded = seedState(now.date);
    const version = await store.save(seeded, 0);
    return { state: seeded, version };
  }

  // Applies a change to the freshly loaded state and saves it. When another request saved in
  // between, the change is applied again on the new state. `mutate` must not call the model.
  async function update(now, mutate) {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const { state, version } = await load(now);
      const result = await mutate(state);
      pruneState(state);
      try {
        await store.save(state, version);
        return { state, result };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    throw new Error('State kept changing while saving; please retry');
  }

  async function weatherOrNull() {
    try {
      return await getWeather(config.location, config.timezone);
    } catch (e) {
      console.error('weather unavailable:', e.message);
      return null;
    }
  }

  function scheduleWithFlags(state, now, weather) {
    return todaysSchedule(state, now.date).map((e) => {
      const diff = e.time ? minutesOf(e.time) - now.minutes : null;
      const leaveAt = leaveAtMinutes(e, weather);
      const departure = state.departures[e.id];
      return {
        ...e,
        past: diff !== null && diff < 0,
        soon: diff !== null && diff >= 0 && diff <= SOON_MINUTES,
        leaveAt: leaveAt === null ? null : hhmm(leaveAt),
        departedAt: departure ? departure.at : null,
      };
    });
  }

  // Returns the cached value for `key`, asking `produce` (the model) only once per key.
  async function cached(state, now, key, produce) {
    if (state.cache[key] !== undefined) return state.cache[key];
    const value = await produce();
    await update(now, (s) => {
      if (s.cache[key] === undefined) rememberCache(s, key, value);
    });
    state.cache[key] = value;
    return value;
  }

  async function briefing(state, now) {
    const weather = await weatherOrNull();
    const schedule = scheduleWithFlags(state, now, weather);
    const kitchen = kitchenItems(state, now.date);
    const soon = schedule.find((e) => e.soon);
    const slot = timeSlot(now.hour);
    // Ask again only when the situation changes: time of day, what is still ahead, weather, chores, food.
    const key = [
      'briefing', now.date, slot, soon?.id ?? '-',
      schedule.filter((e) => !e.past).map((e) => e.id).join(','),
      weather ? weather.code : 'nw',
      state.todos.filter((t) => !t.done).length,
      kitchen.map((k) => k.id).join(','),
    ].join('|');
    const comment = await cached(state, now, key, () =>
      model.text({
        system: BRIEFING_SYSTEM,
        input: briefingInput({ now, slot, location: config.location.name, weather, schedule, todos: state.todos, kitchen }),
        maxTokens: 120,
      }),
    );
    return { comment };
  }

  async function kitchen(state, now) {
    const items = kitchenItems(state, now.date);
    if (items.length === 0) return { items, idea: null };
    const key = `recipe|${now.date}|${items.map((k) => k.id).join(',')}`;
    const idea = await cached(state, now, key, async () => {
      const raw = parseModelJson(await model.text({ system: RECIPE_SYSTEM, input: recipeInput(items), maxTokens: 200 }));
      // The model is asked for ids; accept names too, and drop anything that matches nothing.
      const byId = new Map(items.map((k) => [k.id, k]));
      const byName = new Map(items.map((k) => [k.name.toLowerCase(), k]));
      const uses = [...new Set((raw.uses ?? []).map((u) => byId.get(u) ?? byName.get(String(u).toLowerCase())).filter(Boolean))];
      return { title: raw.title, note: raw.note, uses: uses.map((k) => k.id), usesNames: uses.map((k) => k.name) };
    });
    return { items, idea };
  }

  async function cooked(now, body) {
    const ids = new Set(body.uses ?? []);
    if (ids.size === 0) throw new HttpError(400, 'uses (pantry ids) is required');
    const { state } = await update(now, (s) => {
      for (const p of s.pantry) if (ids.has(p.id)) p.used = true;
    });
    return kitchen(state, now);
  }

  async function scan(now, body) {
    if (!body.image) throw new HttpError(400, 'image is required');
    const answer = await model.vision({
      system: SCAN_SYSTEM,
      input: scanInput({ today: now.date, family: config.family }),
      image: { format: body.format ?? 'jpeg', bytes: Buffer.from(body.image, 'base64') },
    });
    const result = parseModelJson(answer);
    const events = (result.events ?? []).map((e) => ({ id: newId('ev'), away: false, ...e }));
    const todos = (result.todos ?? []).map((t) => ({ id: newId('td'), title: t.title, who: t.who, done: false }));
    const purchasedAt = result.purchaseDate ?? now.date;
    const groceries = (result.groceries ?? [])
      .filter((g) => g.name && Number.isFinite(g.shelfLifeDays) && g.shelfLifeDays > 0)
      .map((g) => ({ id: newId('pt'), name: capitalize(g.name), shelfLifeDays: g.shelfLifeDays, purchasedAt, used: false }));
    const record = {
      id: newId('scan'),
      at: new Date().toISOString(),
      kind: result.kind,
      summary: result.summary ?? 'Photo added',
      fact: scanFact(result.kind, events, todos, groceries),
    };
    await update(now, (s) => {
      s.schedule.push(...events);
      s.todos.push(...todos);
      s.pantry.push(...groceries);
      s.scans.push(record);
    });
    return { kind: result.kind, summary: record.summary, added: { events, todos, groceries } };
  }

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // What the news desk may say about a photo: only what was actually added, so headlines stay true.
  function scanFact(kind, events, todos, groceries) {
    const day = (d) =>
      new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const parts = [`A photo of a ${kind === 'receipt' ? 'shopping receipt' : kind === 'notice' ? 'notice' : 'note'} was added to the family board.`];
    if (events.length) {
      parts.push(`New on the schedule: ${events.map((e) => `${e.title} (${e.who}, ${day(e.date)}${e.time ? ` ${e.time}` : ''})`).join('; ')}.`);
    }
    if (todos.length) parts.push(`New to-dos: ${todos.map((t) => `${t.title} (${t.who})`).join('; ')}.`);
    if (groceries.length) parts.push(`Now in the kitchen: ${groceries.map((g) => g.name).join(', ')}.`);
    return parts.join(' ');
  }

  // --- chores ---

  function openTodos(state) {
    return state.todos.filter((t) => !t.done);
  }

  async function todoDone(now, body) {
    const { id, who, image, force } = body;
    if (!id) throw new HttpError(400, 'id is required');
    if (!who) throw new HttpError(400, 'who is required');
    const { state: before } = await load(now);
    const todo = before.todos.find((t) => t.id === id);
    if (!todo) throw new HttpError(404, `No such to-do: ${id}`);
    if (todo.done) return { confirmed: true, todo, scoreboard: scoreboard(before, now.date), already: true };

    let caption = null;
    if (image && !force) {
      const answer = parseModelJson(
        await model.vision({
          system: CHORE_CHECK_SYSTEM,
          input: choreCheckInput(todo),
          image: { format: body.format ?? 'jpeg', bytes: Buffer.from(image, 'base64') },
        }),
      );
      caption = answer.caption ?? null;
      if (!answer.confirmed) return { confirmed: false, caption, todo };
    }
    const doneAt = `${now.date}T${now.time}:00`;
    const { state } = await update(now, (s) => {
      const t = s.todos.find((x) => x.id === id);
      if (!t) throw new HttpError(404, `No such to-do: ${id}`);
      t.done = true;
      t.doneAt = doneAt;
      t.doneBy = who;
      if (image) s.photos[id] = { image, caption, at: doneAt };
    });
    return { confirmed: true, caption, todo: state.todos.find((t) => t.id === id), scoreboard: scoreboard(state, now.date) };
  }

  // --- departures ---

  function departuresToday(state, now, weather) {
    return todaysSchedule(state, now.date)
      .filter((e) => e.away && e.time)
      .map((e) => ({
        id: e.id,
        title: e.title,
        who: e.who,
        time: e.time,
        leaveAt: hhmm(leaveAtMinutes(e, weather)),
        departedAt: state.departures[e.id]?.at ?? null,
      }));
  }

  async function markDeparted(now, body, via) {
    if (!body.id) throw new HttpError(400, 'id is required');
    const { state } = await update(now, (s) => {
      const e = s.schedule.find((x) => x.id === body.id);
      if (!e) throw new HttpError(404, `No such event: ${body.id}`);
      if (!s.departures[e.id]) s.departures[e.id] = { at: now.time, date: now.date, via };
    });
    return { departed: state.departures[body.id] };
  }

  // --- breaking news ---

  // Everything worth interrupting whatever is on TV for. Sticky alerts stay on screen while they
  // keep being returned; the others are shown once (the TV remembers their ids).
  async function alerts(state, now) {
    const weather = await weatherOrNull();
    const weatherLine = weather ? `Weather: ${weather.current}, rain chance ${weather.rainChance}%.` : '';
    const out = [];

    // Headlines are written by the model once per fact and cached; a failure skips that alert only.
    const headline = async (id, fact) => {
      try {
        return await cached(state, now, `breaking|${id}`, () =>
          model.text({ system: BREAKING_SYSTEM, input: breakingInput({ fact }), maxTokens: 60, temperature: 0.4 }),
        );
      } catch (e) {
        console.error(`headline for ${id} failed:`, e.message);
        return null;
      }
    };
    const push = async (alert, fact) => {
      const text = alert.text ?? (await headline(alert.id, fact));
      if (text) out.push({ sticky: false, ...alert, text });
    };

    for (const e of todaysSchedule(state, now.date)) {
      if (!e.time) continue;
      const leaveAt = leaveAtMinutes(e, weather);
      if (leaveAt === null) {
        const diff = minutesOf(e.time) - now.minutes;
        if (diff >= 0 && diff <= BREAKING_SOON_MINUTES) {
          await push(
            { id: `soon-${e.id}-${now.date}`, level: 'info' },
            `${e.who}: "${e.title}" starts in ${diff} minutes at ${e.time}. ${weatherLine}`,
          );
        }
        continue;
      }
      const departure = state.departures[e.id];
      const diff = leaveAt - now.minutes;
      const group = `depart-${e.id}`;
      const leaveText = hhmm(leaveAt);
      if (departure) {
        if (departure.date === now.date && now.minutes - minutesOf(departure.at) <= NEWS_MINUTES) {
          await push(
            { id: `${group}-done`, group, level: 'info' },
            `${e.who} has left the house for "${e.title}" at ${departure.at}. ${e.time} start looks safe.`,
          );
        }
      } else if (diff > URGENT_MINUTES && diff <= DEVELOPING_MINUTES) {
        await push(
          { id: `${group}-developing`, group, level: 'developing', sticky: true, secondsLeft: diff * 60, eventId: e.id },
          `${e.who} needs to leave for "${e.title}" (${e.time} start) at ${leaveText}, in ${diff} minutes. ${weatherLine}`,
        );
      } else if (diff > 0 && diff <= URGENT_MINUTES) {
        await push(
          { id: `${group}-urgent`, group, level: 'urgent', sticky: true, secondsLeft: diff * 60, eventId: e.id },
          `URGENT: ${e.who} must leave for "${e.title}" at ${leaveText}, only ${diff} minutes left. ${weatherLine}`,
        );
      } else if (diff <= 0 && diff > -INTERRUPT_GRACE_MINUTES) {
        out.push({
          id: `${group}-interrupt`,
          group,
          level: 'interrupt',
          sticky: true,
          pause: true,
          ack: true,
          eventId: e.id,
          secondsLeft: 0,
          text: `WE INTERRUPT THIS PROGRAM. ${e.who}, out the door: "${e.title}" starts at ${e.time}.`,
        });
      }
    }

    for (const k of kitchenItems(state, now.date)) {
      if (k.daysLeft <= 0) {
        await push({ id: `expiring-${k.id}-${now.date}`, level: 'info' }, `The ${k.name} in the kitchen should be used today.`);
      }
    }

    for (const s of state.scans) {
      if (Date.now() - Date.parse(s.at) <= NEWS_MINUTES * 60 * 1000) {
        await push({ id: `scan-${s.id}`, level: 'info' }, s.fact ?? s.summary);
      }
    }

    const board = scoreboard(state, now.date);
    for (const t of state.todos) {
      if (!t.done || !t.doneAt || !t.doneBy || t.doneAt.slice(0, 10) !== now.date) continue;
      if (now.minutes - minutesOf(t.doneAt.slice(11, 16)) > NEWS_MINUTES) continue;
      const photo = state.photos[t.id];
      await push(
        { id: `chore-${t.id}`, level: 'score', caption: scoreline(board), image: photo ? photo.image : undefined },
        `GOAL for ${t.doneBy}: "${t.title}" is done${photo ? ' (photo evidence received)' : ''}. Chore scoreboard this week: ${scoreline(board)}.`,
      );
    }

    return { epoch: state.epoch, now: { date: now.date, time: now.time }, alerts: out };
  }

  async function qr() {
    if (!config.publicUrl) throw new Error('PUBLIC_URL must be set to show the phone QR code');
    const url = `${config.publicUrl.replace(/\/$/, '')}/phone?token=${encodeURIComponent(config.accessToken)}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    return { url, dataUrl };
  }

  return async function handle({ method, path, query, headers, body }) {
    const token = headers['x-access-token'] ?? query.token;
    if (!config.accessToken || token !== config.accessToken) throw new HttpError(401, 'Unauthorized');

    // The dev server can run the whole household on a shifted clock (TIME_SHIFT_MINUTES).
    let now = localNow(config.timezone, new Date(Date.now() + (config.timeShiftMinutes ?? 0) * 60_000));
    // The dev server lets a request pretend it is another time of day (x-fake-time: HH:MM).
    if (config.devTools && headers['x-fake-time']) now = withTime(now, headers['x-fake-time']);
    const route = `${method} ${path}`;
    if (route === 'GET /phone' || route === 'GET /upload') return { html: phonePage(config.accessToken) };
    if (route === 'GET /qr') return qr();

    switch (route) {
      case 'GET /state': {
        const { state } = await load(now);
        const weather = await weatherOrNull();
        return {
          now,
          location: config.location,
          family: config.family,
          schedule: scheduleWithFlags(state, now, weather),
          upcoming: upcomingSchedule(state, now.date),
          todos: state.todos,
          scoreboard: scoreboard(state, now.date),
        };
      }
      case 'GET /briefing':
        return briefing((await load(now)).state, now);
      case 'GET /kitchen':
        return kitchen((await load(now)).state, now);
      case 'POST /kitchen/cooked':
        return cooked(now, body);
      case 'POST /scan':
        return scan(now, body);
      case 'GET /todos': {
        const { state } = await load(now);
        return { family: config.family, todos: openTodos(state), scoreboard: scoreboard(state, now.date) };
      }
      case 'POST /todos/done':
        return todoDone(now, body);
      case 'GET /departures': {
        const { state } = await load(now);
        return { now: now.time, departures: departuresToday(state, now, await weatherOrNull()) };
      }
      case 'POST /departed':
        return markDeparted(now, body, 'phone');
      case 'POST /alerts/ack':
        return markDeparted(now, body, 'tv');
      case 'GET /alerts':
        return alerts((await load(now)).state, now);
      case 'POST /reset': {
        // Demo helper: start over with today's sample household.
        const { version } = (await store.load()) ?? { version: 0 };
        await store.save(seedState(now.date), version);
        return { reset: true };
      }
      default:
        throw new HttpError(404, `Not found: ${route}`);
    }
  };
}
