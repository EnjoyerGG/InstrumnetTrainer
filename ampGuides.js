// ampGuides.js
// 在振幅 HUD 上绘制“预设音符竖线”与倒计时空隙。
// 关键点：
//  - 线的像素间距 = rm.scrollSpeed * (音符相对时间差)，与 speed 滑块无关（只与乐谱有关）。
//  - 线的运动速度 = rm.scrollSpeed * rm.speedFactor（与音符滚动速度一致）。
//  - 倒计时：把所有竖线整体向右推迟 COUNTDOWN_MS 的“路程”，确保倒计时结束时，第一条线正好到 HUD 绘制端。
(function (root) {
    const AmpGuides = {
        _notes: [],          // [{time, accent}]
        _hits: [],                     // [{ t: 命中发生时的乐谱时间(ms) }]
        _hitStyle: { color: 'rgba(166,79,214,0.55)', w: 2 },  // 淡紫色
        _loopMs: 1,
        _startGapMs: 0,      // 倒计时起始空隙
        _style: {
            weak: 'rgba(160,160,160,0.28)',   // 灰
            strong: 'rgba(220,220,220,0.55)', // 灰（重拍稍亮）
            wWeak: 1,
            wStrong: 1.5
        },

        // 供外部传入：当前“谱面时间（ms）”、HUD 矩形区域
        _getNowMs: null,
        _getRect: null,

        init({ getNowMs, getRect }) {
            this._getNowMs = getNowMs;
            this._getRect = getRect;
            return this;
        },

        setNotes(notes, loopMs) {
            this._notes = (notes || []).map(n => ({
                t: Number(n._displayTime ?? n.time) || 0,
                accent: (n.accent | 0) === 1
            }));
            this._loopMs = Math.max(1, Number(loopMs) || 1);
        },

        setStartGap(ms = 0) {
            this._startGapMs = Math.max(0, ms | 0);
        },

        addHitAt(tMs) {
            if (!Number.isFinite(tMs)) return;
            const t = ((tMs % this._loopMs) + this._loopMs) % this._loopMs;
            this._hits.push({ t });
        },
        addHitNow() {
            const now = (this._getNowMs ? this._getNowMs() : 0);
            this.addHitAt(now);
        },
        clearHits() { this._hits.length = 0; },

        clear() {
            this._notes = [];
            this._loopMs = 1;
            this._startGapMs = 0;
        },

        render(ctx, x, y, w, h) {
            if (!ctx || !w || !h) return;   // 没有 notes 也照样可以画“紫色命中痕迹”;

            const S = (root.rm?.scrollSpeed || 0.5) * 1000;
            const now = (this._getNowMs ? this._getNowMs() : 0) % this._loopMs;
            const xHead = (window.SampleUI?.getCursorX?.() ?? (x + w - 1));
            const periodPx = S * (this._loopMs / 1000);

            // === 第一遍：灰色预设线 ===
            ctx.save();
            for (const n of this._notes) {
                let dt = n.t - now; if (dt < 0) dt += this._loopMs;
                const base = xHead + S * ((dt + this._startGapMs) / 1000);
                const k0 = Math.floor((x - base) / periodPx) - 1;
                const k1 = Math.ceil((x + w - base) / periodPx) + 1;

                const strong = !!n.accent;
                ctx.strokeStyle = strong ? this._style.strong : this._style.weak;
                ctx.lineWidth = strong ? this._style.wStrong : this._style.wWeak;

                for (let k = k0; k <= k1; k++) {
                    const xx = Math.round(base + k * periodPx) + 0.5;
                    if (xx < x || xx >= x + w) continue;
                    ctx.beginPath();
                    ctx.moveTo(xx, y);
                    ctx.lineTo(xx, y + h);
                    ctx.stroke();
                }
            }
            ctx.restore();

            // === 第二遍：永久“打击痕迹”（淡紫） ===
            if (this._hits.length) {
                ctx.save();
                ctx.strokeStyle = this._hitStyle.color;
                ctx.lineWidth = this._hitStyle.w;
                for (const h of this._hits) {
                    let dt = h.t - now; if (dt < 0) dt += this._loopMs;
                    const base = xHead + S * ((dt + this._startGapMs) / 1000);
                    const k0 = Math.floor((x - base) / periodPx) - 1;
                    const k1 = Math.ceil((x + w - base) / periodPx) + 1;
                    for (let k = k0; k <= k1; k++) {
                        const xx = Math.round(base + k * periodPx) + 0.5;
                        if (xx < x || xx >= x + w) continue;
                        ctx.beginPath();
                        ctx.moveTo(xx, y);
                        ctx.lineTo(xx, y + h);
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }
        }
    };

    root.AmpGuides = AmpGuides;
})(window);
