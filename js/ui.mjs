/* Menus, lobby and the shop window.
 *
 * All of it is ordinary DOM sitting on top of the canvas, which means the
 * whole front of the game is keyboard accessible, selectable, and readable by
 * a screen reader for free - none of which a canvas menu would have been.
 */

import { asset } from './base.mjs';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SCENARIOS = [
  {
    id: 'hotel', season: 'SEASON 1', name: 'THE COLLAPSING HOTEL', icon: '🏨',
    tint: 'linear-gradient(160deg,#b8703c,#5f2028)', ready: true,
    blurb: 'You wake up on the fourth floor. The fourth floor is not going to be there much longer.',
  },
  { id: 'ship', season: 'SEASON 2', name: 'THE SINKING SHIP', icon: '🚢',
    tint: 'linear-gradient(160deg,#2f6f8f,#16303f)', blurb: 'Everything slides. Including you.' },
  { id: 'city', season: 'SEASON 3', name: 'THE HAUNTED CITY', icon: '🌃',
    tint: 'linear-gradient(160deg,#4a3a6f,#20182f)', blurb: 'Something else is holding the other end.' },
  { id: 'space', season: 'SEASON 4', name: 'THE SPACE STATION', icon: '🛰️',
    tint: 'linear-gradient(160deg,#356f66,#12262b)', blurb: 'No gravity. Somehow worse.' },
];

const STORE = [
  { name: 'REMOVE ADS', price: '$4.99', icon: '🚫', best: true,
    blurb: 'Removes ads permanently, and comes with an exclusive supporter cosmetic.' },
  { name: 'SUPPORTER PACK', price: '$9.99', icon: '💛',
    blurb: 'Removes ads, an exclusive character, a cosmetic bundle and a supporter badge.' },
  { name: 'BANANA COSTUME', price: '$1.99', icon: '🍌', blurb: 'It is a banana. You are the banana.' },
  { name: 'INFLATABLE CHICKEN', price: '$2.49', icon: '🐔', blurb: 'Wobbles independently of your ragdoll. Sorry.' },
  { name: 'BUSINESS SUIT', price: '$1.49', icon: '👔', blurb: 'Dignity, briefly.' },
  { name: 'PIRATE OUTFIT', price: '$1.99', icon: '🏴‍☠️', blurb: 'The hat survives most falls.' },
  { name: 'ASTRONAUT OUTFIT', price: '$2.99', icon: '👨‍🚀', blurb: 'Slow, majestic flailing.' },
  { name: 'FUNNY HAT BUNDLE', price: '$0.99', icon: '🎩', blurb: 'Six hats. One of them is a traffic cone.' },
  { name: 'EMOTE: POINT AND LAUGH', price: '$0.99', icon: '😂', blurb: 'For after you drop your friend.' },
  { name: 'RAGDOLL EFFECT: CONFETTI', price: '$1.49', icon: '🎉', blurb: 'Every wipeout throws a small party.' },
];

export const UI = {
  peerName: 'FRIEND',
  picked: 'gary',
  cast: [],
  cb: {},

  init(opts) {
    UI.cast = opts.cast;
    UI.cb = opts;
    UI.picked = localStorage.getItem('et.char') || 'gary';

    buildCharacters();
    buildScenarios();
    buildStore();
    paintPicked();

    $$('[data-nav]').forEach((el) =>
      el.addEventListener('click', () => show(el.dataset.nav)));

    $$('[data-act]').forEach((el) =>
      el.addEventListener('click', () => act(el.dataset.act)));

    $('#codeinput').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    $('#codeinput').addEventListener('keydown', (e) => { if (e.key === 'Enter') act('join'); });

    $('#creatorform').addEventListener('submit', (e) => {
      e.preventDefault();
      e.target.innerHTML =
        '<h3>THANK YOU</h3><p class="sub">Applications are not open yet - this prototype ' +
        'keeps nothing and sends nothing. When creator characters are real, this is where ' +
        'you will apply.</p>';
    });

    $('#setsound').addEventListener('change', (e) => opts.onSound(e.target.checked));
    $('#setmusic').addEventListener('change', (e) => opts.onMusic(e.target.checked));
    $('#replaytutorial').addEventListener('click', (e) => {
      opts.onTutorial();
      e.target.textContent = 'THE TUTORIAL WILL RUN AGAIN';
    });
    $('#setstreamer').addEventListener('change', (e) =>
      document.body.classList.toggle('streamer', e.target.checked));

    // an invite link drops you straight into the join box with the code filled
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      $('#codeinput').value = room.toUpperCase().slice(0, 5);
      show('joinform');
      $('#joinstatus').textContent = 'INVITED TO ROOM ' + room.toUpperCase();
    }

    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('playing')) show('menu');
    });
  },

  setStatus(msg) { $('#status').textContent = msg || ''; $('#joinstatus').textContent = msg || ''; },

  setRoom(code, slot) {
    $('#roomcode').textContent = code;
    show('lobby');
  },

  setLobby(room, slot) {
    const other = room.players[1 - slot];
    $('#lobbystate').textContent = other
      ? 'Your friend is here. Go on then.'
      : 'Waiting for your friend to join…';
    const slots = room.players.map((p, i) => {
      if (!p) return '<div class="slot empty"><b>EMPTY</b><p class="tiny">no one yet</p></div>';
      const c = UI.cast.find((x) => x.id === p.char) || UI.cast[0];
      return '<div class="slot"><img src="' + asset('hero/' + c.id + '.webp') + '" alt="">' +
        '<b>' + c.name + '</b><p class="tiny">' + (i === slot ? 'YOU' : 'YOUR FRIEND') + '</p></div>';
    });
    $('#lobbyslots').innerHTML = slots.join('');
  },

  showEnd(won) {
    $('#endtitle').textContent = won ? 'YOU BOTH GOT OUT' : 'MISSION SUCCESSFULLY FAILED';
    $('#endsub').textContent = won
      ? 'Against every reasonable expectation.'
      : 'The hotel is now a car park. Go again?';
    $('#endscreen').classList.add('show');
  },

  hideEnd() { $('#endscreen').classList.remove('show'); },
};

/* ------------------------------------------------------------------ screens */

const SCREENS = ['menu', 'joinform', 'lobby', 'characters', 'scenarios', 'store', 'creators', 'settings'];

function show(id) {
  for (const s of SCREENS) $('#' + s).classList.toggle('show', s === id);
  if (id === 'menu' && document.body.classList.contains('playing')) {
    // pausing out of a live game keeps the room; leaving is a separate button
    $('#menu').querySelector('[data-act="play"]').textContent = 'RESUME';
  }
}

function hideAll() {
  for (const s of SCREENS) $('#' + s).classList.remove('show');
  UI.hideEnd();
}

function act(what) {
  const cb = UI.cb;
  switch (what) {
    case 'play':
      if (document.body.classList.contains('playing')) { hideAll(); return; }
      cb.onPlay('create', null, UI.picked);
      break;
    case 'create':
      cb.onPlay('create', null, UI.picked);
      break;
    case 'joinform':
      show('joinform');
      $('#codeinput').focus();
      break;
    case 'join': {
      const code = $('#codeinput').value.trim().toUpperCase();
      if (code.length < 5) return UI.setStatus('THAT CODE IS TOO SHORT');
      UI.setStatus('');
      cb.onPlay('join', code, UI.picked);
      break;
    }
    case 'copy': {
      const link = location.origin + location.pathname + '?room=' + $('#roomcode').textContent;
      navigator.clipboard.writeText(link).then(
        () => { $('#lobbystate').textContent = 'LINK COPIED. Send it to your friend.'; },
        () => { $('#lobbystate').textContent = link; });
      break;
    }
    case 'solo': cb.onSolo(); break;
    case 'drop':
      hideAll();
      document.body.classList.add('playing');
      cb.onStart();
      break;
    case 'retry':
      cb.onRetry();
      hideAll();
      break;
    case 'quit':
      cb.onQuit();
      document.body.classList.remove('playing');
      show('menu');
      $('#menu').querySelector('[data-act="play"]').textContent = 'PLAY';
      break;
  }
}

/* -------------------------------------------------------------------- cards */

function buildCharacters() {
  $('#charcards').innerHTML = UI.cast.map((c) => `
    <div class="card" data-char="${c.id}">
      <img src="${asset('hero/' + c.id + '.webp')}" alt="${c.name}">
      <b>${c.name}</b>
      <span class="tag">${c.tag}</span>
      <span class="quip">${c.quip}</span>
    </div>`).join('');
  $$('#charcards .card').forEach((el) =>
    el.addEventListener('click', () => {
      UI.picked = el.dataset.char;
      localStorage.setItem('et.char', UI.picked);
      paintPicked();
      UI.cb.onChar(UI.picked);
    }));
}

function paintPicked() {
  $$('#charcards .card').forEach((el) =>
    el.classList.toggle('picked', el.dataset.char === UI.picked));
  const c = UI.cast.find((x) => x.id === UI.picked) || UI.cast[0];
  if (!c) return;
  $('#pickedcard').innerHTML =
    `<img src="${asset('hero/' + c.id + '.webp')}" alt=""><b>${c.name}</b>` +
    `<span class="tag">${c.tag}</span><span class="tiny">tap CHARACTERS to swap</span>`;
}

function buildScenarios() {
  $('#scenariocards').innerHTML = SCENARIOS.map((s) => `
    <div class="card ${s.ready ? '' : 'locked'}">
      <div class="thumb" style="background:${s.tint}">${s.icon}</div>
      <span class="season">${s.season}</span>
      <b>${s.name}</b>
      <span class="quip">${s.blurb}</span>
      <span class="price">${s.ready ? 'PLAYABLE NOW' : 'NOT BUILT YET'}</span>
    </div>`).join('');
}

function buildStore() {
  $('#storecards').innerHTML = STORE.map((s) => `
    <div class="card locked">
      <div class="thumb" style="background:linear-gradient(160deg,#6b4326,#2a1a17)">${s.icon}</div>
      <b>${s.name}</b>
      <span class="quip">${s.blurb}</span>
      <span class="price">${s.price}</span>
      ${s.best ? '<span class="tiny">most popular</span>' : ''}
    </div>`).join('');
}
