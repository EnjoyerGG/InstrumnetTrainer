// levelMeter.js — 1:1 声音有效值折线（65s）
// 依赖：meter-processor.js（AudioWorklet，已在你的项目里）
// API: LevelMeter.init({...}); LevelMeter.setupAudio({...}); LevelMeter.update(); LevelMeter.reset();

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
        _lastDb: null, _maxDb: -Infinity, _minDb: Infinity, _sumDb: 0, _nDb: 0,
        _spanSec: 65,            // 时间窗 65 s
        _dbMin: 0, _dbMax: 120,  // 纵轴范围（dBFS 或校准后的 dB）
        _colPeriodMs: 200,       // 每列时间间隔（自动算）
        _lastColTime: 0,         // 上次落新列的时间
        _rmsSmooth: 0.40,        // 折线轻微平滑，越小越“抖”
        _yNow: null,



        // 音频
        _usePeak: true,
        _meterNode: null,

        // --------------- 初始化 UI --------------- //
        init({
            mount,
            width = 360,
            height = 230,
            spanSec = 65,
            dbMin = 0,
            dbMax = 120,
            rmsSmoothing = 0.30
        } = {}) {
            this._spanSec = spanSec;
            this._dbMin = dbMin; this._dbMax = dbMax;
            this._rmsSmooth = rmsSmoothing;

            // 容器
            this._wrap = typeof mount === 'string' ? document.querySelector(mount) : mount;
            if (!this._wrap) { this._wrap = document.createElement('div'); this._wrap.id = 'level-wrap'; document.body.appendChild(this._wrap); }
            this._wrap.className = 'lm-panel';
            this._wrap.style.cssText = `
        position: fixed; right: 16px; bottom: 16px;
        background: rgba(30,30,35,.95); border-radius: 14px;
        box-shadow: 0 6px 24px rgba(0,0,0,.45); padding: 12px 12px 10px 12px;
        color:#e9eef5; font: 14px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial; z-index:1000;
      `;

            // 顶栏：清除 + 大数字 + 绿灯 + 统计
            this._top = document.createElement('div');
            this._top.className = 'lm-top';
            this._top.innerHTML = `
        <button id="lm-clear" style="background:#f2f2f2;color:#111;border:0;border-radius:10px;padding:8px 16px;font-weight:700;margin-right:8px">清除</button>
        <span id="lm-big" style="font-weight:800;font-size:42px;letter-spacing:1px;vertical-align:middle;">--.-</span>
        <span style="margin-left:4px;font-size:18px;opacity:.85">dB</span>
        <span id="lm-led" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-left:10px;background:#29d44d;box-shadow:0 0 6px #29d44d;"></span>
        <span id="lm-stats" style="float:right;opacity:.85;font-weight:600">最大: --.- dB | 平均: --.- dB | 最小: --.- dB</span>
      `;
            this._wrap.appendChild(this._top);
            this._big = this._top.querySelector('#lm-big');
            this._stats = this._top.querySelector('#lm-stats');
            this._top.querySelector('#lm-clear').addEventListener('click', () => this.reset());

            // 画布
            const d = dpr();
            this._canvas = document.createElement('canvas');
            this._canvas.width = Math.round(width * d);
            this._canvas.height = Math.round(height * d);
            this._canvas.style.width = width + 'px';
            this._canvas.style.height = height + 'px';
            this._canvas.style.borderRadius = '10px';
            this._wrap.appendChild(this._canvas);
            this._ctx = this._canvas.getContext('2d');
            this._ctx.setTransform(d, 0, 0, d, 0, 0);
            this._ctx.imageSmoothingEnabled = false;

            // 网格层
            this._grid = document.createElement('canvas');
            this._grid.width = this._canvas.width;
            this._grid.height = this._canvas.height;
            this._gctx = this._grid.getContext('2d');
            this._gctx.setTransform(d, 0, 0, d, 0, 0);
            this._gctx.imageSmoothingEnabled = false;

            // 折线层（左移 1px 滚动）
            this._trace = document.createElement('canvas');
            this._trace.width = this._canvas.width;
            this._trace.height = this._canvas.height;
            this._tctx = this._trace.getContext('2d');
            this._tctx.setTransform(d, 0, 0, d, 0, 0);
            this._tctx.imageSmoothingEnabled = false;

            // 计算列周期: 每列 = spanSec / width 秒
            this._colPeriodMs = (this._spanSec * 1000) / width;
            this._Wpx = width;                     // 以 CSS 像素计
            this._ys = new Float32Array(width);    // 存每列的 y 像素
            this._writeIdx = 0;                    // 写入指针（0..W-1）
            this._filled = false;                  // 是否已经写满一圈

            this._drawGrid();
            this.reset();
            return this;
        },

        // --------------- 音频链（AudioWorklet + 兜底） --------------- //
        async setupAudio({ levelMode = 'peak', offsetDb = 0, workletPath = 'meter-processor.js' } = {}) {
            this._offsetDb = offsetDb;

            const AC = window.AudioContext || window.webkitAudioContext;
            const ctx = (window.getAudioContext && window.getAudioContext()) || new AC();

            // 麦克风
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 }
            });
            const src = ctx.createMediaStreamSource(stream);

            // A-weight 近似
            const hp20 = ctx.createBiquadFilter();
            hp20.type = 'highpass';
            hp20.frequency.value = 20;
            hp20.Q.value = 0.5;
            const peq1k = ctx.createBiquadFilter();
            peq1k.type = 'peaking';
            peq1k.frequency.value = 1000;
            peq1k.Q.value = 1.0;
            peq1k.gain.value = -1.3;
            const hs4k = ctx.createBiquadFilter();
            hs4k.type = 'highshelf';
            hs4k.frequency.value = 3800;
            hs4k.gain.value = 0.0;   // 或 -1.5，保持总体接近 0 dB

            const sink = ctx.createGain();
            sink.gain.value = 0;
            this._usePeak = (levelMode === 'peak');

            let workletOk = false;
            if (ctx.audioWorklet && ctx.audioWorklet.addModule) {
                try {
                    const url = new URL(workletPath, window.location.href).href;
                    await ctx.audioWorklet.addModule(url);
                    const meter = new AudioWorkletNode(ctx, 'meter-processor', {
                        processorOptions: { timeConstantFast: 0.125, offsetDb }
                    });
                    src.connect(hp20); hp20.connect(peq1k); peq1k.connect(hs4k); hs4k.connect(meter); meter.connect(sink); sink.connect(ctx.destination);
                    meter.port.onmessage = (ev) => {
                        if (ev.data && ev.data.type === 'setOffset') return;
                        const { fastDb, peakDb } = ev.data;
                        let db = this._usePeak ? peakDb : fastDb;
                        db = Math.max(this._dbMin, Math.min(this._dbMax, db));   // ★ 夹紧
                        this._setDb(db);
                    };
                    this._meterNode = meter;
                    if (this._meterNode && this._meterNode.port) {
                        this._meterNode.port.postMessage({ type: 'setOffset', value: this._offsetDb });
                    }
                    try { if (root.userStartAudio) await root.userStartAudio(); else await ctx.resume(); } catch (e) { }
                    workletOk = true;
                } catch (e) { console.warn('[AudioWorklet] 加载失败，使用 ScriptProcessor 兜底', e); }
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
                    let fastDb = 20 * Math.log10(Math.sqrt(rms2Fast) + EPS) + this._offsetDb;
                    let peakDb = 20 * Math.log10(peakHold + EPS) + this._offsetDb;
                    fastDb = Math.max(this._dbMin, Math.min(this._dbMax, fastDb));
                    peakDb = Math.max(this._dbMin, Math.min(this._dbMax, peakDb));
                    this._setDb(this._usePeak ? peakDb : fastDb);
                };
                src.connect(hp20); hp20.connect(peq1k); peq1k.connect(hs4k); hs4k.connect(node); node.connect(sink); sink.connect(ctx.destination);
                try { if (root.userStartAudio) await root.userStartAudio(); else await ctx.resume(); } catch (e) { }
            }

            this._running = true;
        },

        _setDb(db) {
            // 大数字 & 统计
            this._lastDb = db;
            if (isFinite(db)) {
                this._big.textContent = db.toFixed(1);
                this._maxDb = Math.max(this._maxDb, db);
                this._minDb = Math.min(this._minDb, db);
                this._sumDb += db; this._nDb++;
                const avg = this._sumDb / this._nDb;
                this._stats.textContent = `最大: ${this._maxDb.toFixed(1)} dB | 平均: ${avg.toFixed(1)} dB | 最小: ${this._minDb.toFixed(1)} dB`;
            }
        },

        // --------------- 每帧更新（按列落点 + 左移 1px） --------------- //
        update() {
            if (!this._running) return;
            const now = performance.now();
            if (now - this._lastColTime < this._colPeriodMs) {
                // 仍然合成（把网格和已有折线画出去）
                this._composite();
                return;
            }
            this._lastColTime = now;

            const W = this._Wpx;
            const H = this._canvas.height / dpr();

            // 1) dB → y（略做平滑）
            if (this._lastDb != null) {
                const t = Math.max(0, Math.min(1, (this._lastDb - this._dbMin) / (this._dbMax - this._dbMin)));
                const yNow = (H - 1) * (1 - t);
                this._yNow = (this._yNow == null) ? yNow : this._yNow * this._rmsSmooth + yNow * (1 - this._rmsSmooth);

                // 2) 推入环形缓冲（最新点）
                this._ys[this._writeIdx] = this._yNow;
                this._writeIdx = (this._writeIdx + 1) % W;
                if (!this._filled && this._writeIdx === 0) this._filled = true;
            }

            // 3) 重画整条线（不再用位图平移）
            const ctx = this._tctx;
            ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, W, H);

            const n = this._filled ? W : this._writeIdx;
            if (n > 1) {
                const start = this._filled ? this._writeIdx : 0; // 最旧点在 start
                ctx.beginPath();
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#ff3b30';

                for (let i = 0; i < n; i++) {
                    const idx = (start + i) % W;   // 缓冲真实位置
                    const x = i;                   // 屏幕 x（从左到右）
                    const y = Math.round(this._ys[idx] || (H - 1));
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            // 4) 合成到最终画布
            this._composite();
        },

        _composite() {
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            this._ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            this._ctx.imageSmoothingEnabled = false;
            this._ctx.clearRect(0, 0, W, H);
            this._ctx.drawImage(this._grid, 0, 0, W, H);
            this._ctx.drawImage(this._trace, 0, 0, W, H);
        },

        // --------------- 网格（纵轴 dB，横轴时间 65s，1s/5s 栅格） --------------- //
        _drawGrid() {
            const g = this._gctx;
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            g.clearRect(0, 0, W, H);
            g.fillStyle = '#0f1114'; g.fillRect(0, 0, W, H);

            // 横向(dB) 每 10 dB 一根，20 dB 加粗并标注
            for (let dB = this._dbMin; dB <= this._dbMax; dB += 10) {
                const t = (dB - this._dbMin) / (this._dbMax - this._dbMin);
                const y = Math.round((H - 1) * (1 - t)) + .5;
                g.beginPath();
                g.strokeStyle = (dB % 20 === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
                g.lineWidth = 1; g.moveTo(0, y); g.lineTo(W, y); g.stroke();
                if (dB % 20 === 0) {
                    g.fillStyle = 'rgba(220,230,240,.85)';
                    g.font = '12px -apple-system,Segoe UI,Roboto,Helvetica,Arial';
                    g.fillText(String(dB), 4, y - 4);
                }
            }

            // 纵向(时间) 每 1s 一根，5s 加粗并标注
            const pxPerSec = W / this._spanSec;
            for (let s = 0; s <= this._spanSec; s++) {
                const x = Math.round(W - s * pxPerSec) + .5; // 右 → 左，0 在最右侧
                const major = (s % 5 === 0);
                g.beginPath();
                g.strokeStyle = major ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
                g.lineWidth = 1; g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
                if (major && s !== 0) {
                    g.fillStyle = 'rgba(220,230,240,.85)';
                    g.font = '12px -apple-system,Segoe UI,Roboto,Helvetica,Arial';
                    g.fillText(`${s}s`, Math.max(0, x - 12), H - 6);
                }
            }

            // 左上角刻度名
            g.fillStyle = 'rgba(220,230,240,.85)';
            g.font = 'bold 13px -apple-system,Segoe UI,Roboto,Helvetica,Arial';
            g.fillText('dB', 6, 16);
        },

        // --------------- 控制 --------------- //
        pause() { this._running = false; },
        resume() { this._running = true; },
        reset() {
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            this._tctx.clearRect(0, 0, W, H);
            this._lastDb = null;
            this._yNow = null;
            this._maxDb = -Infinity;
            this._minDb = Infinity;
            this._sumDb = 0;
            this._nDb = 0;
            this._big.textContent = '--.-';
            this._stats.textContent = `最大: --.- dB | 平均: --.- dB | 最小: --.- dB`;
            this._lastColTime = 0;

            if (this._ys) this._ys.fill(0);
            this._writeIdx = 0; this._filled = false;

            this._composite();
        },

        setScale(dbMin, dbMax) {
            this._dbMin = dbMin; this._dbMax = dbMax;
            this._drawGrid();    // 重画网格文字与线
            this._composite();   // 叠到前台
        },

        calibrateSPL: async function (targetDb = 94, seconds = 2) {
            const t0 = performance.now();
            let sum = 0, n = 0;
            while (performance.now() - t0 < seconds * 1000) {
                if (this._lastDb != null) { sum += this._lastDb; n++; }
                await new Promise(r => setTimeout(r, 16)); // 约 60 FPS 取样
            }
            if (!n) return;
            const measured = sum / n;
            this._offsetDb = targetDb - measured;                // 计算平移量
            try { localStorage.setItem('splOffset', String(this._offsetDb)); } catch (e) { }

            // 通知 worklet 即时生效；兜底分支会在下一块音频里使用 this._offsetDb
            if (this._meterNode && this._meterNode.port) {
                this._meterNode.port.postMessage({ type: 'setOffset', value: this._offsetDb });
            }
        }
    };



    if (root.SampleUI) return; // 已有的话就别重复挂
    root.SampleUI = {
        // 旧代码会传 { mount:'#sampler-wrap', width, height, mic, overlap }
        init(opts = {}) {
            const {
                mount,
                width = 380,
                height = 230,
                spanSec = 65,
                dbMin = -80,             // ★ 默认改为 dBFS 常用区间
                dbMax = 0,
                rmsSmoothing = 0.30 } = opts;
            LevelMeter.init({
                // 不传 mount 就会自动固定在右下角；如果你想继续放在 #sampler-wrap，就传 mount
                mount: mount || undefined,
                width, height,
                spanSec, dbMin, dbMax, rmsSmoothing
            });
            return this;
        },
        setupAudio(opts) { return LevelMeter.setupAudio(opts); },
        resume() { LevelMeter.resume(); },
        pause() { LevelMeter.pause(); },
        reset() { LevelMeter.reset(); },
        update() { LevelMeter.update(); },
        setBars() { }, setMic() { },

        calibrateSPL(targetDb, sec) { return LevelMeter.calibrateSPL(targetDb, sec); },
        setScale(min, max) { return LevelMeter.setScale(min, max); },

    };

    root.LevelMeter = LevelMeter;
})(window);
