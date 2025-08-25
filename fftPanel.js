// fftPanel.js
// 基于 Coding Train: Frequency analysis with FFT（改为麦克风输入 + 面板化）
// 用法：FFTPanel.init({ mic, rectProvider: () => ({x,y,w,h}), bins:64, smoothing:0.9 })

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Panel = {
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _fft: null,
        _bins: 64,
        _smooth: 0.9,
        _bg: '#111319',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,

        init({ mic, rectProvider, bins = 64, smoothing = 0.9 } = {}) {
            this._rect = rectProvider || this._rect;
            this._bins = Math.max(16, bins | 0);
            this._smooth = clamp(smoothing, 0, 0.99);
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
            ctx.save();
            ctx.strokeStyle = this._grid;
            ctx.lineWidth = 1;
            for (let i = 1; i < 5; i++) {
                const yy = Math.round(y + (h * i) / 5) + 0.5;
                ctx.beginPath(); ctx.moveTo(x + 8, yy); ctx.lineTo(x + w - 8, yy); ctx.stroke();
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
            const padL = 10, padR = 10, padT = 6, padB = 10;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;
            const barW = Math.max(1, Math.floor(innerW / N));

            push(); // p5 状态
            translate(x + padL, y + padT);
            colorMode(HSB, 255);
            noStroke();

            for (let i = 0; i < N; i++) {
                const ampl = spec[i];               // 0..255
                const barH = (ampl / 255) * innerH; // 映射到高度
                const hue = Math.floor(i * (255 / N));
                fill(hue, 255, 255);                // HSB
                rect(i * barW, innerH - barH, barW, barH);
            }
            pop(); // 还原 p5 状态

            // 标题与主峰读数
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 14px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText('FFT 频谱 (Mic)', x + 12, y + 10);

            ctx.textAlign = 'right';
            ctx.font = 'bold 22px ui-sans-serif, system-ui, -apple-system';
            ctx.fillText(`${peakHz} Hz`, x + w - 12, y + 8);
            ctx.restore();
        }
    };

    root.FFTPanel = Panel;
})(window);
