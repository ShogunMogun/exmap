/* <persp-terrain> — wireframe terrain flythrough with hard one-point perspective, Three.js.
   Attributes:
     accent : hex — line accent color
*/
(() => {
  const THREE_URL = 'https://unpkg.com/three@0.161.0/build/three.module.js';

  class PerspTerrain extends HTMLElement {
    static get observedAttributes() { return ['accent']; }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:block;position:relative;overflow:hidden;width:100%;height:100%;min-height:540px}canvas{display:block;width:100%;height:100%}</style>';
      this._host = document.createElement('div');
      this._host.style.cssText = 'position:absolute;inset:0';
      root.appendChild(this._host);
      this._mx = 0; this._my = 0; this._tmx = 0; this._tmy = 0;
    }

    attributeChangedCallback(name, _o, val) {
      if (name === 'accent' && this._ready) this._applyAccent(val);
    }

    connectedCallback() { this._init(); }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._renderer) this._renderer.dispose();
    }

    _applyAccent(hex) {
      const c = new this._T.Color(hex || '#38d9f5');
      if (this._lineMat) this._lineMat.color = c;
      if (this._brightMat) this._brightMat.color = c;
      if (this._bldgMat) this._bldgMat.color = c;
      if (this._diamond) this._diamond.material.color = c;
    }

    // cheap value noise
    _noise(x, z) {
      const s = (n) => { const v = Math.sin(n) * 43758.5453; return v - Math.floor(v); };
      const xi = Math.floor(x), zi = Math.floor(z);
      const xf = x - xi, zf = z - zi;
      const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
      const h = (a, b) => s(a * 127.1 + b * 311.7);
      return h(xi, zi) * (1 - u) * (1 - w) + h(xi + 1, zi) * u * (1 - w) +
             h(xi, zi + 1) * (1 - u) * w + h(xi + 1, zi + 1) * u * w;
    }

    _height(x, z) {
      const n1 = this._noise(x * 0.07, z * 0.07);
      const n2 = this._noise(x * 0.22, z * 0.22);
      let h = Math.pow(n1, 1.7) * 6.5 + n2 * 1.2;
      // carve a valley down the middle -> perspective corridor
      const valley = Math.min(1, Math.abs(x) / 12);
      h *= 0.08 + 0.92 * valley * valley;
      return h;
    }

    async _init() {
      if (this._initStarted) return;
      this._initStarted = true;
      const THREE = await import(THREE_URL);
      this._T = THREE;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this._renderer = renderer;
      this._host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x04070c, 18, 78);
      this._scene = scene;

      const cam = new THREE.PerspectiveCamera(72, 1.6, 0.1, 200);
      cam.position.set(0, 3.0, 0);
      this._cam = cam;

      const accent = this.getAttribute('accent') || '#38d9f5';
      this._lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.34, fog: true });
      this._brightMat = new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.9, fog: true });

      // ---- terrain: rows of lines flowing toward camera ----
      this.ROWS = 64; this.COLS = 110;
      this.W = 90; this.DEPTH = 80;
      this._rows = [];
      for (let r = 0; r < this.ROWS; r++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.COLS * 3), 3));
        const line = new THREE.Line(geo, this._lineMat);
        line.frustumCulled = false;
        scene.add(line);
        this._rows.push(line);
      }
      // longitudinal rails: a few lines running into the distance
      this._rails = [];
      const RAILX = [-10, -5.5, -2.5, 2.5, 5.5, 10];
      for (const rx of RAILX) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.ROWS * 3), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.14, fog: true }));
        line.frustumCulled = false;
        line.userData.rx = rx;
        scene.add(line);
        this._rails.push(line);
      }

      // ---- wireframe city blocks rising from the terrain ----
      this._bldgMat = new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.5, fog: true });
      const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      this._bldgs = [];
      for (let i = 0; i < 30; i++) {
        const mesh = new THREE.LineSegments(boxEdges, this._bldgMat);
        mesh.frustumCulled = false;
        scene.add(mesh);
        this._bldgs.push({ mesh, seed: i + 1, zSlot: (i / 30) * this.DEPTH, cycle: null, x: 8, w: 1, h: 2 });
      }

      // ---- horizon line ----
      {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-120, 1.55, -76), new THREE.Vector3(120, 1.55, -76)]);
        scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.5 })));
      }

      // ---- diamond marker at vanishing point ----
      {
        const pts = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.95 });
        const d = new THREE.Line(geo, mat);
        d.position.set(0, 3.4, -74); d.scale.setScalar(1.5);
        scene.add(d);
        this._diamond = d;
        const d2 = new THREE.Line(geo.clone(), new THREE.LineBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.3 }));
        d2.position.copy(d.position); d2.scale.setScalar(2.4);
        scene.add(d2);
        this._diamond2 = d2;
      }

      // resize
      const ro = new ResizeObserver(() => this._resize());
      ro.observe(this);
      this._ro = ro;
      this._resize();

      // pointer parallax
      this.addEventListener('pointermove', (e) => {
        const b = this.getBoundingClientRect();
        this._tmx = ((e.clientX - b.left) / b.width - 0.5) * 2;
        this._tmy = ((e.clientY - b.top) / b.height - 0.5) * 2;
      });
      this.addEventListener('pointerleave', () => { this._tmx = 0; this._tmy = 0; });

      this._ready = true;
      this._t0 = performance.now();
      const tick = () => {
        this._raf = requestAnimationFrame(tick);
        this._frame((performance.now() - this._t0) / 1000);
      };
      tick();
    }

    _resize() {
      const w = this.clientWidth || 800, h = this.clientHeight || 540;
      this._renderer.setSize(w, h, false);
      this._cam.aspect = w / h;
      this._cam.updateProjectionMatrix();
    }

    _frame(t) {
      const speed = 2.0;
      const zt = t * speed;
      const rowStep = this.DEPTH / this.ROWS;

      const mod = (a, n) => ((a % n) + n) % n;
      for (let r = 0; r < this.ROWS; r++) {
        const line = this._rows[r];
        // rows stream toward the camera; noise sampled in absolute world space
        const zWorld = -mod(r * rowStep - zt, this.DEPTH);
        const zNoise = zWorld - zt;
        const pos = line.geometry.attributes.position;
        for (let c = 0; c < this.COLS; c++) {
          const x = (c / (this.COLS - 1) - 0.5) * this.W;
          const y = this._height(x, zNoise);
          pos.setXYZ(c, x, y, zWorld);
        }
        pos.needsUpdate = true;
        line.material = (zWorld > -3) ? this._brightMat : this._lineMat;
      }

      // rails
      for (const rail of this._rails) {
        const pos = rail.geometry.attributes.position;
        const rx = rail.userData.rx;
        const pts = [];
        for (let r = 0; r < this.ROWS; r++) {
          const zWorld = -mod(r * rowStep - zt, this.DEPTH);
          pts.push([rx, this._height(rx, zWorld - zt), zWorld]);
        }
        pts.sort((a, b) => b[2] - a[2]);
        for (let r = 0; r < this.ROWS; r++) pos.setXYZ(r, pts[r][0], pts[r][1], pts[r][2]);
        pos.needsUpdate = true;
      }

      // city blocks stream with the terrain; re-roll footprint each wrap
      for (const b of this._bldgs) {
        const cycle = Math.floor((b.zSlot - zt) / this.DEPTH);
        const m = mod(b.zSlot - zt, this.DEPTH);
        const z = -m;
        if (cycle !== b.cycle) {
          b.cycle = cycle;
          const r1 = this._noise(b.seed * 13.7, cycle * 7.3);
          const r2 = this._noise(b.seed * 5.1, cycle * 3.9);
          const r3 = this._noise(b.seed * 2.2, cycle * 9.1);
          const side = (b.seed % 2 === 0) ? -1 : 1;
          b.x = side * (5.5 + r1 * 24);
          b.w = 0.9 + r2 * 2.2;
          b.h = 1.4 + Math.pow(r3, 1.8) * 11;
        }
        const yBase = this._height(b.x, z - zt);
        b.mesh.position.set(b.x, yBase + b.h / 2, z);
        b.mesh.scale.set(b.w, b.h, b.w);
      }

      // parallax easing
      this._mx += (this._tmx - this._mx) * 0.04;
      this._my += (this._tmy - this._my) * 0.04;
      this._cam.position.x = this._mx * 1.6;
      this._cam.position.y = 3.0 + this._my * -0.5;
      this._cam.lookAt(0, 2.4, -74);

      // diamond pulse
      if (this._diamond) {
        const p = 1.5 + Math.sin(t * 1.4) * 0.12;
        this._diamond.scale.setScalar(p);
        this._diamond2.scale.setScalar(p * 1.65);
        this._diamond2.material.opacity = 0.22 + Math.sin(t * 1.4) * 0.1;
      }

      this._renderer.render(this._scene, this._cam);
    }
  }

  if (!customElements.get('persp-terrain')) customElements.define('persp-terrain', PerspTerrain);
})();
