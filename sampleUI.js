// levelMeter.js — 65s 声音有效值折线
// 依赖：meter-processor.js（AudioWorklet）
// API: SampleUI.init({ mount, width, height, spanSec, dbMin, dbMax, rmsSmoothing })
//      SampleUI.setupAudio({ levelMode, offsetDb, workletPath })
//      SampleUI.update()/reset()/pause()/resume()/calibrateSPL()/setScale()

(function (root) {
    const dpr = () => (window.devicePixelRatio || 1);

    const LevelMeter = {
        // DOM
        _wrap: null, _top: null,
        _canvas: null, _ctx: null,
        _grid: null, _gctx: null,
        _trace: null, _tctx: null,

        // 状态
        _running: true,
        _lastDb: null, _dispDb: null, _lastDbRaw: null, _floorTicks: 0,
        _maxDb: -Infinity, _minDb: Infinity, _sumDb: 0, _nDb: 0,
        _spanSec: 65,
        _dbMin: 20, _dbMax: 100,
        _colPeriodMs: 200, _lastColTime: 0,
        _rmsSmooth: 0.40,
        _yNow: null,

        // 音频
        _usePeak: true,
        _meterNode: null,
        _offsetDb: 0,

        /* -------------------- 初始化 UI -------------------- */
        init({
            mount,
            width = 360,
            height = 230,
            spanSec = 65,
            dbMin = 20,
            dbMax = 100,
            rmsSmoothing = 0.30,
            hudInCanvas = false,
            hudCorner = 'br'
        } = {}) {
            this._spanSec = spanSec;
            this._dbMin = dbMin; this._dbMax = dbMax;
            this._rmsSmooth = rmsSmoothing;
            this._hudInCanvas = !!hudInCanvas;
            this._hudCorner = hudCorner;   // 'br' | 'tr' | 'bl' | 'tl'
            this._pad = { left: 36, right: 10, top: 8, bottom: 8 };

            // 容器：嵌入式（如果没传 mount，就直接加到 <body> 末尾）
            this._wrap = typeof mount === 'string' ? document.querySelector(mount) : mount;
            if (!this._wrap) { this._wrap = document.createElement('div'); document.body.appendChild(this._wrap); }
            this._wrap.className = 'lm-panel';
            this._wrap.style.cssText =
                `position:relative;width:${width + 24}px;margin:8px 0 0 0;
         background:rgba(30,30,35,.95);border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.45);
         padding:12px 12px 10px 12px;color:#e9eef5;
         font:14px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial`;

            // 顶栏：清除 + 大数字 + 绿灯 + 统计
            this._top = document.createElement('div');
            this._top.innerHTML = `
        <button id="lm-clear"
          style="background:#f2f2f2;color:#111;border:0;border-radius:10px;padding:8px 16px;font-weight:700;margin-right:8px">清除</button>
        <span id="lm-big"  style="font-weight:800;font-size:36px;min-width:110px;display:inline-block;letter-spacing:1px;vertical-align:middle;">--.-</span>
        <span style="margin-left:4px;font-size:18px;opacity:.85">dB</span>
        <span id="lm-led"  style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-left:10px;background:#29d44d;box-shadow:0 0 6px #29d44d;"></span>
        <span id="lm-stats" style="float:right;opacity:.85;font-weight:600">Max: --.- dB | Average: --.- dB | Min: --.- dB</span>
      `;
            this._wrap.appendChild(this._top);
            this._big = this._top.querySelector('#lm-big');
            this._stats = this._top.querySelector('#lm-stats');
            this._top.querySelector('#lm-clear').addEventListener('click', () => this.reset());
            if (this._hudInCanvas && this._stats) this._stats.style.display = 'none';

            // 画布
            const d = dpr();
            this._canvas = document.createElement('canvas');
            this._canvas.width = Math.round(width * d);
            this._canvas.height = Math.round(height * d);
            Object.assign(this._canvas.style, { width: `${width}px`, height: `${height}px`, borderRadius: '10px' });
            this._wrap.appendChild(this._canvas);
            this._ctx = this._canvas.getContext('2d'); this._ctx.setTransform(d, 0, 0, d, 0, 0); this._ctx.imageSmoothingEnabled = false;

            // 网格层
            this._grid = document.createElement('canvas');
            this._grid.width = this._canvas.width; this._grid.height = this._canvas.height;
            this._gctx = this._grid.getContext('2d'); this._gctx.setTransform(d, 0, 0, d, 0, 0); this._gctx.imageSmoothingEnabled = false;

            // 折线层
            this._trace = document.createElement('canvas');
            this._trace.width = this._canvas.width; this._trace.height = this._canvas.height;
            this._tctx = this._trace.getContext('2d'); this._tctx.setTransform(d, 0, 0, d, 0, 0); this._tctx.imageSmoothingEnabled = false;

            // 内框尺寸
            this._innerX = this._pad.left;
            this._innerY = this._pad.top;
            this._innerW = Math.max(10, width - this._pad.left - this._pad.right);
            this._innerH = Math.max(10, height - this._pad.top - this._pad.bottom);

            // 环形缓冲（按内框宽度一像素一列）
            this._Wpx = Math.round(this._innerW);
            this._ys = new Float32Array(this._Wpx);
            this._writeIdx = 0; this._filled = false;
            this._colPeriodMs = (this._spanSec * 1000) / this._Wpx;

            this._drawGrid();
            this.reset();
            return this;
        },

        /* -------------------- 音频链 -------------------- */
        async setupAudio({ levelMode = 'peak', offsetDb = 0, workletPath = 'meter-processor.js' } = {}) {
            this._offsetDb = offsetDb;
            const AC = window.AudioContext || window.webkitAudioContext;
            const ctx = (window.getAudioContext && window.getAudioContext()) || new AC();

            // 麦克风
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 }
            });
            const src = ctx.createMediaStreamSource(stream);

            // 简单 A-weight 近似（HP 20Hz + PEQ 1kHz -1.3dB + HS 3.8kHz）
            const hp20 = ctx.createBiquadFilter(); hp20.type = 'highpass'; hp20.frequency.value = 20; hp20.Q.value = 0.5;
            const peq1k = ctx.createBiquadFilter(); peq1k.type = 'peaking'; peq1k.frequency.value = 1000; peq1k.Q.value = 1.0; peq1k.gain.value = -1.3;
            const hs4k = ctx.createBiquadFilter(); hs4k.type = 'highshelf'; hs4k.frequency.value = 3800; hs4k.gain.value = 0.0;

            const sink = ctx.createGain(); sink.gain.value = 0;   // 静音
            this._usePeak = (levelMode === 'peak');

            let workletOk = false;
            if (ctx.audioWorklet && ctx.audioWorklet.addModule) {
                try {
                    const url = new URL(workletPath, window.location.href).href;
                    await ctx.audioWorklet.addModule(url);
                    const meter = new AudioWorkletNode(ctx, 'meter-processor', { processorOptions: { timeConstantFast: 0.125, offsetDb } });
                    src.connect(hp20); hp20.connect(peq1k); peq1k.connect(hs4k); hs4k.connect(meter); meter.connect(sink); sink.connect(ctx.destination);
                    meter.port.onmessage = (ev) => {
                        if (!ev.data) return;
                        const { fastDb, peakDb } = ev.data;
                        const dbRaw = this._usePeak ? peakDb : fastDb; // 未夹限
                        this._lastDbRaw = dbRaw;
                        const db = Math.max(this._dbMin, Math.min(this._dbMax, dbRaw));
                        this._setDb(db);
                    };
                    this._meterNode = meter;
                    if (this._meterNode?.port) this._meterNode.port.postMessage({ type: 'setOffset', value: this._offsetDb });
                    try { if (root.userStartAudio) await root.userStartAudio(); else await ctx.resume(); } catch { }
                    workletOk = true;
                } catch (e) { console.warn('[AudioWorklet] addModule 失败，降级 ScriptProcessor', e); }
            }

            if (!workletOk) {
                const node = ctx.createScriptProcessor(1024, 1, 1);
                const alphaFromDt = (dt, tau = 0.125) => Math.exp(-dt / tau);
                let rms2Fast = 0, peakHold = 0;
                node.onaudioprocess = (e) => {
                    const inBuf = e.inputBuffer.getChannelData(0);
                    let sum = 0, peak = 0;
                    for (let i = 0; i < inBuf.length; i++) { const x = inBuf[i], ax = Math.abs(x); sum += x * x; if (ax > peak) peak = ax; }
                    const rms2Block = sum / inBuf.length;
                    const dt = inBuf.length / ctx.sampleRate;
                    const alpha = alphaFromDt(dt, 0.125);
                    rms2Fast = rms2Fast * alpha + rms2Block * (1 - alpha);
                    peakHold = Math.max(peak, peakHold * 0.95);
                    const EPS = 1e-6;

                    const fastDbRaw = 20 * Math.log10(Math.sqrt(rms2Fast) + EPS) + this._offsetDb;
                    const peakDbRaw = 20 * Math.log10(peakHold + EPS) + this._offsetDb;
                    const fastDb = Math.max(this._dbMin, Math.min(this._dbMax, fastDbRaw));
                    const peakDb = Math.max(this._dbMin, Math.min(this._dbMax, peakDbRaw));
                    this._lastDbRaw = this._usePeak ? peakDbRaw : fastDbRaw;
                    this._setDb(this._usePeak ? peakDb : fastDb);
                };
                src.connect(hp20); hp20.connect(peq1k); peq1k.connect(hs4k); hs4k.connect(node); node.connect(sink); sink.connect(ctx.destination);
                try { if (root.userStartAudio) await root.userStartAudio(); else await ctx.resume(); } catch { }
            }

            this._running = true;
        },

        _setDb(db) {
            this._lastDb = db;
            if (!isFinite(db)) return;
            if (this._dispDb == null) this._dispDb = db;
            this._dispDb = this._dispDb * 0.88 + db * 0.12;
            this._big.textContent = this._dispDb.toFixed(1);

            this._maxDb = Math.max(this._maxDb, db);
            this._minDb = Math.min(this._minDb, db);
            this._sumDb += db; this._nDb++;
            const avg = this._sumDb / this._nDb;
            const s = `Max: ${this._maxDb.toFixed(1)} dB | Average: ${avg.toFixed(1)} dB | Min: ${this._minDb.toFixed(1)} dB`;
            this._statsStr = s;
            if (this._stats) this._stats.textContent = s;


            // —— 卡在量程下限时的“自救”：连着多帧都 <= dbMin ≈ 认为贴地 —— //
            if (db <= this._dbMin + 0.2) {
                this._floorTicks = (this._floorTicks || 0) + 1;
                if (this._floorTicks > 30) {                // ~半秒~1秒（取决于回调频率）
                    const raw = this._lastDbRaw;
                    if (Number.isFinite(raw)) {
                        const target = 45;                      // 先把背景抬到 ~45 dB
                        this.setOffsetDb((this._offsetDb || 0) + (target - raw));
                    }
                    this._floorTicks = 0;
                }
            } else {
                this._floorTicks = 0;
            }
        },

        /* -------------------- 每帧更新 -------------------- */
        update() {
            if (!this._running) return;
            const now = performance.now();
            if (now - this._lastColTime < this._colPeriodMs) { this._composite(); return; }
            this._lastColTime = now;

            // dB→y
            if (this._lastDb != null) {
                const t = Math.max(0, Math.min(1, (this._lastDb - this._dbMin) / (this._dbMax - this._dbMin)));
                const yNow = (this._innerH - 1) * (1 - t);
                this._yNow = (this._yNow == null) ? yNow : this._yNow * this._rmsSmooth + yNow * (1 - this._rmsSmooth);

                // 推入环形缓冲
                this._ys[this._writeIdx] = this._yNow;
                this._writeIdx = (this._writeIdx + 1) % this._Wpx;
                if (!this._filled && this._writeIdx === 0) this._filled = true;
            }

            // 重画完整折线
            const ctx = this._tctx;
            const Wc = this._canvas.width / dpr(), Hc = this._canvas.height / dpr();
            const x0 = this._innerX, y0 = this._innerY, w = this._innerW;

            ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, Wc, Hc);

            const n = this._filled ? this._Wpx : this._writeIdx;
            if (n > 1) {
                const start = this._filled ? this._writeIdx : 0;
                ctx.beginPath(); ctx.lineWidth = 1; ctx.strokeStyle = '#ff3b30';
                for (let i = 0; i < n; i++) {
                    const idx = (start + i) % this._Wpx;
                    const x = x0 + i;
                    const y = y0 + Math.round(this._ys[idx] || (this._innerH - 1));
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
            this._composite();
        },

        _composite() {
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            this._ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            this._ctx.clearRect(0, 0, W, H);
            this._ctx.drawImage(this._grid, 0, 0, W, H);
            this._ctx.drawImage(this._trace, 0, 0, W, H);
            if (this._hudInCanvas && this._statsStr) this._drawHUD();
        },

        _drawHUD() {
            const ctx = this._ctx;
            const pad = 8;
            let x = this._innerX + this._innerW - pad;
            let y = this._innerY + this._innerH - pad;
            if (this._hudCorner === 'tr') { x = this._innerX + this._innerW - pad; y = this._innerY + pad; }
            else if (this._hudCorner === 'tl') { x = this._innerX + pad; y = this._innerY + pad; }
            else if (this._hudCorner === 'bl') { x = this._innerX + pad; y = this._innerY + this._innerH - pad; }
            ctx.save();
            ctx.textAlign = (x > this._innerX + this._innerW / 2) ? 'right' : 'left';
            ctx.textBaseline = (y > this._innerY + this._innerH / 2) ? 'bottom' : 'top';
            ctx.font = '600 12px -apple-system,Segoe UI,Roboto,Helvetica,Arial';
            ctx.fillStyle = 'rgba(220,230,240,.88)';
            ctx.fillText(this._statsStr, x, y);
            ctx.restore();
        },
        /* -------------------- 网格 -------------------- */
        _drawGrid() {
            const g = this._gctx;
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            const x0 = this._innerX, y0 = this._innerY, w = this._innerW, h = this._innerH;

            g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            g.clearRect(0, 0, W, H);

            // 外框 + 背景
            g.strokeStyle = 'rgba(230,230,235,.28)'; g.lineWidth = 6;
            g.beginPath(); g.roundRect(x0 - 6, y0 - 6, w + 12, h + 12, 10); g.stroke();
            g.fillStyle = 'rgba(16,17,19,.85)'; g.fillRect(x0, y0, w, h);

            // 横向 dB
            for (let dB = this._dbMin; dB <= this._dbMax; dB += 10) {
                const t = (dB - this._dbMin) / (this._dbMax - this._dbMin);
                const y = y0 + Math.round((h - 1) * (1 - t)) + .5;
                g.beginPath();
                g.strokeStyle = (dB % 20 === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
                g.lineWidth = 1; g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke();
                if (dB % 20 === 0) {
                    g.fillStyle = 'rgba(220,230,240,.85)'; g.font = '12px -apple-system,Segoe UI,Roboto,Helvetica,Arial';
                    g.textAlign = 'right'; g.textBaseline = 'middle';
                    g.fillText(String(dB), x0 - 6, y);   // 画在外侧
                }
            }
        },

        reset() {
            this._lastDb = this._dispDb = null;
            this._maxDb = -Infinity; this._minDb = Infinity; this._sumDb = 0; this._nDb = 0;
            if (this._big) this._big.textContent = '--.-';
            if (this._stats) this._stats.textContent = 'Max: --.- dB | Average: --.- dB | Min: --.- dB';
            if (this._ys) this._ys.fill(0);
            this._writeIdx = 0; this._filled = false; this._yNow = null;
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            this._tctx.setTransform(dpr(), 0, 0, dpr(), 0, 0); this._tctx.clearRect(0, 0, W, H);
            this._drawGrid(); this._composite();
        },

        pause() { this._running = false; const led = this._top?.querySelector('#lm-led'); if (led) { led.style.background = '#e74c3c'; led.style.boxShadow = '0 0 6px #e74c3c'; } },
        resume() { this._running = true; const led = this._top?.querySelector('#lm-led'); if (led) { led.style.background = '#29d44d'; led.style.boxShadow = '0 0 6px #29d44d'; } },

        setScale(min, max) { this._dbMin = min; this._dbMax = max; this._drawGrid(); this._composite(); },

        async calibrateSPL(targetDb = 94, seconds = 2) {
            const t0 = performance.now(); let sum = 0, n = 0;
            while (performance.now() - t0 < seconds * 1000) {
                const v = (this._lastDbRaw ?? this._lastDb);
                if (Number.isFinite(v)) { sum += v; n++; }
                await new Promise(r => setTimeout(r, 16));
            }
            if (!n) return;
            const measured = sum / n;
            this._offsetDb = targetDb - measured;
            try { localStorage.setItem('splOffset', String(this._offsetDb)); } catch { }
            if (this._meterNode?.port) this._meterNode.port.postMessage({ type: 'setOffset', value: this._offsetDb });
        },

        setOffsetDb(db) {
            this._offsetDb = db;
            try { localStorage.setItem('splOffset', String(db)); } catch { }
            // Worklet 路径需要通知处理器；ScriptProcessor 路径会直接读取 this._offsetDb
            if (this._meterNode?.port) {
                this._meterNode.port.postMessage({ type: 'setOffset', value: db });
            }
        },
        nudgeOffset(deltaDb) {
            this.setOffsetDb((this._offsetDb || 0) + deltaDb);
        }
    };

    if (root.SampleUI) return;
    root.SampleUI = {
        init(opts = {}) { LevelMeter.init(opts); return this; },
        setupAudio: (opts) => LevelMeter.setupAudio(opts),
        update: () => LevelMeter.update(),
        reset: () => LevelMeter.reset(),
        pause: () => LevelMeter.pause(),
        resume: () => LevelMeter.resume(),
        setScale: (a, b) => LevelMeter.setScale(a, b),
        calibrateSPL: (t, s) => LevelMeter.calibrateSPL(t, s),
        setOffsetDb: (db) => LevelMeter.setOffsetDb(db),
        nudgeOffset: (d) => LevelMeter.nudgeOffset(d),

        // 没用到但在外部被调用到的接口，保留为 no-op 防止报错
        setBars: () => { }, setMic: () => { }

    };

    root.LevelMeter = LevelMeter;
})(window);
