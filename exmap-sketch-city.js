/* <exmap-sketch> — blueprint / outline-sketch city with a central park.
   White volumes + ink edge lines on paper, fog fade, topo contours,
   pond, loop path, playground, scenario pins in blueprint chips.
   API:
     attributes: ink (hex), paper (hex)
     setProgress(p) 0..1 · focusPin(id) · clearFocus()
   Events (composed): 'pinselect' {id}
*/
(() => {
  if (customElements.get('exmap-sketch')) return;
  const THREE_URL = 'https://unpkg.com/three@0.161.0/build/three.module.js';

  const PINS = [
    { id: 'p1', side: 'right', accent: '#22c55e',
      title: 'DESIGN REVIEW — APPROVED', sub: 'Architecture · facade V4',
      checks: [
        { label: 'Massing envelope', verdict: 'PASS', cells: 'ggggggagggggggggg' },
        { label: 'Wind comfort', verdict: 'PASS', cells: 'ggaggggggggggggg' },
      ],
      msgs: [
        { av: 'LB', name: 'Lena Brandt', role: 'ARCHITECT', when: '9:20 AM', text: 'V4 setbacks read beautifully from street level. Locking the facade grid →' },
        { av: 'MC', name: 'Mira Chen', role: 'PLANNER', when: '9:26 AM', text: 'Zoning confirms FAR 8.4 — plaza shadow stays under 2h. Approved on our side.' },
      ],
      pos: [-31.5, 18, 0], hl: [11, 22, 11], cam: [-4, 32, 12], look: [-31.5, 9, 0] },
    { id: 'p2', side: 'left', accent: '#22d3ee',
      title: 'FEASIBILITY — PARCEL 41-B', sub: 'Real estate · yield +8.2%',
      graph: { title: 'PROJECTED YIELD', tag: '+8.2%', from: 'Q1', to: 'Q8',
        bars: [14, 16, 15, 19, 22, 21, 26, 30, 29, 34, 38, 42] },
      msgs: [
        { av: 'OH', name: 'Omar Haddad', role: 'DEVELOPER', when: '11:31 AM', text: '41-B pencils at +8.2% with podium retail. Sending to committee →' },
        { av: 'DK', name: 'Dana Katz', role: 'PLANNER', when: '11:38 AM', text: 'Zoning is clear on our side — syncing with the community board Thursday.' },
      ],
      pos: [20, 2.4, 21], hl: [12, 7, 12], cam: [26, 38, 36], look: [20, 2, 21] },
    { id: 'p3', side: 'right', accent: '#f43f5e',
      title: 'SUNLIGHT STUDY — FAILED', sub: 'Urban planning · Elm Park',
      msgs: [
        { av: 'MC', name: 'Mira Chen', role: 'PLANNER', when: '2:40 PM', text: 'Tower shadow crosses the playground 2–4pm. Requesting massing revision →' },
        { av: 'LB', name: 'Lena Brandt', role: 'ARCHITECT', when: '2:47 PM', text: 'Received — testing a 6m setback on the south tower to clear the playground.' },
        { av: 'DK', name: 'Dana Katz', role: 'COMMUNITY', when: '2:52 PM', text: 'Parents group flagged that same corner — thanks for the quick turnaround.' },
      ],
      pos: [-11, 3.2, -5], hl: [14, 5, 11], cam: [-22, 9, 12], look: [-11, 1, -5] },
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

  class ExmapSketch extends HTMLElement {
    static get observedAttributes() { return ['ink', 'paper']; }

    constructor() {
      super();
      this._progress = 0;
      this._focusId = null;
      this._mx = 0; this._my = 0;
      this._onPointer = (e) => {
        this._mx = (e.clientX / innerWidth) * 2 - 1;
        this._my = (e.clientY / innerHeight) * 2 - 1;
      };
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = `<style>
        :host{display:block;position:relative;overflow:hidden;width:100%;height:100%;--ink:#2438b8}
        canvas{display:block;width:100%;height:100%}
        .pins{position:absolute;inset:0;pointer-events:none;overflow:hidden}
        .pin{position:absolute;left:0;top:0;background:none;border:none;padding:0;margin:0;cursor:pointer;
             opacity:0;pointer-events:none;transition:opacity .5s;will-change:transform;
             font-family:'IBM Plex Mono',monospace}
        .pin.show{opacity:1;pointer-events:auto}
        .pin{--ac:var(--ink);outline:none}
        .pin .dot{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;
             background:var(--ink);border:3px solid #fff;box-shadow:0 0 0 2px var(--ink)}
        .pin .ring{position:absolute;left:-13px;top:-13px;width:24px;height:24px;border-radius:50%;
             border:2px solid var(--ink);animation:xsPulse 2.4s ease-out infinite}
        @keyframes xsPulse{0%{transform:scale(.5);opacity:.9}70%{transform:scale(1.5);opacity:0}100%{opacity:0}}
        .chip{position:absolute;top:-19px;left:24px;width:max-content;max-width:250px;text-align:left;display:block;
             background:#fff;border:1px solid var(--ink);border-left:3px solid var(--ac);border-radius:8px;
             padding:8px 12px;box-shadow:4px 4px 0 color-mix(in srgb, var(--ink) 16%, transparent);transition:transform .2s}
        .chip::before{content:'';position:absolute;top:18px;left:-24px;width:24px;height:1px;background:var(--ink)}
        .pin.flip .chip{left:auto;right:24px}
        .pin.flip .chip::before{left:auto;right:-24px}
        .chip .bar{display:block;color:var(--ink);font-size:13px;font-weight:700;letter-spacing:.08em;white-space:nowrap}
        .chip .body{display:block;margin-top:4px;font-size:11px;font-weight:600;letter-spacing:.06em;color:color-mix(in srgb, var(--ink) 88%, #fff);white-space:nowrap}
        .pin:hover .chip{transform:translate(0,-2px)}
        .pin.quiet .chip{opacity:0;pointer-events:none;transition:opacity .3s}
        .pin.open .chip{display:none}
        .convo{display:none;position:absolute;left:96px;top:-150px;--anchor:150px;width:276px;flex-direction:column;gap:8px;text-align:left;cursor:default}
        .pin.flip .convo{left:auto;right:96px}
        .pin.open .convo{display:flex}
        .convo::before{content:'';position:absolute;left:-20px;top:8px;height:calc(100% - 16px);width:11px;
             border:3px solid var(--ink);border-right:none;background:none;box-sizing:border-box}
        .pin.open .convo::before{animation:xsGrow 5.3s linear both}
        @keyframes xsGrow{0%{height:0}13%{height:7%}18%{height:7%}30%{height:27%}37%{height:27%}49%{height:48%}56%{height:48%}70%{height:64%}77%{height:64%}85%{height:80%}89%{height:80%}100%{height:calc(100% - 16px)}}
        .convo::after{content:'';position:absolute;left:-88px;top:var(--anchor);width:68px;height:3px;background:var(--ink);
             transform:scaleX(0);transform-origin:left}
        .pin.open .convo::after{animation:xsLine .5s ease-out both}
        @keyframes xsLine{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
        .pin.flip .convo::before{left:auto;right:-20px;border:3px solid var(--ink);border-left:none}
        .pin.flip .convo::after{left:auto;right:-88px;transform-origin:right}
        .status{display:flex;gap:9px;align-items:center;background:#fff;color:var(--ink);padding:10px 12px;
             border:1px solid var(--ink);border-left:3px solid var(--ac);border-radius:8px;
             box-shadow:4px 4px 0 color-mix(in srgb, var(--ink) 16%, transparent)}
        .status .sdot{width:9px;height:9px;border-radius:50%;background:var(--ac);flex:none;animation:xsBlink 1.6s ease-in-out infinite}
        @keyframes xsBlink{0%,100%{opacity:1}50%{opacity:.35}}
        .status .xclose{margin-left:auto;font-style:normal;font-size:13px;line-height:1;cursor:pointer;
             width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:1px solid color-mix(in srgb, var(--ink) 35%, #fff);border-radius:5px;flex:none}
        .status .xclose:hover{background:var(--ink);color:#fff}
        .status b{display:block;font-size:10px;letter-spacing:.1em;font-weight:700}
        .status i{display:block;font-style:normal;font-size:8px;letter-spacing:.14em;opacity:.7;margin-top:2px}
        .widget{display:block;background:#fff;border:1px solid color-mix(in srgb, var(--ink) 45%, #fff);border-radius:8px;padding:4px 0;color:var(--ink)}
        .crow{display:block;padding:6px 10px}
        .crow+.crow{border-top:1px solid color-mix(in srgb, var(--ink) 18%, #fff)}
        .chd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}
        .chd b{font-size:10px;font-weight:600;letter-spacing:.03em}
        .chd i{font-style:normal;font-size:8px;font-weight:700;letter-spacing:.14em;color:var(--ink)}
        .crow.fail .chd i{color:var(--ink);text-decoration:underline}
        .cells{display:flex;gap:2px}
        .cells i{flex:1;height:9px;border-radius:2px;background:color-mix(in srgb, var(--ink) 55%, #fff)}
        .cells i.a{background:color-mix(in srgb, var(--ink) 25%, #fff)}
        .cells i.r{background:var(--ink)}
        .cft{display:flex;justify-content:space-between;margin-top:3px;font-size:7px;letter-spacing:.14em;color:color-mix(in srgb, var(--ink) 55%, #fff)}
        .cft i{font-style:normal}
        .gbars{display:flex;align-items:flex-end;gap:3px;height:54px;padding:8px 10px 4px}
        .gbars i{flex:1;background:color-mix(in srgb, var(--ink) 28%, #fff);border-radius:2px 2px 0 0}
        .gbars i.hot{background:var(--ink)}
        .msg{display:flex;gap:8px;background:#fff;border:1px solid color-mix(in srgb, var(--ink) 45%, #fff);border-radius:8px;padding:8px 10px;color:var(--ink);margin-left:22px}
        .av{flex:none;width:24px;height:24px;border-radius:50%;background:var(--ink);overflow:hidden;display:flex;align-items:flex-end;justify-content:center}
        .av svg{width:18px;height:18px;display:block}
        .msg.you .av{background:color-mix(in srgb, var(--ink) 70%, #000)}
        .msg .mb{display:block;min-width:0;flex:1}
        .msg .mh{display:flex;align-items:baseline;gap:6px;margin-bottom:2px}
        .msg .mh b{font-size:9px;font-weight:700}
        .msg .mh .role{font-style:normal;font-size:7px;letter-spacing:.1em;background:color-mix(in srgb, var(--ink) 12%, #fff);border-radius:3px;padding:1px 4px}
        .msg .mh .tm{font-style:normal;font-size:7px;letter-spacing:.1em;opacity:.55}
        .msg .tx{display:block;font-size:9.5px;line-height:1.5;letter-spacing:.02em}
        .typing{display:flex;align-items:center;gap:5px;font-size:7px;letter-spacing:.16em;color:color-mix(in srgb, var(--ink) 60%, #fff);padding:0 2px;margin-left:24px}
        .typing i{width:4px;height:4px;border-radius:50%;background:var(--ink);animation:xsTyp 1.2s ease-in-out infinite;font-style:normal}
        .typing i:nth-child(2){animation-delay:.2s}
        .typing i:nth-child(3){animation-delay:.4s}
        @keyframes xsTyp{0%,100%{opacity:.25;transform:none}50%{opacity:1;transform:translateY(-2px)}}
        .composer{display:flex;gap:8px;background:#fff;border:1px solid var(--ink);border-radius:8px;padding:8px 10px;color:var(--ink);margin-left:38px;
             box-shadow:4px 4px 0 color-mix(in srgb, var(--ink) 16%, transparent)}
        .composer .mb{display:block;min-width:0;flex:1}
        .composer b{display:block;font-size:9px;font-weight:700;margin-bottom:4px}
        .cinput{display:block;width:100%;box-sizing:border-box;background:color-mix(in srgb, var(--ink) 6%, #fff);
             border:1px solid color-mix(in srgb, var(--ink) 30%, #fff);border-radius:6px;padding:6px 8px;
             font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:var(--ink);outline:none}
        .cinput:focus{border-color:var(--ink)}
        .cbar{display:flex;align-items:center;gap:9px;margin-top:6px}
        .cico{font-size:10px;opacity:.55;font-style:normal}
        .csend{margin-left:auto;display:flex;align-items:center;gap:5px;background:var(--ink);color:#fff;border-radius:999px;
             padding:4px 12px;font-size:9px;font-weight:700;letter-spacing:.12em;cursor:pointer}
        .csend:hover{background:#fff;color:var(--ink);outline:1.5px solid var(--ink);outline-offset:-4px}
        .back{display:block;text-align:center;font-size:9px;letter-spacing:.2em;color:var(--ink);
             background:#fff;border:1px solid color-mix(in srgb, var(--ink) 45%, #fff);border-radius:8px;padding:7px;cursor:pointer}
        .back:hover{border-color:var(--ink)}
        .pin.open .convo>*{animation:xsIn .7s both}
        .pin.open .convo>:nth-child(2){animation-delay:.9s}
        .pin.open .convo>:nth-child(3){animation-delay:1.9s}
        .pin.open .convo>:nth-child(4){animation-delay:3s}
        .pin.open .convo>:nth-child(5){animation-delay:4.1s}
        .pin.open .convo>:nth-child(6){animation-delay:4.6s}
        @keyframes xsIn{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
      </style>`;
      this._canvasHost = document.createElement('div');
      this._canvasHost.style.cssText = 'position:absolute;inset:0';
      r.appendChild(this._canvasHost);
      this._pinLayer = document.createElement('div');
      this._pinLayer.className = 'pins';
      r.appendChild(this._pinLayer);
    }

    attributeChangedCallback(name, _o, v) {
      if (!this._ready) return;
      if (name === 'ink') this._applyInk(v);
      if (name === 'paper') this._applyPaper(v);
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
      const rng = mulberry32(4711);

      // detailed building models (user asset pack) for the hi-tech core.
      // NOTE: examples/jsm loaders can't resolve bare 'three' imports here,
      // so we fetch the OBJ and parse it ourselves (plain v/f data).
      const objPromise = fetch('assets/buildlot.obj')
        .then((r) => (r.ok ? r.text() : null))
        .catch((e) => { console.warn('[exmap-sketch] obj fetch failed', e); return null; });

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;  // smooth edge, still hard/graphic
      this._renderer = renderer;
      this._canvasHost.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xf7f6f1, 120, 310);
      this._scene = scene;

      // graphic light: white sunlit faces, shadows drop to deep ink blue
      scene.add(new THREE.HemisphereLight(0x3644c8, 0x141c66, 0.38));
      const dl = new THREE.DirectionalLight(0xffffff, 1.35);
      dl.position.set(-60, 90, 40);
      dl.castShadow = true;
      dl.shadow.mapSize.set(4096, 4096);
      dl.shadow.camera.left = -140;
      dl.shadow.camera.right = 140;
      dl.shadow.camera.top = 140;
      dl.shadow.camera.bottom = -140;
      dl.shadow.camera.near = 20;
      dl.shadow.camera.far = 320;
      dl.shadow.bias = -0.0004;
      scene.add(dl);

      const cam = new THREE.PerspectiveCamera(50, 1.7, 0.5, 800);
      cam.position.set(0, 58, 122);
      this._cam = cam;
      this._lookCur = new THREE.Vector3(0, 12, -10);
      this._tPos = new THREE.Vector3(0, 58, 122);
      this._tLook = new THREE.Vector3(0, 12, -10);
      this._v3 = new THREE.Vector3();

      // ---- materials ----
      const fillMat = new THREE.MeshToonMaterial({ color: 0xffffff });  // two-tone: white lit / ink shadow
      this._fillMat = fillMat;
      const lineMat = new THREE.LineBasicMaterial({ color: 0x2438b8, transparent: true, opacity: 0.85 });
      this._lineMat = lineMat;
      const lawnMat = new THREE.MeshLambertMaterial({ color: 0xf0f0e2 });
      const pondMat = new THREE.MeshLambertMaterial({ color: 0xdce6f8 });
      const pathMat = new THREE.MeshLambertMaterial({ color: 0xeae7db });
      const padMat = new THREE.MeshLambertMaterial({ color: 0xf3ede0 });
      const groundMat = new THREE.MeshLambertMaterial({ color: 0xf7f6f1 });
      this._groundMat = groundMat;

      // ---- merge helpers ----
      const fillGeos = [];
      const lineGeos = [];
      const mergeGeos = (geos) => {
        let vc = 0, ic = 0;
        for (const g of geos) {
          vc += g.attributes.position.count;
          ic += g.index ? g.index.count : g.attributes.position.count;
        }
        const pos = new Float32Array(vc * 3), norm = new Float32Array(vc * 3);
        const idx = new Uint32Array(ic);
        let vo = 0, io = 0;
        for (const g of geos) {
          pos.set(g.attributes.position.array, vo * 3);
          norm.set(g.attributes.normal.array, vo * 3);
          const n = g.attributes.position.count;
          if (g.index) {
            const gi = g.index.array;
            for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
            io += gi.length;
          } else {
            for (let i = 0; i < n; i++) idx[io + i] = vo + i;
            io += n;
          }
          vo += n;
          g.dispose();
        }
        const m = new THREE.BufferGeometry();
        m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        m.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
        m.setIndex(new THREE.BufferAttribute(idx, 1));
        return m;
      };
      const mergeLines = (geos) => {
        let n = 0;
        for (const g of geos) n += g.attributes.position.count;
        const pos = new Float32Array(n * 3);
        let o = 0;
        for (const g of geos) {
          pos.set(g.attributes.position.array, o * 3);
          o += g.attributes.position.count;
          g.dispose();
        }
        const m = new THREE.BufferGeometry();
        m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        return m;
      };
      this._mergeGeosFn = mergeGeos;
      this._mergeLinesFn = mergeLines;
      const addBox = (w, h, d, x, y, z) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        fillGeos.push(g);
        const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d), 20);
        e.translate(x, y, z);
        lineGeos.push(e);
      };
      // rectangle outline loop (4 segments) at height y
      const addRectLoop = (w, d, x, y, z) => {
        const hw = w / 2, hd = d / 2;
        const pts = [
          [x - hw, y, z - hd, x + hw, y, z - hd],
          [x + hw, y, z - hd, x + hw, y, z + hd],
          [x + hw, y, z + hd, x - hw, y, z + hd],
          [x - hw, y, z + hd, x - hw, y, z - hd],
        ].flat();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
        lineGeos.push(g);
      };
      const addCircleLoop = (rx, rz, x, z, y, seg, wobble) => {
        const pts = [];
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
          const w0 = 1 + (wobble ? wobble * Math.sin(a0 * 3 + rx) : 0);
          const w1 = 1 + (wobble ? wobble * Math.sin(a1 * 3 + rx) : 0);
          pts.push(x + Math.cos(a0) * rx * w0, y, z + Math.sin(a0) * rz * w0,
                   x + Math.cos(a1) * rx * w1, y, z + Math.sin(a1) * rz * w1);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
        lineGeos.push(g);
      };

      // ---- ground ----
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.06;
      ground.receiveShadow = true;
      scene.add(ground);
      const grid = new THREE.GridHelper(380, 38, 0x2438b8, 0x2438b8);
      grid.material.transparent = true;
      grid.material.opacity = 0.06;
      grid.position.y = 0.005;
      this._grid = grid;
      scene.add(grid);

      // ---- park: lawn, pond, loop path, contours, playground, pavilion ----
      const PARK_W = 40, PARK_D = 28;
      {
        const lawn = new THREE.Mesh(new THREE.PlaneGeometry(PARK_W, PARK_D), lawnMat);
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.y = 0.01;
        lawn.receiveShadow = true;
        scene.add(lawn);
        addRectLoop(PARK_W, PARK_D, 0, 0.03, 0);
        // pond
        const pondGeo = new THREE.CircleGeometry(1, 40);
        pondGeo.scale(6, 4.2, 1);
        const pond = new THREE.Mesh(pondGeo, pondMat);
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(5.5, 0.03, -3);
        scene.add(pond);
        addCircleLoop(6, 4.2, 5.5, -3, 0.05, 40, 0.04);
        addCircleLoop(6.8, 4.9, 5.5, -3, 0.04, 40, 0.05); // shore line
        // topo contours radiating from pond
        for (let i = 0; i < 4; i++)
          addCircleLoop(8.2 + i * 2.6, 6 + i * 2.1, 5, -3, 0.035, 48, 0.08);
        // loop path (ring, west side)
        const ringGeo = new THREE.RingGeometry(6.4, 8.2, 40);
        const path = new THREE.Mesh(ringGeo, pathMat);
        path.rotation.x = -Math.PI / 2;
        path.position.set(-9, 0.02, 1);
        scene.add(path);
        addCircleLoop(6.4, 6.4, -9, 1, 0.04, 40, 0);
        addCircleLoop(8.2, 8.2, -9, 1, 0.04, 40, 0);
        // playground pad (option B)
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(7, 5.4), padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(11, 0.025, 7.5);
        scene.add(pad);
        addRectLoop(7, 5.4, 11, 0.05, 7.5);
        addBox(1.2, 0.9, 1.2, 9.6, 0.45, 6.6);
        addBox(0.9, 1.4, 0.9, 11.4, 0.7, 8.2);
        addBox(2.2, 0.12, 0.5, 12.2, 0.9, 6.6);   // slide beam
        addBox(0.1, 0.9, 0.5, 13.2, 0.45, 6.6);
        // pavilion near path
        addBox(3.4, 0.16, 2.6, -9, 2.3, -6.5);
        for (const [px, pz] of [[-10.4, -7.5], [-7.6, -7.5], [-10.4, -5.5], [-7.6, -5.5]])
          addBox(0.16, 2.3, 0.16, px, 1.15, pz);
        // benches along path
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.4;
          addBox(1.1, 0.34, 0.4, -9 + Math.cos(a) * 9.3, 0.17, 1 + Math.sin(a) * 9.3);
        }
      }

      // ---- trees: sketch lollipops (trunk + faceted canopy w/ edges) ----
      const treePts = [];
      const inPark = (x, z) => Math.abs(x) < PARK_W / 2 - 1 && Math.abs(z) < PARK_D / 2 - 1;
      const nearPond = (x, z) => Math.hypot((x - 5.5) / 7.4, (z + 3) / 5.6) < 1;
      const nearPlay = (x, z) => Math.abs(x - 11) < 4.4 && Math.abs(z - 7.5) < 3.6;
      // park grove (denser west — shade-study zone)
      for (let i = 0; i < 46; i++) {
        const x = -PARK_W / 2 + 1.5 + rng() * (PARK_W - 3) * (rng() < 0.6 ? 0.5 : 1);
        const z = -PARK_D / 2 + 1.5 + rng() * (PARK_D - 3);
        if (nearPond(x, z) || nearPlay(x, z)) continue;
        if (Math.hypot((x + 9) / 7.3, (z - 1) / 7.3) > 0.86 && Math.hypot((x + 9) / 7.3, (z - 1) / 7.3) < 1.14) continue;
        treePts.push({ x, z, s: 0.8 + rng() * 0.9 });
      }
      // street trees around the park
      for (let i = 0; i < 26; i++) {
        const side = Math.floor(rng() * 4);
        const t = rng() * 2 - 1;
        const E = 3.2;
        const x = side < 2 ? t * (PARK_W / 2 + 2) : (side === 2 ? -PARK_W / 2 - E : PARK_W / 2 + E);
        const z = side < 2 ? (side === 0 ? -PARK_D / 2 - E : PARK_D / 2 + E) : t * (PARK_D / 2 + 2);
        treePts.push({ x, z, s: 0.6 + rng() * 0.4 });
      }
      {
        const canopyBase = new THREE.IcosahedronGeometry(1, 0);
        for (const t of treePts) {
          const trunk = new THREE.CylinderGeometry(0.06 * t.s, 0.09 * t.s, 1.1 * t.s, 5);
          trunk.translate(t.x, 0.55 * t.s, t.z);
          fillGeos.push(trunk);
          const c = canopyBase.clone();
          const sy = 0.8 + rng() * 0.5;
          c.scale(t.s, t.s * sy, t.s);
          c.rotateY(rng() * Math.PI);
          c.translate(t.x, (1.1 + sy * 0.75) * t.s, t.z);
          const e = new THREE.EdgesGeometry(c, 1);
          lineGeos.push(e);
          fillGeos.push(c);
        }
      }

      // ---- city blocks around the park ----
      const PITCH = 10.5, BLK = 8.6;
      const addFloorLoops = (w, h, d, x, z) => {
        for (let y = 3.4; y < h - 1.4; y += 3.4)
          addRectLoop(w + 0.04, d + 0.04, x, y, z);
      };
      const building = (cx, cz, hBase) => {
        const kind = rng();
        if (kind < 0.3 && hBase > 12) {
          // tiered tower with spire (greeble style)
          let w = 5.5 + rng() * 2, d = 5.5 + rng() * 2, y = 0;
          const tiers = 2 + Math.floor(rng() * 2);
          for (let i = 0; i < tiers; i++) {
            const th = hBase * (i === 0 ? 0.5 : 0.5 / (tiers - 1)) * (0.8 + rng() * 0.4);
            addBox(w, th, d, cx, y + th / 2, cz);
            if (rng() < 0.6) addFloorLoops(w, th, d, cx, cz) ;
            y += th; w *= 0.72; d *= 0.72;
          }
          addBox(0.14, 3 + rng() * 4, 0.14, cx, y + 1.8, cz);
        } else if (kind < 0.55) {
          // L-shape block
          const w = 5 + rng() * 2.5, d = 3 + rng() * 1.5, h = hBase * (0.5 + rng() * 0.4);
          addBox(w, h, d, cx - 1, h / 2, cz - 1.5);
          const h2 = h * (0.6 + rng() * 0.5);
          addBox(d, h2, w, cx + 1.8, h2 / 2, cz + 1);
          if (h > 7) addFloorLoops(w, h, d, cx - 1, cz - 1.5);
        } else if (kind < 0.75) {
          // slab row
          const n = 2 + Math.floor(rng() * 2);
          for (let i = 0; i < n; i++) {
            const w = BLK / n - 0.7, h = hBase * (0.4 + rng() * 0.4);
            addBox(w, h, 2.6 + rng(), cx - BLK / 2 + w / 2 + i * (BLK / n) + 0.3, h / 2, cz + (rng() - 0.5) * 3);
          }
        } else {
          // simple box + parapet step
          const w = 4.5 + rng() * 3, d = 4.5 + rng() * 3, h = hBase * (0.5 + rng() * 0.5);
          addBox(w, h, d, cx, h / 2, cz);
          const tw = w * (0.4 + rng() * 0.3);
          addBox(tw, 1 + rng() * 1.6, tw, cx + (rng() - 0.5) * (w - tw) * 0.5, h + 0.6, cz + (rng() - 0.5) * (d - tw) * 0.5);
          if (h > 7 && rng() < 0.7) addFloorLoops(w, h, d, cx, cz);
        }
      };
      const modelSlots = [];
      for (let gx = -11; gx <= 11; gx++) for (let gz = -11; gz <= 11; gz++) {
        const cx = gx * PITCH, cz = gz * PITCH;
        if (Math.abs(cx) < PARK_W / 2 + 5 && Math.abs(cz) < PARK_D / 2 + 5) continue;
        // keep a clear pocket around the descend camera's end position — fill with low-rise
        if ((cx - 17) * (cx - 17) + (cz - 56) * (cz - 56) < 220) {
          building(cx, cz, 2.5 + rng() * 3);
          continue;
        }
        const dist = Math.hypot(cx, cz);
        if (dist > 118) continue;
        const near = Math.max(0, 1 - dist / 120);
        const hBase = 5 + rng() * 9 + (dist > 55 ? rng() * rng() * 26 : rng() * 6) + near * 2;
        if (dist <= 74) {
          // hi-tech core: filled with detailed models from the asset pack
          modelSlots.push({ cx, cz, dist, hBase, rot: Math.floor(rng() * 4) * Math.PI / 2, r1: rng(), r2: rng() });
        } else {
          building(cx, cz, hBase);
        }
        // front band (camera side): pack the gaps with small low annex masses
        if (cz >= 18) {
          const n = 1 + Math.floor(rng() * 2);
          for (let i = 0; i < n; i++) {
            const w2 = 2 + rng() * 1.8, d2 = 2 + rng() * 1.8, h2 = 2.5 + rng() * 4.5;
            const ox = (rng() < 0.5 ? -1 : 1) * (BLK / 2 - w2 / 2 + 0.4);
            const oz2 = (rng() - 0.5) * (BLK - d2);
            addBox(w2, h2, d2, cx + ox, h2 / 2, cz + oz2);
          }
        }
      }

      // ---- commit merged geometry ----
      const fills = new THREE.Mesh(mergeGeos(fillGeos), fillMat);
      fills.frustumCulled = false;
      fills.castShadow = true;
      fills.receiveShadow = true;
      scene.add(fills);
      const lines = new THREE.LineSegments(mergeLines(lineGeos), lineMat);
      lines.frustumCulled = false;
      scene.add(lines);

      // ---- pins ----
      const AV_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4" fill="#fff"/><path d="M4 22c1.5-4.2 5-6.2 8-6.2s6.5 2 8 6.2z" fill="#fff"/></svg>';
      this._pinEls = PINS.map((p) => {
        const b = document.createElement('div');
        b.className = 'pin' + (p.side === 'left' ? ' flip' : '');
        b.setAttribute('role', 'button');
        b.tabIndex = 0;
        b.style.setProperty('--ac', p.accent);
        b.style.cursor = 'pointer';
        const checks = (p.checks || [])
          .map((c) => `<span class="crow${c.verdict === 'FAIL' ? ' fail' : ''}"><span class="chd"><b>${c.label}</b><i>${c.verdict}</i></span><span class="cells">${[...c.cells].map((ch) => `<i class="${ch === 'a' ? 'a' : ch === 'r' ? 'r' : ''}"></i>`).join('')}</span><span class="cft"><i>SG RUNS</i><i>TODAY</i></span></span>`)
          .join('');
        let widget = '';
        if (p.checks) {
          widget = `<span class="widget">${checks}</span>`;
        } else if (p.graph) {
          const gmax = Math.max(...p.graph.bars);
          const gbars = p.graph.bars
            .map((v, i) => `<i class="${i === p.graph.bars.length - 1 ? 'hot' : ''}" style="height:${Math.round(v / gmax * 44)}px"></i>`)
            .join('');
          widget = `<span class="widget"><span class="crow"><span class="chd"><b>${p.graph.title}</b><i>${p.graph.tag}</i></span></span><span class="gbars">${gbars}</span><span class="cft" style="padding:0 10px 8px"><i>${p.graph.from}</i><i>${p.graph.to}</i></span></span>`;
        }
        const msgs = p.msgs
          .map((m) => `<span class="msg"><span class="av">${AV_SVG}</span><span class="mb"><span class="mh"><b>${m.name}</b><i class="role">${m.role}</i><i class="tm">${m.when}</i></span><span class="tx">${m.text}</span></span></span>`)
          .join('');
        b.innerHTML = `<span class="ring"></span><span class="dot"></span>` +
          `<span class="chip"><span class="bar">${p.title}</span>` +
          `<span class="body">${p.sub}</span></span>` +
          `<span class="convo">` +
          `<span class="status"><span class="sdot"></span><span><b>${p.title}</b><i>${p.sub}</i></span><em class="xclose">×</em></span>` +
          widget +
          msgs +
          `<span class="typing"><i></i><i></i><i></i>&nbsp;${p.msgs[0].name.split(' ')[0].toUpperCase()} IS TYPING</span>` +
          `<span class="composer"><span class="av">${AV_SVG}</span><span class="mb"><b>You</b>` +
          `<input class="cinput" placeholder="Reply to the team…">` +
          `<span class="cbar"><i class="cico">⊕</i><i class="cico">Aa</i><i class="cico">@</i>` +
          `<span class="csend">SEND ▸</span></span></span></span>` +
          `</span>`;
        const sendMsg = () => {
          const input = b.querySelector('.cinput');
          const text = (input.value || '').trim();
          if (!text) return;
          const el2 = document.createElement('span');
          el2.className = 'msg you';
          el2.innerHTML = `<span class="av">${AV_SVG}</span><span class="mb"><span class="mh"><b>You</b><i class="tm">NOW</i></span><span class="tx"></span></span>`;
          el2.querySelector('.tx').textContent = text;
          b.querySelector('.typing').before(el2);
          input.value = '';
        };
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (e.target.closest('.csend')) { sendMsg(); return; }
          if (e.target.closest('.composer')) return;
          if (e.target.closest('.xclose')) {
            this.clearFocus();
            this.dispatchEvent(new CustomEvent('pinclear', { bubbles: true, composed: true }));
            return;
          }
          this.focusPin(p.id);
          this.dispatchEvent(new CustomEvent('pinselect', { detail: { id: p.id }, bubbles: true, composed: true }));
        });
        b.addEventListener('keydown', (e) => {
          if (e.target.closest && e.target.closest('.cinput')) {
            e.stopPropagation();
            if (e.key === 'Enter') sendMsg();
          }
        });
        this._pinLayer.appendChild(b);
        return b;
      });

      // ---- focus highlights: parcel volume + expanding ground ring per pin ----
      this._hls = PINS.map((p) => {
        const [hw, hh, hd] = p.hl;
        const g = new THREE.Group();
        const boxGeo = new THREE.BoxGeometry(hw, hh, hd);
        const box = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0x2438b8, transparent: true, opacity: 0.1, depthWrite: false }));
        box.position.y = hh / 2;
        const eg = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color: 0x2438b8, transparent: true, opacity: 0.95 }));
        eg.position.y = hh / 2;
        const scan = new THREE.Mesh(new THREE.PlaneGeometry(hw, hd), new THREE.MeshBasicMaterial({ color: 0x2438b8, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
        scan.rotation.x = -Math.PI / 2;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0x2438b8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.12;
        g.add(box, eg, scan, ring);
        g.position.set(p.pos[0], 0, p.pos[2]);
        g.visible = false;
        scene.add(g);
        return { g, box, scan, ring, hh, hw };
      });

      this._ready = true;
      this._applyInk(this.getAttribute('ink') || '#2438b8');
      this._applyPaper(this.getAttribute('paper') || '#f7f6f1');

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
      this.dispatchEvent(new CustomEvent('cityready', { bubbles: true, composed: true }));
      if (objPromise) {
        objPromise.then((text) => {
          if (!this._scene) return;
          let ok = false;
          if (text) {
            try { ok = this._placeModels(text, modelSlots); }
            catch (e) { console.warn('[exmap-sketch] model placement failed', e); }
          }
          if (ok) return;
          // fallback: procedural massing in the slots
          fillGeos.length = 0; lineGeos.length = 0;
          for (const s of modelSlots) building(s.cx, s.cz, s.hBase);
          const m2 = new THREE.Mesh(mergeGeos(fillGeos), fillMat);
          m2.frustumCulled = false; m2.castShadow = true; m2.receiveShadow = true; scene.add(m2);
          const l2 = new THREE.LineSegments(mergeLines(lineGeos), lineMat);
          l2.frustumCulled = false; scene.add(l2);
          this.dispatchEvent(new CustomEvent('modelsready', { bubbles: true, composed: true }));
        });
      }
      // ---- roads + traffic (added on top of the existing grid; buildings untouched) ----
      {
        const roadMat = new THREE.MeshLambertMaterial({ color: 0xe4e1d6 });
        const carBodyMat = new THREE.MeshLambertMaterial({ color: 0x2438b8 });
        const dashMat = new THREE.MeshBasicMaterial({ color: 0x2438b8, transparent: true, opacity: 0.5 });
        const HALF = 11 * PITCH;
        const ROADW = 3.0;
        const inPark = (x, z) => Math.abs(x) < PARK_W / 2 + 4 && Math.abs(z) < PARK_D / 2 + 4;
        // street centrelines sit between building rows: (g+0.5)*PITCH
        const lanes = [];
        for (let g = -11; g < 11; g++) lanes.push((g + 0.5) * PITCH);
        // road strips (skip the park footprint)
        this._cars = [];
        const rnd2 = mulberry32(99);
        for (const c of lanes) {
          if (Math.abs(c) > 116) continue;
          // avenue running along X at z=c
          if (!(Math.abs(c) < PARK_D / 2 + 4)) {
            const road = new THREE.Mesh(new THREE.PlaneGeometry(232, ROADW), roadMat);
            road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, c); road.receiveShadow = true; scene.add(road);
            for (let k = -110; k <= 110; k += 8) {
              const d = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.22), dashMat);
              d.rotation.x = -Math.PI / 2; d.position.set(k, 0.03, c); scene.add(d);
            }
            // cars on this avenue
            const nC = 2 + Math.floor(rnd2() * 3);
            for (let i = 0; i < nC; i++) {
              const car = new THREE.Group();
              const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 1.0), i % 2 ? carBodyMat : carBodyMat.clone());
              if (i % 2) body.material.color.setHex(0x0f2f7a);
              body.castShadow = true; body.position.y = 0.42; car.add(body);
              const dir = rnd2() < 0.5 ? 1 : -1;
              const lane = c + dir * 0.7;
              car.position.set((rnd2() * 2 - 1) * 110, 0, lane);
              scene.add(car);
              this._cars.push({ car, axis: 'x', dir, coord: lane, speed: 9 + rnd2() * 10 });
            }
          }
          // street running along Z at x=c
          if (!(Math.abs(c) < PARK_W / 2 + 4)) {
            const road = new THREE.Mesh(new THREE.PlaneGeometry(ROADW, 232), roadMat);
            road.rotation.x = -Math.PI / 2; road.position.set(c, 0.02, 0); road.receiveShadow = true; scene.add(road);
            for (let k = -110; k <= 110; k += 8) {
              const d = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 3), dashMat);
              d.rotation.x = -Math.PI / 2; d.position.set(c, 0.03, k); scene.add(d);
            }
            const nC = 2 + Math.floor(rnd2() * 3);
            for (let i = 0; i < nC; i++) {
              const car = new THREE.Group();
              const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 2.0), carBodyMat.clone());
              body.material.color.setHex(i % 2 ? 0x2438b8 : 0x0f2f7a);
              body.castShadow = true; body.position.y = 0.42; car.add(body);
              const dir = rnd2() < 0.5 ? 1 : -1;
              const lane = c + dir * 0.7;
              car.position.set(lane, 0, (rnd2() * 2 - 1) * 110);
              scene.add(car);
              this._cars.push({ car, axis: 'z', dir, coord: lane, speed: 9 + rnd2() * 10 });
            }
          }
        }
      }

      this._pt = performance.now();
      const loop = (t) => { this._raf = requestAnimationFrame(loop); this._frame(t); };
      this._raf = requestAnimationFrame(loop);
    }

    // Parse the OBJ text (v / o / f lines), weld duplicate verts, and place
    // the named buildings (Skyscreaper/Corporate/Office/Media/Building/Flats)
    // into the hi-tech core slots as white fills + ink edge lines.
    _placeModels(text, slots) {
      const THREE = this._T;
      // ---- parse ----
      const verts = [];
      const objects = [];
      let cur = null;
      const lines = text.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const L = lines[li];
        if (L.length < 3) continue;
        const c0 = L.charCodeAt(0), c1 = L.charCodeAt(1);
        if (c0 === 118 && c1 === 32) {            // 'v '
          const p = L.slice(2).trim().split(/\s+/);
          verts.push(+p[0], +p[1], +p[2]);
        } else if (c0 === 111 && c1 === 32) {     // 'o '
          cur = { name: L.slice(2).trim(), tris: [] };
          objects.push(cur);
        } else if (c0 === 102 && c1 === 32) {     // 'f '
          if (!cur) { cur = { name: 'bldg', tris: [] }; objects.push(cur); }
          const p = L.slice(2).trim().split(/\s+/);
          const idx = [];
          for (let i = 0; i < p.length; i++) {
            const s = p[i];
            const sl = s.indexOf('/');
            let vi = parseInt(sl === -1 ? s : s.slice(0, sl), 10);
            vi = vi < 0 ? verts.length / 3 + vi : vi - 1;
            idx.push(vi);
          }
          for (let i = 1; i + 1 < idx.length; i++) {
            const a = idx[0], b = idx[i], c = idx[i + 1];
            if (a === b || b === c || a === c) continue;
            cur.tris.push(a, b, c);
          }
        }
      }
      // ---- build prototypes per category ----
      const cats = {};
      const size = new THREE.Vector3();
      for (const o of objects) {
        if (!o.tris.length) continue;
        // weld duplicate coords (0.5-unit grid in raw model units)
        const weld = new Map(), remap = new Map();
        const pos = [], index = [];
        const canon = (gi) => {
          let li2 = remap.get(gi);
          if (li2 !== undefined) return li2;
          const x = verts[gi * 3], y = verts[gi * 3 + 1], z = verts[gi * 3 + 2];
          const key = Math.round(x * 2) + ',' + Math.round(y * 2) + ',' + Math.round(z * 2);
          let w = weld.get(key);
          if (w === undefined) { w = pos.length / 3; pos.push(x, y, z); weld.set(key, w); }
          remap.set(gi, w);
          return w;
        };
        for (let i = 0; i < o.tris.length; i += 3) {
          const a = canon(o.tris[i]), b = canon(o.tris[i + 1]), c = canon(o.tris[i + 2]);
          if (a === b || b === c || a === c) continue;
          index.push(a, b, c);
        }
        if (!index.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        g.setIndex(index);
        g.computeBoundingBox();
        const bb = g.boundingBox;
        bb.getSize(size);
        if (size.y < 1) continue;
        g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        g.scale(1 / size.y, 1 / size.y, 1 / size.y);
        const edges = new THREE.EdgesGeometry(g, 22);
        const fill = g.toNonIndexed();
        fill.computeVertexNormals();          // flat facet normals
        g.dispose();
        const nm = o.name.toLowerCase();
        const key = nm.indexOf('skys') === 0 ? 'sky' : nm.indexOf('corp') === 0 ? 'corp'
          : nm.indexOf('off') === 0 ? 'office' : nm.indexOf('media') === 0 ? 'media'
          : nm.indexOf('flat') === 0 ? 'flats' : 'bldg';
        if (!cats[key]) cats[key] = [];
        cats[key].push({ fill, edges, fx: size.x / size.y, fz: size.z / size.y });
      }
      const allKeys = Object.keys(cats);
      if (!allKeys.length) return false;
      const H = { sky: [28, 42], corp: [20, 30], office: [14, 20], media: [10, 16], bldg: [9, 14], flats: [7, 11] };
      const zones = {
        core: ['sky', 'corp', 'sky', 'office'],
        mid: ['office', 'media', 'corp', 'office'],
        outer: ['flats', 'bldg', 'office', 'flats'],
      };
      const fillGeos = [], lineGeos = [];
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(),
        up = new THREE.Vector3(0, 1, 0), sv = new THREE.Vector3(), pv = new THREE.Vector3();
      for (const s of slots) {
        const zone = (s.cz < -8 && s.dist < 64) ? 'core' : s.dist < 52 ? 'mid' : 'outer';
        let key = zones[zone][Math.floor(s.r1 * 4) % 4];
        // cells in front of the park: mostly low, with a few mid-rise accents
        const parkFront = s.cz >= 19 && s.cz <= 48 && Math.abs(s.cx) <= 24;
        const accent = parkFront && s.r2 > 0.8 && !(s.cx > 2 && s.cx < 28);  // no tall accents in the view corridor
        if (parkFront) key = accent ? (s.r1 < 0.5 ? 'office' : 'media') : s.r1 < 0.5 ? 'flats' : 'bldg';
        if (!cats[key] || !cats[key].length) key = allKeys[Math.floor(s.r1 * allKeys.length) % allKeys.length];
        const list = cats[key];
        const proto = list[Math.floor(s.r2 * list.length) % list.length];
        const range = H[key] || [7, 12];
        let sc = range[0] + s.r1 * (range[1] - range[0]);
        if (parkFront) sc = Math.min(sc, accent ? 17 : 8);
        const fp = Math.max(proto.fx, proto.fz) * sc;
        if (fp > 10) sc *= 10 / fp;
        q.setFromAxisAngle(up, s.rot);
        sv.set(sc, sc, sc);
        pv.set(s.cx, 0, s.cz);
        M.compose(pv, q, sv);
        const fg = proto.fill.clone(); fg.applyMatrix4(M); fillGeos.push(fg);
        const lg = proto.edges.clone(); lg.applyMatrix4(M); lineGeos.push(lg);
      }
      if (!fillGeos.length) return false;
      const mesh = new THREE.Mesh(this._mergeGeosFn(fillGeos), this._fillMat);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this._scene.add(mesh);
      const lines2 = new THREE.LineSegments(this._mergeLinesFn(lineGeos), this._lineMat);
      lines2.frustumCulled = false;
      this._scene.add(lines2);
      this.dispatchEvent(new CustomEvent('modelsready', { bubbles: true, composed: true }));
      return true;
    }

    _applyInk(hex) {
      if (!this._T) return;
      this.shadowRoot.host.style.setProperty('--ink', hex);
      const pinHost = this.shadowRoot.querySelector('.pins');
      if (pinHost) pinHost.style.setProperty('--ink', hex);
      this.shadowRoot.styleSheets; // no-op
      const c = new this._T.Color(hex);
      this._lineMat.color = c;
      if (this._grid) this._grid.material.color = c;
      // shadow style var lives on :host — set there too
      this.style.setProperty('--ink', hex);
    }
    _applyPaper(hex) {
      if (!this._T) return;
      const c = new this._T.Color(hex);
      this._scene.fog.color = c;
      this._groundMat.color = c;
    }

    _frame(t) {
      const dt = Math.min(0.05, (t - this._pt) / 1000 || 0.016);
      this._pt = t;
      // drive traffic along the avenues/streets, wrapping at the edges
      if (this._cars) {
        for (const c of this._cars) {
          if (c.axis === 'x') {
            let x = c.car.position.x + c.dir * c.speed * dt;
            if (x > 116) x = -116; else if (x < -116) x = 116;
            c.car.position.x = x;
            c.car.rotation.y = c.dir > 0 ? 0 : Math.PI;
          } else {
            let z = c.car.position.z + c.dir * c.speed * dt;
            if (z > 116) z = -116; else if (z < -116) z = 116;
            c.car.position.z = z;
            c.car.rotation.y = c.dir > 0 ? 0 : Math.PI;
          }
        }
      }
      const focus = this._focusId ? PINS.find(p => p.id === this._focusId) : null;
      if (focus) {
        this._tPos.set(focus.cam[0], focus.cam[1], focus.cam[2]);
        this._tLook.set(focus.look[0], focus.look[1], focus.look[2]);
      } else {
        const e = smooth(this._progress);
        const drift = Math.sin(t * 0.0002) * 2.5;
        this._tPos.set(drift + 17 * e, 58 - 36 * e, 122 - 66 * e);
        this._tLook.set(drift * 0.3 + e, 12 - 11 * e, -10 + 11 * e);
      }
      const mAmp = focus ? 0.3 : 1;
      this._tPos.x += this._mx * 3 * mAmp;
      this._tPos.y += -this._my * 1.2 * mAmp;
      this._tLook.x += this._mx * 6 * mAmp;
      this._tLook.y += -this._my * 3.5 * mAmp;
      const k = 1 - Math.pow(0.002, dt);
      this._cam.position.lerp(this._tPos, k);
      this._lookCur.lerp(this._tLook, k);
      this._cam.lookAt(this._lookCur);

      const showPins = this._progress > 0.75;
      const openId = this._focusId;   // panels open on click only
      for (let i = 0; i < PINS.length; i++) {
        const p = PINS[i], el = this._pinEls[i];
        const v = this._v3.set(p.pos[0], p.pos[1], p.pos[2]).project(this._cam);
        const behind = v.z > 1;
        el.style.transform = `translate(${(v.x * 0.5 + 0.5) * this._W}px, ${(-v.y * 0.5 + 0.5) * this._H}px)`;
        const vis = !behind && (this._focusId ? this._focusId === p.id : showPins);
        el.classList.toggle('show', vis);
        const open = openId === p.id;
        el.classList.toggle('open', open);
        // animate the 3D highlight on the focused subject
        const hl = this._hls && this._hls[i];
        if (hl) {
          hl.g.visible = open;
          if (open) {
            const ph = (t * 0.0006) % 1;
            hl.scan.position.y = 0.3 + ph * (hl.hh - 0.6);          // scan plane sweeps up
            hl.scan.material.opacity = 0.32 * (1 - ph);
            const rp = (t * 0.0009) % 1;
            const rs = hl.hw * (0.7 + rp * 1.6);
            hl.ring.scale.set(rs, rs, 1);                            // ground pulse ring
            hl.ring.material.opacity = 0.85 * (1 - rp);
            hl.box.material.opacity = 0.08 + 0.05 * Math.sin(t * 0.004);
          }
        }
        if (open) {
          // clamp the convo panel inside the viewport
          const convo = el.querySelector('.convo');
          if (convo) {
            const py = (-v.y * 0.5 + 0.5) * this._H;
            const ch = convo.offsetHeight || 300;
            let top = -150;
            if (py + top < 16) top = 16 - py;
            if (py + top + ch > this._H - 16) top = this._H - 16 - ch - py;
            convo.style.top = `${top}px`;
            convo.style.setProperty('--anchor', `${-top}px`);  // bracket meets the pin
          }
        }
        el.classList.toggle('quiet', false);
      }
      this._renderer.render(this._scene, this._cam);
    }
  }
  customElements.define('exmap-sketch', ExmapSketch);
})();
