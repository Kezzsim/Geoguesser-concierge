/* ============================================================
   GEOGUESSER CONCIERGE — Application Logic
   ============================================================

   Flow:
     1. view-entry      → enter session number, look up CSV row
     2. view-image      → show 360 (Three.js) or regular image; 10-s timer
     3. view-map        → (GeoGuess only) drop OSM pin, confirm
     4. view-convention → text input "OwO, what furry convention is this?"
     5. view-question   → questions A → B → C, each in a 2×2 grid
     6. view-score      → results

   CSV columns (actual order from manifest.csv):
     Session Number, Session Image, GeoGuess, Name of Furry Convention,
     Year, Coordinates,
     Question A, Correct Answer A, A answer 1, A answer 2, A answer 3,
     Question B, Correct Answer B, B answer 1, B answer 2, B answer 3,
     Question C, Correct Answer C, C answer 1, C answer 2, C answer 3
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────────
const S = {
  manifest:        [],
  row:             null,   // matched CSV row object
  isGeo:           false,
  guessCoords:     null,   // { lat, lng }
  distanceMiles:   null,
  conventionGuess: '',
  answers:         { A: null, B: null, C: null },
  currentQ:        'A',

  // Three.js cleanup handle
  threeActive:     false,
  threeRenderer:   null,

  // Leaflet handle
  leafletMap:      null,
  leafletMarker:   null,
};

// ── DOM helpers ───────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
}
function setLoading(on) { $('loading').classList.toggle('hidden', !on); }

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Replace a button element with a fresh clone (clears all listeners).
// Returns the new element.
function freshBtn(id) {
  const old = $(id);
  const neo = old.cloneNode(true);
  old.parentNode.replaceChild(neo, old);
  return neo;
}

// ── CSV parsing ───────────────────────────────────────────────
function parseCSVLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^\uFEFF/, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

async function loadManifest() {
  const r = await fetch('manifest.csv');
  if (!r.ok) throw new Error('Could not load manifest.csv');
  return parseCSV(await r.text());
}

// ── Haversine distance (miles) ─────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Array shuffle (Fisher-Yates) ──────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ══════════════════════════════════════════════════════════════
// VIEW 1 — SESSION ENTRY
// ══════════════════════════════════════════════════════════════
function initEntry() {
  const input = $('session-input');
  const errEl = $('entry-error');

  function setErr(msg) {
    errEl.textContent = msg;
    errEl.classList.toggle('hidden', !msg);
  }

  async function go() {
    const val = input.value.trim();
    if (!val) { setErr('Please enter a session number.'); return; }

    setLoading(true);
    try {
      if (!S.manifest.length) S.manifest = await loadManifest();

      const row = S.manifest.find(r => r['Session Number'] === val);
      if (!row) {
        setLoading(false);
        setErr(`Session "${val}" not found — check your number and try again.`);
        return;
      }

      S.row   = row;
      S.isGeo = row['GeoGuess'].toUpperCase() === 'TRUE';
      setErr('');
      setLoading(false);
      startImageView();
    } catch (e) {
      setLoading(false);
      setErr('Could not load session data — please try again.');
      console.error(e);
    }
  }

  freshBtn('btn-start').addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ══════════════════════════════════════════════════════════════
// VIEW 2 — IMAGE VIEWER
// ══════════════════════════════════════════════════════════════
function startImageView() {
  // Tear down any previous Three.js scene
  S.threeActive = false;
  if (S.threeRenderer) {
    S.threeRenderer.dispose();
    S.threeRenderer = null;
  }

  const container = $('viewer-container');
  container.innerHTML = '';
  showView('view-image');

  const imgPath = `images/${S.row['Session Image']}`;
  if (S.isGeo) init360(imgPath, container);
  else         initRegularImage(imgPath, container);

  startCountdown();
}

// ── 10-second countdown then unlock button ──────────────────
function startCountdown() {
  const fillBar    = $('timer-fill');
  const labelEl    = $('timer-label');
  const btn        = freshBtn('btn-viewer-next');

  let left = 10;
  fillBar.style.width = '100%';
  fillBar.style.background = 'var(--blue)';
  labelEl.textContent = left;
  btn.disabled  = true;
  btn.className = 'btn btn-locked';
  btn.textContent = 'Observe carefully…';

  const tick = setInterval(() => {
    left--;
    const pct = (left / 10) * 100;
    fillBar.style.width = pct + '%';
    // colour-shift from blue → green as time runs out
    fillBar.style.background = left <= 3 ? 'var(--green)' : 'var(--blue)';
    labelEl.textContent = left > 0 ? left : '';

    if (left <= 0) {
      clearInterval(tick);
      btn.disabled  = false;
      btn.className = 'btn btn-unlocked';
      btn.textContent = "I've seen enough →";
    }
  }, 1000);

  btn.addEventListener('click', () => {
    clearInterval(tick);
    S.isGeo ? startMapView() : startConventionView();
  });
}

// ── 360° panorama viewer (Three.js equirectangular sphere) ───
function init360(src, container) {
  const W = container.clientWidth  || window.innerWidth;
  const H = container.clientHeight || window.innerHeight;

  const scene    = new THREE.Scene();
  const camera   = new THREE.PerspectiveCamera(75, W / H, .1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  container.appendChild(renderer.domElement);

  S.threeRenderer = renderer;
  S.threeActive   = true;

  // Sphere with inward-facing normals
  const geo = new THREE.SphereGeometry(1000, 64, 32);
  geo.scale(-1, 1, 1);
  const mat  = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  setLoading(true);
  new THREE.TextureLoader().load(
    src,
    tex => {
      mat.map = tex;
      mat.needsUpdate = true;
      setLoading(false);
    },
    undefined,
    err => { setLoading(false); console.error('360 load error:', err); }
  );

  // Drag-to-look state
  let dragging = false, prevX = 0, prevY = 0, lon = 0, lat = 0;

  function down(x, y) { dragging = true; prevX = x; prevY = y; }
  function move(x, y) {
    if (!dragging) return;
    lon  -= (x - prevX) * 0.22;
    lat  += (y - prevY) * 0.22;
    lat   = Math.max(-85, Math.min(85, lat));
    prevX = x; prevY = y;
  }
  function up() { dragging = false; }

  const cvs = renderer.domElement;
  cvs.addEventListener('mousedown',  e => down(e.clientX, e.clientY));
  cvs.addEventListener('mousemove',  e => move(e.clientX, e.clientY));
  cvs.addEventListener('mouseup',    up);
  cvs.addEventListener('mouseleave', up);
  cvs.addEventListener('touchstart', e => { if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  cvs.addEventListener('touchmove',  e => { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  cvs.addEventListener('touchend',   up);

  // Resize
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  ro.observe(container);

  // Render loop
  (function animate() {
    if (!S.threeActive) return;
    requestAnimationFrame(animate);
    const phi   = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    camera.lookAt(
      1000 * Math.sin(phi) * Math.cos(theta),
      1000 * Math.cos(phi),
      1000 * Math.sin(phi) * Math.sin(theta)
    );
    renderer.render(scene, camera);
  })();
}

// ── Regular image viewer (pan + pinch-zoom) ──────────────────
function initRegularImage(src, container) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;cursor:grab;user-select:none;touch-action:none;';

  const img  = document.createElement('img');
  img.style.cssText = 'position:absolute;top:0;left:0;transform-origin:top left;user-select:none;pointer-events:none;-webkit-user-drag:none;';
  img.src = src;

  let scale = 1, tx = 0, ty = 0;
  let dragging = false, lastX = 0, lastY = 0, lastDist = null;

  function applyTransform() {
    img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  }

  function fitToContainer() {
    if (!img.naturalWidth) return;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    scale = iw / ih > cw / ch ? cw / iw : ch / ih;
    tx = (cw - iw * scale) / 2;
    ty = (ch - ih * scale) / 2;
    applyTransform();
  }

  function zoomAt(cx, cy, factor) {
    const ns = Math.max(.05, Math.min(20, scale * factor));
    const r  = ns / scale;
    tx = cx - r * (cx - tx);
    ty = cy - r * (cy - ty);
    scale = ns;
    applyTransform();
  }

  img.onload = fitToContainer;
  if (img.complete && img.naturalWidth) fitToContainer();

  // Mouse
  wrap.addEventListener('mousedown', e => {
    e.preventDefault(); dragging = true; lastX = e.clientX; lastY = e.clientY;
    wrap.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    tx += e.clientX - lastX; ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; wrap.style.cursor = 'grab'; });

  // Wheel zoom
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 0.9);
  }, { passive: false });

  // Touch drag + pinch
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      dragging = true; lastDist = null;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      dragging = false;
      lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const d  = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      if (lastDist) {
        const r = wrap.getBoundingClientRect();
        zoomAt(mx - r.left, my - r.top, d / lastDist);
        tx += mx - lastX; ty += my - lastY; applyTransform();
      }
      lastDist = d; lastX = mx; lastY = my;
    } else if (e.touches.length === 1 && dragging) {
      tx += e.touches[0].clientX - lastX; ty += e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      applyTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', () => { dragging = false; lastDist = null; });

  wrap.appendChild(img);
  container.appendChild(wrap);
}

// ══════════════════════════════════════════════════════════════
// VIEW 3 — GEOGUESS MAP
// ══════════════════════════════════════════════════════════════
function startMapView() {
  // Tear down previous Leaflet instance if any
  if (S.leafletMap) {
    S.leafletMap.remove();
    S.leafletMap = null;
    S.leafletMarker = null;
  }
  S.guessCoords = null;

  showView('view-map');

  const map = L.map('map', { center: [20, 0], zoom: 2, zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
  S.leafletMap = map;

  const hintEl  = $('map-hint');
  const btn     = freshBtn('btn-confirm-pin');
  btn.disabled  = true;

  map.on('click', e => {
    const { lat, lng } = e.latlng;
    S.guessCoords = { lat, lng };

    if (S.leafletMarker) {
      S.leafletMarker.setLatLng(e.latlng);
    } else {
      S.leafletMarker = L.marker(e.latlng).addTo(map);
    }

    hintEl.textContent = `📍 ${lat.toFixed(4)}°,  ${lng.toFixed(4)}°`;
    btn.disabled = false;
  });

  btn.addEventListener('click', () => {
    if (!S.guessCoords) return;

    // Parse coordinates from CSV — stored as "lat,lng" (quoted in CSV)
    const raw = S.row['Coordinates'] || '';
    const parts = raw.split(',').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      S.distanceMiles = haversine(S.guessCoords.lat, S.guessCoords.lng, parts[0], parts[1]);
    } else {
      S.distanceMiles = null;
    }
    startConventionView();
  });
}

// ══════════════════════════════════════════════════════════════
// VIEW 4 — CONVENTION NAME INPUT
// ══════════════════════════════════════════════════════════════
function startConventionView() {
  showView('view-convention');

  const input = $('convention-input');
  input.value = '';
  setTimeout(() => input.focus(), 300);

  function submit() {
    const val = input.value.trim();
    if (!val) {
      input.style.borderColor = 'var(--red)';
      input.addEventListener('input', () => { input.style.borderColor = ''; }, { once: true });
      return;
    }
    S.conventionGuess = val;
    startQuestion('A');
  }

  freshBtn('btn-submit-convention').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

// ══════════════════════════════════════════════════════════════
// VIEW 5 — QUESTION (A / B / C)
// ══════════════════════════════════════════════════════════════
function startQuestion(letter) {
  S.currentQ = letter;

  const idx  = { A: 1, B: 2, C: 3 }[letter];
  $('q-progress').textContent = `Question ${idx} / 3`;
  $('q-text').textContent     = S.row[`Question ${letter}`];

  const correct = S.row[`Correct Answer ${letter}`];
  const opts    = shuffle([
    S.row[`${letter} answer 1`],
    S.row[`${letter} answer 2`],
    S.row[`${letter} answer 3`],
  ]);

  // Place 3 answers randomly into 4 grid slots; one slot is an invisible spacer
  const slots = [null, null, null, null];
  const positions = shuffle([0, 1, 2, 3]);
  opts.forEach((opt, i) => { slots[positions[i]] = opt; });

  const grid = $('answers-grid');
  grid.innerHTML = '';

  slots.forEach(opt => {
    if (opt === null) {
      // Empty spacer — visually invisible, keeps grid shape
      const spacer = el('div', 'btn-answer empty-cell');
      spacer.setAttribute('aria-hidden', 'true');
      grid.appendChild(spacer);
    } else {
      const btn = el('button', 'btn btn-answer', opt);
      btn.addEventListener('click', () => handleAnswer(btn, opt, correct, grid, letter));
      grid.appendChild(btn);
    }
  });

  // Reset next-question button
  const nq = freshBtn('btn-next-q');
  nq.style.visibility = 'hidden';
  nq.textContent = letter === 'C' ? 'View Results →' : 'Next Question →';

  showView('view-question');
}

function handleAnswer(clicked, selected, correct, grid, letter) {
  // Disable all answer buttons immediately
  grid.querySelectorAll('.btn-answer:not(.empty-cell)').forEach(b => { b.disabled = true; });

  const isCorrect = selected === correct;
  S.answers[letter] = isCorrect;

  clicked.classList.add(isCorrect ? 'correct' : 'wrong');

  // If wrong, reveal which was correct
  if (!isCorrect) {
    grid.querySelectorAll('.btn-answer:not(.empty-cell)').forEach(b => {
      if (b.textContent === correct) b.classList.add('reveal');
    });
  }

  // Show and wire Next button
  const nq = $('btn-next-q');
  nq.style.visibility = 'visible';
  // Use freshBtn-equivalent inline since we already have the reference
  const nqNew = nq.cloneNode(true);
  nqNew.style.visibility = 'visible';
  nq.parentNode.replaceChild(nqNew, nq);

  nqNew.addEventListener('click', () => {
    const next = { A: 'B', B: 'C' };
    if (next[letter]) startQuestion(next[letter]);
    else showScore();
  });
}

// ══════════════════════════════════════════════════════════════
// VIEW 6 — SCORE
// ══════════════════════════════════════════════════════════════
function showScore() {
  const row     = S.row;
  const actual  = row['Name of Furry Convention'];
  const guessed = S.conventionGuess;

  const { A, B, C } = S.answers;
  const allCorrect   = A && B && C;
  const distOk       = S.isGeo && S.distanceMiles !== null && S.distanceMiles < 200;
  const perfect      = allCorrect && (!S.isGeo || distOk);

  let html = `
    <div class="names-block">
      <div class="name-row">
        <span class="name-label">Your guess</span>
        <span class="name-value">${escHtml(guessed)}</span>
      </div>
      <div class="name-row">
        <span class="name-label">Actual convention</span>
        <span class="name-value actual">${escHtml(actual)}</span>
      </div>
    </div>
  `;

  if (perfect) {
    html += `
      <div class="big-check">✓</div>
      <p class="perfect-label">Perfect Score!</p>
    `;
  } else {
    html += '<div class="score-items">';

    if (S.isGeo) {
      const dist = S.distanceMiles !== null
        ? `${Math.round(S.distanceMiles).toLocaleString()} miles from target`
        : 'No location guessed';
      html += scoreItem(distOk, `📍 ${dist}`);
    }

    html += scoreItem(A, 'Question A');
    html += scoreItem(B, 'Question B');
    html += scoreItem(C, 'Question C');
    html += '</div>';
  }

  $('score-body').innerHTML = html;
  showView('view-score');
}

function scoreItem(ok, label) {
  return `
    <div class="score-item ${ok ? 'ok' : 'bad'}">
      <span class="score-icon">${ok ? '✓' : '✗'}</span>
      <span class="score-text">${escHtml(label)}</span>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', initEntry);
