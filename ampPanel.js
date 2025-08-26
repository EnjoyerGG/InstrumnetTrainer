// ampPanel.js — Amplitude(音量包络) 面板（麦克风输入）
// 灵感来源：Coding Train Graphing Amplitude 示例（改为麦克风 + 面板化 + HUD 皮肤）
// 用法：
//   ampHUD = AmpPanel.init({
//     mic,
//     rectProvider: () => RECT.rightL, // 你要渲染的矩形
//     smoothing: 0.9,                  // 振幅平滑
//     vscale: 3.0,                     // 垂直放大(默认 3 倍，便于看得见)
//     historySec: 2.5                  // 横向时间窗(秒)，会根据面板宽度自适应采样步长
//   });

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Panel = {
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _amp: null,
        _mic: null,
        _fft: null,
        _smooth: 0.1,
        _vscale: 3.0,
        _hist: [],
        _histMax: 0,          // 由面板宽度决定：1 像素一个样点
        _historySec: 2.5,     // 目标时间窗（秒）
        _ema: 0,
        _bg: '#111319',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,
        _preferAmp: false,
        _modeLabel: 'RMS', //面板右上角小徽标
        _fastResponse: true,

        _maxLevel: 0,         // 历史最大电平
        _maxLevelDecay: 0.99,  // 更快的最大值衰减系数
        _instantAdapt: false,  // 是否瞬间适应（避免动画效果）
        _dynamicScale: true,  // 是否启用动态缩放
        _overload: false,     // 过载指示
        _overloadThreshold: 0.8, // 降低过载阈值
        _targetFillRatio: 0.8, // 目标填充比例（波形最高点占面板高度的80%）

        init({ mic, rectProvider, smoothing = 0.9, vscale = 3.0, historySec = 2.5, fastResponse = true } = {}) {
            this._rect = rectProvider || this._rect;
            this._smooth = clamp(smoothing, 0, 0.99);
            this._vscale = Math.max(1, vscale);
            this._historySec = Math.max(0.5, historySec);
            this._fastResponse = fastResponse;

            this._mic = mic;
            this._amp = null;
            this._fft = new p5.FFT(0.85, 512);
            if (mic) this._fft.setInput(mic);

            return this;
        },

        tryEnableAmplitude() {
            try {
                if (!this._amp) {
                    this._amp = new p5.Amplitude();
                    const smoothValue = this._fastResponse ? 0.0 : this._smooth;
                    this._amp.smooth(smoothValue);
                    if (this._mic) this._amp.setInput(this._mic);
                }
            } catch (e) { /* 安静失败，保留 FFT-RMS 路径 */ }
        },

        preferAmplitude(on = true) {
            this._preferAmp = !!on;
            if (this._preferAmp) this.tryEnableAmplitude(); // 仅在需要时创建 worklet
        },

        setFastResponse(enabled = true) {
            this._fastResponse = enabled;
            if (this._amp) {
                const smoothValue = this._fastResponse ? 0.0 : this._smooth;
                this._amp.smooth(smoothValue);
            }
        },

        setDynamicScale(enabled = true) {
            this._dynamicScale = enabled;
            if (!enabled) {
                this._maxLevel = 0; // 重置最大值
            }
        },

        // 获取当前状态信息
        getStatus() {
            return {
                dynamicScale: this._dynamicScale,
                instantAdapt: this._instantAdapt,
                currentMode: this._dynamicScale ?
                    (this._instantAdapt ? 'INSTANT' : 'SMOOTH') : 'FIXED'
            };
        },

        setInstantAdapt(enabled = true) {
            this._instantAdapt = enabled;
        },

        _roundRect(ctx, x, y, w, h, r, fill, stroke) {
            const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
            ctx.restore();
        },

        _drawBG(ctx, x, y, w, h) {
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);
            ctx.save();
            ctx.strokeStyle = this._grid;
            ctx.lineWidth = 1;
            for (let i = 1; i < 5; i++) {
                const yy = Math.round(y + (h * i) / 5) + 0.5;
                ctx.beginPath(); ctx.moveTo(x + 8, yy); ctx.lineTo(x + w - 8, yy); ctx.stroke();
            }
            ctx.restore();
        },

        _ensureHistCapacity(innerW) {
            const max = Math.max(10, Math.floor(innerW)); // 每像素 1 点
            if (max !== this._histMax) {
                this._histMax = max;
                if (this._hist.length > max) this._hist.splice(0, this._hist.length - max);
            }
        },

        // 计算有效的缩放系数
        _getEffectiveScale() {
            if (!this._dynamicScale || this._maxLevel <= 0) {
                return this._vscale;
            }
            // 动态调整缩放，确保最大值不会超过面板高度的80%
            const maxAllowedScale = this._targetFillRatio / this._maxLevel;
            return Math.min(this._vscale, maxAllowedScale);
        },

        // 计算 0..1 电平：优先用 p5.Amplitude；否则用 FFT 波形 RMS，并做平滑
        _currentLevel() {
            let level = 0;

            if (this._preferAmp && this._amp && this._amp.getLevel) {
                level = this._amp.getLevel() || 0;
                this._modeLabel = this._fastResponse ? 'AMP*' : 'AMP';
            } else if (this._fft) {
                const wave = this._fft.waveform(512); // [-1,1]
                let rms = 0;
                for (let i = 0; i < wave.length; i++) rms += wave[i] * wave[i];
                rms = Math.sqrt(rms / wave.length);   // 0..1 近似

                // 指数平滑（与 p5.Amplitude.smooth 一致的效果）
                if (this._fastResponse) {
                    // 快速响应模式：使用轻微的平滑或不平滑
                    const alpha = 0.8;  // 快速响应，但避免过于抖动
                    this._ema = this._ema ? (this._ema * (1 - alpha) + rms * alpha) : rms;
                } else {
                    // 传统平滑模式
                    const alpha = 1 - this._smooth;
                    this._ema = this._ema ? (this._ema * (1 - alpha) + rms * alpha) : rms;
                }
                level = this._ema;
                this._modeLabel = this._fastResponse ? 'RMS*' : 'RMS';
            }

            level = Math.min(1, Math.max(0, level));
            // 更新最大电平跟踪
            if (level > this._maxLevel) {
                this._maxLevel = level;
            } else {
                // 根据设置决定衰减方式
                if (this._instantAdapt) {
                    // 瞬间适应模式：如果当前电平明显小于最大值，快速降低最大值
                    if (level < this._maxLevel * 0.5) {
                        this._maxLevel = Math.max(level, this._maxLevel * 0.8);
                    } else {
                        this._maxLevel *= this._maxLevelDecay;
                    }
                } else {
                    // 渐进模式：缓慢衰减
                    this._maxLevel *= this._maxLevelDecay;
                }
            }

            // 检测过载
            this._overload = level > this._overloadThreshold;

            return level;
        },

        render(ctx, x, y, w, h) {
            const r = this._rect();
            if (r && r.w && r.h) { x = r.x; y = r.y; w = r.w; h = r.h; }
            if (!w || !h) return;

            if (this._mic && this._fft) { try { this._fft.setInput(this._mic); } catch (e) { } }

            this._drawBG(ctx, x, y, w, h);

            const padL = 10, padR = 10, padT = 8, padB = 14;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;
            this._ensureHistCapacity(innerW);

            // 取当前音量（0..1），并转 dBFS（仅用于读数显示）
            const level = this._currentLevel();
            const db = -20 * Math.log10(Math.max(1e-6, level)); // 负值，越接近 0 越响

            // 维护历史：右进左出
            this._hist.push(level);
            if (this._hist.length > this._histMax) this._hist.shift();

            // 获取有效缩放系数
            const effectiveScale = this._getEffectiveScale();

            // 把历史画成折线
            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            // 底部“零线”
            const baseY = y + padT + innerH;
            // 第一段
            if (this._hist.length > 0) {
                const safeHeight = this._hist[0] * innerH * effectiveScale;
                const y0 = baseY - Math.min(innerH * 0.98, safeHeight);
                ctx.moveTo(x + padL, y0);
            }
            // 其余段
            for (let i = 1; i < this._hist.length; i++) {
                const px = x + padL + i;
                // 确保波形绝对不超出边界，留出安全边距
                const safeHeight = this._hist[i] * innerH * effectiveScale;
                const py = baseY - Math.min(innerH * 0.98, safeHeight);
                ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.restore();

            // 红色扫描线（当前点）
            ctx.save();
            ctx.strokeStyle = 'rgba(255,64,64,0.9)';
            ctx.lineWidth = 2;
            const cursorX = x + padL + this._hist.length;
            ctx.beginPath(); ctx.moveTo(cursorX + 0.5, y + padT); ctx.lineTo(cursorX + 0.5, y + padT + innerH); ctx.stroke();
            ctx.restore();

            // 过载指示器
            if (this._overload) {
                ctx.save();
                ctx.fillStyle = 'rgba(255,0,0,0.3)';
                ctx.fillRect(x + 2, y + 2, w - 4, 20);
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 12px ui-sans-serif, system-ui, -apple-system';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('OVERLOAD', x + w / 2, y + 12);
                ctx.restore();
            }

            // 标题 & dB 读数
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 14px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            const title = this._fastResponse ? 'Amplitude (Fast)' : 'Amplitude (Smooth)';
            ctx.fillText(title, x + 12, y + 10);

            //在右上角dB左边画模式徽标
            ctx.textAlign = 'right';
            ctx.font = '  bold 15px ui-sans-serif, system-ui, -apple-system';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(this._modeLabel, x + w - 180, y + 30);

            // 动态缩放指示
            if (this._dynamicScale && effectiveScale < this._vscale) {
                ctx.fillStyle = 'rgba(0,255,0,0.6)';
                ctx.font = '10px ui-sans-serif, system-ui, -apple-system';
                ctx.fillText('AUTO', x + w - 60, y + 45);
            }

            ctx.textAlign = 'right';
            ctx.font = 'bold 18px ui-sans-serif, system-ui, -apple-system';
            // 过载时用红色显示dB值
            ctx.fillStyle = this._overload ? 'rgba(255,100,100,0.9)' : 'rgba(255,255,255,0.85)';
            // 典型范围 -60 ~ -10 dBFS；很安静时显示 “-inf”
            const label = (level <= 1e-6) ? '−∞ dB' : `${db.toFixed(1)} dB`;
            ctx.fillText(label, x + w - 12, y + 8);
            ctx.restore();
        }
    };

    root.AmpPanel = Panel;
})(window);
