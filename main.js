const APP_VERSION = '2';
const STORAGE_KEY = 'cluedo-pwa:v2';
const VERSION_KEY = 'cluedo-pwa:app-version';

// Etats de cellule: 0=inconnu, 1=possede, 2=soupçonne, 3=ne l'a pas
const CellState = {
  unknown: 0,
  have: 1,
  suspect: 2,
  not: 3
};

const CellCycle = [CellState.unknown, CellState.not, CellState.suspect, CellState.have];

const CARD_CATALOG = {
  suspects: [
    { key: 'Madame Pervenche', name: 'גרין' },
    { key: 'Colonel Moutarde', name: 'חרדלי' },
    { key: 'Madame Rose', name: 'אורכידאה' },
    { key: 'Professeur Vert', name: 'רקיע' },
    { key: 'Docteur Olive', name: 'שזיפי' },
    { key: 'Mademoiselle Scarlett', name: 'שני' }
  ],
  weapons: [
    { key: 'Fusil', name: 'פמוט' },
    { key: 'Canne', name: 'פגיון' },
    { key: 'Dague', name: 'מוט ברזל' },
    { key: 'Chandelier', name: 'אקדח' },
    { key: 'Clé anglaise', name: 'חבל' },
    { key: 'Révolver', name: 'מפתח צינורות' }
  ],
  rooms: [
    { key: 'Salon', name: 'אולם נשפים' },
    { key: 'Jardin', name: 'חדר ביליארד' },
    { key: 'Chambre', name: 'חממה' },
    { key: 'Salle à manger', name: 'חדר אוכל' },
    { key: 'Cuisine', name: 'מסדרון' },
    { key: 'Bureau', name: 'מטבח' },
    { key: 'Salle de bain', name: 'ספרייה' },
    { key: 'Biblioteque', name: 'סלון' },
    { key: 'Garage', name: 'חדר עבודה' }
  ]
};

function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
}

function normalizeName(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

function makeCardId(category, key) {
  return category + ':' + key;
}

function getAllCards() {
  const cards = [];
  for (const [category, names] of Object.entries(CARD_CATALOG)) {
    for (const item of names) {
      cards.push({ id: makeCardId(category, item.key), category, name: item.name, key: item.key });
    }
  }
  return cards;
}

const ALL_CARDS = getAllCards();

function emptyGrid(players) {
  const grid = {};
  for (const card of ALL_CARDS) {
    grid[card.id] = {};
    for (const p of players) {
      grid[card.id][p.id] = CellState.unknown;
    }
  }
  return grid;
}

function defaultGame(playersCount, playersNames) {
  const players = Array.from({ length: playersCount }, (_, i) => {
    const name = normalizeName(playersNames?.[i]) || ('שחקן ' + (i + 1));
    return { id: uid('p'), name };
  });

  return {
    version: 1,
    players,
    grid: emptyGrid(players),
    crossedCards: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function clearAppStorage() {
  try {
    localStorage.removeItem('cluedo-pwa:v1');
    localStorage.removeItem('cluedo-pwa:v2');
    sessionStorage.clear();
  } catch {}
}

async function clearAppCaches() {
  if (!('caches' in window)) return;

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('cluedo-cache-'))
        .map((key) => caches.delete(key))
    );
  } catch {}
}

async function migrateIfNeeded() {
  const savedVersion = localStorage.getItem(VERSION_KEY);

  if (savedVersion === APP_VERSION) return;

  clearAppStorage();

  try {
    localStorage.setItem(VERSION_KEY, APP_VERSION);
  } catch {}
}

function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;

    if (!parsed.grid) parsed.grid = {};
    if (!parsed.crossedCards) parsed.crossedCards = {};
    const grid = parsed.grid;

    for (const card of ALL_CARDS) {
      if (!grid[card.id]) grid[card.id] = {};
      for (const p of parsed.players ?? []) {
        if (grid[card.id][p.id] == null) {
          grid[card.id][p.id] = CellState.unknown;
        }
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveGame(game) {
  const next = { ...game, updatedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function stateToText(state) {
  switch (state) {
    case CellState.have:
      return 'יש לו';
    case CellState.suspect:
      return 'אני חושד';
    case CellState.not:
      return 'אין לו';
    default:
      return '';
  }
}

function stateToGlyph(state) {
  switch (state) {
    case CellState.not:
      return '×';
    case CellState.suspect:
      return '?';
    case CellState.have:
      return '✓';
    default:
      return '';
  }
}

function cycleState(current) {
  const idx = CellCycle.indexOf(current);
  const nextIdx = (idx >= 0 ? idx + 1 : 1) % CellCycle.length;
  return CellCycle[nextIdx];
}

function categoryLabel(cat) {
  if (cat === 'suspects') return 'דמויות';
  if (cat === 'weapons') return 'כלי רצח';
  if (cat === 'rooms') return 'חדרים';
  return cat;
}

function computeCardStats(game, card) {
  const playerStates = game.players.map((p) => game.grid?.[card.id]?.[p.id] ?? CellState.unknown);
  const haveCount = playerStates.filter((s) => s === CellState.have).length;
  const notCount = playerStates.filter((s) => s === CellState.not).length;
  const suspectCount = playerStates.filter((s) => s === CellState.suspect).length;

  const hasOwner = haveCount > 0;
  const allNot = notCount === game.players.length && game.players.length > 0;

  const possibleOwners = playerStates
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s !== CellState.not);

  const forcedOwner = !hasOwner && possibleOwners.length === 1
    ? game.players[possibleOwners[0].i]
    : null;

  return { haveCount, notCount, suspectCount, hasOwner, allNot, forcedOwner };
}

function computeSuggestions(game) {
  const forcings = [];
  const solution = {
    suspects: { certain: [], candidates: [] },
    weapons: { certain: [], candidates: [] },
    rooms: { certain: [], candidates: [] }
  };

  for (const card of ALL_CARDS) {
    const st = computeCardStats(game, card);

    if (st.allNot) solution[card.category].certain.push(card);

    if (!st.hasOwner) {
      solution[card.category].candidates.push({ card, ...st });
    }

    if (st.forcedOwner) {
      forcings.push({ card, player: st.forcedOwner });
    }
  }

  for (const cat of Object.keys(solution)) {
    solution[cat].candidates.sort((a, b) => b.notCount - a.notCount || b.suspectCount - a.suspectCount);
    solution[cat].candidates = solution[cat].candidates.slice(0, 3);
  }

  forcings.sort((a, b) => {
    const sa = computeCardStats(game, a.card);
    const sb = computeCardStats(game, b.card);
    return sb.notCount - sa.notCount;
  });

  return { forcings: forcings.slice(0, 5), solution };
}

function ensureAppRoot() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app');
  return app;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') {
      node.className = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }

  for (const ch of children) {
    if (ch == null) continue;
    node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  }

  return node;
}

function renderSetup(app, initialPlayers = 3) {
  clear(app);

  const wrap = el('div', { class: 'card section' });
  const grid = el('div', { class: 'col' });

  const countLabel = el('label', {}, ['מספר שחקנים']);
  const countInput = document.createElement('input');

  countInput.type = 'text';
  countInput.inputMode = 'numeric';
  countInput.autocomplete = 'off';
  countInput.spellcheck = false;
  countInput.style.direction = 'ltr';
  countInput.style.textAlign = 'right';

  const digitMap = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    '۰': '0',
    '۱': '1',
    '۲': '2',
    '۳': '3',
    '۴': '4',
    '۵': '5',
    '۶': '6',
    '۷': '7',
    '۸': '8',
    '۹': '9'
  };

  function toAsciiDigits(str) {
    return String(str ?? '').replace(/[٠-٩۰-۹]/g, (d) => digitMap[d] ?? d);
  }

  function normalizePlayerCount(value) {
    const ascii = toAsciiDigits(value);
    const m = ascii.match(/\d+/);
    if (!m) return null;

    const n = parseInt(m[0], 10);
    if (!Number.isFinite(n)) return null;

    return Math.max(2, Math.min(8, n));
  }

  const initialN = normalizePlayerCount(initialPlayers) ?? 3;
  countInput.value = String(initialN);

  const playersBox = el('div', { class: 'col' });

  function renderPlayerInputs(count) {
    clear(playersBox);

    for (let i = 0; i < count; i++) {
      const lbl = el('label', {}, ['שם השחקן ' + (i + 1)]);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'לדוגמה: אלכס';
      inp.autocomplete = 'off';
      inp.setAttribute('data-player-idx', String(i));
      inp.value = '';

      playersBox.appendChild(lbl);
      playersBox.appendChild(inp);
    }
  }

  renderPlayerInputs(initialN);

  const applyFromInput = () => {
    const n = normalizePlayerCount(countInput.value);
    if (n == null) return;

    if (String(n) !== countInput.value) {
      countInput.value = String(n);
    }

    renderPlayerInputs(n);
  };

  countInput.addEventListener('input', applyFromInput);
  countInput.addEventListener('change', applyFromInput);
  countInput.addEventListener('blur', applyFromInput);

  const startBtn = el('button', { class: 'btnPrimary' }, ['התחל']);
  startBtn.addEventListener('click', () => {
    const n = normalizePlayerCount(countInput.value) ?? initialN;
  
    const inputs = Array.from(playersBox.querySelectorAll('input[data-player-idx]'));
    const names = inputs
      .sort((a, b) => Number(a.dataset.playerIdx) - Number(b.dataset.playerIdx))
      .map((inp) => inp.value);
  
    const cleaned = names.map((nm, i) => {
      const x = normalizeName(nm) || ('שחקן ' + (i + 1));
      return x;
    });
  
    const game = defaultGame(n, cleaned);
    saveGame(game);
  
    if (n >= 5) {
      alert('עבור 5 שחקנים או יותר, מומלץ לסובב את הטלפון לרוחב כדי לראות טוב יותר.');    }
  
    renderMain(app, game);
  });
  const hint = el(
    'div',
    { class: 'mini' },
    ['טיפ: לחץ על תא כדי לעבור בין המצבים: לא ידוע → אין לו → אני חושד → יש לו.']
  );

  grid.appendChild(el('div', { class: 'col' }, [countLabel, countInput]));
  grid.appendChild(playersBox);
  grid.appendChild(startBtn);
  grid.appendChild(hint);
  wrap.appendChild(grid);
  app.appendChild(wrap);
}

function renderMain(app, game) {
  clear(app);

  const topHeader = el('div', { class: 'header' });
  const actions = el('div', { class: 'row' });

  const backBtn = el('button', { class: 'btnGhost' }, ['חזרה']);
  backBtn.addEventListener('click', () => {
    if (!confirm('לחזור להגדרת המשחק? זה ימחק את כל הסימונים.')) return;

    localStorage.removeItem(STORAGE_KEY);
    renderSetup(app, game.players.length);
  });

  const resetBtn = el('button', { class: 'btnDanger' }, ['איפוס']);
  resetBtn.addEventListener('click', () => {
    if (!confirm('לאפס את הטבלה ולהתחיל מחדש?')) return;

    const newGame = defaultGame(game.players.length, game.players.map((p) => p.name));
    saveGame(newGame);
    game = newGame;
    renderMain(app, game);
  });

  actions.appendChild(backBtn);
  actions.appendChild(resetBtn);
  topHeader.appendChild(actions);

  app.appendChild(el('div', { class: 'card section' }, [topHeader]));

  const boardCard = el('div', { class: 'card' });
  const boardWrap = el('div', { class: 'section' });
  const boardTitle = el('div', { class: 'row' });

  boardWrap.appendChild(boardTitle);
  boardCard.appendChild(boardWrap);

  const matrixWrap = el('div', { class: 'matrixWrap' });
  boardCard.appendChild(matrixWrap);

  app.appendChild(boardCard);

  renderBoard(boardCard, game);

  function renderBoard(container, currentGame) {
    const matrixWrapEl = container.querySelector('.matrixWrap') || matrixWrap;
    clear(matrixWrapEl);

    const categories = ['suspects', 'weapons', 'rooms'];

    for (const cat of categories) {
      const block = el('div', { class: 'solutionBlock' });
      block.style.marginBottom = '10px';

      block.appendChild(el('h3', {}, [categoryLabel(cat)]));

      const cards = ALL_CARDS.filter((c) => c.category === cat);

      const table = document.createElement('table');
      table.className = 'matrix';

      const thead = document.createElement('thead');
      const hr = document.createElement('tr');

      const th0 = document.createElement('th');
      th0.textContent = 'קלפים';
      hr.appendChild(th0);

      for (const p of currentGame.players) {
        const th = document.createElement('th');
        th.textContent = p.name;
        hr.appendChild(th);
      }

      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      for (const card of cards) {
        const tr = document.createElement('tr');

        const th = document.createElement('th');
        th.textContent = card.name;

        const isCrossed = !!currentGame.crossedCards?.[card.id];
        if (isCrossed) {
          th.style.textDecoration = 'line-through';
          th.style.opacity = '0.6';
        }

        th.style.cursor = 'pointer';
        th.title = 'לחץ כדי לסמן/לבטל';

        th.addEventListener('click', () => {
          if (!currentGame.crossedCards) currentGame.crossedCards = {};
          currentGame.crossedCards[card.id] = !currentGame.crossedCards[card.id];
          saveGame(currentGame);
          renderMain(app, currentGame);
        });

        tr.appendChild(th);

        for (const p of currentGame.players) {
          const td = document.createElement('td');

          const btn = document.createElement('button');
          btn.className = 'cell';

          const state = currentGame.grid?.[card.id]?.[p.id] ?? CellState.unknown;
          btn.dataset.state = String(state);

          btn.setAttribute(
            'aria-label',
            card.name + ', ' + p.name + ': ' + (stateToText(state) || 'לא ידוע') + ' (לחץ כדי לשנות)'
          );

          const inner = document.createElement('div');
          inner.className = 'cellInner';

          const glyph = document.createElement('div');
          glyph.className = 'stateText';
          glyph.textContent = stateToGlyph(state);

          inner.appendChild(glyph);
          btn.appendChild(inner);

          btn.addEventListener('click', () => {
            const current = currentGame.grid[card.id][p.id] ?? CellState.unknown;
            const next = cycleState(current);
            currentGame.grid[card.id][p.id] = next;
            saveGame(currentGame);
            renderMain(app, currentGame);
          });

          td.appendChild(btn);
          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      block.appendChild(table);
      matrixWrapEl.appendChild(block);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#039;';
      default:
        return c;
    }
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');

    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    let hasRefreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasRefreshed) return;
      hasRefreshed = true;
      window.location.reload();
    });
  } catch {
    // silencieux
  }
}

async function bootstrap() {
  await migrateIfNeeded();

  const app = ensureAppRoot();
  const game = loadGame();

  await registerServiceWorker();

  if (!game) {
    renderSetup(app, 3);
  } else {
    renderMain(app, game);
  }
}

bootstrap();