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
        _vscale: 1.12,
        _liftPx: 12,      // 整体上移（底部留白）

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

        _drawXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB) {
            const baseY = y + h - padB + 0.5;

            // 底线
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + padL, baseY); ctx.lineTo(x + w - padR, baseY); ctx.stroke();

            // 主/次刻度：2k 主、1k 次
            const major = 2000, minor = 1000;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = 'bold 12px ui-sans-serif, system-ui, -apple-system';

            for (let f = 0; f <= nyquist + 1; f += minor) {
                const px = x + padL + (f / nyquist) * innerW;
                const isMajor = (f % major === 0);

                ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px + 0.5, y + padT);
                ctx.lineTo(px + 0.5, baseY);
                ctx.stroke();

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

            this._drawBG(ctx, x, y, w, h);

            const spec = this._fft.analyze(); // 0..255
            const N = spec.length;
            const nyquist = sampleRate() / 2;
            const binHz = nyquist / N;

            // 主峰（用于右上角读数）
            let peakIdx = 1, peakVal = spec[1] || 0;
            for (let i = 2; i < N; i++) { const v = spec[i] || 0; if (v > peakVal) { peakVal = v; peakIdx = i; } }
            const peakHz = Math.round(peakIdx * binHz);

            // 内边距：底部 padB 更大 = 整体上移
            const padL = 10, padR = 10, padT = 6, padB = 14 + this._liftPx;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;

            // -------- 自动压缩（列聚合）--------
            // 目标：列数 = innerW（每个像素 1 列），每列聚合若干 bins（取 max），防溢出
            const numCols = Math.max(1, Math.floor(innerW));
            const step = N / numCols;

            push();
            translate(x + padL, y + padT);
            colorMode(HSB, 255);
            noStroke();

            for (let col = 0; col < numCols; col++) {
                const i0 = Math.floor(col * step);
                const i1 = Math.floor((col + 1) * step);
                let maxV = 0;
                for (let k = i0; k < Math.min(i1, N); k++) if (spec[k] > maxV) maxV = spec[k];

                // 高度（加垂直放大，顶端预留 1px）
                const barH = Math.min(innerH - 1, (maxV / 255) * innerH * this._vscale);

                // 颜色按该列中心频率映射
                const midIdx = (i0 + i1) * 0.5;
                const hue = Math.floor((midIdx / N) * 255);

                fill(hue, 255, 255);
                rect(col, innerH - barH, 1, barH);
            }
            pop();
            // -----------------------------------

            // 频率轴刻度
            this._drawXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB);

            // 标题 & 读数
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText('FFT(Mic)', x + 12, y + 10);

            ctx.textAlign = 'right';
            ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system';
            ctx.fillText(`${peakHz} Hz`, x + w - 12, y + 8);
            ctx.restore();
        }
    };

    root.FFTPanel = Panel;
})(window);
