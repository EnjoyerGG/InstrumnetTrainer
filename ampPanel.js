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
        _smooth: 0.9,
        _vscale: 3.0,
        _hist: [],
        _histMax: 0,          // 由面板宽度决定：1 像素一个样点
        _historySec: 2.5,     // 目标时间窗（秒）
        _bg: '#111319',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,

        init({ mic, rectProvider, smoothing = 0.9, vscale = 3.0, historySec = 2.5 } = {}) {
            this._rect = rectProvider || this._rect;
            this._smooth = clamp(smoothing, 0, 0.99);
            this._vscale = Math.max(1, vscale);
            this._historySec = Math.max(0.5, historySec);

            this._amp = new p5.Amplitude();
            if (mic) this._amp.setInput(mic);
            this._amp.smooth(this._smooth);

            return this;
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

            // 横向网格
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

        render(ctx, x, y, w, h) {
            const r = this._rect();
            if (r && r.w && r.h) { x = r.x; y = r.y; w = r.w; h = r.h; }
            if (!w || !h) return;

            this._drawBG(ctx, x, y, w, h);

            const padL = 10, padR = 10, padT = 8, padB = 14;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;
            this._ensureHistCapacity(innerW);

            // 取当前音量（0..1），并转 dBFS（仅用于读数显示）
            let level = 0;
            if (this._amp && typeof this._amp.getLevel === 'function') {
                level = this._amp.getLevel() || 0;
            }
            const db = 20 * Math.log10(Math.max(1e-6, level)); // 负值，越接近 0 越响

            // 维护历史：右进左出
            this._hist.push(level);
            if (this._hist.length > this._histMax) this._hist.shift();

            // 把历史画成折线
            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            // 底部“零线”
            const baseY = y + padT + innerH;
            // 第一段
            if (this._hist.length > 0) {
                const y0 = baseY - Math.min(innerH - 1, this._hist[0] * innerH * this._vscale);
                ctx.moveTo(x + padL, y0);
            }
            // 其余段
            for (let i = 1; i < this._hist.length; i++) {
                const px = x + padL + i;
                const py = baseY - Math.min(innerH - 1, this._hist[i] * innerH * this._vscale);
                ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.restore();

            // 红色扫描线（当前点）
            ctx.save();
            ctx.strokeStyle = 'rgba(255,64,64,0.9)';
            ctx.lineWidth = 1;
            const cursorX = x + padL + this._hist.length;
            ctx.beginPath(); ctx.moveTo(cursorX + 0.5, y + padT); ctx.lineTo(cursorX + 0.5, y + padT + innerH); ctx.stroke();
            ctx.restore();

            // 标题 & dB 读数
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 14px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillText('Amplitude (Mic)', x + 12, y + 10);

            ctx.textAlign = 'right';
            ctx.font = 'bold 18px ui-sans-serif, system-ui, -apple-system';
            // 典型范围 -60 ~ -10 dBFS；很安静时显示 “-inf”
            const label = (level <= 1e-6) ? '−∞ dB' : `${db.toFixed(1)} dB`;
            ctx.fillText(label, x + w - 12, y + 8);
            ctx.restore();
        }
    };

    root.AmpPanel = Panel;
})(window);
