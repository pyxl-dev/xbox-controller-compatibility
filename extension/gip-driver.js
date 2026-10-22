// Pilote GIP (protocole des manettes Xbox One / Series) au-dessus de WebUSB.
// Fonctionne dans le navigateur (navigator.usb) et dans Node (usb.webusb) pour les tests.
// Références : pilote Linux xpad (xpadone_process_packet) et xone.
(function (root) {
  'use strict';

  const GIP_CLASS = 0xff;
  const GIP_SUBCLASS = 0x47;
  const GIP_PROTOCOL = 0xd0;

  const CMD_ACK = 0x01;
  const CMD_ANNOUNCE = 0x02;
  const CMD_POWER = 0x05;
  const CMD_AUTH = 0x06;
  const CMD_VIRTUAL_KEY = 0x07;
  const CMD_RUMBLE = 0x09;
  const CMD_LED = 0x0a;
  const CMD_INPUT = 0x20;

  // Filtres pour navigator.usb.requestDevice : toute manette GIP + PDP.
  const USB_FILTERS = [
    { classCode: GIP_CLASS, subclassCode: GIP_SUBCLASS, protocolCode: GIP_PROTOCOL },
    { vendorId: 0x0e6f },
    { vendorId: 0x24c6 },
  ];

  function isGipDevice(device) {
    if (device.deviceClass === GIP_CLASS && device.deviceSubclass === GIP_SUBCLASS &&
        device.deviceProtocol === GIP_PROTOCOL) return true;
    return !!findGipInterface(device);
  }

  function findGipInterface(device) {
    const configs = device.configurations || (device.configuration ? [device.configuration] : []);
    for (const config of configs) {
      for (const iface of config.interfaces) {
        for (const alt of iface.alternates) {
          if (alt.interfaceClass === GIP_CLASS && alt.interfaceSubclass === GIP_SUBCLASS &&
              alt.interfaceProtocol === GIP_PROTOCOL) {
            const epIn = alt.endpoints.find(e => e.direction === 'in' && e.type === 'interrupt');
            const epOut = alt.endpoints.find(e => e.direction === 'out' && e.type === 'interrupt');
            if (epIn && epOut) {
              return {
                configurationValue: config.configurationValue,
                interfaceNumber: iface.interfaceNumber,
                alternateSetting: alt.alternateSetting,
                epIn: epIn.endpointNumber,
                epOut: epOut.endpointNumber,
                packetSize: epIn.packetSize || 64,
              };
            }
          }
        }
      }
    }
    return null;
  }

  function emptyState() {
    return {
      a: false, b: false, x: false, y: false,
      lb: false, rb: false, view: false, menu: false,
      ls: false, rs: false, up: false, down: false, left: false, right: false,
      guide: false, share: false,
      lt: 0, rt: 0,           // 0..1
      lx: 0, ly: 0, rx: 0, ry: 0, // -1..1, Y vers le bas positif (convention Gamepad API)
    };
  }

  function axis(value) {
    return Math.max(-1, Math.min(1, value / 32767));
  }

  class GipController {
    constructor(device, { log = () => {}, onState = () => {}, onDisconnect = () => {} } = {}) {
      this.device = device;
      this.log = log;
      this.onState = onState;
      this.onDisconnect = onDisconnect;
      this.seq = 0;
      this.state = emptyState();
      this.timestamp = 0;
      this.running = false;
      this.rumbleTimer = null;
    }

    async open() {
      const d = this.device;
      if (!d.opened) await d.open();
      let info = findGipInterface(d);
      if (!info) throw new Error('Interface GIP introuvable sur ce périphérique');
      if (!d.configuration || d.configuration.configurationValue !== info.configurationValue) {
        await d.selectConfiguration(info.configurationValue);
        info = findGipInterface(d);
      }
      this.info = info;
      await d.claimInterface(info.interfaceNumber);
      if (info.alternateSetting) {
        await d.selectAlternateInterface(info.interfaceNumber, info.alternateSetting);
      }
      this.running = true;
      this.readLoop();
      await this.sendInit();
    }

    async close() {
      this.running = false;
      try { await this.device.releaseInterface(this.info.interfaceNumber); } catch (_) {}
      try { await this.device.close(); } catch (_) {}
    }

    nextSeq() {
      this.seq = (this.seq + 1) & 0xff;
      if (this.seq === 0) this.seq = 1;
      return this.seq;
    }

    async send(bytes) {
      const data = new Uint8Array(bytes);
      await this.device.transferOut(this.info.epOut, data);
    }

    async sendInit() {
      // Même séquence que xpad pour les manettes PDP (0x0e6f) : allumage, LED, « auth ».
      await this.send([CMD_POWER, 0x20, this.nextSeq(), 0x01, 0x00]);
      if (this.device.vendorId === 0x0e6f) {
        await this.send([CMD_LED, 0x20, this.nextSeq(), 0x03, 0x00, 0x01, 0x14]);
        await this.send([CMD_AUTH, 0x20, this.nextSeq(), 0x02, 0x01, 0x00]);
      }
      this.log('Initialisation GIP envoyée');
    }

    async readLoop() {
      while (this.running) {
        let result;
        try {
          result = await this.device.transferIn(this.info.epIn, this.info.packetSize);
        } catch (err) {
          if (!this.running) return;
          this.running = false;
          this.log('Lecture interrompue : ' + (err && err.message));
          this.onDisconnect(err);
          return;
        }
        if (result.status !== 'ok' || !result.data) continue;
        const bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        try {
          await this.handlePacket(bytes);
        } catch (err) {
          this.log('Paquet ignoré : ' + (err && err.message));
        }
      }
    }

    async handlePacket(p) {
      if (p.length < 4) return;
      const cmd = p[0];
      const needsAck = (p[1] & 0x10) !== 0;
      if (needsAck) await this.ack(p);

      if (cmd === CMD_INPUT && p.length >= 18) {
        const s = this.state;
        const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        s.menu = !!(p[4] & 0x04);
        s.view = !!(p[4] & 0x08);
        s.a = !!(p[4] & 0x10);
        s.b = !!(p[4] & 0x20);
        s.x = !!(p[4] & 0x40);
        s.y = !!(p[4] & 0x80);
        s.up = !!(p[5] & 0x01);
        s.down = !!(p[5] & 0x02);
        s.left = !!(p[5] & 0x04);
        s.right = !!(p[5] & 0x08);
        s.lb = !!(p[5] & 0x10);
        s.rb = !!(p[5] & 0x20);
        s.ls = !!(p[5] & 0x40);
        s.rs = !!(p[5] & 0x80);
        s.lt = Math.min(1, dv.getUint16(6, true) / 1023);
        s.rt = Math.min(1, dv.getUint16(8, true) / 1023);
        s.lx = axis(dv.getInt16(10, true));
        s.ly = -axis(dv.getInt16(12, true));
        s.rx = axis(dv.getInt16(14, true));
        s.ry = -axis(dv.getInt16(16, true));
        this.emit(p);
      } else if (cmd === CMD_VIRTUAL_KEY && p.length >= 5) {
        this.state.guide = !!(p[4] & 0x01);
        this.emit(p);
      } else if (cmd === CMD_ANNOUNCE) {
        // La manette s'annonce (par ex. après une reconnexion) : on la réinitialise.
        this.log('Annonce reçue, réinitialisation');
        await this.sendInit();
      }
    }

    async ack(p) {
      // Accusé de réception GIP (format repris de xpad / xone).
      await this.send([CMD_ACK, 0x20, p[2], 0x09, 0x00, p[0], 0x20, p[3], 0x00, 0x00, 0x00, 0x00, 0x00]);
    }

    emit(raw) {
      this.timestamp = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.onState(this.state, raw);
    }

    // strong / weak : 0..1, durée en ms.
    async rumble(strong, weak, durationMs) {
      const s = Math.round(Math.max(0, Math.min(1, strong)) * 100);
      const w = Math.round(Math.max(0, Math.min(1, weak)) * 100);
      clearTimeout(this.rumbleTimer);
      await this.send([CMD_RUMBLE, 0x00, this.nextSeq(), 0x09, 0x00, 0x0f, 0x00, 0x00, s, w, 0xff, 0x00, 0xff]);
      if (durationMs > 0 && (s || w)) {
        this.rumbleTimer = setTimeout(() => this.rumble(0, 0, 0).catch(() => {}), durationMs);
      }
    }
  }

  const api = { GipController, USB_FILTERS, isGipDevice, findGipInterface, emptyState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GipDriver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
