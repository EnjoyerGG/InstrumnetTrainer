// sweepMode.js
// 静止谱面 + 左→右扫条模式（底部新画布）
// - 音符静止，按 0..Loop 映射到画布宽度，speed 只影响扫条速度；
// - 读取外部 rm.scoreNotes（time/accent/abbr/...），Loop = rm.totalDuration；
// - 支持倒计时 startGapMs；
// - 渲染 Perfect/Good/Miss：复用 rm.feedbackStates；
// - 鼠标/麦克风命中：addHitNow() 在“当前扫条位置”刻一根永久紫线。

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Mode = {
        // ===== 注入 =====
        _nowMs: () => 0,
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _speedMul: 1,
        _getFeedback: () => [],              // () => rm.feedbackStates
        _glyph: (ab) => (ab || ''),          // (abbr) => 可渲染字符

        // ===== 数据 =====
        _loopMs: 1,
        _notes: [],      // [{ idx, time, accent, abbr, drum }]
        _startGapMs: 0,

        // ===== 状态 =====
        _permHits: [],   // [{x}]
        _lastTs: 0,

        // ===== 样式 =====
        _bg: '#16181c',
        _frame: '#666b73',
        _grid: 'rgba(255,255,255,0.06)',
        _bar: '#ff3b7b',
        _note: '#d0d6e0',
        _noteStrong: '#ffffff',
        _hit: 'rgba(166,79,214,0.95)',
        _text: 'rgba(255,255,255,0.8)',
        _r: 10,            // note 半径（弱）
        _rStrong: 12,      // note 半径（强）
        _barW: 3,          // 扫条宽
        _hitW: 3,          // 命中竖线宽
        _corner: 12,       // 圆角
        _laneGap: 28,      // 上下两条谱线间距（像素）
        _labelFadeMs: 2000,

        _phaseBiasMs: 0,
        _padTop: 24,     // 面板内容距顶部的内边距（想更低就改大些）
        _padBottom: 12,  // 面板内容距底部的内边距

        // —— 初始化 —— //
        init({ nowMs, rectProvider, speedMultiplier, getFeedback, glyph } = {}) {
            this._nowMs = nowMs || this._nowMs;
            this._rect = rectProvider || this._rect;
            this._speedMul = Number(speedMultiplier || 1);
            if (typeof getFeedback === 'function') this._getFeedback = getFeedback;
            if (typeof glyph === 'function') this._glyph = glyph;
            return this;
        },

        // —— 同步谱面 —— //
        setNotes(notes = [], loopMs = 1) {
            // 保留索引，便于按 rm.feedbackStates[idx] 找到判定结果
            this._notes = (notes || []).map((n, i) => ({
                idx: i,
                time: Number(n._displayTime ?? n.time) || 0,
                accent: (n.accent | 0) === 1,
                abbr: n.abbr || (n.type ? String(n.type)[0].toUpperCase() : '')
            }));
            this._loopMs = Math.max(1, Number(loopMs) || 1);
        },

        // 倒计时（ms）
        setStartGap(ms = 0) { this._startGapMs = Math.max(0, Number(ms) || 0); },

        // 只影响扫条速度，不改音符间隔
        setSpeedMultiplier(k = 1) { this._speedMul = Math.max(0.05, Number(k) || 1); },

        // 命中痕迹
        clearHits() { this._permHits.length = 0; },
        addHitNow() {
            const r = this._rect();
            const xBar = this.getBarX(r.x, r.w);
            this._permHits.push({ x: Math.round(xBar) + 0.5 });
        },

        // —— 时间(ms) → X 像素（静止谱面）—— //
        timeToX(tMs, x, w) {
            // 正余数：先做一次 %，加 loopMs 防负数，再 % 一次归回 [0, loopMs)
            const p = (((tMs % this._loopMs) + this._loopMs) % this._loopMs) / this._loopMs; // 0..1
            return x + p * w;
        },

        // —— 扫条位置 —— //
        getBarX(x, w) {
            const now = this._nowMs();
            const virt = (now * this._speedMul + this._startGapMs + this._phaseBiasMs) % this._loopMs;
            const p = virt / this._loopMs;
            return x + p * w;
        },

        // —— 渲染 —— //
        render(ctx, x, y, w, h) {
            if (!ctx || !w || !h) return;

            // 外框保持原位
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);

            // ★ 内层区域：把内容整体下移（留缝）
            const inY = y + this._padTop;
            const inH = h - this._padTop - this._padBottom;

            // 网格
            this._drawGrid(ctx, x, inY, w, inH);

            // 两条谱线
            const cy = Math.round(inY + inH * 0.58) + 0.5;
            const yTop = cy - this._laneGap / 2;
            const yBot = cy + this._laneGap / 2;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(x + 16, yTop); ctx.lineTo(x + w - 16, yTop); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + 16, yBot); ctx.lineTo(x + w - 16, yBot); ctx.stroke();
            ctx.restore();

            // 音符（糖葫芦）
            const fb = this._getFeedback() || [];
            for (const n of this._notes) {
                const xx = Math.round(this.timeToX(n.time, x, w)) + 0.5;
                const yy = n.abbr && n.abbr === n.abbr.toLowerCase() ? yBot : yTop;
                const glyph = this._glyph(n.abbr);

                // 竖线
                const stemTop = yy + 10;
                const stemBottom = inY + inH - 10;
                const stemAlpha = n.accent ? 0.22 : 0.14;
                ctx.save();
                ctx.strokeStyle = `rgba(255,255,255,${stemAlpha})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(xx, stemTop);
                ctx.lineTo(xx, stemBottom);
                ctx.stroke();
                ctx.restore();

                // 字符
                ctx.save();
                ctx.fillStyle = n.accent ? this._noteStrong : this._note;
                ctx.font = (n.accent ? 'bold 18px ' : 'bold 16px ') + 'ui-sans-serif, system-ui, -apple-system';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(glyph || '', xx, yy);
                ctx.restore();

                // 判定反馈
                const st = fb[n.idx];
                if (st && st.judged && st.fadeTimer > 0) {
                    const a = Math.max(0, Math.min(1, st.fadeTimer / this._labelFadeMs));
                    ctx.save();
                    ctx.globalAlpha = a;
                    ctx.fillStyle =
                        st.result === 'Perfect' ? 'rgba(174,79,214,1)' :
                            st.result === 'Good' ? 'rgba(85,187,90,1)' :
                                'rgba(211,47,47,1)';
                    ctx.font = '13px ui-sans-serif, system-ui, -apple-system';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(st.result, xx, yy - 14);
                    ctx.restore();
                }
            }

            // 永久命中竖线（也用内层）
            if (this._permHits.length) {
                ctx.save();
                ctx.strokeStyle = this._hit;
                ctx.lineWidth = this._hitW;
                for (const h0 of this._permHits) {
                    if (h0.x < x - 6 || h0.x > x + w + 6) continue;
                    ctx.beginPath();
                    ctx.moveTo(h0.x, inY + 8);
                    ctx.lineTo(h0.x, inY + inH - 8);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // 扫条
            const xBar = this.getBarX(x, w);
            ctx.save();
            ctx.strokeStyle = this._bar;
            ctx.lineWidth = this._barW;
            ctx.beginPath();
            ctx.moveTo(xBar, inY + 6);
            ctx.lineTo(xBar, inY + inH - 6);
            ctx.stroke();
            ctx.restore();

            // 右下角说明
            ctx.save();
            ctx.fillStyle = this._text;
            ctx.font = '12px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(
                `Loop: ${(this._loopMs / 1000).toFixed(2)}s | Notes: ${this._notes.length}`,
                x + w - 12,
                inY + inH - 10
            );
            ctx.restore();
        },


        // —— 工具 —— //
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
        },

        snapToLeft() {    // ★ 让扫条此刻就在最左边（x==panel左边）
            const cur = (this._nowMs() * this._speedMul + this._startGapMs) % this._loopMs;
            this._phaseBiasMs = (this._loopMs - cur) % this._loopMs;
        },
    };

    root.SweepMode = Mode;
})(window);
