// fftPanel.js — FFT 频谱（麦克风）+ 自动压缩 + 可上移基线 + 线性频率刻度
// 用法：
// fftHUD = FFTPanel.init({
//   mic,
//   rectProvider: () => RECT.fft,
//   bins: 1024,          // 高分辨率
//   smoothing: 0.85,
//   vscale: 1.12,        // 垂直放大
//   lift: 14             // ↑ 整体上移像素，确保整根柱子可见
// });

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Panel = {
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _fft: null,
        _bins: 256,
        _smooth: 0.85,
        _bg: '#111319',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,
        _vscale: 2.5,
        _liftPx: 0,      // 整体上移（底部留白）
        _axisMode: 'hybrid',     // 'linear' | 'hybrid'
        _focusBelowHz: 5000,     // 低频优先：该频率以下“展开”
        _compressFrac: 0.20,     // 高频压缩占比（后 20% 宽度显示 > focusBelowHz）
        _logBase: 10,            // 对数轴底
        _showPeak: true,
        _showPower50Hz: true,

        setAxis(opts = {}) {
            if (opts.mode) this._axisMode = opts.mode;
            if (Number.isFinite(opts.focusBelowHz)) this._focusBelowHz = Math.max(100, opts.focusBelowHz);
            if (Number.isFinite(opts.compressFraction)) this._compressFrac = Math.min(0.6, Math.max(0.05, opts.compressFraction));
            if (Number.isFinite(opts.logBase)) this._logBase = Math.max(2, opts.logBase);
            return this;
        },
        enablePeakMarkers(v = true) { this._showPeak = !!v; return this; },
        showPowerLine50Hz(v = true) { this._showPower50Hz = !!v; return this; },

        init({ mic, rectProvider, bins = 256, smoothing = 0.85, vscale = 1.12, lift = 12 } = {}) {
            this._rect = rectProvider || this._rect;
            this._bins = Math.max(16, bins | 0);
            this._smooth = clamp(smoothing, 0, 0.99);
            this._vscale = vscale;
            this._liftPx = lift;
            this._fft = new p5.FFT(this._smooth, this._bins);
            if (mic) this._fft.setInput(mic);
            return this;
        },

        _roundRect(ctx, x, y, w, h, r, fill, stroke) {
            const rr = clamp(r, 0, Math.min(w, h) / 2);
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

        // 在 fftPanel.js 中，替换 _drawXAxis 方法
        _drawXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB) {
            const baseY = y + h - padB + 0.5;

            // —— 频率→像素映射（linear / hybrid）——
            const mapFreqX = (fHz) => {
                if (this._axisMode === 'linear') {
                    return (fHz / nyquist) * innerW;
                }
                const F = this._focusBelowHz;            // 低频展开阈值
                const rightFrac = this._compressFrac;    // 高频压缩占比
                const leftW = innerW * (1 - rightFrac);
                if (fHz <= F) {
                    const b = this._logBase;
                    const t = Math.log(1 + (b - 1) * (fHz / F)) / Math.log(b);
                    return leftW * t;
                } else {
                    const hiSpan = nyquist - F;
                    const hiX = ((fHz - F) / hiSpan) * (innerW * rightFrac);
                    return leftW + hiX;
                }
            };

            ctx.save();
            // 底线
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + padL, baseY);
            ctx.lineTo(x + w - padR, baseY);
            ctx.stroke();

            // 刻度：根据模式动态调整
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = 'bold 11px ui-sans-serif, system-ui, -apple-system';

            let majorTicks, minorTicks;

            if (this._axisMode === 'linear') {
                // 线性模式：更稀疏的刻度
                majorTicks = [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000];
                minorTicks = [1000, 3000, 5000, 7000, 9000, 11000, 13000, 15000, 17000, 19000, 21000];
            } else {
                // Hybrid模式：重点突出低频区域
                majorTicks = [0, 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 20000, 22000];
                minorTicks = [50, 150, 300, 750, 1500, 3000, 7500, 12500, 17500];
            }

            // 次刻度（细线）
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            for (const f of minorTicks) {
                if (f <= nyquist) {
                    const px = x + padL + mapFreqX(f);
                    if (px >= x + padL && px <= x + w - padR) {
                        ctx.beginPath();
                        ctx.moveTo(px + 0.5, y + padT + 8);
                        ctx.lineTo(px + 0.5, baseY - 2);
                        ctx.stroke();
                    }
                }
            }

            // 主刻度（粗线 + 标签）
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1;
            for (const f of majorTicks) {
                if (f <= nyquist) {
                    const px = x + padL + mapFreqX(f);
                    if (px >= x + padL && px <= x + w - padR) {
                        // 刻度线
                        ctx.beginPath();
                        ctx.moveTo(px + 0.5, y + padT);
                        ctx.lineTo(px + 0.5, baseY);
                        ctx.stroke();

                        // 标签（跳过0Hz）
                        if (f > 0) {
                            let label;
                            if (f >= 1000) {
                                label = (f / 1000) + 'k';
                            } else {
                                label = '' + f;
                            }

                            // 检查标签是否会重叠
                            const labelWidth = ctx.measureText(label).width;
                            const hasSpace = (px - labelWidth / 2 > x + padL + 5) &&
                                (px + labelWidth / 2 < x + w - padR - 5);

                            if (hasSpace) {
                                ctx.fillStyle = 'rgba(255,255,255,0.75)';
                                ctx.fillText(label, px, baseY + 3);
                            }
                        }
                    }
                }
            }

            // 50Hz 参考线（可开关）- 只在hybrid模式显示
            if (this._showPower50Hz && this._axisMode === 'hybrid') {
                const p50 = x + padL + mapFreqX(50);
                if (p50 >= x + padL && p50 <= x + w - padR) {
                    ctx.strokeStyle = 'rgba(31, 234, 193, 0.55)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(p50 + 0.5, y + padT);
                    ctx.lineTo(p50 + 0.5, baseY);
                    ctx.stroke();

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    ctx.font = 'bold 12px ui-sans-serif';
                    ctx.fillText('50Hz', p50, y + padT + 80);
                }
            }
            ctx.restore();
        },

        render(ctx, x, y, w, h) {
            const r = this._rect();
            if (r && r.w && r.h) { x = r.x; y = r.y; w = r.w; h = r.h; }
            if (!w || !h || !this._fft) return;

            this._drawBG(ctx, x, y, w, h);

            const spec = this._fft.analyze(); // 0..255
            const N = spec.length;
            const nyquist = sampleRate() / 2;
            const binHz = nyquist / N;

            // 主峰（用于右上角读数）
            let peakIdx = 1, peakVal = spec[1] || 0;
            for (let i = 2; i < N; i++) {
                const v = spec[i] || 0;
                if (v > peakVal) {
                    peakVal = v;
                    peakIdx = i;
                }
            }
            const peakHz = Math.round(peakIdx * binHz);

            // 内边距
            const padL = 10, padR = 10, padT = 6, padB = 14 + this._liftPx;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;

            // 频率映射函数
            const mapFreqX = (fHz) => {
                if (this._axisMode === 'linear') return (fHz / nyquist) * innerW;
                const F = this._focusBelowHz, rightFrac = this._compressFrac, leftW = innerW * (1 - rightFrac);
                if (fHz <= F) {
                    const b = this._logBase;
                    const t = Math.log(1 + (b - 1) * (fHz / F)) / Math.log(b);
                    return leftW * t;
                } else {
                    const hiSpan = nyquist - F;
                    const hiX = ((fHz - F) / hiSpan) * (innerW * rightFrac);
                    return leftW + hiX;
                }
            };

            // 绘制频谱柱状图
            push();
            translate(x + padL, y + padT);
            colorMode(HSB, 255);
            noStroke();

            const numCols = Math.max(1, Math.floor(innerW));
            for (let col = 0; col < numCols; col++) {
                const xL = col, xR = col + 1;

                // 逆映射找频率区间
                const invMap = (targetX) => {
                    let lo = 0, hi = nyquist;
                    for (let it = 0; it < 18; it++) {
                        const mid = (lo + hi) * 0.5;
                        (mapFreqX(mid) < targetX) ? (lo = mid) : (hi = mid);
                    }
                    return (lo + hi) * 0.5;
                };

                const fL = invMap(xL);
                const fR = invMap(xR);

                const i0 = Math.max(0, Math.floor((fL / nyquist) * N));
                const i1 = Math.min(N - 1, Math.ceil((fR / nyquist) * N));
                let maxV = 0;
                for (let k = i0; k <= i1; k++) if (spec[k] > maxV) maxV = spec[k];

                const barH = Math.min(innerH - 1, (maxV / 255) * innerH * this._vscale);
                const midHz = (fL + fR) * 0.5;
                const hue = Math.floor(((midHz / nyquist)) * 255);

                fill(hue, 255, 255);
                rect(col, innerH - barH, 1, barH);
            }
            pop();

            // 绘制坐标轴
            this._drawXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB);

            // 主峰小圆点
            if (this._showPeak && peakIdx > 0) {
                const px = (x + padL) + mapFreqX(peakHz);
                const py = (y + padT) + 10;
                ctx.save();
                ctx.fillStyle = 'rgba(255,240,160,0.95)';
                ctx.beginPath();
                ctx.arc(px, py, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // 标题行：FFT(Mic) + 模式 + 峰值频率
            ctx.save();
            ctx.textBaseline = 'top';

            // 左侧：FFT(Mic)
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left';
            ctx.fillText('FFT(Mic)', x + 12, y + 10);

            // 紧邻右侧：模式指示
            const titleWidth = ctx.measureText('FFT(Mic)').width;
            ctx.fillStyle = 'rgba(22, 252, 83, 0.7)';
            ctx.font = 'bold 13px ui-sans-serif, system-ui, -apple-system';
            ctx.fillText(`[${this._axisMode.toUpperCase()}]`, x + 12 + titleWidth + 8, y + 12);

            // 右侧：峰值频率
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'right';
            ctx.fillText(`${peakHz} Hz`, x + w - 12, y + 8);

            ctx.restore();
        }
    };

    root.FFTPanel = Panel;
})(window);
