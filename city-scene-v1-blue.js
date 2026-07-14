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
      n = Math.max(0, Math.min(4, n));
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
      this._applyAccent(this.getAttribute('accent') || '#2448FF');

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

      this._districts = [[], [], [], []]; // arrays of {lines, mat, baseY, mesh}
      this._occluders = [];
      const boxMat = new THREE.MeshBasicMaterial({ color: 0xf7f6f1 });
      const half = 5.5;

      for (let gx = -5; gx <= 5; gx++) {
        for (let gz = -5; gz <= 5; gz++) {
          // streets: skip every 3rd row/col
          if ((gx + 6) % 3 === 2 || (gz + 6) % 3 === 2) continue;
          if (rnd() < 0.14) continue; // empty lots
          const district = (gx >= 0 ? 1 : 0) + (gz >= 0 ? 2 : 0); // quadrants 0..3
          const centerBoost = Math.max(0, 2.2 - (Math.abs(gx) + Math.abs(gz)) * 0.28);
          const h = 0.4 + rnd() * 2.2 + centerBoost * rnd() + (rnd() < 0.08 ? 2.5 : 0);
          const w = 0.62 + rnd() * 0.25, d = 0.62 + rnd() * 0.25;
          const geo = new THREE.BoxGeometry(w, h, d);
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

      // ---- wind layer (environmental sim, shown on scenario 01) ----
      {
        const WPN = 120;
        this._windP = [];
        this._windPos = new THREE.Float32BufferAttribute(new Float32Array(WPN * 6), 3);
        const wgeo = new THREE.BufferGeometry();
        wgeo.setAttribute('position', this._windPos);
        this._windGeo = wgeo;
        this._windMat = new THREE.LineBasicMaterial({ color: this._cHot, transparent: true, opacity: 0 });
        scene.add(new THREE.LineSegments(wgeo, this._windMat));
        for (let i = 0; i < WPN; i++) {
          this._windP.push({ x: (Math.random() - 0.5) * 15, y: 0.3 + Math.pow(Math.random(), 1.6) * 4.5, z: (Math.random() - 0.5) * 14 });
        }
        this._windFade = 0;
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
            const wantOp = hot ? 0.85 + pulse * 0.15 : 0.4;
            cur.opacity += (wantOp - cur.opacity) * 0.08;
          }
          const rm = this._rings[i].mat;
          const wantR = hot ? 0.35 + pulse * 0.3 : 0;
          rm.opacity += (wantR - rm.opacity) * 0.1;
          this._rings[i].ring.scale.setScalar(hot ? 1 + pulse * 0.04 : 1);
        }

        // wind streamlines — fade in on the ENVIRONMENT scenario (05), drift +x, swirl around towers
        this._windFade += (((this._scene === 4) ? 1 : 0) - this._windFade) * 0.05;
        this._windMat.opacity = this._windFade * 0.85;
        this._windMat.color.copy(this._cHot);
        if (this._windFade > 0.01) {
          const arr = this._windPos.array;
          for (let i = 0; i < this._windP.length; i++) {
            const p = this._windP[i];
            const vx = 1.9 + Math.sin(p.z * 1.3 + p.y * 0.8) * 0.5;
            const vy = Math.sin(p.x * 0.7 + t) * 0.12;
            const vz = Math.sin(p.x * 0.9 + p.y * 2.1) * 0.9 + Math.cos(p.z * 1.7) * 0.25;
            p.x += vx * 0.035; p.y += vy * 0.035; p.z += vz * 0.035;
            if (p.x > 7.8) { p.x = -7.8; p.z = (Math.random() - 0.5) * 14; p.y = 0.3 + Math.pow(Math.random(), 1.6) * 4.5; }
            const k = i * 6, tl = 0.4;
            arr[k] = p.x; arr[k + 1] = p.y; arr[k + 2] = p.z;
            arr[k + 3] = p.x - vx * tl; arr[k + 4] = p.y - vy * tl; arr[k + 5] = p.z - vz * tl;
          }
          this._windPos.needsUpdate = true;
        }

        renderer.render(scene, cam);
      };
      tick();
    }

    _applyAccent(hex) {
      const T = this._T;
      if (!T) { this._pendingAccent = hex; return; }
      const c = new T.Color(hex || '#2448FF');
      this._cHot = c.clone().lerp(new T.Color('#ffffff'), 0.35);
      this._cBase = c.clone().multiplyScalar(0.55);
      this._cDim = c.clone().multiplyScalar(0.3);
      // update grid + existing materials lazily via lerp in the loop
    }

    _retarget() {
      // each scene: [azimuth, elevation, view size (zoom), vertical offset]
      const shots = [
        [150, 24, 10, 1.9],      // 01 — MODEL: low far-corner view, clearly distinct from ENVIRONMENT
        [115, 10, 6.5, 2.2],     // 02 — street level, looking up through the towers
        [205, 78, 12, 0.2],      // 03 — top-down plan view
        [295, 22, 14, 1.2],      // 04 — wide low orbit
        [45, 34, 10, 1.6],       // 05 — ENVIRONMENT: classic isometric, wind readable between towers
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

  if (!customElements.get('iso-city-v1b')) customElements.define('iso-city-v1b', IsoCity);
})();
