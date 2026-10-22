(function () {
  'use strict';
  const { GipController, USB_FILTERS, isGipDevice } = window.GipDriver;

  const BUTTONS = [
    ['a', 'A'], ['b', 'B'], ['x', 'X'], ['y', 'Y'], ['lb', 'LB'], ['rb', 'RB'],
    ['view', 'View'], ['menu', 'Menu'], ['guide', 'Xbox'], ['ls', 'L3'], ['rs', 'R3'],
    ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'],
  ];
  const AXES = [['lx', 'Stick G X'], ['ly', 'Stick G Y'], ['rx', 'Stick D X'], ['ry', 'Stick D Y'],
                ['lt', 'Gâchette G'], ['rt', 'Gâchette D']];

  const statusEl = document.getElementById('status');
  const rawEl = document.getElementById('raw');
  const btnEls = {};
  const axisEls = {};

  for (const [key, label] of BUTTONS) {
    const el = document.createElement('div');
    el.className = 'key';
    el.textContent = label;
    document.getElementById('buttons').appendChild(el);
    btnEls[key] = el;
  }
  for (const [key, label] of AXES) {
    const container = document.getElementById('axes');
    const name = document.createElement('span');
    name.textContent = label;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    const val = document.createElement('span');
    container.append(name, bar, val);
    axisEls[key] = { fill, val, centered: key !== 'lt' && key !== 'rt' };
  }

  function render(s, raw) {
    for (const [key] of BUTTONS) btnEls[key].classList.toggle('on', !!s[key]);
    for (const [key] of AXES) {
      const { fill, val, centered } = axisEls[key];
      const v = s[key];
      if (centered) {
        const left = Math.min(50, 50 + v * 50);
        fill.style.left = left + '%';
        fill.style.width = Math.abs(v * 50) + '%';
      } else {
        fill.style.left = '0';
        fill.style.width = v * 100 + '%';
      }
      val.textContent = v.toFixed(2);
    }
    rawEl.textContent = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  let controller = null;

  async function attach(device) {
    if (controller) return;
    const c = new GipController(device, {
      log: (m) => console.log(m),
      onState: render,
      onDisconnect: () => { controller = null; statusEl.textContent = 'Manette déconnectée.'; },
    });
    try {
      await c.open();
      controller = c;
      statusEl.textContent = `Connectée : ${device.productName || 'manette GIP'}. Appuie sur les boutons !`;
      c.rumble(0.4, 0.4, 300).catch(() => {});
    } catch (err) {
      statusEl.textContent = 'Erreur : ' + err.message;
    }
  }

  document.getElementById('connect').addEventListener('click', async () => {
    if (!navigator.usb) {
      statusEl.textContent = 'WebUSB n’est pas disponible dans ce navigateur (voir le README).';
      return;
    }
    try {
      await attach(await navigator.usb.requestDevice({ filters: USB_FILTERS }));
    } catch (err) {
      if (err.name !== 'NotFoundError') statusEl.textContent = 'Erreur : ' + err.message;
    }
  });

  if (navigator.usb) {
    navigator.usb.getDevices().then((ds) => {
      const d = ds.find(isGipDevice);
      if (d) attach(d);
    });
    navigator.usb.addEventListener('connect', (e) => { if (isGipDevice(e.device)) attach(e.device); });
  } else {
    statusEl.textContent = 'WebUSB n’est pas disponible dans ce navigateur (voir le README).';
  }
})();
