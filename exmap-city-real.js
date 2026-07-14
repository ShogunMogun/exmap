/* <exmap-city> — REALISTIC golden-hour city, Three.js.
   Low warm sun, volumetric light shafts (crepuscular beams), atmospheric
   haze, real downtown massing: podium towers, perimeter courtyard blocks,
   dark membrane roofs with HVAC clutter, muted material palette, grimy
   facades with sparse warm interior lights.
   API (unchanged):
     attribute accent : hex accent color (model-grid + landmark edge tint)
     method setProgress(p)  : 0..1 scroll progress
     method focusPin(id) / clearFocus()
   Events (composed): 'pinselect' {id}, 'cityready'
*/
(() => {
  if (customElements.get('exmap-city')) return;
  const THREE_URL = 'https://unpkg.com/three@0.161.0/build/three.module.js';

  const PINS = [
    { id: 'p1', color: '#ff5468', side: 'right',
      title: 'SUNLIGHT STUDY — FAILED', sub: 'Urban planning · Elm Park',
      pos: [-44, 4.5, -26], cam: [-56, 9, -2], look: [-44, 3, -26] },
    { id: 'p2', color: '#35e08c', side: 'left',
      title: 'DESIGN REVIEW — APPROVED', sub: 'Architecture · facade V4',
      pos: [40, 21, -30.5], cam: [30, 17, -8], look: [40, 19, -34] },
    { id: 'p3', color: '#38d9f5', side: 'right',
      title: 'FEASIBILITY — PARCEL 41-B', sub: 'Real estate · yield +8.2%',
      pos: [22, 4, 34], cam: [9, 9, 54], look: [22, 4, 34] },
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const smooth = (t) => t * t * (3 - 2 * t);

  class ExmapCity extends HTMLElement {
    static get observedAttributes() { return ['accent']; }

    constructor() {
      super();
      this._progress = 0;
      this._focusId = null;
      this._ready = false;
      this._mx = 0; this._my = 0;
      this._onPointer = (e) => {
        this._mx = (e.clientX / innerWidth) * 2 - 1;
        this._my = (e.clientY / innerHeight) * 2 - 1;
      };
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = `<style>
        :host{display:block;position:relative;overflow:hidden;width:100%;height:100%}
        canvas{display:block;width:100%;height:100%}
        .pins{position:absolute;inset:0;pointer-events:none;overflow:hidden}
        .pin{position:absolute;left:0;top:0;background:none;border:none;padding:0;margin:0;cursor:pointer;
             opacity:0;pointer-events:none;transition:opacity .6s;will-change:transform;font-family:'Chakra Petch',sans-serif}
        .pin.show{opacity:1;pointer-events:auto}
        .pin .dot{position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;
             background:var(--c);box-shadow:0 0 14px var(--c),0 0 34px var(--c)}
        .pin .ring{position:absolute;left:-15px;top:-15px;width:28px;height:28px;border-radius:50%;
             border:1px solid var(--c);animation:xcPulse 2.2s ease-out infinite}
        @keyframes xcPulse{0%{transform:scale(.5);opacity:.9}70%{transform:scale(1.5);opacity:0}100%{opacity:0}}
        .chip{position:absolute;top:-24px;left:26px;width:224px;text-align:left;display:block;
             background:rgba(14,12,18,.92);border:1px solid var(--c);
             padding:11px 14px;border-radius:12px;box-shadow:0 8px 30px rgba(20,10,25,.45),0 0 22px color-mix(in srgb, var(--c) 30%, transparent);transition:transform .25s}
        .chip::before{content:'';position:absolute;top:29px;left:-26px;width:26px;height:1px;background:var(--c);opacity:.8}
        .pin.flip .chip{left:auto;right:26px}
        .pin.flip .chip::before{left:auto;right:-26px}
        .chip b{display:block;font-weight:600;font-size:12px;letter-spacing:.08em;color:#fff}
        .chip i{display:block;font-style:normal;font-family:'IBM Plex Mono',monospace;font-size:10px;
             letter-spacing:.04em;color:rgba(223,233,239,.72);margin-top:4px}
        .pin:hover .chip{transform:translateY(-2px)}
        .pin.quiet .chip{opacity:0;pointer-events:none;transition:opacity .3s}
      </style>`;
      this._canvasHost = document.createElement('div');
      this._canvasHost.style.cssText = 'position:absolute;inset:0';
      r.appendChild(this._canvasHost);
      this._pinLayer = document.createElement('div');
      this._pinLayer.className = 'pins';
      r.appendChild(this._pinLayer);
    }

    attributeChangedCallback(name, _o, val) {
      if (name === 'accent' && this._ready) this._applyAccent(val);
    }

    setProgress(p) { this._progress = Math.max(0, Math.min(1, p)); }
    focusPin(id) { this._focusId = id; }
    clearFocus() { this._focusId = null; }

    connectedCallback() { this._init(); window.addEventListener('pointermove', this._onPointer, { passive: true }); }
    disconnectedCallback() {
      window.removeEventListener('pointermove', this._onPointer);
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._renderer) this._renderer.dispose();
    }

    async _init() {
      if (this._initStarted) return;
      this._initStarted = true;
      const THREE = await import(THREE_URL);
      this._T = THREE;
      const rng = mulberry32(90210);

      // real building models from the user's asset pack (mid-rise fill)
      let fbxGroupsPromise = null;
      try {
        const { FBXLoader } = await import('https://unpkg.com/three@0.161.0/examples/jsm/loaders/FBXLoader.js');
        const loader = new FBXLoader();
        loader.setResourcePath('assets/buildings/');
        const names = ['RB001', 'RB002', 'RB003', 'RB004', 'RB005', 'RB006', 'RB007', 'RB008', 'RB009', 'RB010'];
        fbxGroupsPromise = Promise.all(names.map((n) => loader.loadAsync('assets/buildings/' + n + '.fbx').catch(() => null)));
      } catch (err) {
        console.warn('[exmap-city] FBXLoader unavailable — procedural buildings only', err);
      }

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this._renderer = renderer;
      this._canvasHost.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // warm atmospheric haze — matches the DC sky horizon
      scene.fog = new THREE.Fog(0xdeaa6d, 95, 330);
      this._scene = scene;

      // ---- golden-hour environment map: warm reflections on glass/metal ----
      {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new THREE.Scene();
        const ec = document.createElement('canvas');
        ec.width = 1; ec.height = 256;
        const ex = ec.getContext('2d');
        const eg = ex.createLinearGradient(0, 0, 0, 256);
        eg.addColorStop(0, '#22375c');    // deep zenith blue
        eg.addColorStop(0.42, '#5c6f96'); // mid sky
        eg.addColorStop(0.55, '#c08a68'); // warm band
        eg.addColorStop(0.62, '#f0b87e'); // horizon glow
        eg.addColorStop(0.70, '#a37c5c'); // ground haze
        eg.addColorStop(1, '#5c4f42');    // ground
        ex.fillStyle = eg; ex.fillRect(0, 0, 1, 256);
        const envTex = new THREE.CanvasTexture(ec);
        envTex.colorSpace = THREE.SRGBColorSpace;
        envScene.add(new THREE.Mesh(
          new THREE.SphereGeometry(100, 32, 16),
          new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })
        ));
        // HDR low sun (values > 1 = blazing glints on glass)
        const sunBall = new THREE.Mesh(
          new THREE.SphereGeometry(7, 16, 8),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(24, 15, 7) })
        );
        sunBall.position.set(-62, 26, -42);
        envScene.add(sunBall);
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(110, 42),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.3, 1.3), side: THREE.DoubleSide })
        );
        glow.position.set(-58, 30, -40);
        glow.lookAt(0, 12, 0);
        envScene.add(glow);
        scene.environment = pmrem.fromScene(envScene, 0.04).texture;
        pmrem.dispose();
      }

      // ---- lighting: low warm sun, cool blue sky fill, long soft shadows ----
      scene.add(new THREE.HemisphereLight(0x7f92b8, 0x8a6b52, 0.5));
      const sun = new THREE.DirectionalLight(0xffc48c, 2.9);
      sun.position.set(-105, 62, -70);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
      sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
      sun.shadow.camera.near = 20; sun.shadow.camera.far = 460;
      sun.shadow.bias = -0.0006;
      scene.add(sun);
      const cool = new THREE.DirectionalLight(0x4a6090, 0.4);
      cool.position.set(100, 55, 80);
      scene.add(cool);

      const cam = new THREE.PerspectiveCamera(55, 1.7, 0.5, 900);
      cam.position.set(0, 16, 120);
      this._cam = cam;
      this._lookCur = new THREE.Vector3(0, 34, -30);
      this._tPos = new THREE.Vector3(0, 16, 120);
      this._tLook = new THREE.Vector3(0, 34, -30);
      this._v3 = new THREE.Vector3();

      // ---- facade textures: punched windows, grime, AO, warm interior lights ----
      const wrapTex = (cv) => {
        const t = new THREE.CanvasTexture(cv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      };
      const wrapLin = (cv) => {
        const t = new THREE.CanvasTexture(cv);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        return t;
      };
      const mkFacade = (wall, glassTop, glassBot, litP, balcony) => {
        const W = 512, H = 512;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        const e = document.createElement('canvas'); e.width = W; e.height = H;
        const ex = e.getContext('2d'); ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
        const rgh = document.createElement('canvas'); rgh.width = W; rgh.height = H;
        const rx = rgh.getContext('2d'); rx.fillStyle = '#d8d8d8'; rx.fillRect(0, 0, W, H);
        x.fillStyle = wall; x.fillRect(0, 0, W, H);
        // material mottle
        for (let i = 0; i < 2200; i++) {
          x.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
          x.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
        }
        const rows = 24, cols = 12, rh = H / rows, cw = W / cols;
        // pier relief
        for (let col = 0; col <= cols; col++) {
          x.fillStyle = 'rgba(0,0,0,0.10)';
          x.fillRect(col * cw - 1, 0, 1, H);
          x.fillStyle = 'rgba(255,255,255,0.06)';
          x.fillRect(col * cw, 0, 1, H);
        }
        for (let row = 0; row < rows; row++) {
          x.fillStyle = 'rgba(0,0,0,0.16)';                    // floor spandrel line
          x.fillRect(0, row * rh + rh - 2, W, 2);
          x.fillStyle = 'rgba(255,255,255,0.05)';
          x.fillRect(0, row * rh + rh - 3, W, 1);
          for (let col = 0; col < cols; col++) {
            const px = col * cw + 5, py = row * rh + 4;
            const ww = cw - 10, wh = rh - 9;
            x.fillStyle = 'rgba(0,0,0,0.5)';                   // deep reveal
            x.fillRect(px - 1, py - 1, ww + 2, wh + 3);
            const gg = x.createLinearGradient(0, py, 0, py + wh);
            gg.addColorStop(0, glassTop); gg.addColorStop(1, glassBot);
            x.fillStyle = gg; x.fillRect(px, py, ww, wh);
            // per-pane tint variation
            const jit = rng();
            x.fillStyle = jit < 0.5 ? `rgba(0,0,0,${jit * 0.22})` : `rgba(255,255,255,${(jit - 0.5) * 0.14})`;
            x.fillRect(px, py, ww, wh);
            x.fillStyle = 'rgba(255,255,255,0.45)';            // sill
            x.fillRect(px - 1, py + wh + 1, ww + 2, 1);
            rx.fillStyle = '#282828'; rx.fillRect(px, py, ww, wh);
            const rr = rng();
            if (rr < litP) {                                   // warm interior light
              ex.fillStyle = 'rgba(255,196,130,0.9)';
              ex.fillRect(px + 1, py + 1, ww - 2, wh - 2);
            } else if (rr < litP + 0.03) {                     // low-sun glint
              ex.fillStyle = 'rgba(255,232,200,0.5)';
              ex.fillRect(px, py, ww, wh);
            } else if (rr < litP + 0.34) {                     // blinds / curtains
              x.fillStyle = 'rgba(16,14,12,0.5)';
              x.fillRect(px, py + wh * (0.3 + rng() * 0.3), ww, wh);
            }
          }
          if (balcony) {                                       // balcony slab + railing
            x.fillStyle = 'rgba(0,0,0,0.22)';
            x.fillRect(0, row * rh + rh - 7, W, 5);
            x.fillStyle = 'rgba(255,255,255,0.10)';
            for (let col = 0; col < cols; col++)
              x.fillRect(col * cw + 3, row * rh + rh - 7, cw - 6, 1);
          }
        }
        // grime streaks
        for (let i = 0; i < 40; i++) {
          x.fillStyle = 'rgba(26,22,18,0.05)';
          x.fillRect(rng() * W, rng() * H * 0.6, 1 + rng() * 3, 50 + rng() * 160);
        }
        // base AO
        const ag = x.createLinearGradient(0, H, 0, H - 90);
        ag.addColorStop(0, 'rgba(20,17,14,0.35)'); ag.addColorStop(1, 'rgba(20,17,14,0)');
        x.fillStyle = ag; x.fillRect(0, H - 90, W, 90);
        return { map: wrapTex(c), glow: wrapTex(e), rough: wrapLin(rgh) };
      };
      const mkCurtain = () => {
        const W = 512, H = 512;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        const e = document.createElement('canvas'); e.width = W; e.height = H;
        const ex = e.getContext('2d'); ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
        const gg = x.createLinearGradient(0, 0, 0, H);
        gg.addColorStop(0, '#76838e');
        gg.addColorStop(0.5, '#46525a');
        gg.addColorStop(1, '#272e34');
        x.fillStyle = gg; x.fillRect(0, 0, W, H);
        const rows = 24, cols = 16, rh = H / rows, cw = W / cols;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
          const rr = rng();
          if (rr < 0.05) { ex.fillStyle = 'rgba(255,226,180,0.85)'; ex.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4); }
          else if (rr < 0.11) { ex.fillStyle = 'rgba(255,200,140,0.4)'; ex.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4); }
          else if (rr < 0.2) { x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4); }
          else if (rr < 0.28) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(col * cw + 2, row * rh + 2, cw - 4, rh - 4); }
        }
        x.fillStyle = 'rgba(10,14,17,0.65)';
        for (let col = 0; col <= cols; col++) x.fillRect(col * cw - 1, 0, 2, H);
        for (let row = 0; row <= rows; row++) x.fillRect(0, row * rh - 1, W, 2);
        x.fillStyle = 'rgba(255,255,255,0.08)';
        for (let row = 0; row <= rows; row++) x.fillRect(0, row * rh + 1, W, 1);
        return { map: wrapTex(c), glow: wrapTex(e) };
      };

      // muted, real-world wall palette (precast, limestone, brick, render)
      const facadeDefs = [
        ['#a8a49a', '#5e6b74', '#23282c', 0.05, false],
        ['#b6b0a4', '#66737c', '#262b30', 0.04, false],
        ['#8f8a80', '#5a6770', '#22272b', 0.07, true],
        ['#7c6a5a', '#5e6a72', '#20252a', 0.06, false],   // brick
        ['#9c9488', '#616e77', '#24292e', 0.05, true],
        ['#b0a898', '#5c6972', '#23282d', 0.04, false],
        ['#847a6c', '#5f6c75', '#22272c', 0.08, true],
        ['#6e675e', '#58656e', '#1f2429', 0.07, false],   // dark masonry
        ['#a29a8c', '#63707a', '#252a2f', 0.05, false],
        ['#8a8278', '#5c6972', '#21262b', 0.06, true],
      ];
      const sideMats = facadeDefs.map(([wall, gTop, gBot, lit, bal]) => {
        const t = mkFacade(wall, gTop, gBot, lit, bal);
        return new THREE.MeshStandardMaterial({
          map: t.map, emissive: 0xffffff, emissiveMap: t.glow, emissiveIntensity: 0.85,
          roughnessMap: t.rough, roughness: 1.0, metalness: 0.25, envMapIntensity: 0.7,
        });
      });
      const ct = mkCurtain();
      const curtainMat = new THREE.MeshStandardMaterial({
        map: ct.map, emissive: 0xffffff, emissiveMap: ct.glow, emissiveIntensity: 0.9,
        roughness: 0.08, metalness: 0.92, envMapIntensity: 1.5,
      });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b6760, roughness: 0.96 });     // dark membrane/gravel
      const parapetMat = new THREE.MeshStandardMaterial({ color: 0x958e82, roughness: 0.9 });
      const hvacMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.55, metalness: 0.55, envMapIntensity: 0.9 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x5a5e63, roughness: 0.4, metalness: 0.7, envMapIntensity: 1.0 });
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4c36, roughness: 0.92 });
      const craneMat = new THREE.MeshStandardMaterial({ color: 0xd9a437, roughness: 0.6, metalness: 0.25 });
      const silMat = new THREE.MeshStandardMaterial({ color: 0xa89a8c, roughness: 1 });

      const city = new THREE.Group();
      scene.add(city);

      // ---- geometry merging ----
      const buckets = new Map();
      const addGeo = (mat, g) => {
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat).push(g);
        return g;
      };
      const scaleUV = (g, w, h, d) => {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++)
          uv.setXY(i, uv.getX(i) * Math.max(w, d) / 7, uv.getY(i) * h / 16);
      };
      const addBox = (mat, w, h, d, x, y, z, winUV) => {
        const g = new THREE.BoxGeometry(w, h, d);
        if (winUV) scaleUV(g, w, h, d);
        g.translate(x, y, z);
        return addGeo(mat, g);
      };
      const mergeGeos = (geos) => {
        let vc = 0, ic = 0;
        for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
        const pos = new Float32Array(vc * 3), norm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
        const idx = new Uint32Array(ic);
        let vo = 0, io = 0;
        for (const g of geos) {
          pos.set(g.attributes.position.array, vo * 3);
          norm.set(g.attributes.normal.array, vo * 3);
          uv.set(g.attributes.uv.array, vo * 2);
          const gi = g.index.array;
          for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
          vo += g.attributes.position.count; io += gi.length;
          g.dispose();
        }
        const m = new THREE.BufferGeometry();
        m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        m.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
        m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        m.setIndex(new THREE.BufferAttribute(idx, 1));
        return m;
      };

      // ---- process FBX building set into instanceable models ----
      const fbxModels = [];
      const texLoader = new THREE.TextureLoader();
      const wallC = texLoader.load('assets/buildings/AussenWand_C.jpg');
      wallC.colorSpace = THREE.SRGBColorSpace;
      wallC.wrapS = wallC.wrapT = THREE.RepeatWrapping;
      const wallN = texLoader.load('assets/buildings/AussenWand_N.jpg');
      wallN.wrapS = wallN.wrapT = THREE.RepeatWrapping;
      const sharedFbxMat = new THREE.MeshStandardMaterial({ map: wallC, normalMap: wallN, roughness: 0.9, metalness: 0.03 });
      if (fbxGroupsPromise) {
        const groups = await fbxGroupsPromise;
        for (const g2 of groups) {
          if (!g2) continue;
          g2.updateMatrixWorld(true);
          const geos = [];
          let bigMat = null, bigCount = 0;
          g2.traverse((ch) => {
            if (!ch.isMesh || !ch.geometry) return;
            const geo = ch.geometry.clone();
            geo.applyMatrix4(ch.matrixWorld);
            const nV = geo.attributes.position.count;
            if (!geo.index) {
              const idx = new Uint32Array(nV);
              for (let j = 0; j < nV; j++) idx[j] = j;
              geo.setIndex(new THREE.BufferAttribute(idx, 1));
            }
            if (!geo.attributes.normal) geo.computeVertexNormals();
            if (!geo.attributes.uv)
              geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(nV * 2), 2));
            for (const key of Object.keys(geo.attributes))
              if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
            geos.push(geo);
            const mm = Array.isArray(ch.material) ? ch.material[0] : ch.material;
            if (nV > bigCount) { bigCount = nV; bigMat = mm; }
          });
          if (!geos.length) continue;
          const merged = mergeGeos(geos);
          merged.computeBoundingBox();
          const bb = merged.boundingBox;
          const size = new THREE.Vector3();
          bb.getSize(size);
          merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
          let s = (8 + rng() * 5) / Math.max(0.001, size.y);
          s = Math.min(s, 8.6 / Math.max(0.001, Math.max(size.x, size.z)));
          let matOut = sharedFbxMat;
          if (bigMat && bigMat.map) {
            bigMat.map.colorSpace = THREE.SRGBColorSpace;
            matOut = new THREE.MeshStandardMaterial({
              map: bigMat.map, normalMap: bigMat.normalMap || null,
              roughness: 0.9, metalness: 0.03,
            });
          }
          fbxModels.push({ geo: merged, mat: matOut, scale: s });
        }
        console.log('[exmap-city] FBX building models ready:', fbxModels.length);
      }
      const fbxPlacements = [];

      // ---- massing vocabulary ----
      const addParapet = (w, d, x, h, z) =>
        addBox(parapetMat, w + 0.18, 0.32, d + 0.18, x, h + 0.16, z, false);
      const addWaterTower = (x, h, z) => {
        const cyl = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 8);
        cyl.translate(x, h + 0.95, z);
        addGeo(woodMat, cyl);
        const cone = new THREE.ConeGeometry(0.66, 0.5, 8);
        cone.translate(x, h + 1.75, z);
        addGeo(woodMat, cone);
        addBox(darkMat, 0.12, 0.4, 0.12, x, h + 0.2, z, false);
      };
      const addRoofClutter = (x, h, z, w, d) => {
        const n = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const bw = 0.6 + rng() * 1.2, bd = 0.6 + rng() * 1.2, bh = 0.4 + rng() * 0.8;
          addBox(hvacMat, bw, bh, bd,
            x + (rng() - 0.5) * Math.max(0.2, w - bw - 0.7),
            h + bh / 2 + 0.18,
            z + (rng() - 0.5) * Math.max(0.2, d - bd - 0.7), false);
        }
        if (rng() < 0.35)
          addBox(darkMat, 0.08, 1.2 + rng() * 2, 0.08,
            x + (rng() - 0.5) * (w - 1), h + 0.9, z + (rng() - 0.5) * (d - 1), false);
      };
      const addFlat = (mat, w, h, d, x, z) => {
        addBox(mat, w, h, d, x, h / 2, z, true);
        addBox(roofMat, Math.max(0.4, w - 0.15), 0.2, Math.max(0.4, d - 0.15), x, h + 0.08, z, false);
        addParapet(w, d, x, h, z);
        if (h > 4.5 && rng() < 0.65) addRoofClutter(x, h, z, w, d);
        if (h > 6 && rng() < 0.26)
          addWaterTower(x + (rng() - 0.5) * (w - 1.6), h, z + (rng() - 0.5) * (d - 1.6));
      };

      const treePts = [];
      const grassGeos = [];
      const addGrass = (w, d, cx, cz) => {
        const g = new THREE.PlaneGeometry(w, d);
        g.rotateX(-Math.PI / 2);
        g.translate(cx, 0.02, cz);
        grassGeos.push(g);
      };

      // European/NY-style perimeter block with inner courtyard
      const addPerimeter = (cx, cz) => {
        const B = 9.2, dpt = 2.3 + rng() * 0.5;
        const hBase = 3 + rng() * 3;
        const slab = (x0, z0, w, d) => {
          const h = Math.max(2.6, hBase + (rng() - 0.5) * 2.4);
          const mat = sideMats[Math.floor(rng() * sideMats.length)];
          addBox(mat, w, h, d, x0, h / 2, z0, true);
          addBox(roofMat, w - 0.12, 0.18, d - 0.12, x0, h + 0.07, z0, false);
          addParapet(w, d, x0, h, z0);
          if (rng() < 0.45) addRoofClutter(x0, h, z0, w, d);
          if (h > 5.5 && rng() < 0.28)
            addWaterTower(x0 + (rng() - 0.5) * (w - 1.6), h, z0 + (rng() - 0.5) * (d - 1.6));
        };
        for (const zz of [cz - (B - dpt) / 2, cz + (B - dpt) / 2]) {
          const n = 2 + (rng() < 0.5 ? 1 : 0);
          let x0 = cx - B / 2;
          for (let i = 0; i < n; i++) {
            const w = B / n;
            slab(x0 + w / 2, zz, w - 0.06, dpt);
            x0 += w;
          }
        }
        const innerD = B - 2 * dpt;
        for (const xx of [cx - (B - dpt) / 2, cx + (B - dpt) / 2]) {
          const n = rng() < 0.5 ? 1 : 2;
          let z0 = cz - innerD / 2;
          for (let i = 0; i < n; i++) {
            const d = innerD / n;
            slab(xx, z0 + d / 2, dpt, d - 0.06);
            z0 += d;
          }
        }
        addGrass(Math.max(1.4, innerD - 0.6), Math.max(1.4, innerD - 0.6), cx, cz);
        if (rng() < 0.8)
          treePts.push({ x: cx + (rng() - 0.5) * 2.2, z: cz + (rng() - 0.5) * 2.2, s: 0.55 + rng() * 0.45 });
      };

      // downtown podium + tower
      const addPodiumTower = (cx, cz, tall) => {
        const pw = 8 + rng() * 1.4, pd = 8 + rng() * 1.4, ph = 2.8 + rng() * 2.2;
        const pMat = sideMats[Math.floor(rng() * sideMats.length)];
        addBox(pMat, pw, ph, pd, cx, ph / 2, cz, true);
        addParapet(pw, pd, cx, ph, cz);
        addBox(roofMat, pw - 0.15, 0.18, pd - 0.15, cx, ph + 0.07, cz, false);
        const tMat = rng() < 0.55 ? curtainMat : sideMats[Math.floor(rng() * sideMats.length)];
        let tw = 4.2 + rng() * 2.2, td = 4.2 + rng() * 2.2;
        const X = cx + (rng() - 0.5) * Math.max(0, pw - tw - 1);
        const Z = cz + (rng() - 0.5) * Math.max(0, pd - td - 1);
        let y = ph;
        if (rng() < 0.55 && tall > 16) {
          const t1 = tall * (0.62 + rng() * 0.12);
          addBox(tMat, tw, t1, td, X, y + t1 / 2, Z, true);
          addParapet(tw, td, X, y + t1, Z);
          y += t1;
          tw *= 0.72; td *= 0.72;
          const t2 = tall - t1;
          addBox(tMat, tw, t2, td, X, y + t2 / 2, Z, true);
          addParapet(tw, td, X, y + t2, Z);
          y += t2;
        } else {
          addBox(tMat, tw, tall, td, X, y + tall / 2, Z, true);
          addParapet(tw, td, X, y + tall, Z);
          y += tall;
        }
        addBox(roofMat, tw - 0.1, 0.16, td - 0.1, X, y + 0.06, Z, false);
        addBox(hvacMat, tw * 0.45, 0.9 + rng() * 0.9, td * 0.45, X + (rng() - 0.5) * tw * 0.25, y + 0.65, Z, false);
        if (rng() < 0.5) addBox(darkMat, 0.1, 2.5 + rng() * 3.5, 0.1, X, y + 1.8, Z, false);
        if (rng() < 0.4) addRoofClutter(cx, ph, cz, pw, pd);
      };

      // ---- streets: worn asphalt, sidewalks, crosswalks ----
      {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const x = c.getContext('2d');
        x.fillStyle = '#87837b'; x.fillRect(0, 0, 256, 256);        // block ground
        x.fillStyle = '#9a968e';                                    // sidewalks
        x.fillRect(80, 0, 96, 256); x.fillRect(0, 80, 256, 96);
        x.fillStyle = '#3d4045';                                    // asphalt
        x.fillRect(92, 0, 72, 256); x.fillRect(0, 92, 256, 72);
        // asphalt wear
        for (let i = 0; i < 500; i++) {
          x.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.05)';
          const px = rng() * 256, py = rng() * 256;
          if ((px > 92 && px < 164) || (py > 92 && py < 164)) x.fillRect(px, py, 1 + rng() * 3, 1 + rng() * 3);
        }
        // gutters
        x.fillStyle = 'rgba(0,0,0,0.3)';
        x.fillRect(92, 0, 2, 256); x.fillRect(162, 0, 2, 256);
        x.fillRect(0, 92, 256, 2); x.fillRect(0, 162, 256, 2);
        // lane dashes
        x.strokeStyle = 'rgba(226,218,196,0.5)'; x.lineWidth = 2;
        x.setLineDash([10, 12]);
        x.beginPath();
        x.moveTo(128, 0); x.lineTo(128, 80); x.moveTo(128, 176); x.lineTo(128, 256);
        x.moveTo(0, 128); x.lineTo(80, 128); x.moveTo(176, 128); x.lineTo(256, 128);
        x.stroke();
        x.setLineDash([]);
        // crosswalks
        x.fillStyle = 'rgba(226,218,196,0.45)';
        for (let s = 96; s < 164; s += 10) {
          x.fillRect(s, 82, 6, 8); x.fillRect(s, 166, 6, 8);
          x.fillRect(82, s, 8, 6); x.fillRect(166, s, 8, 6);
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(64, 64);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(704, 704),
          new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0.02, envMapIntensity: 0.35 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.05;
        ground.receiveShadow = true;
        city.add(ground);
      }
      const grid = new THREE.GridHelper(560, 56, 0x38d9f5, 0x38d9f5);
      grid.material.transparent = true;
      grid.material.opacity = 0.05;
      grid.position.y = 0.03;
      this._grid = grid;
      city.add(grid);

      // ---- landmark sites ----
      const SITE_PARK = [-44, -26];
      const SITE_TOWER = [40, -34];
      const SITE_PARCEL = [22, 34];
      const nearSite = (cx, cz, s, r) => Math.hypot(cx - s[0], cz - s[1]) < r;

      const mkPark = (cx, cz) => {
        addGrass(8.8, 8.8, cx, cz);
        const n = 5 + Math.floor(rng() * 5);
        for (let i = 0; i < n; i++)
          treePts.push({ x: cx + (rng() - 0.5) * 7.4, z: cz + (rng() - 0.5) * 7.4, s: 0.8 + rng() * 0.9 });
      };

      // ---- city blocks: real downtown structure ----
      for (let gx = -8; gx <= 8; gx++) for (let gz = -8; gz <= 8; gz++) {
        const cx = gx * 11, cz = gz * 11;
        const dist = Math.hypot(cx, cz);
        if (dist > 96) continue;
        if (nearSite(cx, cz, SITE_PARK, 14) || nearSite(cx, cz, SITE_TOWER, 10) || nearSite(cx, cz, SITE_PARCEL, 10)) continue;
        if (rng() < 0.07) { mkPark(cx, cz); }
        else {
          const core = Math.max(0, 1 - dist / 95);
          if (dist < 36 && rng() < 0.78) {
            addPodiumTower(cx + (rng() - 0.5) * 1.2, cz + (rng() - 0.5) * 1.2,
              13 + rng() * rng() * 30 + core * 9);
          } else if (dist < 62 && rng() < 0.28) {
            addPodiumTower(cx, cz, 8 + rng() * 10);
          } else if (rng() < 0.46) {
            addPerimeter(cx, cz);
          } else if (fbxModels.length && rng() < 0.55) {
            fbxPlacements.push({
              x: cx + (rng() - 0.5) * 1.5, z: cz + (rng() - 0.5) * 1.5,
              rot: Math.floor(rng() * 4) * Math.PI / 2,
              type: Math.floor(rng() * fbxModels.length),
              sv: rng(),
            });
          } else {
            const n = 1 + Math.floor(rng() * 2);
            for (let k = 0; k < n; k++) {
              const w = 3 + rng() * 3.2, d = 3 + rng() * 3.2;
              const h = 3.2 + rng() * 5 + core * 7 * rng();
              const ox = (rng() - 0.5) * (8 - w), oz = (rng() - 0.5) * (8 - d);
              addFlat(sideMats[Math.floor(rng() * sideMats.length)], w, h, d, cx + ox, cz + oz);
            }
          }
        }
        if (rng() < 0.65) {
          const nT = 1 + Math.floor(rng() * 3);
          for (let i = 0; i < nT; i++) {
            const edge = Math.floor(rng() * 4);
            const off = (rng() - 0.5) * 7;
            const E = 4.55;
            const tx = cx + (edge === 0 ? -E : edge === 1 ? E : off);
            const tz = cz + (edge === 2 ? -E : edge === 3 ? E : off);
            treePts.push({ x: tx, z: tz, s: 0.55 + rng() * 0.5 });
          }
        }
      }

      // ---- SITE 1: Elm Park ----
      {
        const [PX, PZ] = SITE_PARK;
        addGrass(20, 20, PX, PZ);
        const pond = new THREE.Mesh(
          new THREE.CircleGeometry(3.4, 24),
          new THREE.MeshStandardMaterial({ color: 0x9a8a74, roughness: 0.04, metalness: 0.92, envMapIntensity: 1.5 })
        );
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(PX + 2.5, 0.04, PZ + 2);
        city.add(pond);
        const path = new THREE.Mesh(
          new THREE.RingGeometry(5.2, 6.2, 32),
          new THREE.MeshStandardMaterial({ color: 0xa8a296, roughness: 1 })
        );
        path.rotation.x = -Math.PI / 2;
        path.position.set(PX, 0.035, PZ);
        city.add(path);
        for (let i = 0; i < 22; i++) {
          const a = rng() * Math.PI * 2, r = 2 + rng() * 7.5;
          const tx = PX + Math.cos(a) * r, tz = PZ + Math.sin(a) * r;
          if (Math.hypot(tx - (PX + 2.5), tz - (PZ + 2)) < 4.2) continue;
          treePts.push({ x: tx, z: tz, s: 0.9 + rng() * 1.1 });
        }
      }

      // ---- accent edges ----
      this._accentLines = [];
      const edgeMatBase = new THREE.LineBasicMaterial({ color: 0x38d9f5, transparent: true, opacity: 0.6 });
      const addEdgesFromGeo = (g) => {
        const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMatBase.clone());
        city.add(l);
        this._accentLines.push(l);
      };

      // ---- SITE 2: hero glass tower ----
      {
        const [LX, LZ] = SITE_TOWER;
        const tiers = [[11, 18, 8, 9], [8.5, 16, 6.5, 26], [6, 12, 5, 40]];
        for (const [w, h, d, y] of tiers) {
          const gg2 = new THREE.BoxGeometry(w, h, d);
          scaleUV(gg2, w, h, d);
          gg2.translate(LX, y, LZ);
          addGeo(curtainMat, gg2);
          addParapet(w, d, LX, y + h / 2, LZ);
          addEdgesFromGeo(new THREE.BoxGeometry(w, h, d).translate(LX, y, LZ));
        }
        addBox(darkMat, 0.14, 4, 0.14, LX, 48, LZ, false);
        addBox(roofMat, 6, 0.4, 3, LX, 3.4, LZ + 5.2, false);
      }

      // ---- SITE 3: development parcel + crane + ghost massing ----
      {
        const [LX, LZ] = SITE_PARCEL;
        const pad = new THREE.Mesh(
          new THREE.PlaneGeometry(9.4, 9.4),
          new THREE.MeshStandardMaterial({ color: 0x9d7f5e, roughness: 1 })
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(LX, 0.03, LZ);
        pad.receiveShadow = true;
        city.add(pad);
        const ghost = new THREE.Mesh(
          new THREE.BoxGeometry(5.5, 14, 4.5),
          new THREE.MeshStandardMaterial({ color: 0x38d9f5, transparent: true, opacity: 0.16, roughness: 0.2 })
        );
        ghost.position.set(LX - 1, 7, LZ - 1);
        city.add(ghost);
        addEdgesFromGeo(new THREE.BoxGeometry(5.5, 14, 4.5).translate(LX - 1, 7, LZ - 1));
        addBox(craneMat, 0.5, 16, 0.5, LX + 3, 8, LZ + 2.5, false);
        addBox(craneMat, 10, 0.4, 0.4, LX + 0.5, 15.8, LZ + 2.5, false);
        addBox(craneMat, 3, 0.4, 0.4, LX + 6, 15.8, LZ + 2.5, false);
        addBox(darkMat, 0.8, 0.8, 0.8, LX + 7, 15.3, LZ + 2.5, false);
        addBox(darkMat, 0.08, 4, 0.08, LX - 2.5, 13.8, LZ + 2.5, false);
        for (const [fx, fz, fw, fd] of [[LX, LZ - 4.6, 9.4, 0.15], [LX, LZ + 4.6, 9.4, 0.15], [LX - 4.6, LZ, 0.15, 9.4], [LX + 4.6, LZ, 0.15, 9.4]])
          addBox(darkMat, fw, 1.1, fd, fx, 0.55, fz, false);
      }

      // ---- grass ----
      if (grassGeos.length) {
        const grass = new THREE.Mesh(mergeGeos(grassGeos),
          new THREE.MeshStandardMaterial({ color: 0x64744c, roughness: 1 }));
        grass.receiveShadow = true;
        city.add(grass);
      }

      // ---- far silhouettes melting into haze ----
      for (let i = 0; i < 70; i++) {
        const ang = rng() * Math.PI * 2;
        const rad = 118 + rng() * 70;
        const w = 8 + rng() * 16, h = 8 + rng() * 34;
        addBox(silMat, w, h, 8 + rng() * 12, Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad, false);
      }

      // ---- commit merged ----
      for (const [mat, geos] of buckets) {
        const mesh = new THREE.Mesh(mergeGeos(geos), mat);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        city.add(mesh);
      }

      // ---- real residential buildings, instanced per type ----
      if (fbxModels.length && fbxPlacements.length) {
        const byType = fbxModels.map(() => []);
        for (const p of fbxPlacements) byType[p.type].push(p);
        const M = new THREE.Matrix4(), q = new THREE.Quaternion(),
          sv = new THREE.Vector3(), pv = new THREE.Vector3(),
          up = new THREE.Vector3(0, 1, 0);
        fbxModels.forEach((m, ti) => {
          const list = byType[ti];
          if (!list.length) return;
          const im = new THREE.InstancedMesh(m.geo, m.mat, list.length);
          list.forEach((p, i) => {
            q.setFromAxisAngle(up, p.rot);
            const sc = m.scale * (0.88 + p.sv * 0.28);
            sv.set(sc, sc, sc);
            pv.set(p.x, 0, p.z);
            M.compose(pv, q, sv);
            im.setMatrixAt(i, M);
          });
          im.castShadow = true;
          im.receiveShadow = true;
          city.add(im);
        });
      }

      // ---- trees: irregular multi-lobe canopies, muted olive greens ----
      if (treePts.length) {
        const M = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const sv = new THREE.Vector3();
        const pv = new THREE.Vector3();
        const trunkGeo = new THREE.CylinderGeometry(0.07, 0.13, 1.1, 5);
        trunkGeo.translate(0, 0.55, 0);
        const trunks = new THREE.InstancedMesh(trunkGeo,
          new THREE.MeshStandardMaterial({ color: 0x4e3b28, roughness: 1 }), treePts.length);
        const lobes = [];
        const mkLobe = (r, ox, oy, oz) => {
          const g = new THREE.IcosahedronGeometry(r, 2);
          if (!g.index) {
            const nV = g.attributes.position.count;
            const idx = new Uint32Array(nV);
            for (let j = 0; j < nV; j++) idx[j] = j;
            g.setIndex(new THREE.BufferAttribute(idx, 1));
          }
          const p = g.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const nx = p.getX(i), ny = p.getY(i), nz = p.getZ(i);
            // deterministic noise (duplicated verts move identically — no cracks)
            const j = 1 + 0.2 * Math.sin(nx * 9.1 + oy * 5) + 0.16 * Math.sin(nz * 8.2 + ox * 7) + 0.13 * Math.sin(ny * 7.3);
            p.setXYZ(i, nx * j, ny * j * 0.88, nz * j);
          }
          g.computeVertexNormals();
          g.translate(ox, oy, oz);
          lobes.push(g);
        };
        mkLobe(0.62, 0, 1.5, 0);
        mkLobe(0.45, 0.4, 1.22, 0.15);
        mkLobe(0.42, -0.35, 1.28, -0.2);
        mkLobe(0.38, 0.05, 1.85, -0.1);
        const folGeo = mergeGeos(lobes);
        const fol = new THREE.InstancedMesh(folGeo,
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), treePts.length);
        const col = new THREE.Color();
        for (let i = 0; i < treePts.length; i++) {
          const t = treePts[i];
          q.setFromAxisAngle(up, rng() * Math.PI * 2);
          sv.set(t.s * (0.85 + rng() * 0.3), t.s * (0.8 + rng() * 0.5), t.s * (0.85 + rng() * 0.3));
          pv.set(t.x, 0, t.z);
          M.compose(pv, q, sv);
          trunks.setMatrixAt(i, M);
          fol.setMatrixAt(i, M);
          col.setHSL(0.2 + rng() * 0.07, 0.24 + rng() * 0.14, 0.17 + rng() * 0.1);
          fol.setColorAt(i, col);
        }
        trunks.castShadow = true;
        fol.castShadow = true;
        fol.receiveShadow = true;
        city.add(trunks); city.add(fol);
      }

      // ---- cars: muted real-world colors ----
      {
        const N = 48;
        const lanes = [];
        for (let g = -7; g <= 7; g++) lanes.push(g * 11 + 5.5);
        this._cars = [];
        const carGeo = new THREE.BoxGeometry(1.5, 0.62, 0.78);
        carGeo.translate(0, 0.36, 0);
        const carMesh = new THREE.InstancedMesh(carGeo,
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.7, envMapIntensity: 1.1 }), N);
        carMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const bodyCols = [0xd8d3c8, 0x8a8d92, 0x3a3d42, 0x6b2f2a, 0x2f4a5c, 0xb0a68e, 0x565048];
        const col = new THREE.Color();
        for (let i = 0; i < N; i++) {
          const axis = rng() < 0.5 ? 'x' : 'z';
          const lane = lanes[Math.floor(rng() * lanes.length)];
          const p = (rng() - 0.5) * 190;
          const spd = (3.5 + rng() * 6) * (rng() < 0.5 ? 1 : -1);
          this._cars.push({ axis, lane: lane + (spd > 0 ? 0.85 : -0.85), p, spd });
          col.setHex(bodyCols[Math.floor(rng() * bodyCols.length)]);
          carMesh.setColorAt(i, col);
        }
        carMesh.castShadow = true;
        this._carMesh = carMesh;
        this._carM = new THREE.Matrix4();
        this._qX = new THREE.Quaternion();
        this._qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        this._one = new THREE.Vector3(1, 1, 1);
        city.add(carMesh);
      }

      // ---- VOLUMETRIC LIGHT: sun glow + crepuscular beams through the haze ----
      {
        const sunDir = sun.position.clone().normalize();
        // sun glow sprite
        const gc = document.createElement('canvas'); gc.width = gc.height = 256;
        const gx2 = gc.getContext('2d');
        const rg = gx2.createRadialGradient(128, 128, 0, 128, 128, 128);
        rg.addColorStop(0, 'rgba(255,244,224,1)');
        rg.addColorStop(0.16, 'rgba(255,224,176,0.85)');
        rg.addColorStop(0.45, 'rgba(255,186,116,0.28)');
        rg.addColorStop(1, 'rgba(255,166,86,0)');
        gx2.fillStyle = rg; gx2.fillRect(0, 0, 256, 256);
        const gt2 = new THREE.CanvasTexture(gc);
        gt2.colorSpace = THREE.SRGBColorSpace;
        const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: gt2, transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, depthTest: false, fog: false, opacity: 0.85,
        }));
        sunSprite.position.copy(sunDir).multiplyScalar(430);
        sunSprite.scale.set(320, 320, 1);
        sunSprite.renderOrder = 4;
        scene.add(sunSprite);

        // beam texture: soft slanted shafts
        const bc = document.createElement('canvas'); bc.width = 512; bc.height = 256;
        const bx2 = bc.getContext('2d');
        for (let i = 0; i < 13; i++) {
          const px = 20 + rng() * 472, wd = 5 + rng() * 26, al = 0.09 + rng() * 0.22;
          const lg = bx2.createLinearGradient(px - wd, 0, px + wd, 0);
          lg.addColorStop(0, 'rgba(255,222,174,0)');
          lg.addColorStop(0.5, `rgba(255,222,174,${al})`);
          lg.addColorStop(1, 'rgba(255,222,174,0)');
          bx2.fillStyle = lg;
          bx2.fillRect(px - wd, 0, wd * 2, 256);
        }
        bx2.globalCompositeOperation = 'destination-in';
        const vg = bx2.createLinearGradient(0, 0, 0, 256);
        vg.addColorStop(0, 'rgba(0,0,0,1)');
        vg.addColorStop(0.7, 'rgba(0,0,0,0.45)');
        vg.addColorStop(1, 'rgba(0,0,0,0)');
        bx2.fillStyle = vg; bx2.fillRect(0, 0, 512, 256);
        const bt = new THREE.CanvasTexture(bc);
        bt.colorSpace = THREE.SRGBColorSpace;
        const yaw = Math.atan2(-sunDir.z, sunDir.x);
        const el = Math.asin(sunDir.y);
        const tilt = (Math.PI / 2 - el) * 0.6;   // beams lean along the sun ray
        const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        for (const [off, sc, op] of [[-46, 1.15, 0.45], [-8, 1, 0.6], [30, 0.9, 0.45], [66, 0.75, 0.3]]) {
          const m = new THREE.Mesh(
            new THREE.PlaneGeometry(340 * sc, 130 * sc),
            new THREE.MeshBasicMaterial({
              map: bt, transparent: true, blending: THREE.AdditiveBlending,
              depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: op,
            })
          );
          m.position.copy(n).multiplyScalar(off);
          m.position.y = 42 * sc;
          m.rotation.y = yaw;
          m.rotateZ(tilt);
          m.renderOrder = 5;
          scene.add(m);
        }
      }

      // ---- pins DOM ----
      this._pinEls = PINS.map((p) => {
        const b = document.createElement('button');
        b.className = 'pin' + (p.side === 'left' ? ' flip' : '');
        b.style.setProperty('--c', p.color);
        b.innerHTML = `<span class="ring"></span><span class="dot"></span>` +
          `<span class="chip"><b>${p.title}</b><i>${p.sub}</i></span>`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.focusPin(p.id);
          this.dispatchEvent(new CustomEvent('pinselect', { detail: { id: p.id }, bubbles: true, composed: true }));
        });
        this._pinLayer.appendChild(b);
        return b;
      });

      this._applyAccent(this.getAttribute('accent') || '#38d9f5');

      const resize = () => {
        const w = this.clientWidth || 1, h = this.clientHeight || 1;
        this._W = w; this._H = h;
        renderer.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      };
      this._ro = new ResizeObserver(resize);
      this._ro.observe(this);
      resize();

      this._ready = true;
      this.dispatchEvent(new CustomEvent('cityready', { bubbles: true, composed: true }));
      this._pt = performance.now();
      const loop = (t) => { this._raf = requestAnimationFrame(loop); this._frame(t); };
      this._raf = requestAnimationFrame(loop);
    }

    _applyAccent(hex) {
      if (!this._T) return;
      const c = new this._T.Color(hex);
      if (this._grid) this._grid.material.color = c;
      for (const l of (this._accentLines || [])) l.material.color = c;
    }

    _frame(t) {
      const dt = Math.min(0.05, (t - this._pt) / 1000 || 0.016);
      this._pt = t;

      const focus = this._focusId ? PINS.find(p => p.id === this._focusId) : null;
      if (focus) {
        this._tPos.set(focus.cam[0], focus.cam[1], focus.cam[2]);
        this._tLook.set(focus.look[0], focus.look[1], focus.look[2]);
      } else {
        const e = smooth(this._progress);
        const drift = Math.sin(t * 0.00022) * 2.2;
        this._tPos.set(drift, 16 + 48 * e, 120 - 34 * e);
        this._tLook.set(drift * 0.4, 34 - 32 * e, -30 + 14 * e);
      }
      const mAmp = focus ? 0.35 : 1;
      this._tPos.x += this._mx * 3.5 * mAmp;
      this._tPos.y += -this._my * 1.4 * mAmp;
      this._tLook.x += this._mx * 8 * mAmp;
      this._tLook.y += -this._my * 4.5 * mAmp;
      const k = 1 - Math.pow(0.002, dt);
      this._cam.position.lerp(this._tPos, k);
      this._lookCur.lerp(this._tLook, k);
      this._cam.lookAt(this._lookCur);

      if (this._cars) {
        for (let i = 0; i < this._cars.length; i++) {
          const c = this._cars[i];
          c.p += c.spd * dt;
          if (c.p > 96) c.p = -96;
          if (c.p < -96) c.p = 96;
          const M = this._carM;
          if (c.axis === 'x') M.compose(this._v3.set(c.p, 0, c.lane), this._qX, this._one);
          else M.compose(this._v3.set(c.lane, 0, c.p), this._qZ, this._one);
          this._carMesh.setMatrixAt(i, M);
        }
        this._carMesh.instanceMatrix.needsUpdate = true;
      }

      const showPins = this._progress > 0.84;
      for (let i = 0; i < PINS.length; i++) {
        const p = PINS[i], el = this._pinEls[i];
        const v = this._v3.set(p.pos[0], p.pos[1], p.pos[2]).project(this._cam);
        const behind = v.z > 1;
        el.style.transform = `translate(${(v.x * 0.5 + 0.5) * this._W}px, ${(-v.y * 0.5 + 0.5) * this._H}px)`;
        const vis = !behind && (this._focusId ? this._focusId === p.id : showPins);
        el.classList.toggle('show', vis);
        el.classList.toggle('quiet', this._focusId === p.id);
      }

      this._renderer.render(this._scene, this._cam);
    }
  }

  customElements.define('exmap-city', ExmapCity);
})();
