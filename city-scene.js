/* <iso-city> — procedural wireframe isometric city, Three.js.
   Attributes / properties:
     scene   : 0..3  — which district is highlighted + camera azimuth target
     accent  : hex   — wireframe accent color
     auto    : "1"   — auto-cycle scenes every 4s when idle
*/
(() => {
  const THREE_URL = 'https://unpkg.com/three@0.161.0/build/three.module.js';

  class IsoCity extends HTMLElement {
    static get observedAttributes() { return ['scene', 'accent', 'auto']; }

    constructor() {
      super();
      this._scene = 0;
      this._ready = false;
      this._autoTimer = null;
      this._lastInteract = 0;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:block;position:relative;overflow:hidden;width:100%;height:100%;min-height:540px}canvas{display:block;width:100%;height:100%}</style>';
      this._canvasHost = document.createElement('div');
      this._canvasHost.style.cssText = 'position:absolute;inset:0';
      root.appendChild(this._canvasHost);
    }

    set scene(v) { this._setScene(parseInt(v, 10) || 0, true); }
    get scene() { return this._scene; }

    attributeChangedCallback(name, _old, val) {
      if (name === 'scene') this._setScene(parseInt(val, 10) || 0, true);
      if (name === 'accent' && this._ready) this._applyAccent(val);
      if (name === 'auto') this._setupAuto();
    }

    _setScene(n, userDriven) {
      n = Math.max(0, Math.min(3, n));
      if (n === this._scene && this._ready) return;
      this._scene = n;
      if (userDriven) this._lastInteract = performance.now();
      if (this._ready) this._retarget();
      this.dispatchEvent(new CustomEvent('scenechange', { detail: { scene: n } }));
    }

    connectedCallback() { this._init(); }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      clearInterval(this._autoTimer);
      if (this._ro) this._ro.disconnect();
      if (this._renderer) this._renderer.dispose();
    }

    async _init() {
      if (this._initStarted) return;
      this._initStarted = true;
      const THREE = await import(THREE_URL);
      this._T = THREE;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this._renderer = renderer;
      this._canvasHost.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      this._three = scene;

      // ---- camera (orthographic isometric) ----
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
      this._cam = cam;
      this._azimuth = 45; this._azTarget = 45;
      this._elev = 35.264; this._elevTarget = 35.264;
      this._view = 10; this._viewTarget = 10;
      this._yOff = 1.6; this._yOffTarget = 1.6;
      this._aspect = 1.6;

      // ---- palette ----
      this._applyAccent(this.getAttribute('accent') || '#38d9f5');

      // ---- ground grid ----
      const gridMat = new THREE.LineBasicMaterial({ color: this._cDim, transparent: true, opacity: 0.22 });
      const gridGeo = new THREE.BufferGeometry();
      const gpts = [];
      const EXT = 13;
      for (let i = -EXT; i <= EXT; i++) {
        gpts.push(-EXT, 0, i, EXT, 0, i);
        gpts.push(i, 0, -EXT, i, 0, EXT);
      }
      gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gpts, 3));
      scene.add(new THREE.LineSegments(gridGeo, gridMat));

      // ---- procedural city ----
      let seed = 1337;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      this._emptyLots = [];

      this._districts = [[], [], [], []]; // arrays of {lines, mat, baseY, mesh}
      this._occluders = [];
      const boxMat = new THREE.MeshBasicMaterial({ color: 0x04070c });
      const half = 5.5;

      for (let gx = -5; gx <= 5; gx++) {
        for (let gz = -5; gz <= 5; gz++) {
          // streets: skip every 3rd row/col
          if ((gx + 6) % 3 === 2 || (gz + 6) % 3 === 2) continue;
          if (rnd() < 0.14) { this._emptyLots.push([gx, gz]); continue; } // empty lots
          const district = (gx >= 0 ? 1 : 0) + (gz >= 0 ? 2 : 0); // quadrants 0..3
          const centerBoost = Math.max(0, 2.2 - (Math.abs(gx) + Math.abs(gz)) * 0.28);
          const h = 0.4 + rnd() * 2.2 + centerBoost * rnd() + (rnd() < 0.08 ? 2.5 : 0);
          const w = 0.62 + rnd() * 0.25, d = 0.62 + rnd() * 0.25;
          const isCyl = false;
          const geo = isCyl
            ? new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, h, 8)
            : new THREE.BoxGeometry(w, h, d);
          geo.translate(0, h / 2, 0);
          const mesh = new THREE.Mesh(geo, boxMat);
          mesh.position.set(gx, 0.001, gz);
          // tiny scale-down so lines don't z-fight
          mesh.scale.setScalar(0.985);
          scene.add(mesh);
          this._occluders.push(mesh);

          const edges = new THREE.EdgesGeometry(geo);
          const mat = new THREE.LineBasicMaterial({ color: this._cBase, transparent: true, opacity: 0.55 });
          const lines = new THREE.LineSegments(edges, mat);
          lines.position.copy(mesh.position);
          scene.add(lines);
          this._districts[district].push({ mat, lines, mesh, h });

          // floor bands (facade detail)
          const fb = [];
          const hw2 = w / 2 * 0.99, hd2 = d / 2 * 0.99;
          for (let y = 0.55; y < h - 0.25; y += 0.6) {
            fb.push(-hw2, y, -hd2, hw2, y, -hd2, hw2, y, -hd2, hw2, y, hd2);
            fb.push(hw2, y, hd2, -hw2, y, hd2, -hw2, y, hd2, -hw2, y, -hd2);
          }
          if (!isCyl && fb.length) {
            const fbg = new THREE.BufferGeometry();
            fbg.setAttribute('position', new THREE.Float32BufferAttribute(fb, 3));
            const fbm = new THREE.LineBasicMaterial({ color: this._cBase, transparent: true, opacity: 0.16 });
            const fbl = new THREE.LineSegments(fbg, fbm);
            fbl.position.copy(mesh.position);
            scene.add(fbl);
            this._districts[district].push({ mat: fbm, lines: fbl, mesh, h, baseOp: 0.38 });
          }

          // rooftop units (penthouse boxes)
          if (!isCyl && h > 1.5 && rnd() < 0.55) {
            const rw = 0.16 + rnd() * 0.14, rh = 0.12 + rnd() * 0.18, rd = 0.14 + rnd() * 0.12;
            const rgeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, rh, rd));
            rgeo.translate((rnd() - 0.5) * (w - rw) * 0.7, h + rh / 2, (rnd() - 0.5) * (d - rd) * 0.7);
            const rl = new THREE.LineSegments(rgeo, mat);
            rl.position.copy(mesh.position);
            scene.add(rl);
          }

          // stepped setback tiers on some towers
          if (!isCyl && h > 1.9 && rnd() < 0.38) {
            const tw = w * (0.5 + rnd() * 0.2), td = d * (0.5 + rnd() * 0.2), th = 0.5 + rnd() * 0.9;
            const tg2 = new THREE.BoxGeometry(tw, th, td);
            tg2.translate(0, h + th / 2, 0);
            const tmesh = new THREE.Mesh(tg2, boxMat);
            tmesh.position.copy(mesh.position);
            tmesh.scale.setScalar(0.985);
            scene.add(tmesh);
            this._occluders.push(tmesh);
            const tl2 = new THREE.LineSegments(new THREE.EdgesGeometry(tg2), mat);
            tl2.position.copy(mesh.position);
            scene.add(tl2);
          }

          // rooftop detail on tall buildings
          if (h > 2.6 && rnd() < 0.7) {
            const ag = new THREE.BufferGeometry();
            ag.setAttribute('position', new THREE.Float32BufferAttribute([0, h, 0, 0, h + 0.5 + rnd() * 0.4, 0], 3));
            const aline = new THREE.LineSegments(ag, mat);
            aline.position.set(gx, 0, gz);
            scene.add(aline);
          }
        }
      }

      // ---- landmark towers (stepped art-deco, Empire-State style) ----
      {
        const used = [];
        const lots = this._emptyLots.filter(l => Math.abs(l[0]) + Math.abs(l[1]) >= 3).slice(0, 3);
        for (const [gx, gz] of lots) {
          used.push([gx, gz]);
          const district = (gx >= 0 ? 1 : 0) + (gz >= 0 ? 2 : 0);
          const lmat = new THREE.LineBasicMaterial({ color: this._cBase, transparent: true, opacity: 0.6 });
          let y = 0;
          for (const [tw, th] of [[0.95, 2.3], [0.72, 1.5], [0.52, 1.0], [0.32, 0.6]]) {
            const g = new THREE.BoxGeometry(tw, th, tw);
            g.translate(0, y + th / 2, 0);
            const m = new THREE.Mesh(g, boxMat);
            m.position.set(gx, 0.001, gz); m.scale.setScalar(0.985);
            scene.add(m); this._occluders.push(m);
            const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), lmat);
            l.position.set(gx, 0.001, gz);
            scene.add(l);
            // corner setback ticks for the art-deco silhouette
            this._districts[district].push({ mat: lmat, lines: l, mesh: m, h: y + th });
            y += th;
          }
          const sg = new THREE.BufferGeometry();
          sg.setAttribute('position', new THREE.Float32BufferAttribute([0, y, 0, 0, y + 1.15, 0], 3));
          scene.add(new THREE.LineSegments(sg, lmat)).position.set(gx, 0, gz);
        }
        this._emptyLots = this._emptyLots.filter(l => !used.some(u => u[0] === l[0] && u[1] === l[1]));
      }

      // ---- roads ----
      const S = [-4, -1, 2, 5];
      const roadMat = new THREE.LineBasicMaterial({ color: this._cBase, transparent: true, opacity: 0.45 });
      const rpts = [];
      const EXTR = 6.5;
      for (const s of S) {
        // street edges (both orientations)
        rpts.push(s - 0.45, 0.012, -EXTR, s - 0.45, 0.012, EXTR);
        rpts.push(s + 0.45, 0.012, -EXTR, s + 0.45, 0.012, EXTR);
        rpts.push(-EXTR, 0.012, s - 0.45, EXTR, 0.012, s - 0.45);
        rpts.push(-EXTR, 0.012, s + 0.45, EXTR, 0.012, s + 0.45);
        // dashed center lines
        for (let d = -EXTR; d < EXTR; d += 1) {
          rpts.push(s, 0.012, d, s, 0.012, d + 0.45);
          rpts.push(d, 0.012, s, d + 0.45, 0.012, s);
        }
      }
      // crosswalks at intersections
      for (const sx of S) for (const sz of S) {
        for (let k = -2; k <= 2; k++) {
          const o = k * 0.16;
          rpts.push(sx + o, 0.014, sz - 0.62, sx + o, 0.014, sz - 0.78);
          rpts.push(sx + o, 0.014, sz + 0.62, sx + o, 0.014, sz + 0.78);
          rpts.push(sx - 0.62, 0.014, sz + o, sx - 0.78, 0.014, sz + o);
          rpts.push(sx + 0.62, 0.014, sz + o, sx + 0.78, 0.014, sz + o);
        }
      }
      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(rpts, 3));
      scene.add(new THREE.LineSegments(roadGeo, roadMat));

      // ---- traffic ----
      this._cars = [];
      this._carMat = new THREE.LineBasicMaterial({ color: this._cHot, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 14; i++) {
        const cg = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.28, 0.1, 0.14));
        cg.translate(0, 0.06, 0);
        const car = new THREE.LineSegments(cg, this._carMat);
        scene.add(car);
        const axis = rnd() < 0.5 ? 'x' : 'z';
        this._cars.push({
          car, axis,
          lane: S[Math.floor(rnd() * 4)] + (rnd() < 0.5 ? -0.22 : 0.22),
          speed: (0.5 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1),
          offset: rnd() * 13,
        });
        if (axis === 'z') car.rotation.y = Math.PI / 2;
      }

      // ---- info layers (fade in per scene) ----
      this._layerFade = [0, 0, 0, 0];
      this._fadeMats = [[], [], [], []];
      const reg = (i, mat, base) => { mat.transparent = true; mat.opacity = 0; this._fadeMats[i].push({ mat, base }); };

      // LAYER 02 — environmental simulation: wind streamlines through the city
      const WPN = 110;
      this._windP = [];
      this._windPos = new Float32Array(WPN * 6);
      const windGeo = new THREE.BufferGeometry();
      windGeo.setAttribute('position', new THREE.BufferAttribute(this._windPos, 3));
      this._windGeo = windGeo;
      const windMat = new THREE.LineBasicMaterial({ color: 0xbfeeff }); reg(1, windMat, 0.55);
      scene.add(new THREE.LineSegments(windGeo, windMat));
      for (let i = 0; i < WPN; i++) {
        this._windP.push({ x: (rnd() - 0.5) * 15, y: 0.3 + Math.pow(rnd(), 1.6) * 4.2, z: (rnd() - 0.5) * 14 });
      }
      // wind rose: prevailing-direction arrows at the model edge
      const wrPts = [];
      for (let k = -2; k <= 2; k++) {
        const z0 = k * 2.4, x0 = -7.6;
        wrPts.push(x0, 0.6, z0, x0 + 1.0, 0.6, z0);
        wrPts.push(x0 + 1.0, 0.6, z0, x0 + 0.7, 0.6, z0 - 0.18);
        wrPts.push(x0 + 1.0, 0.6, z0, x0 + 0.7, 0.6, z0 + 0.18);
      }
      const wrGeo = new THREE.BufferGeometry();
      wrGeo.setAttribute('position', new THREE.Float32BufferAttribute(wrPts, 3));
      const wrMat = new THREE.LineBasicMaterial({ color: 0xbfeeff }); reg(1, wrMat, 0.55);
      scene.add(new THREE.LineSegments(wrGeo, wrMat));

      // LAYER 03 — industries working on the model
      const mkText = (text, col) => {
        const c = document.createElement('canvas'); c.width = 512; c.height = 56;
        const g = c.getContext('2d');
        g.font = '600 30px "IBM Plex Mono", monospace';
        g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text.split('').join('\u2009'), 256, 30);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
        sp.scale.set(4.0, 0.44, 1);
        return sp;
      };

      this._edits = [];
      // ARCHITECTURE (amber) — a mid-rise being reshaped
      const archPool = this._districts[0].filter(b => b.h > 1.2 && b.h < 2.8);
      const b0 = archPool.length ? archPool[Math.floor(rnd() * archPool.length)] : this._districts[0][0];
      {
        const p = b0.mesh.geometry.parameters;
        const sg = new THREE.BoxGeometry(p.width + 0.3, p.height + 0.3, p.depth + 0.3);
        sg.translate(0, p.height / 2 + 0.02, 0);
        const sm = new THREE.LineDashedMaterial({ color: 0xf5b03d, dashSize: 0.14, gapSize: 0.1 });
        reg(2, sm, 0.95);
        const sel = new THREE.LineSegments(new THREE.EdgesGeometry(sg), sm);
        sel.computeLineDistances();
        sel.position.copy(b0.mesh.position);
        scene.add(sel);
        this._edits.push({ b: b0, sel });
      }

      // URBAN PLANNING (green) — a new transit route being drawn along a street
      {
        const rz = -1;
        const rSegPts = [];
        for (let x = -6.2; x < 6.2; x += 0.55) rSegPts.push(x, 0.05, rz, x + 0.32, 0.05, rz);
        this._routeSegs = rSegPts.length / 6;
        const rgeo = new THREE.BufferGeometry();
        rgeo.setAttribute('position', new THREE.Float32BufferAttribute(rSegPts, 3));
        const rmat = new THREE.LineBasicMaterial({ color: 0x3df5a6 }); reg(2, rmat, 0.95);
        this._route = new THREE.LineSegments(rgeo, rmat);
        this._route.geometry.setDrawRange(0, 0);
        scene.add(this._route);
      }

      // REAL ESTATE (violet) — a parcel being surveyed (corner brackets)
      {
        const lot2 = (this._emptyLots && this._emptyLots[2]) || [4, 4];
        const L = 0.62, A = 0.28, y = 0.03;
        const bp = [];
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          bp.push(sx * L, y, sz * L, sx * (L - A), y, sz * L);
          bp.push(sx * L, y, sz * L, sx * L, y, sz * (L - A));
        }
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
        const bm = new THREE.LineBasicMaterial({ color: 0xb07cff }); reg(2, bm, 0.95);
        this._parcel = new THREE.LineSegments(bg, bm);
        this._parcel.position.set(lot2[0], 0, lot2[1]);
        scene.add(this._parcel);
      }

      // LAYER 04 — planned build (ghost tower rising on an empty lot)
      let lot = [0.5, 0.5];
      if (this._emptyLots.length) {
        this._emptyLots.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])));
        lot = this._emptyLots[0];
      }
      const towerH = 3.6;
      const ghost = new THREE.Group();
      const tm = new THREE.LineBasicMaterial({ color: 0xffffff }); reg(3, tm, 0.95);
      const tg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.05, towerH, 1.05));
      tg.translate(0, towerH / 2, 0);
      ghost.add(new THREE.LineSegments(tg, tm));
      // floor slabs every 0.45
      const flPts = [];
      const hw = 0.525;
      for (let y = 0.45; y < towerH; y += 0.45) {
        flPts.push(-hw, y, -hw, hw, y, -hw, hw, y, -hw, hw, y, hw);
        flPts.push(hw, y, hw, -hw, y, hw, -hw, y, hw, -hw, y, -hw);
      }
      const flGeo = new THREE.BufferGeometry();
      flGeo.setAttribute('position', new THREE.Float32BufferAttribute(flPts, 3));
      const flMat = new THREE.LineBasicMaterial({ color: 0xffffff }); reg(3, flMat, 0.4);
      ghost.add(new THREE.LineSegments(flGeo, flMat));
      ghost.position.set(lot[0], 0.01, lot[1]);
      ghost.scale.y = 0.001;
      this._ghostTower = ghost;
      scene.add(ghost);
      const fpm = new THREE.LineBasicMaterial({ color: this._cHot }); reg(3, fpm, 0.9);
      const fpg = new THREE.BufferGeometry();
      const F = 0.75;
      fpg.setAttribute('position', new THREE.Float32BufferAttribute([
        -F, 0.02, -F, F, 0.02, -F, F, 0.02, -F, F, 0.02, F,
        F, 0.02, F, -F, 0.02, F, -F, 0.02, F, -F, 0.02, -F,
      ], 3));
      const fp = new THREE.LineSegments(fpg, fpm);
      fp.position.set(lot[0], 0, lot[1]);
      scene.add(fp);

      // ---- district beacon rings ----
      this._rings = [];
      const ringCenters = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
      for (let i = 0; i < 4; i++) {
        const rg = new THREE.BufferGeometry();
        const rp = [];
        const R = 3.6, SEG = 64;
        for (let s = 0; s < SEG; s++) {
          const a1 = (s / SEG) * Math.PI * 2, a2 = ((s + 1) / SEG) * Math.PI * 2;
          rp.push(Math.cos(a1) * R, 0.02, Math.sin(a1) * R, Math.cos(a2) * R, 0.02, Math.sin(a2) * R);
        }
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        const rm = new THREE.LineBasicMaterial({ color: this._cHot, transparent: true, opacity: 0 });
        const ring = new THREE.LineSegments(rg, rm);
        ring.position.set(ringCenters[i][0], 0, ringCenters[i][1]);
        scene.add(ring);
        this._rings.push({ ring, mat: rm });
      }

      // ---- resize ----
      const fit = () => {
        const w = this.clientWidth || 600, h = this.clientHeight || 500;
        renderer.setSize(w, h, false);
        this._aspect = w / h;
      };
      this._ro = new ResizeObserver(fit);
      this._ro.observe(this);
      fit();

      this._ready = true;
      this._retarget();
      // snap camera on first load
      this._azimuth = this._azTarget;
      this._elev = this._elevTarget;
      this._view = this._viewTarget;
      this._yOff = this._yOffTarget;
      this._setupAuto();

      // ---- loop ----
      const clock = new THREE.Clock();
      const tick = () => {
        this._raf = requestAnimationFrame(tick);
        const t = clock.getElapsedTime();

        // damped camera: azimuth + elevation + zoom + idle drift
        const drift = Math.sin(t * 0.18) * 2.2;
        this._azimuth += (this._azTarget + drift - this._azimuth) * 0.045;
        this._elev += (this._elevTarget + Math.sin(t * 0.13) * 1.2 - this._elev) * 0.045;
        this._view += (this._viewTarget - this._view) * 0.045;
        this._yOff += (this._yOffTarget - this._yOff) * 0.045;
        const az = this._azimuth * Math.PI / 180;
        const elev = Math.max(4, this._elev) * Math.PI / 180;
        const R = 40;
        cam.position.set(Math.cos(az) * Math.cos(elev) * R, Math.sin(elev) * R, Math.sin(az) * Math.cos(elev) * R);
        cam.lookAt(0, 1.2, 0);
        cam.left = -this._view * this._aspect / 2; cam.right = this._view * this._aspect / 2;
        cam.top = this._view / 2 + this._yOff; cam.bottom = -this._view / 2 + this._yOff;
        cam.updateProjectionMatrix();

        // traffic
        for (const c of this._cars) {
          const p = (((c.offset + t * c.speed) % 13) + 13) % 13 - 6.5;
          if (c.axis === 'x') c.car.position.set(p, 0, c.lane);
          else c.car.position.set(c.lane, 0, p);
        }

        // district glow
        const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
        for (let i = 0; i < 4; i++) {
          const hot = i === this._scene;
          for (const b of this._districts[i]) {
            const cur = b.mat;
            const wantColor = hot ? this._cHot : this._cBase;
            cur.color.lerp(wantColor, 0.08);
            const wantOp = (hot ? 0.85 + pulse * 0.15 : 0.4) * (b.baseOp || 1);
            cur.opacity += (wantOp - cur.opacity) * 0.08;
          }
          const rm = this._rings[i].mat;
          const wantR = hot ? 0.35 + pulse * 0.3 : 0;
          rm.opacity += (wantR - rm.opacity) * 0.1;
          this._rings[i].ring.scale.setScalar(hot ? 1 + pulse * 0.04 : 1);
        }

        // info layers: fade + motion
        for (let i = 1; i <= 3; i++) {
          this._layerFade[i] += (((this._scene === i) ? 1 : 0) - this._layerFade[i]) * 0.06;
          const f = this._layerFade[i];
          for (const e of this._fadeMats[i]) e.mat.opacity = e.base * f;
        }
        if (this._layerFade[1] > 0.01) {
          const dt = 0.016;
          for (let i = 0; i < this._windP.length; i++) {
            const p = this._windP[i];
            // prevailing wind +x, channeled by streets, swirling around towers
            const vx = 1.8 + Math.sin(p.z * 1.3 + p.y * 0.8) * 0.5;
            const vz = Math.sin(p.x * 0.9 + p.y * 2.1) * 0.9 + Math.cos(p.z * 1.7) * 0.25;
            const vy = Math.sin(p.x * 0.55 + p.z * 0.7) * 0.22;
            p.x += vx * dt; p.y = Math.max(0.25, p.y + vy * dt); p.z += vz * dt;
            if (p.x > 7.8) { p.x = -7.8; p.z = (Math.random() - 0.5) * 14; p.y = 0.3 + Math.pow(Math.random(), 1.6) * 4.2; }
            const k = i * 6, tl = 0.34;
            this._windPos[k] = p.x; this._windPos[k + 1] = p.y; this._windPos[k + 2] = p.z;
            this._windPos[k + 3] = p.x - vx * tl; this._windPos[k + 4] = p.y - vy * tl; this._windPos[k + 5] = p.z - vz * tl;
          }
          this._windGeo.attributes.position.needsUpdate = true;
        }
        // industries at work: reshape + route draw + parcel pulse
        const f2 = this._layerFade[2];
        this._edits.forEach((e, i) => {
          const want = f2 > 0.3 ? 1 + Math.sin(t * 1.1 + i * 2.1) * 0.22 : 1;
          const cur = e.b.mesh.scale.y + (want - e.b.mesh.scale.y) * 0.05;
          e.b.mesh.scale.y = cur;
          e.b.lines.scale.y = cur;
          e.sel.scale.y = cur;
        });
        if (f2 > 0.01) {
          const seg = Math.floor((t * 5) % (this._routeSegs + 12));
          this._route.geometry.setDrawRange(0, Math.min(seg, this._routeSegs) * 2);
          const pp = 1 + Math.sin(t * 2.4) * 0.07;
          this._parcel.scale.set(pp, 1, pp);
        }
        if (this._layerFade[3] > 0.01) {
          const cyc = (t % 6) / 6;
          const grow = Math.min(1, cyc * 1.5);
          this._ghostTower.scale.y = Math.max(0.001, 1 - Math.pow(1 - grow, 3));
        }

        renderer.render(scene, cam);
      };
      tick();
    }

    _applyAccent(hex) {
      const T = this._T;
      if (!T) { this._pendingAccent = hex; return; }
      const c = new T.Color(hex || '#38d9f5');
      this._cHot = c.clone().lerp(new T.Color('#ffffff'), 0.35);
      this._cBase = c.clone().multiplyScalar(0.55);
      this._cDim = c.clone().multiplyScalar(0.3);
      // update grid + existing materials lazily via lerp in the loop
    }

    _retarget() {
      // each scene: [azimuth, elevation, view size (zoom), vertical offset]
      const shots = [
        [45, 35.264, 10, 1.6],   // 01 — MAP: classic isometric
        [115, 30, 10.5, 1.5],    // 02 — WIND: mid orbit, streamlines readable
        [205, 30, 8.5, 1.7],     // 03 — COLLAB: closer isometric
        [295, 13, 8, 2.4],       // 04 — BUILD: street level, looking up
      ];
      const s = shots[this._scene];
      this._azTarget = s[0];
      this._elevTarget = s[1];
      this._viewTarget = s[2];
      this._yOffTarget = s[3];
    }

    _setupAuto() {
      clearInterval(this._autoTimer);
      if (this.getAttribute('auto') === '1') {
        this._autoTimer = setInterval(() => {
          if (performance.now() - this._lastInteract > 6000) {
            this._setScene((this._scene + 1) % 4, false);
          }
        }, 4000);
      }
    }
  }

  if (!customElements.get('iso-city')) customElements.define('iso-city', IsoCity);
})();
