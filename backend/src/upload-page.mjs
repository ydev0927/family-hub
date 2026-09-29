// Phone page opened from the QR code on the TV. Three tabs: send a photo of a notice or receipt,
// report a finished chore (with optional photo evidence), and say "I've left" for today's outings.
export function phonePage(token) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Family Hub</title>
<style>
  :root { color-scheme: dark; --bg: #000; --card: #1c1c1e; --card2: #2c2c2e; --text: #fff; --muted: #8e8e93; --accent: #5856d6; --ok: #34c759; --err: #ff453a; --warn: #ff9500; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.5 -apple-system, system-ui, sans-serif; padding: 20px 16px 48px; }
  h1 { font-size: 24px; margin: 0 0 14px; }
  nav { display: flex; gap: 8px; margin-bottom: 20px; }
  nav button { flex: 1; background: var(--card); color: var(--muted); border: 0; border-radius: 12px; padding: 12px 0; font-size: 16px; font-weight: 600; }
  nav button.on { background: var(--accent); color: #fff; }
  section { display: none; }
  section.on { display: block; }
  p.lead { color: var(--muted); margin: 0 0 18px; }
  .btn { display: block; width: 100%; background: var(--accent); color: #fff; text-align: center; padding: 16px; border-radius: 14px; font-size: 18px; font-weight: 600; border: 0; }
  .btn.secondary { background: var(--card2); }
  .btn:disabled { opacity: .5; }
  input[type=file] { display: none; }
  img.preview { display: none; width: 100%; border-radius: 14px; margin-top: 14px; }
  .status { margin-top: 14px; color: var(--muted); min-height: 1.5em; }
  .status.err { color: var(--err); }
  .status.ok { color: var(--ok); font-weight: 600; }
  .card { background: var(--card); border-radius: 14px; padding: 14px 16px; margin-top: 12px; }
  .card h2 { font-size: 14px; color: var(--muted); margin: 0 0 8px; font-weight: 600; letter-spacing: .5px; }
  .card ul { margin: 0; padding-left: 20px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid #2c2c2e; }
  .row:last-child { border-bottom: 0; }
  .row .title { flex: 1; }
  .row .who { color: var(--muted); font-size: 15px; }
  .row.selected { color: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 16px; }
  .chip { background: var(--card2); border: 0; color: var(--text); padding: 10px 16px; border-radius: 999px; font-size: 16px; }
  .chip.on { background: var(--accent); }
  .small { color: var(--muted); font-size: 14px; }
  .score { display: flex; gap: 14px; font-size: 20px; font-weight: 700; }
  .stack { display: grid; gap: 10px; margin-top: 14px; }
</style>
</head>
<body>
<h1>Family Hub</h1>
<nav>
  <button data-tab="photo" class="on">Photo</button>
  <button data-tab="done">Done</button>
  <button data-tab="leave">Leaving</button>
</nav>

<section id="photo" class="on">
  <p class="lead">Take a photo of a school notice, flyer, or grocery receipt. It shows up on the TV.</p>
  <label class="btn">Take a photo<input id="scanFile" type="file" accept="image/*" capture="environment"></label>
  <img id="scanPreview" class="preview" alt="">
  <div id="scanStatus" class="status"></div>
  <div id="scanResult"></div>
</section>

<section id="done">
  <p class="lead">Finished a chore? Pick it, say who did it, and (for double points) send a photo as proof.</p>
  <div id="doneStatus" class="status"></div>
  <div class="card"><h2>This week</h2><div id="board" class="score"></div></div>
  <div class="card"><h2>Who did it?</h2><div id="who" class="chips"></div></div>
  <div class="card"><h2>Open chores</h2><div id="todos"></div></div>
  <div class="stack">
    <label class="btn" id="doneWithPhoto">Done, with photo<input id="doneFile" type="file" accept="image/*" capture="environment"></label>
    <button class="btn secondary" id="doneNoPhoto">Done, no photo</button>
  </div>
  <img id="donePreview" class="preview" alt="">
</section>

<section id="leave">
  <p class="lead">Today's outings. Tap when you're out the door and the TV stops nagging.</p>
  <div id="leaveStatus" class="status"></div>
  <div id="departures"></div>
</section>

<script>
const TOKEN = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-access-token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
  if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);
  return json;
}

function setStatus(el, text, kind) {
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function resize(file, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read the photo'));
    img.src = URL.createObjectURL(file);
  });
}

// --- tabs ---
document.querySelectorAll('nav button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === b.dataset.tab));
    if (b.dataset.tab === 'done') loadTodos();
    if (b.dataset.tab === 'leave') loadDepartures();
  });
});

// --- photo tab ---
function list(title, items) {
  if (!items.length) return '';
  return '<div class="card"><h2>' + title + '</h2><ul>' + items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul></div>';
}

$('scanFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  setStatus($('scanStatus'), 'Reading the photo…');
  $('scanResult').innerHTML = '';
  try {
    const dataUrl = await resize(file, 1600);
    $('scanPreview').src = dataUrl;
    $('scanPreview').style.display = 'block';
    const json = await call('POST', 'scan', { image: dataUrl.split(',')[1], format: 'jpeg' });
    setStatus($('scanStatus'), json.summary, 'ok');
    $('scanResult').innerHTML =
      list('Schedule', json.added.events.map((e) => e.date + (e.time ? ' ' + e.time : '') + ' · ' + e.title + ' (' + e.who + ')')) +
      list('To-do', json.added.todos.map((t) => t.title + ' (' + t.who + ')')) +
      list('Kitchen', json.added.groceries.map((g) => g.name + ' · keeps about ' + g.shelfLifeDays + ' days'));
  } catch (e) {
    setStatus($('scanStatus'), e.message, 'err');
  } finally {
    ev.target.value = '';
  }
});

// --- done tab ---
let selectedTodo = null;
let selectedWho = localStorage.getItem('who') || null;

function renderBoard(board) {
  $('board').innerHTML = board.length ? board.map((s) => '<span>' + esc(s.who) + ' ' + s.score + '</span>').join('') : '<span class="small">No points yet this week</span>';
}

async function loadTodos() {
  try {
    const json = await call('GET', 'todos');
    renderBoard(json.scoreboard);
    $('who').innerHTML = json.family.map((f) => '<button class="chip' + (f === selectedWho ? ' on' : '') + '" data-who="' + esc(f) + '">' + esc(f) + '</button>').join('');
    $('who').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      selectedWho = b.dataset.who;
      localStorage.setItem('who', selectedWho);
      $('who').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    if (!json.todos.length) {
      $('todos').innerHTML = '<div class="small">Nothing open. Nice.</div>';
    } else {
      $('todos').innerHTML = json.todos.map((t) => '<div class="row" data-id="' + esc(t.id) + '"><span class="title">' + esc(t.title) + '</span><span class="who">' + esc(t.who) + '</span></div>').join('');
      $('todos').querySelectorAll('.row').forEach((r) => r.addEventListener('click', () => {
        selectedTodo = r.dataset.id;
        $('todos').querySelectorAll('.row').forEach((x) => x.classList.toggle('selected', x === r));
        setStatus($('doneStatus'), '');
      }));
    }
  } catch (e) {
    setStatus($('doneStatus'), e.message, 'err');
  }
}

async function finish(image) {
  if (!selectedTodo) return setStatus($('doneStatus'), 'Pick a chore first.', 'err');
  if (!selectedWho) return setStatus($('doneStatus'), 'Who did it?', 'err');
  setStatus($('doneStatus'), image ? 'Checking the photo…' : 'Saving…');
  try {
    let json = await call('POST', 'todos/done', { id: selectedTodo, who: selectedWho, image, format: 'jpeg' });
    if (!json.confirmed) {
      const anyway = confirm('The TV is not convinced: "' + (json.caption || 'no match') + '". Mark it done anyway?');
      if (!anyway) return setStatus($('doneStatus'), 'Not marked. Try another photo.', 'err');
      json = await call('POST', 'todos/done', { id: selectedTodo, who: selectedWho, image, format: 'jpeg', force: true });
    }
    setStatus($('doneStatus'), 'Done! ' + (json.caption || '') + ' Watch the TV.', 'ok');
    selectedTodo = null;
    renderBoard(json.scoreboard);
    await loadTodos();
  } catch (e) {
    setStatus($('doneStatus'), e.message, 'err');
  }
}

$('doneFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resize(file, 640);
    $('donePreview').src = dataUrl;
    $('donePreview').style.display = 'block';
    await finish(dataUrl.split(',')[1]);
  } catch (e) {
    setStatus($('doneStatus'), e.message, 'err');
  } finally {
    ev.target.value = '';
  }
});
$('doneNoPhoto').addEventListener('click', () => finish(undefined));

// --- leaving tab ---
async function loadDepartures() {
  try {
    const json = await call('GET', 'departures');
    if (!json.departures.length) {
      $('departures').innerHTML = '<div class="small">No outings today.</div>';
      return;
    }
    $('departures').innerHTML = json.departures.map((d) =>
      '<div class="card"><div class="row"><div><div>' + esc(d.title) + ' · ' + esc(d.time) + '</div><div class="small">' + esc(d.who) + ' · leave by ' + esc(d.leaveAt) + '</div></div>' +
      (d.departedAt ? '<span class="small">Left at ' + esc(d.departedAt) + '</span>' : '<button class="btn" style="width:auto;padding:10px 16px;font-size:16px" data-id="' + esc(d.id) + '">I\\'ve left</button>') +
      '</div></div>').join('');
    $('departures').querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await call('POST', 'departed', { id: b.dataset.id });
        setStatus($('leaveStatus'), 'Noted. Safe travels.', 'ok');
        await loadDepartures();
      } catch (e) {
        setStatus($('leaveStatus'), e.message, 'err');
        b.disabled = false;
      }
    }));
  } catch (e) {
    setStatus($('leaveStatus'), e.message, 'err');
  }
}
</script>
</body>
</html>`;
}
