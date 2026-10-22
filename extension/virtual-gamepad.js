// Injecté dans la page Luna (monde MAIN) : branche la manette GIP via WebUSB
// et la présente comme une manette Xbox standard à navigator.getGamepads().
(function () {
  'use strict';
  if (window.__afterglowGamepadInstalled) return;
  window.__afterglowGamepadInstalled = true;

  const { GipController, USB_FILTERS, isGipDevice, emptyState } = window.GipDriver;
  const TAG = '[Afterglow → Luna]';
  const log = (...args) => console.log(TAG, ...args);

  // Identifiant au format Chrome d'une manette Xbox Series officielle, pour que les jeux
  // affichent les bons pictogrammes.
  const GAMEPAD_ID = 'Xbox Series X Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)';

  let controller = null;
  let state = emptyState();
  let timestamp = 0;
  let virtualIndex = 0;
  let connected = false;

  // --- Gamepad virtuel -------------------------------------------------------

  function makeButton(pressed, value) {
    const b = Object.create(typeof GamepadButton !== 'undefined' ? GamepadButton.prototype : Object.prototype);
    Object.defineProperties(b, {
      pressed: { value: pressed, enumerable: true },
      touched: { value: pressed || value > 0, enumerable: true },
      value: { value: value, enumerable: true },
    });
    return b;
  }

  const vibrationActuator = {
    type: 'dual-rumble',
    effects: ['dual-rumble'],
    canPlayEffectType: (t) => t === 'dual-rumble',
    playEffect(type, params = {}) {
      if (!controller || type !== 'dual-rumble') return Promise.resolve('preempted');
      const duration = params.duration || 0;
      return controller.rumble(params.strongMagnitude || 0, params.weakMagnitude || 0, duration)
        .then(() => new Promise((r) => setTimeout(() => r('complete'), duration)))
        .catch(() => 'preempted');
    },
    reset() {
      if (controller) controller.rumble(0, 0, 0).catch(() => {});
      return Promise.resolve('complete');
    },
  };

  function snapshot() {
    const s = state;
    const btn = (p) => makeButton(p, p ? 1 : 0);
    const trig = (v) => makeButton(v > 0.12, v);
    const buttons = [
      btn(s.a), btn(s.b), btn(s.x), btn(s.y),
      btn(s.lb), btn(s.rb), trig(s.lt), trig(s.rt),
      btn(s.view), btn(s.menu), btn(s.ls), btn(s.rs),
      btn(s.up), btn(s.down), btn(s.left), btn(s.right),
      btn(s.guide),
    ];
    const g = Object.create(typeof Gamepad !== 'undefined' ? Gamepad.prototype : Object.prototype);
    Object.defineProperties(g, {
      id: { value: GAMEPAD_ID, enumerable: true },
      index: { value: virtualIndex, enumerable: true },
      connected: { value: connected, enumerable: true },
      mapping: { value: 'standard', enumerable: true },
      timestamp: { value: timestamp, enumerable: true },
      axes: { value: Object.freeze([s.lx, s.ly, s.rx, s.ry]), enumerable: true },
      buttons: { value: Object.freeze(buttons), enumerable: true },
      vibrationActuator: { value: vibrationActuator, enumerable: true },
      hapticActuators: { value: [], enumerable: true },
    });
    return g;
  }

  const nativeGetGamepads = Navigator.prototype.getGamepads;

  function patchedGetGamepads() {
    const real = Array.from(nativeGetGamepads.call(navigator) || []);
    if (!connected) return real;
    // Place la manette virtuelle sur le premier emplacement libre.
    const list = real.slice();
    while (list.length <= virtualIndex) list.push(null);
    list[virtualIndex] = snapshot();
    return list;
  }
  Object.defineProperty(patchedGetGamepads, 'name', { value: 'getGamepads' });
  Navigator.prototype.getGamepads = patchedGetGamepads;
  // Fait passer la fonction pour native auprès des scripts qui vérifient toString().
  const nativeToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (this === patchedGetGamepads) return nativeToString.call(nativeGetGamepads);
    return nativeToString.call(this);
  };

  function fireGamepadEvent(type) {
    const ev = new Event(type);
    Object.defineProperty(ev, 'gamepad', { value: snapshot() });
    window.dispatchEvent(ev);
  }

  // --- Connexion USB ---------------------------------------------------------

  async function attach(device) {
    if (controller) return;
    const real = Array.from(nativeGetGamepads.call(navigator) || []);
    virtualIndex = real.findIndex((g) => !g);
    if (virtualIndex < 0) virtualIndex = real.length;

    const c = new GipController(device, {
      log,
      onState: (s) => { state = s; timestamp = c.timestamp; },
      onDisconnect: () => detach(),
    });
    try {
      await c.open();
    } catch (err) {
      log('Impossible d’ouvrir la manette :', err);
      toast('Impossible d’ouvrir la manette : ' + err.message, true);
      try { await device.close(); } catch (_) {}
      return;
    }
    controller = c;
    connected = true;
    timestamp = performance.now();
    log('Manette connectée à l’emplacement', virtualIndex);
    fireGamepadEvent('gamepadconnected');
    hideButton();
    toast('Manette Afterglow connectée 🎮');
    c.rumble(0.3, 0.3, 200).catch(() => {});
  }

  function detach() {
    if (!controller) return;
    controller = null;
    if (connected) {
      fireGamepadEvent('gamepaddisconnected');
      connected = false;
      state = emptyState();
      toast('Manette déconnectée', true);
    }
    showButton();
  }

  async function autoConnect() {
    if (!navigator.usb) {
      log('WebUSB indisponible dans ce navigateur/cette page');
      return;
    }
    try {
      const devices = (await navigator.usb.getDevices()).filter(isGipDevice);
      if (devices.length) await attach(devices[0]);
      else showButton();
    } catch (err) {
      log('WebUSB bloqué :', err);
      showButton();
    }
  }

  async function requestController() {
    if (!navigator.usb) {
      toast('WebUSB est désactivé dans ce navigateur (voir le README).', true);
      return;
    }
    try {
      const device = await navigator.usb.requestDevice({ filters: USB_FILTERS });
      await attach(device);
    } catch (err) {
      if (err && err.name === 'NotFoundError') return; // fenêtre fermée sans choix
      log('Erreur de connexion :', err);
      toast('Erreur : ' + err.message, true);
    }
  }

  if (navigator.usb) {
    navigator.usb.addEventListener('connect', (e) => {
      if (isGipDevice(e.device)) attach(e.device);
    });
    navigator.usb.addEventListener('disconnect', (e) => {
      if (controller && e.device === controller.device) detach();
    });
  }

  // --- Interface (bouton flottant + messages) --------------------------------

  let host = null;
  let shadow = null;

  function ensureUi() {
    if (host) return true;
    if (!document.body) return false;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        button, .toast { font: 600 14px -apple-system, system-ui, sans-serif; border-radius: 999px; }
        button { display:none; padding:10px 16px; border:0; cursor:pointer; color:#fff;
                 background:#7b2ff7; box-shadow:0 4px 16px rgba(0,0,0,.35); }
        button:hover { background:#6420d6; }
        .toast { position:absolute; right:0; bottom:52px; white-space:nowrap; padding:8px 14px;
                 color:#fff; background:#1d7a3a; opacity:0; transition:opacity .3s; pointer-events:none; }
        .toast.error { background:#a3261c; }
        .toast.show { opacity:1; }
      </style>
      <div class="toast"></div>
      <button type="button">🎮 Connecter la manette</button>`;
    shadow.querySelector('button').addEventListener('click', requestController);
    document.body.appendChild(host);
    return true;
  }

  function whenUiReady(fn) {
    if (ensureUi()) fn();
    else document.addEventListener('DOMContentLoaded', () => { ensureUi(); fn(); }, { once: true });
  }

  function showButton() { whenUiReady(() => { shadow.querySelector('button').style.display = 'block'; }); }
  function hideButton() { whenUiReady(() => { shadow.querySelector('button').style.display = 'none'; }); }

  let toastTimer = null;
  function toast(message, isError) {
    whenUiReady(() => {
      const el = shadow.querySelector('.toast');
      el.textContent = message;
      el.classList.toggle('error', !!isError);
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
    });
  }

  autoConnect();
})();
