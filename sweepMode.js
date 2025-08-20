// sweepMode.js
// 静止谱面 + 左→右扫条（Bar）模式。
// ─ 由 JSON/你的 rm 提供 notes（ms 时间）与 loop 时长。
// ─ 音符静止按时间等距铺满画布宽度，speed 仅影响“扫条速度”，不会改变音符间隔。
// ─ 支持倒计时 startGapMs：倒计时期间扫条延后，确保第一拍对上。
// ─ 可记录命中（鼠标/麦克风）在扫条处打“永久竖线”。

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Mode = {
        // ---- 注入 ----
        _nowMs: () => 0,                // 谱面时间（建议传 rm._t）
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }), // 画布矩形（由外部给）
        _speedMul: 1,                   // 额外播放倍率（可选）

        // ---- 数据 ----
        _loopMs: 1,
        _notes: [],    // [{time(ms), accent:boolean}]
        _startGapMs: 0,

        // ---- 状态 ----
        _permHits: [], // 永久命中痕迹：{ x }
        _lastTs: 0,    // for dt

        // ---- 样式 ----
        _bg: '#16181c',
        _frame: '#666b73',
        _grid: 'rgba(255,255,255,0.06)',
        _bar: '#ff3b7b',
        _note: '#d0d6e0',
        _noteStrong: '#ffffff',
        _hit: 'rgba(166,79,214,0.95)',
        _text: 'rgba(255,255,255,0.8)',
        _r: 10,         // note 半径（弱）
        _rStrong: 12,   // note 半径（强）
        _barW: 3,       // 打击条宽度
        _hitW: 3,       // 命中竖线宽度
        _corner: 12,    // 圆角

        // —— 初始化 —— //
        init({ nowMs, rectProvider, speedMultiplier } = {}) {
            this._nowMs = nowMs || this._nowMs;
            this._rect = rectProvider || this._rect;
            this._speedMul = Number(speedMultiplier || 1);
            return this;
        },

        // 设置音符 + 循环总时长（单位 ms）
        setNotes(notes = [], loopMs = 1) {
            this._notes = (notes || []).map(n => ({
                time: Number(n._displayTime ?? n.time) || 0,
                accent: (n.accent | 0) === 1
            }));
            this._loopMs = Math.max(1, Number(loopMs) || 1);
        },

        // 倒计时（ms）
        setStartGap(ms = 0) { this._startGapMs = Math.max(0, Number(ms) || 0); },

        // 额外播放倍率（不改音符间隔，只改扫条速度）
        setSpeedMultiplier(k = 1) { this._speedMul = Math.max(0.05, Number(k) || 1); },

        // 清理永久命中
        clearHits() { this._permHits.length = 0; },

        // 记录一次命中：在“当前扫条位置”打永久竖线
        addHitNow() {
            const r = this._rect();
            const xBar = this.getBarX(r.x, r.w);
            this._permHits.push({ x: Math.round(xBar) + 0.5 });
        },

        // —— 映射：时间(ms) -> X 像素（静止谱面，按 loop 等比映射） —— //
        timeToX(tMs, x, w) {
            const p = ((tMs % this._loopMs) + this._loopMs) / this._loopMs; // 0..1
            return x + p * w;
        },

        // —— 扫条位置：随时间左→右（受 startGap 与 speedMultiplier 影响） —— //
        getBarX(x, w) {
            const now = this._nowMs();
            // 倒计时：整体延后；speedMul：整体加速/减速
            const virt = (now * this._speedMul + this._startGapMs) % this._loopMs;
            const p = virt / this._loopMs; // 0..1
            return x + p * w;
        },

        // —— 渲染 —— //
        render(ctx, x, y, w, h) {
            if (!ctx || !w || !h) return;

            // 背板
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);

            // 网格（横线）
            this._drawGrid(ctx, x, y, w, h);

            // 中线轨道
            const cy = Math.round(y + h * 0.55) + 0.5;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x + 16, cy);
            ctx.lineTo(x + w - 16, cy);
            ctx.stroke();
            ctx.restore();

            // 音符（静止）
            for (const n of this._notes) {
                const xx = Math.round(this.timeToX(n.time, x, w)) + 0.5;
                const rr = n.accent ? this._rStrong : this._r;
                ctx.beginPath();
                ctx.fillStyle = n.accent ? this._noteStrong : this._note;
                ctx.arc(xx, cy, rr, 0, Math.PI * 2);
                ctx.fill();
                // 小三角（可选）
                ctx.beginPath();
                ctx.moveTo(xx, cy + rr + 6);
                ctx.lineTo(xx - 4, cy + rr + 14);
                ctx.lineTo(xx + 4, cy + rr + 14);
                ctx.closePath();
                ctx.fill();
            }

            // 永久命中竖线（和扫条同色系）
            if (this._permHits.length) {
                ctx.save();
                ctx.strokeStyle = this._hit;
                ctx.lineWidth = this._hitW;
                for (const h0 of this._permHits) {
                    if (h0.x < x - 6 || h0.x > x + w + 6) continue;
                    ctx.beginPath();
                    ctx.moveTo(h0.x, y + 8);
                    ctx.lineTo(h0.x, y + h - 8);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // 扫条（当前时间）
            const xBar = this.getBarX(x, w);
            ctx.save();
            ctx.strokeStyle = this._bar;
            ctx.lineWidth = this._barW;
            ctx.beginPath();
            ctx.moveTo(xBar, y + 6);
            ctx.lineTo(xBar, y + h - 6);
            ctx.stroke();
            ctx.restore();

            // 底部说明
            ctx.save();
            ctx.fillStyle = this._text;
            ctx.font = '12px ui-sans-serif, system-ui, -apple-system';
            const max = Math.max(...this._notes.map(n => n.time), 0);
            ctx.fillText(`Loop: ${(this._loopMs / 1000).toFixed(2)}s | Notes: ${this._notes.length}`, x + 12, y + h - 10);
            ctx.restore();
        },

        // —— 工具：绘制圆角面板 + 网格 —— //
        _roundRect(ctx, x, y, w, h, r, fill, stroke) {
            ctx.save();
            ctx.beginPath();
            const rr = clamp(r, 0, Math.min(w, h) / 2);
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
            const ys = 5;
            for (let i = 1; i < ys; i++) {
                const yy = Math.round(y + (h * i) / ys) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x + 8, yy);
                ctx.lineTo(x + w - 8, yy);
                ctx.stroke();
            }
            ctx.restore();
        }
    };

    root.SweepMode = Mode;
})(window);
