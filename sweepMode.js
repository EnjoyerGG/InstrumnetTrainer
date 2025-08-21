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
        _permHits: [],   // [{ x, t, idx, dt, l, res }]  // res: 'good'|'early'|'late'|'miss'
        _lastTs: 0,

        // ===== 样式 =====
        _bg: '#16181c',
        _frame: '#666b73',
        _grid: 'rgba(255,255,255,0.06)',
        _bar: '#ff3b7b',
        _note: '#d0d6e0',
        _noteStrong: '#ffffff',

        _hit: 'rgba(152, 65, 199, 0.4)',
        _hitW: 2,          // 命中竖线宽

        _text: 'rgba(255,255,255,0.8)',
        _r: 10,            // note 半径（弱）
        _rStrong: 12,      // note 半径（强）
        _barW: 3,          // 扫条宽

        _corner: 12,       // 圆角
        _laneGap: 28,      // 上下两条谱线间距（像素）
        _labelFadeMs: 2000,

        _phaseBiasMs: 0,
        _padTop: 24,     // 面板内容距顶部的内边距（想更低就改大些）
        _padBottom: 12,  // 面板内容距底部的内边距

        _showGrid: false,   // ← 关闭网格横线
        _showLanes: false,  // ← 关闭两条谱线

        _accentColor: '#ffd400',   // ★ 重音黄色（和滚动音符一致的黄，按需改）

        _showTicks: true,                     // 是否显示刻度
        _tickColor: 'rgba(255,255,255,0.14)', // 刻度线颜色（浅灰、半透明）
        _tickW: 1,                            // 刻度线宽
        _beatMs: 0,                           // 一拍时长（ms），外部注入 rm.noteInterval
        setBeatMs(ms) { this._beatMs = Math.max(0, Number(ms) || 0); return this; },

        _labelFont: 'bold 16px ui-sans-serif, system-ui, -apple-system', // ★ 加粗加大
        _labelStroke: 'rgba(255,255,255,0.85)',
        _labelStrokeW: 2,
        _labelShadow: 'rgba(255,255,255,0.35)',
        _labelShadowBlur: 3,

        //右下角灰色框
        _showFeedPanel: false,   // ← 设为 false：不画框；想要小框可改 true
        _feedPanelW: 180,
        _feedPanelH: 84,

        _showRMFeedback: false,                 // ★ 不再显示 rm 的 Perfect/Good/Miss 文案
        // —— 底部 HUD 自己的判定阈值（以“拍”的比例计）——
        _thrGood: 0.0525,                       // |Δt| < 0.0525 beat → good
        _thrLate: 0.16,                         // |Δt| > 0.16 beat  → miss
        setJudgeThresholds(good, late) {         // 可选：外部重设
            if (Number.isFinite(good)) this._thrGood = Math.max(0, good);
            if (Number.isFinite(late)) this._thrLate = Math.max(this._thrGood, late);
            return this;
        },


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

        _drawOutlinedText(ctx, text, x, y, fillColor, align = 'left', baseline = 'top') {
            ctx.save();
            ctx.font = this._labelFont;
            ctx.textAlign = align;
            ctx.textBaseline = baseline;
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;

            // 先描边 + 轻微白光
            ctx.strokeStyle = this._labelStroke;
            ctx.lineWidth = this._labelStrokeW;
            ctx.shadowColor = this._labelShadow;
            ctx.shadowBlur = this._labelShadowBlur;
            ctx.strokeText(text, x, y);

            // 再填充目标颜色
            ctx.shadowBlur = 0;
            ctx.fillStyle = fillColor;
            ctx.fillText(text, x, y);
            ctx.restore();
        },


        _drawOutlinedText(ctx, text, x, y, fillColor) {
            ctx.save();
            ctx.font = this._labelFont;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;

            ctx.strokeStyle = this._labelStroke;
            ctx.lineWidth = this._labelStrokeW;
            ctx.shadowColor = this._labelShadow;
            ctx.shadowBlur = this._labelShadowBlur;
            ctx.strokeText(text, x, y);

            ctx.shadowBlur = 0;
            ctx.fillStyle = fillColor;
            ctx.fillText(text, x, y);
            ctx.restore();
        },


        // 倒计时（ms）
        setStartGap(ms = 0) { this._startGapMs = Math.max(0, Number(ms) || 0); },

        // 只影响扫条速度，不改音符间隔
        setSpeedMultiplier(k = 1) { this._speedMul = Math.max(0.05, Number(k) || 1); },

        // 命中痕迹
        clearHits() { this._permHits.length = 0; },
        addHitNow() {
            const r = this._rect();
            const now = this._nowMs();
            // 虚拟时间：与扫条位置一致
            const virt = (now * this._speedMul + this._startGapMs + this._phaseBiasMs) % this._loopMs;
            const xBar = this.getBarX(r.x, r.w);

            // 找最近音符（考虑循环，dt 映射到 (-loop/2, +loop/2]）
            let bestIdx = -1, bestAbs = Infinity, bestDt = 0;
            for (let i = 0; i < this._notes.length; i++) {
                let dt = this._notes[i].time - virt;
                const half = this._loopMs * 0.5;
                if (dt > half) dt -= this._loopMs;
                if (dt < -half) dt += this._loopMs;
                const a = Math.abs(dt);
                if (a < bestAbs) { bestAbs = a; bestIdx = i; bestDt = dt; }
            }

            // |Δt| 换成“拍”的比例
            const beat = this._beatMs || 1;   // 防 0
            const l = Math.abs(bestDt) / beat;
            let res;
            if (l > this._thrLate) res = 'miss';
            else if (l < this._thrGood) res = 'good';
            else res = (bestDt > 0 ? 'early' : 'late');   // dt>0：紫线在左（早）；dt<0：紫线在右（晚）

            this._permHits.push({
                x: Math.round(xBar) + 0.5,
                t: virt,
                idx: bestIdx,
                dt: bestDt,
                l,
                res,
                sys: Date.now()
            });
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
            if (this._showGrid) this._drawGrid(ctx, x, inY, w, inH);

            // 两条谱线
            // 两条谱线（可关）
            const cy = Math.round(inY + inH * 0.58 - 15) + 0.5;
            const yTop = cy - this._laneGap / 2;
            const yBot = cy + this._laneGap / 2;
            if (this._showLanes) {
                ctx.save();
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x + 16, yTop); ctx.lineTo(x + w - 16, yTop); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x + 16, yBot); ctx.lineTo(x + w - 16, yBot); ctx.stroke();
                ctx.restore();
            }

            // --------- 每个音符的 ±1/8、±1/4 拍刻度（在音符之前画，作为背景） ---------
            if (this._showTicks && this._beatMs > 0 && this._notes.length) {
                const tickOffsets = [-0.16, -0.0525, 0.0525, 0.16].map(r => r * this._beatMs);
                const yTickTop = inY + 6;                 // 刻度线顶端
                const yTickBot = inY + inH - 6;           // 刻度线底端
                ctx.save();
                ctx.strokeStyle = this._tickColor;
                ctx.lineWidth = this._tickW;
                for (const n of this._notes) {
                    for (const dt of tickOffsets) {
                        const t = n.time + dt;
                        const xx = Math.round(this.timeToX(t, x, w)) + 0.5;
                        if (xx < x - 2 || xx > x + w + 2) continue;
                        ctx.beginPath();
                        ctx.moveTo(xx, yTickTop);
                        ctx.lineTo(xx, yTickBot);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }


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
                ctx.fillStyle = n.accent ? this._accentColor : this._note;
                ctx.font = (n.accent ? 'bold 18px ' : 'bold 16px ') + 'ui-sans-serif, system-ui, -apple-system';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(glyph || '', xx, yy);
                ctx.restore();

                // 判定反馈
                //const st = fb[n.idx];
                //if (st && st.judged && st.fadeTimer > 0) {
                if (this._showRMFeedback) {
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
                        //}
                    }
                }
            }

            // 永久命中竖线（也用内层）
            if (this._permHits.length) {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
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

            // —— 右侧小面板：显示最近命中反馈 ——
            // 面板尺寸/位置（靠右上，避开 Loop 文案）
            if (this._showFeedPanel) {
                const panelW = this._feedPanelW, panelH = this._feedPanelH;
                const px = x + w - panelW - 12;     // 紧贴右边
                const py = inY + inH - panelH - 40; // 在 Loop 行字的上方
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.28)';           // 更小更浅
                ctx.strokeStyle = 'rgba(255,255,255,0.18)';
                ctx.lineWidth = 1.5;
                const r = 10;
                ctx.beginPath();
                ctx.moveTo(px + r, py);
                ctx.arcTo(px + panelW, py, px + panelW, py + panelH, r);
                ctx.arcTo(px + panelW, py + panelH, px, py + panelH, r);
                ctx.arcTo(px, py + panelH, px, py, r);
                ctx.arcTo(px, py, px + panelW, py, r);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }

            // 最近几条（最多 5 条，最新在上）
            const rows = this._permHits.slice(-5).reverse();  // 最近 5 条
            const lineH = 20;
            const tx = x + w - 12;                 // 右侧内边距
            let ty = inY + inH - 36 - (rows.length - 1) * lineH; // 距底部预留 36px，向上堆叠

            for (const h of rows) {
                let color = 'rgba(174,79,214,1)'; // 默认紫：EARLY/LATE
                let label = 'LATE';
                if (h.res === 'good') { color = 'rgba(85,187,90,1)'; label = 'GOOD'; }
                else if (h.res === 'miss') { color = 'rgba(211,47,47,1)'; label = 'MISS'; }
                else if (h.res === 'early') { color = 'rgba(174,79,214,1)'; label = 'EARLY'; }

                // 右对齐，无背景，仅文字（有白色细描边 + 轻微白光）
                this._drawOutlinedText(ctx, label, tx, ty, color, 'right', 'top');

                ty += lineH;
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
            ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(
                `Loop: ${(this._loopMs / 1000).toFixed(2)}s | Notes: ${this._notes.length}`,
                x + w - 10,
                inY + inH
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
