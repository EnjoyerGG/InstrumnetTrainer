// fftPanel.js
// 基于 Coding Train: Frequency analysis with FFT（改为麦克风输入 + 面板化）
// 用法：FFTPanel.init({ mic, rectProvider: () => ({x,y,w,h}), bins:64, smoothing:0.9 })

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Panel = {
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _fft: null,
        _bins: 256,
        _smooth: 0.85,
        _bg: '#010101ff',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,
        _vscale: 1.12,  //垂直放大系数
        _liftPx: 8, //整体上移像素

        init({ mic, rectProvider, bins = 256, smoothing = 0.85, vscale = 1.12, lift = 8 } = {}) {
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

        _drawGrid(ctx, x, y, w, h) {
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);
            ctx.save();
            ctx.strokeStyle = this._grid;
            ctx.lineWidth = 1;
            for (let i = 1; i < 5; i++) {
                const yy = Math.round(y + (h * i) / 5) + 0.5;
                ctx.beginPath(); ctx.moveTo(x + 8, yy);
                ctx.lineTo(x + w - 8, yy);
                ctx.stroke();
            }
            ctx.restore();
        },

        //画x轴刻度
        _drawXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB) {
            const baseY = y + h - padB + 0.5;

            // 底线
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + padL, baseY); ctx.lineTo(x + w - padR, baseY); ctx.stroke();

            // 主/次刻度
            const major = 2000;  // 2k 主刻度
            const minor = 1000;  // 1k 次刻度
            const labelPad = 14;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = '12px ui-sans-serif, system-ui, -apple-system';

            for (let f = 0; f <= nyquist + 1; f += minor) {
                const px = x + padL + (f / nyquist) * innerW;
                const isMajor = (f % major === 0);

                ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)';
                ctx.lineWidth = 1;

                // 竖向网格线（从内部顶部到底线）
                ctx.beginPath();
                ctx.moveTo(px + 0.5, y + padT);
                ctx.lineTo(px + 0.5, baseY);
                ctx.stroke();

                // 标签（主刻度）
                if (isMajor && f > 0) {
                    const label = (f >= 1000) ? (f / 1000) + 'k' : ('' + f);
                    ctx.fillStyle = 'rgba(255,255,255,0.70)';
                    ctx.fillText(label, px, baseY + 2);
                }
            }
            ctx.restore();
        },

        render(ctx, x, y, w, h) {
            const r = this._rect();
            if (r && r.w && r.h) { x = r.x; y = r.y; w = r.w; h = r.h; }
            if (!w || !h || !this._fft) return;

            // 外框与背景
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);
            this._drawGrid(ctx, x, y, w, h);

            // 频谱数据（0..255）
            const spec = this._fft.analyze();
            const N = spec.length;
            const nyquist = sampleRate() / 2;
            const binHz = nyquist / N;

            // 找主峰
            let peakIdx = 1, peakVal = spec[1] || 0;
            for (let i = 2; i < N; i++) {
                const v = spec[i] || 0;
                if (v > peakVal) { peakVal = v; peakIdx = i; }
            }
            const peakHz = Math.round(peakIdx * binHz);

            // 柱状图（仿 Coding Train：HSB 色相随频率变化）
            const padL = 10, padR = 10, padT = 4, padB = 10 + this._liftPx;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;

            const barW = Math.max(1, Math.floor(innerW / N));
            push();
            translate(x + padL, y + padT);
            colorMode(HSB, 255);
            noStroke();
            for (let i = 0; i < N; i++) {
                const ampl = spec[i];               // 0..255
                const barH = Math.min(innerH, (ampl / 255) * innerH * this._vscale); // 垂直放大
                const hue = Math.floor(i * (255 / N));
                fill(hue, 255, 255);                // HSB
                rect(i * barW, innerH - barH, barW, barH);
            }
            pop(); // 还原 p5 状态

            // 频率轴刻度（主：2k，次：1k）
            this._drawXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB);

            // 标题与主峰读数
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 14px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText('FFT(Mic)', x + 12, y + 10);

            ctx.textAlign = 'right';
            ctx.font = 'bold 22px ui-sans-serif, system-ui, -apple-system';
            ctx.fillText(`${peakHz} Hz`, x + w - 12, y + 8);
            ctx.restore();
        }
    };

    root.FFTPanel = Panel;
})(window);
