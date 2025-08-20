// ampGuides.js
// 在振幅 HUD 上绘制“预设音符竖线”与倒计时空隙。
// 关键点：
//  - 线的像素间距 = rm.scrollSpeed * (音符相对时间差)，与 speed 滑块无关（只与乐谱有关）。
//  - 线的运动速度 = rm.scrollSpeed * rm.speedFactor（与音符滚动速度一致）。
//  - 倒计时：把所有竖线整体向右推迟 COUNTDOWN_MS 的“路程”，确保倒计时结束时，第一条线正好到 HUD 绘制端。
(function (root) {
    const AmpGuides = {
        _notes: [],          // [{time, accent}]
        _loopMs: 1,
        _startGapMs: 0,      // 倒计时起始空隙
        _style: {
            weak: 'rgba(120,160,255,0.28)',
            strong: 'rgba(120,160,255,0.5)',
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

        clear() {
            this._notes = [];
            this._loopMs = 1;
            this._startGapMs = 0;
        },

        render(ctx, x, y, w, h) {
            if (!ctx || !w || !h || !this._notes.length) return;

            // 参照：音符滚动速度 = rm.scrollSpeed(px/ms) * rm.speedFactor (ms/ms)
            // 转 px/s 时： S = rm.scrollSpeed * 1000
            const S = (root.rm?.scrollSpeed || 0.5) * 1000;         // 固定“像素/秒”比例（只由乐谱单位决定）
            const sf = (root.rm?.speedFactor || 1);                 // speed 滑块倍率（只影响速度，不影响间距）
            const now = (this._getNowMs ? this._getNowMs() : 0) % this._loopMs;

            // HUD 的“绘制端”在最右：以右边界为“现在时刻”的屏幕位置
            const xHead = x + w - 1;

            // 一整轮音符对应的像素距离（用于复制铺满整个宽度）
            const periodPx = S * (this._loopMs / 1000);

            ctx.save();
            for (const n of this._notes) {
                // 距离“现在”的相对时间（回环修正）
                let dt = n.t - now;
                if (dt < 0) dt += this._loopMs;

                // 倒计时：整体右移“COUNTDOWN_MS 的路程”
                // 注意：这里不乘 speedFactor —— 因为“间距”只取决于谱面时间轴
                const base = xHead + S * ((dt + this._startGapMs) / 1000);

                // 复制到可视区（考虑左右多几轮，避免边界闪烁）
                const k0 = Math.floor((x - base) / periodPx) - 1;
                const k1 = Math.ceil((x + w - base) / periodPx) + 1;

                for (let k = k0; k <= k1; k++) {
                    const xx = Math.round(base + k * periodPx) + 0.5;
                    if (xx < x || xx >= x + w) continue;

                    ctx.beginPath();
                    ctx.strokeStyle = n.accent ? this._style.strong : this._style.weak;
                    ctx.lineWidth = n.accent ? this._style.wStrong : this._style.wWeak;
                    ctx.moveTo(xx, y);
                    ctx.lineTo(xx, y + h);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    };

    root.AmpGuides = AmpGuides;
})(window);
