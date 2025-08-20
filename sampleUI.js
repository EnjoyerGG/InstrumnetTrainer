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
        _renderRect: null,
        _clearRect: null,

        // 音频
        _usePeak: true,
        _meterNode: null,
        _offsetDb: 0,

        //用于调整速度倍率
        _speedMul: 1,
        _sampleMul: 1,

        _baseDb: null,          // 背景(基线)估计
        _baseAlpha: 0.97,      // 背景平滑 (越接近1越慢)
        _baseRiseCap: 0.8,     // 背景每帧最多上升(dB)，防止被峰值带着跑
        _gateDb: 5.5,           // 门限：低于“背景+门限”时按背景画（=平线）
        _sAtk: 0.50,            // 上冲(打击)时的系数（小=快）
        _sRel: 0.50,            // 回落时的系数（大=慢）
        _baseFallAlpha: 0.35,
        _snapPx: 0,
        _resumeGuardUntil: 0,   // 恢复后的“写列禁入”时间戳

        _eventActive: false,
        _gateDownK: 0.45,      // 迟滞：退出门限 = base + gate * 0.55（小于进入门限）
        _eventS: 0.35,         // 事件态跟随系数（越小越快）
        _baseQuant: 0.5,       // 基线量化步长（dB），让基线更“平”
        _sBase: 0.08,            // 基线态的平滑（越小越快，保留自然抖动）
        _sEvent: 0.22,

        _despikeDb: 2,       // 去刺阈值：单列最大允许向下跳幅（dB）
        _med3: [null, null, null],
        _med3Idx: 0,
        _prevDrawDb: null,

        // —— 外部击打门控（来自 TM） —— //
        _tmHoldUntil: 0,
        _tmLabel: 'BG',
        _tmConf: 0,
        _tmBoostDb: 4.0,   // 命中时轻微提升绘制值（让峰更像“命中”）

        _useBeatGrid: false,
        _beatBPM: 120,
        _beatsPerBar: 4,

        _markers: [],        // {x, life, color, _ts}
        _lastMarkT: 0,       // 上次更新标记的时间戳

        _penAtCenter: true,   // 笔是否在中线；false=在最右列

        _hardPeaks: [],        // 永久标记 {x,y,color}
        _peakTrack: null,      // 正在跟踪的峰 {minY, untilTs}
        _lastHardT: 0,
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
            hudCorner = 'tl',
            headless = true,
            clearInCanvas = false

        } = {}) {
            this._spanSec = spanSec;
            this._dbMin = dbMin; this._dbMax = dbMax;
            this._rmsSmooth = rmsSmoothing;
            this._hudInCanvas = !!hudInCanvas;
            this._hudCorner = hudCorner;   // 'br' | 'tr' | 'bl' | 'tl'
            this._clearInCanvas = !!clearInCanvas;
            this._headless = !!headless;
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
            if (this._headless) {        // ★ 整个自带面板隐藏，只作为离屏渲染
                this._wrap.style.display = 'none';
            }

            // 画布
            const d = dpr();
            this._canvas = document.createElement('canvas');
            this._canvas.width = Math.round(width * d);
            this._canvas.height = Math.round(height * d);
            Object.assign(this._canvas.style, { width: `${width}px`, height: `${height}px`, borderRadius: '10px' });
            this._wrap.appendChild(this._canvas);
            this._ctx = this._canvas.getContext('2d');
            this._ctx.setTransform(d, 0, 0, d, 0, 0); this._ctx.imageSmoothingEnabled = false;

            // 网格层
            this._grid = document.createElement('canvas');
            this._grid.width = this._canvas.width;
            this._grid.height = this._canvas.height;
            this._gctx = this._grid.getContext('2d'); this._gctx.setTransform(d, 0, 0, d, 0, 0); this._gctx.imageSmoothingEnabled = false;

            // 折线层
            this._trace = document.createElement('canvas');
            this._trace.width = this._canvas.width;
            this._trace.height = this._canvas.height;
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
            if (this._pendingSize) {
                const { w, h } = this._pendingSize; this._pendingSize = null;
                this.resize(w, h);
            }
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
                    src.connect(hp20);
                    hp20.connect(peq1k);
                    peq1k.connect(hs4k);
                    hs4k.connect(meter);
                    meter.connect(sink);
                    sink.connect(ctx.destination);
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

        setBPM(bpm, baseBpm = 120) {
            const b = (bpm || baseBpm);
            this._beatBPM = b;
            this._speedMul = Math.max(0.05, b / baseBpm);
            this._drawGrid();           // 速度变化时重画网格
        },


        // 打开/关闭按拍网格
        useBeatGrid(on = true, bpm = 120, beatsPerBar = 4) {
            this._useBeatGrid = !!on;
            this._beatBPM = bpm | 0;
            this._beatsPerBar = beatsPerBar | 0;
            this._drawGrid();
        },

        // 每秒推进多少列（折线速度，给网格/标记共用）
        _colsPerSec() {
            return (this._innerW / this._spanSec)
                * Math.max(0.05, this._speedMul)
                * Math.max(0.05, this._sampleMul);
        },

        setPenAtCenter(on = true) { this._penAtCenter = !!on; },
        getCursorX() {                    // 提供给 AmpGuides 作为“现在时刻的屏幕 x”
            return this._penAtCenter
                ? (this._innerX + Math.floor(this._innerW * 0.5))
                : (this._innerX + this._innerW - 1);
        },

        // 以后做“音符判定”时，往 HUD 打一条竖线（从最右侧入场）
        pushMarker(color = '#a64fd6', lifeMs = 380) {
            this._markers.push({
                x: this._innerX + this._innerW - 1,
                life: lifeMs,
                color,
                _ts: performance.now()
            });
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

        setExternalHit(label, conf, holdMs = 140) {
            this._tmLabel = label || 'BG';
            this._tmConf = conf || 0;
            const until = performance.now() + (holdMs | 0);
            this._tmHoldUntil = until;
            this._peakTrack = { minY: Infinity, until };
        },

        setSpeedFactor(sf = 1) {
            this._speedMul = Math.max(0.05, Number(sf) || 1);
        },

        /* -------------------- 每帧更新 -------------------- */
        update() {
            if (!this._running) return;
            const now = performance.now();
            const effPeriod = this._colPeriodMs / (Math.max(0.05, this._speedMul) * Math.max(0.05, this._sampleMul));
            if (now - this._lastColTime < effPeriod) { this._composite(); return; }
            this._lastColTime = now;

            // —— dB → y（事件态/基线分离 + 迟滞 + 硬跳）——
            if (this._lastDb != null) {
                // 恢复保护：倒计时恢复后的若干毫秒不推进列，避免竖针
                const nowT = performance.now();
                if (nowT < this._resumeGuardUntil) { this._composite(); return; }

                // 1) 背景估计：上升限速 + 下降快跟随
                if (this._baseDb == null) this._baseDb = this._lastDb;
                if (this._lastDb >= this._baseDb) {
                    const noPeak = Math.min(this._lastDb, this._baseDb + this._baseRiseCap);
                    this._baseDb = this._baseDb * this._baseAlpha + noPeak * (1 - this._baseAlpha);
                } else {
                    this._baseDb = this._baseDb * this._baseFallAlpha + this._lastDb * (1 - this._baseFallAlpha);
                }

                // 2) 带“迟滞”的门限：避免来回抖动
                const gateUp = this._baseDb + this._gateDb;
                const gateDown = this._baseDb + this._gateDb * this._gateDownK;

                // 来自 TM 的外部门控（在 hold 期内始终认为命中）
                const tmActive = (performance.now() < this._tmHoldUntil) && (this._tmLabel && this._tmLabel !== 'BG');

                const wasEvent = this._eventActive;
                if (!this._eventActive) {
                    if (tmActive || this._lastDb >= gateUp) this._eventActive = true;
                } else {
                    if (!tmActive && this._lastDb < gateDown) this._eventActive = false;
                }
                const edgeSnap = (wasEvent !== this._eventActive);

                // 3) 候选 dB：事件态=真值；基线态=轻平滑（保留自然抖动）
                let candDb = this._eventActive
                    ? this._lastDb
                    : (this._lastDb * (1 - this._sBase) + this._baseDb * this._sBase);

                // —— 去刺：只在“非事件态”做 —— //
                let drawDb;
                if (tmActive) drawDb += this._tmBoostDb;
                if (!this._eventActive) {
                    // (a) 3 点中值（median-of-3），消单列刺
                    if (this._med3[0] == null) this._med3 = [candDb, candDb, candDb];
                    this._med3Idx = (this._med3Idx + 1) % 3;
                    this._med3[this._med3Idx] = candDb;
                    const [a, b, c] = this._med3;
                    const med = (a > b) ? ((b > c) ? b : (a > c ? c : a))
                        : ((a > c) ? a : (b > c ? c : b));

                    // (b) 最大向下跳幅夹限（两列刺）
                    const prev = (this._prevDrawDb != null) ? this._prevDrawDb : med;
                    const maxDrop = this._despikeDb || 6.0;
                    drawDb = (prev - med > maxDrop) ? (prev - maxDrop) : med;
                } else {
                    drawDb = candDb; // 事件态保持锋利
                }
                this._prevDrawDb = drawDb;

                // 4) 映射到像素
                const t = Math.max(0, Math.min(1, (drawDb - this._dbMin) / (this._dbMax - this._dbMin)));
                const yTarget = (this._innerH - 1) * (1 - t);

                // 5) 平滑 / 硬贴
                if (this._yNow == null) this._yNow = yTarget;

                // 进入/退出事件边沿直接贴目标；事件态内也贴（刀口）；
                // 基线态按原来的轻平滑（已去刺，不会再直插）
                const dy = Math.abs(yTarget - this._yNow);
                if ((wasEvent !== this._eventActive) || this._eventActive || dy >= this._snapPx) {
                    this._yNow = yTarget;                     // 事件态/边沿：刀口
                } else {
                    if (this._yNow > yTarget) {
                        const r = 0.1;                         // ★ 快速回落（0.2~0.35 可调）
                        this._yNow = this._yNow * r + yTarget * (1 - r);
                    } else {
                        const s = this._sBase;                  // 上行仍然用轻平滑
                        this._yNow = this._yNow * s + yTarget * (1 - s);
                    }
                }

                // 6) 推入环形缓冲
                this._ys[this._writeIdx] = this._yNow;
                this._writeIdx = (this._writeIdx + 1) % this._Wpx;
                if (!this._filled && this._writeIdx === 0) this._filled = true;

                // —— 跟踪命中峰的最高点（y 越小越高） —— //
                if (this._peakTrack) {
                    const yTop = this._innerY + Math.round(this._yNow || 0);
                    if (yTop < this._peakTrack.minY) this._peakTrack.minY = yTop;

                    if (performance.now() >= this._peakTrack.until) {
                        const xPen = this.getCursorX ? this.getCursorX() : (this._innerX + this._innerW - 1);
                        this._hardPeaks.push({ x: xPen + 0.5, y: this._peakTrack.minY + 0.5, color: '#ffcc00' });
                        this._peakTrack = null;
                    }
                }
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
                ctx.beginPath();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ff3b30';
                for (let i = 0; i < n; i++) {
                    const idx = (start + i) % this._Wpx;
                    const x = x0 + i;
                    const y = y0 + Math.round(this._ys[idx] || (this._innerH - 1));
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
            this._composite();

            const dtHard = (now - (this._lastHardT || now)) / 1000;
            this._lastHardT = now;
            if (this._hardPeaks.length) {
                const v = this._colsPerSec();
                const ctx = this._tctx;
                for (const m of this._hardPeaks) {
                    m.x -= v * dtHard;
                    ctx.beginPath();
                    ctx.strokeStyle = m.color || '#ffcc00';
                    ctx.lineWidth = 2;
                    ctx.moveTo(m.x - 4, m.y); ctx.lineTo(m.x + 4, m.y);
                    ctx.moveTo(m.x, m.y - 4); ctx.lineTo(m.x, m.y + 4);
                    ctx.stroke();
                }
            }

            // === 判定标记（随折线速度向左移动） ===
            if (this._markers.length) {
                const now = performance.now();
                if (!this._lastMarkT) this._lastMarkT = now;
                const dt = (now - this._lastMarkT) / 1000;    // s
                this._lastMarkT = now;

                const v = this._colsPerSec(); // px/s
                const ctx = this._tctx;

                for (let i = this._markers.length - 1; i >= 0; i--) {
                    const m = this._markers[i];
                    // 位置 & 寿命
                    m.x -= v * dt;
                    m.life -= (now - (m._ts || now));
                    m._ts = now;

                    // 超界或过期移除
                    if (m.x < this._innerX || m.life <= 0) {
                        this._markers.splice(i, 1);
                        continue;
                    }
                    // 绘制竖线
                    ctx.beginPath();
                    ctx.strokeStyle = m.color;
                    ctx.lineWidth = 2;
                    ctx.moveTo(m.x + 0.5, this._innerY);
                    ctx.lineTo(m.x + 0.5, this._innerY + this._innerH);
                    ctx.stroke();
                }

            }
        },


        _composite() {
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            this._ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            this._ctx.clearRect(0, 0, W, H);
            this._ctx.drawImage(this._grid, 0, 0, W, H);
            //this._ctx.drawImage(this._trace, 0, 0, W, H);
            const n = this._filled ? this._Wpx : this._writeIdx;
            const penX = this.getCursorX ? this.getCursorX() : (this._innerX + this._innerW - 1);
            const rightOfData = this._innerX + Math.max(0, n - 1);   // 最新一列（旧逻辑：在最右）
            const dx = Math.round(penX - rightOfData);

            this._ctx.save();
            this._ctx.beginPath();                      // 只在内框里绘制
            this._ctx.rect(this._innerX, this._innerY, this._innerW, this._innerH);
            this._ctx.clip();
            this._ctx.drawImage(this._trace, dx, 0, W, H);
            this._ctx.restore();
            if (this._hudInCanvas && this._statsStr) this._drawHUD();
        },

        _drawHUD() {
            const ctx = this._ctx;
            const pad = 8;
            const xL = this._innerX + pad;
            const yT = this._innerY + pad;
            const xR = this._innerX + this._innerW - pad;         // 供统计用
            const yB = this._innerY + this._innerH - pad;

            // —— 左上：大号 dB + 单位 + 绿灯 —— //
            const big = (this._dispDb != null) ? this._dispDb.toFixed(1) : '--.-';

            ctx.save();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            // 小一号的数字
            ctx.font = '800 22px -apple-system,Segoe UI,Roboto';
            ctx.fillStyle = 'rgba(235,240,245,.98)';
            ctx.fillText(big, xL, yT);

            // dB 单位
            const wBig = ctx.measureText(big).width;
            ctx.font = '700 19px -apple-system,Segoe UI,Roboto';
            ctx.fillStyle = 'rgba(225,230,240,.92)';
            ctx.fillText('dB', xL + wBig + 6, yT + 2);

            // 绿点
            const wDB = ctx.measureText('dB').width;
            ctx.beginPath();
            ctx.fillStyle = '#29d44d';
            ctx.arc(xL + wBig + 6 + wDB + 10, yT + 10, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // —— 右下：统计行 —— //
            if (this._statsStr) {
                ctx.save();
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.font = '600 15px -apple-system,Segoe UI,Roboto';
                ctx.fillStyle = 'rgba(220,230,240,.88)';
                ctx.fillText(this._statsStr, xR, yB);
                ctx.restore();
            }

            // 画布清除按钮已取消：不再设置 this._clearRect
            this._clearRect = null;
        },

        /* -------------------- 网格 -------------------- */
        _drawGrid() {
            const g = this._gctx;
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            const x0 = this._innerX, y0 = this._innerY, w = this._innerW, h = this._innerH;

            g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            g.clearRect(0, 0, W, H);

            // 外框 + 背景
            g.strokeStyle = 'rgba(230,230,235,.28)';
            g.lineWidth = 6;
            g.beginPath();
            g.roundRect(x0 - 6, y0 - 6, w + 12, h + 12, 10);
            g.stroke();
            g.fillStyle = 'rgba(16,17,19,.85)';
            g.fillRect(x0, y0, w, h);

            // 横向 dB
            for (let dB = this._dbMin; dB <= this._dbMax; dB += 10) {
                const t = (dB - this._dbMin) / (this._dbMax - this._dbMin);
                const y = y0 + Math.round((h - 1) * (1 - t)) + .5;
                g.beginPath();
                g.strokeStyle = (dB % 20 === 0) ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.10)';
                g.lineWidth = 1;
                g.moveTo(x0, y);
                g.lineTo(x0 + w, y);
                g.stroke();
                if (dB % 20 === 0) {
                    g.fillStyle = 'rgba(220,230,240,.85)';
                    g.font = '700 12px -apple-system,Segoe UI,Roboto,Helvetica,Arial';
                    g.textAlign = 'right';
                    g.textBaseline = 'middle';
                    const LABEL_GAP = 12;
                    g.fillText(String(dB), x0 - LABEL_GAP, y);   // 画在外侧
                }
            }

            if (this._useBeatGrid && this._beatBPM > 0) {
                const g = this._gctx;
                const x0 = this._innerX, y0 = this._innerY, w = this._innerW, h = this._innerH;

                // 仍与“时间轴”绑定（不乘 _sampleMul）
                const pxPerSec = this._innerW / this._spanSec;
                const pxPerBeat = pxPerSec * (60 / this._beatBPM);

                const subdiv = 4;                        // 1 拍分成 4 份（可改 8）
                const pxPerSub = pxPerBeat / subdiv;
                const perBarSubs = this._beatsPerBar * subdiv;

                let x = x0 + w + 0.5;
                let sub = 0;
                while (x >= x0) {
                    const isBar = (sub % perBarSubs) === 0;       // 小节线
                    const isBeat = (sub % subdiv) === 0;           // 拍线

                    g.beginPath();
                    g.strokeStyle = isBar ? 'rgba(255,255,255,.18)'
                        : isBeat ? 'rgba(255,255,255,.12)'
                            : 'rgba(255,255,255,.06)';  // 子拍更淡
                    g.lineWidth = 1;
                    g.moveTo(x, y0);
                    g.lineTo(x, y0 + h);
                    g.stroke();

                    x -= pxPerSub;
                    sub++;
                }
            }
        },

        setSampleRateMul(m = 1) { this._sampleMul = Math.max(0.05, Number(m) || 1); },

        reset() {
            this._lastDb = this._dispDb = null;
            this._maxDb = -Infinity;
            this._minDb = Infinity;
            this._sumDb = 0;
            this._nDb = 0;
            if (this._big) this._big.textContent = '--.-';
            if (this._stats) this._stats.textContent = 'Max: --.- dB | Average: --.- dB | Min: --.- dB';
            if (this._ys) this._ys.fill(0);
            this._writeIdx = 0;
            this._filled = false;
            this._yNow = null;
            const W = this._canvas.width / dpr(), H = this._canvas.height / dpr();
            this._tctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            this._tctx.clearRect(0, 0, W, H);
            this._drawGrid();
            this._composite();
            this._lastColTime = performance.now();
        },

        pause() {
            this._running = false;
            const led = this._top?.querySelector('#lm-led');
            if (led) {
                led.style.background = '#e74c3c';
                led.style.boxShadow = '0 0 6px #e74c3c';
            }
        },
        resume() {
            this._running = true;
            this._lastColTime = performance.now();
            this._resumeGuardUntil = performance.now() + 400;
            const led = this._top?.querySelector('#lm-led');
            if (led) {
                led.style.background = '#29d44d';
                led.style.boxShadow = '0 0 6px #29d44d';
            }
        },

        renderTo(ctx, x, y, w, h) {
            this._composite(); // 先合成
            const W = this._canvas.width / (window.devicePixelRatio || 1);
            const H = this._canvas.height / (window.devicePixelRatio || 1);
            const dw = w ?? W, dh = h ?? H;
            ctx.drawImage(this._canvas, x, y, dw, dh);
            this._renderRect = { x, y, w: dw, h: dh };
        },
        pointerDown(px, py) {
            const rr = this._renderRect, cr = this._clearRect; if (!rr || !cr) return false;
            const sx = this._canvas.width / (window.devicePixelRatio || 1) / rr.w;
            const sy = this._canvas.height / (window.devicePixelRatio || 1) / rr.h;
            const ix = (px - rr.x) * sx, iy = (py - rr.y) * sy;
            if (ix >= cr.x && ix <= cr.x + cr.w && iy >= cr.y && iy <= cr.y + cr.h) {
                this.reset(); return true;
            }
            return false;
        },

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
        },

        resize(w, h) {
            if (!this._canvas) { this._pendingSize = { w, h }; return; }
            const d = (window.devicePixelRatio || 1);
            if (!w || !h) return;
            const W = Math.round(w * d), H = Math.round(h * d);
            if (this._canvas.width === W && this._canvas.height === H) return; // 尺寸未变

            // 重设三层画布尺寸
            this._canvas.width = W; this._canvas.height = H;
            this._grid.width = W; this._grid.height = H;
            this._trace.width = W; this._trace.height = H;

            // 重新计算内框 & 采样列数
            this._innerX = this._pad.left;
            this._innerY = this._pad.top;
            this._innerW = Math.max(10, w - this._pad.left - this._pad.right);
            this._innerH = Math.max(10, h - this._pad.top - this._pad.bottom);
            this._Wpx = Math.round(this._innerW);
            this._ys = new Float32Array(this._Wpx);
            this._writeIdx = 0; this._filled = false;
            this._colPeriodMs = (this._spanSec * 1000) / this._Wpx;

            this._drawGrid();
        }
    };

    if (root.SampleUI) return;
    root.SampleUI = {
        init(opts = {}) { LevelMeter.init(opts); return this; },
        setupAudio: (opts) => LevelMeter.setupAudio(opts),
        update: () => LevelMeter.update(),
        renderTo: (...a) => LevelMeter.renderTo(...a),
        pointerDown: (...a) => LevelMeter.pointerDown(...a),
        reset: () => LevelMeter.reset(),
        pause: () => LevelMeter.pause(),
        resume: () => LevelMeter.resume(),
        setScale: (a, b) => LevelMeter.setScale(a, b),
        calibrateSPL: (t, s) => LevelMeter.calibrateSPL(t, s),
        setOffsetDb: (db) => LevelMeter.setOffsetDb(db),
        nudgeOffset: (d) => LevelMeter.nudgeOffset(d),
        resize: (w, h) => LevelMeter.resize(w, h),
        setSpeedFactor: (sf) => LevelMeter.setSpeedFactor(sf),
        setSampleRateMul: (m) => LevelMeter.setSampleRateMul(m),
        setExternalHit: (label, conf, hold) => LevelMeter.setExternalHit(label, conf, hold),

        setBPM: (bpm, baseBpm) => LevelMeter.setBPM(bpm, baseBpm),
        useBeatGrid: (on, bpm, bpb) => LevelMeter.useBeatGrid(on, bpm, bpb),
        pushMarker: (color, lifeMs) => LevelMeter.pushMarker(color, lifeMs),

        getCursorX: () => LevelMeter.getCursorX(),
        setPenAtCenter: (on) => LevelMeter.setPenAtCenter(on),
        clearHardPeaks: () => { LevelMeter._hardPeaks.length = 0; LevelMeter._peakTrack = null; },


        // 没用到但在外部被调用到的接口，保留为 no-op 防止报错
        setBars: () => { },
        setMic: () => { }

    };

    root.LevelMeter = LevelMeter;
})(window);
