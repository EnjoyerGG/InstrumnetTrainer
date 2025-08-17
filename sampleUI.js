(function (root) {
    const dpr = () => (window.devicePixelRatio || 1);

    function colorForDb(db) {
        const t = Math.max(0, Math.min(1, (db + 80) / 80));
        let r = 0;
        let g = 0;
        let b = 0;
        if (t < 0.25) {
            r = 0;
            g = 0;
            b = 80 + 700 * t;
        } else if (t < 0.5) {
            r = 0;
            g = 200 * (t - 0.25) / 0.25;
            b = 255;
        } else if (t < 0.75) {
            r = 180 * (t - 0.5) / 0.25;
            g = 200;
            b = 255 - 80 * (t - 0.75) / 0.25;
        } else {
            r = 180 + 60 * (t - 0.75) / 0.25;
            g = 200 + 55 * (t - 0.75) / 0.25;
            b = 175;
        }
        return `rgb(${r | 0},${g | 0},${b | 0})`;
    }

    const SampleUI = {
        _wrap: null,
        _specCanvas: null,
        _specCtx: null,
        _barsWrap: null,
        _fft: null,
        _mic: null,
        _running: false,
        _lastColAt: 0,
        _fftSize: 1024,
        _overlap: 0.5,     // 0~0.9
        _hopMs: 0,         // 根据 overlap 动态计算
        _colX: 0,          // 当前绘制列 x
        _bgDb: -90,        // 背景 dB（用于裁剪）
        _dbMax: -10,
        _bufCanvas: null,      // 离屏缓冲
        _bootFilled: false,    // 首帧是否已铺满

        init({ mount = '#sampler-wrap', width = 280, height = 84, mic = null, overlap = 0.5 } = {}) {
            this._wrap = typeof mount === 'string' ? document.querySelector(mount) : mount;
            if (!this._wrap) {
                this._wrap = document.createElement('div');
                this._wrap.id = 'sampler-wrap';
                document.body.appendChild(this._wrap);
            }
            this._wrap.classList.add('sampler');

            // 顶部行：开关 + overlap
            const top = document.createElement('div');
            top.className = 'sampler-top';
            top.innerHTML = `
        <label class="sampler-switch">
          <input type="checkbox" id="sampler-toggle">
          <span>Input</span><span class="onoff">OFF</span>
        </label>
        <div class="sampler-overlap">
          <span>Overlap:</span>
          <input type="range" id="overlap-slider" min="0" max="0.9" step="0.05" value="${overlap}">
          <input type="number" id="overlap-num" min="0" max="0.9" step="0.05" value="${overlap}">
        </div>
      `;
            this._wrap.appendChild(top);

            // 频谱图画布
            const spec = document.createElement('canvas');
            spec.width = Math.round(width * dpr());
            spec.height = Math.round(height * dpr());
            spec.style.width = width + 'px';
            spec.style.height = height + 'px';
            spec.className = 'sampler-spec';
            this._wrap.appendChild(spec);
            this._specCanvas = spec;
            this._specCtx = spec.getContext('2d');
            this._specCtx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            this._specCtx.fillStyle = '#111'; this._specCtx.fillRect(0, 0, width, height);

            // 输出条
            const bars = document.createElement('div');
            bars.className = 'sampler-bars';
            this._wrap.appendChild(bars);
            this._barsWrap = bars;

            // 事件
            const toggle = top.querySelector('#sampler-toggle');
            const onoff = top.querySelector('.onoff');
            toggle.addEventListener('change', async () => {
                onoff.textContent = toggle.checked ? 'ON' : 'OFF';
                this._running = toggle.checked;
                if (toggle.checked) {
                    // 唤醒 p5 声音引擎（有的浏览器必须在用户手势后 resume）
                    try {
                        if (root.userStartAudio) await root.userStartAudio();
                        else if (root.getAudioContext) await root.getAudioContext().resume();
                    } catch (e) { /* 忽略 */ }
                    // 确保 FFT 真正接上 mic
                    if (this._mic && this._mic.start) this._mic.start();
                    if (this._fft && this._mic) this._fft.setInput(this._mic);
                }
            });

            const slider = top.querySelector('#overlap-slider');
            const num = top.querySelector('#overlap-num');
            const setOverlap = (v) => {
                const val = Math.max(0, Math.min(0.9, parseFloat(v) || 0));
                this._overlap = val;
                slider.value = num.value = String(val);
                // hop = frame * (1 - overlap)
                const sr = (root.getAudioContext ? root.getAudioContext().sampleRate : 44100) || 44100;
                const frameMs = this._fftSize / sr * 1000;
                this._hopMs = Math.max(8, frameMs * (1 - this._overlap));
            };
            slider.addEventListener('input', () => setOverlap(slider.value));
            num.addEventListener('input', () => setOverlap(num.value));
            setOverlap(overlap);

            // 音频输入（复用 p5 mic，如果提供）
            this._mic = mic || (root.mic || null);
            this._fft = new p5.FFT(0.8, this._fftSize);
            if (this._mic) this._fft.setInput(this._mic);

            // 初始 bars（会被 setBars 覆盖）
            this.setBars([{ label: 'Background', value: 0.7, color: '#f39c12' }]);

            // 默认不开启，等外部把 running 传进来或手动点开关
            this._running = false;
            toggle.checked = false; onoff.textContent = 'OFF';

            const placeLeftOfHud = () => {
                const hud = document.getElementById('mic-hud');
                if (!hud || !this._wrap) return;
                const r = hud.getBoundingClientRect();
                const vw = window.innerWidth, vh = window.innerHeight;
                const gap = 14;
                // 面板右侧贴 HUD 左侧：right = (窗口宽 - HUD.left) + gap
                const right = Math.max(8, vw - r.left + gap);
                // 面板底部跟 HUD 同一条底边：bottom = (窗口高 - HUD.bottom) + gap
                const bottom = Math.max(8, vh - r.bottom + gap);
                Object.assign(this._wrap.style, { position: 'fixed', top: 'auto', right: right + 'px', bottom: bottom + 'px', left: 'auto' });
            };
            placeLeftOfHud();
            window.addEventListener('resize', placeLeftOfHud);
            return this;
        },

        // 每帧调用；仅当显式传入 running 时才覆盖内部状态
        update(opts) {
            if (opts && typeof opts.running === 'boolean') this._running = opts.running;
            if (!this._running || !this._fft) return;

            const now = performance.now();
            if (now - this._lastColAt < this._hopMs) return;
            this._lastColAt = now;

            const ctx = this._specCtx;
            const cvs = this._specCanvas;
            const _dpr = (window.devicePixelRatio || 1);

            const w = cvs.width / _dpr;      // CSS 像素宽
            const h = cvs.height / _dpr;     // CSS 像素高
            const wp = cvs.width;            // 设备像素宽
            const hp = cvs.height;           // 设备像素高

            // 1) 取一帧频谱并转 dB
            const spectrum = this._fft.analyze();               // 0..255
            const dbs = spectrum.map(v => 20 * Math.log10((v / 255) || 1e-4));
            const bins = dbs.length;

            // 2) 首帧：直接把同一列“铺满整幅”，避免左侧长期黑
            if (!this._bootFilled) {
                for (let x = 0; x < w; x++) {
                    for (let i = 0; i < bins; i++) {
                        const db = Math.max(this._bgDb, Math.min(this._dbMax, dbs[i]));
                        ctx.fillStyle = colorForDb(db);
                        const y = h - Math.round((i / bins) * h);
                        ctx.fillRect(x, y, 1, Math.ceil(h / bins) + 1);
                    }
                }
                this._bootFilled = true;
                return; // 下一帧再进入滚动
            }

            // 3) 用离屏缓冲把整张图向左平移 1px（HiDPI 安全）
            if (!this._bufCanvas || this._bufCanvas.width !== wp || this._bufCanvas.height !== hp) {
                this._bufCanvas = document.createElement('canvas');
                this._bufCanvas.width = wp;
                this._bufCanvas.height = hp;
            }
            const bctx = this._bufCanvas.getContext('2d');
            bctx.clearRect(0, 0, wp, hp);
            bctx.drawImage(cvs, 0, 0); // 先把当前画面拷到离屏

            // 源矩形用“设备像素”，目标用“CSS 像素”
            const sx = 1 * _dpr;            // 左移 1 个 CSS 像素
            const sw = wp - sx;
            ctx.drawImage(this._bufCanvas, sx, 0, sw, hp, 0, 0, w - 1, h);

            // 4) 在最右侧补上一列新数据
            for (let i = 0; i < bins; i++) {
                const db = Math.max(this._bgDb, Math.min(this._dbMax, dbs[i]));
                ctx.fillStyle = colorForDb(db);
                const y = h - Math.round((i / bins) * h);
                ctx.fillRect(w - 1, y, 1, Math.ceil(h / bins) + 1);
            }

            // 5) 可选：最右侧浅色竖网格
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(w - 1, 0, 1, h);
        },

        // 设置输出条（和你右下角百分比同步）
        // items: [{label:'Background', value:0.7, color:'#f39c12'}, ...]
        setBars(items = []) {
            if (!this._barsWrap) return;
            this._barsWrap.innerHTML = '';
            items.forEach(it => {
                const row = document.createElement('div');
                row.className = 'bar-row';
                row.innerHTML = `
          <span class="bar-label" title="${it.label}">${it.label}</span>
          <div class="bar-outer">
            <div class="bar-inner" style="width:${Math.round((it.value || 0) * 100)}%; background:${it.color || '#6ab8ff'}"></div>
          </div>
          <span class="bar-val">${Math.round((it.value || 0) * 100)}%</span>
        `;
                this._barsWrap.appendChild(row);
            });
        },

        pause() { this._running = false; const t = this._wrap.querySelector('#sampler-toggle'); if (t) t.checked = false; const o = this._wrap.querySelector('.onoff'); if (o) o.textContent = 'OFF'; },
        resume() {
            this._running = true;
            const t = this._wrap.querySelector('#sampler-toggle'); if (t) t.checked = true;
            const o = this._wrap.querySelector('.onoff'); if (o) o.textContent = 'ON';
            // —— 关键：即使是代码触发 resume，也要真正接上音频 —— //
            try {
                if (window.userStartAudio) userStartAudio();
                else if (window.getAudioContext) getAudioContext().resume();
            } catch (e) { }
            if (this._mic && this._mic.start) this._mic.start();
            if (this._fft && this._mic) this._fft.setInput(this._mic);
        },
        reset() {
            // 清空画布
            if (this._specCtx) {
                const w = this._specCanvas.width / dpr(), h = this._specCanvas.height / dpr();
                this._specCtx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
                this._specCtx.fillStyle = '#111'; this._specCtx.fillRect(0, 0, w, h);
            }
            this._bootFilled = false;
        },

        // 可选：换麦克风（如果需要）
        setMic(mic) { this._mic = mic; if (this._fft) this._fft.setInput(mic); }
    };
    root.SampleUI = SampleUI;
})(window);
