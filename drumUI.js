// ui/drumUI.js  ——  独立 Canvas 鼓面控件（无 p5 依赖）
(function (root) {
    // ---------------- 工具函数 ----------------
    function deg2rad(d) { return d * Math.PI / 180; }
    function normDeg(a) { a %= 360; return a < 0 ? a + 360 : a; }
    function inArc(ang, start, end) {
        ang = normDeg(ang); start = normDeg(start); end = normDeg(end);
        return (start <= end) ? (ang >= start && ang < end) : (ang >= start || ang < end);
    }
    function midAngleDeg(start, end) {
        const diff = ((end - start + 360) % 360);
        return (start + diff / 2) % 360; // 跨 0° 也安全
    }
    function hexToRgba(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(124,211,255,${a})`;
        const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    // ---------------- 默认 4 扇区（兜底） ----------------
    const DEFAULT_SECTORS = [
        // Open：Michael Spiro（Conga Masterclass）
        {
            abbr: 'O', label: 'Open', start: -45, end: 45, color: '#7cd3ff',
            link: 'https://www.youtube.com/watch?v=X2wONYkRh58'
        },
        // Slap：PAS（Austin Shoupe）
        {
            abbr: 'S', label: 'Slap', start: 45, end: 135, color: '#ff8a80',
            link: 'https://www.youtube.com/watch?v=rr6l9HZkXmM'
        },
        // Palm/Bass：Kalani
        {
            abbr: 'P', label: 'Palm', start: 135, end: 225, color: '#ffd54f',
            link: 'https://www.youtube.com/watch?v=REICDYAm3cE'
        },
        // Tip / Palm tap（入门系列）
        {
            abbr: 'T', label: 'Tip', start: 225, end: 315, color: '#c5e1a5',
            link: 'https://www.youtube.com/watch?v=oZ-7KGKZqjQ'
        },
    ]
    function sanitizeSectors(arr) {
        const src = Array.isArray(arr) && arr.length ? arr : DEFAULT_SECTORS;
        return src.map(s => ({ ...s, start: normDeg(s.start), end: normDeg(s.end) }));
    }

    // ---------------- Drum 核心 ----------------
    function createDrum(ctx, sectorsInput) {
        // 关键：统一做兜底 + 角度规范，避免 undefined.forEach 报错
        const sectors = sanitizeSectors(sectorsInput);

        const state = {
            flashes: new Map(),   // abbr -> 剩余 ms
            hoverAbbr: null,
            cx: 0, cy: 0, r: 60
        };

        function layout(w, h) {
            // 固定尺寸时会传 size,size；这里仍防御一下
            const margin = 10;
            const rMaxH = Math.max(24, (h - 2 * margin) / 2);
            const rMaxW = Math.max(24, (w - 2 * margin) / 2);
            state.r = Math.min(160, rMaxH, rMaxW);
            state.cx = w / 2;
            state.cy = h / 2;
        }

        function trigger(abbr, ms = 320) { state.flashes.set(abbr, ms); }

        function update(dt) {
            for (const [k, t] of [...state.flashes]) {
                const nt = t - dt;
                (nt <= 0) ? state.flashes.delete(k) : state.flashes.set(k, nt);
            }
        }

        function draw(bgColor) {
            const dpr = window.devicePixelRatio || 1;
            const W = ctx.canvas.width / dpr;
            const H = ctx.canvas.height / dpr;
            const { cx, cy, r } = state;

            ctx.save();

            // 背景：整张画布铺满
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = bgColor || '#2f3036';
            ctx.fillRect(0, 0, W, H);

            ctx.translate(cx, cy);

            // 背景盘
            ctx.fillStyle = '#24262b';
            ctx.beginPath(); ctx.arc(0, 0, r * 1.0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(20,20,23,.6)';
            ctx.beginPath(); ctx.arc(0, 0, r * 0.925, 0, Math.PI * 2); ctx.fill();

            // 扇区 + 发光
            sectors.forEach(sec => {
                const active = state.flashes.has(sec.abbr);

                // 底层
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.fillStyle = hexToRgba(sec.color, 0.35);
                ctx.arc(0, 0, r * 0.88, deg2rad(sec.start), deg2rad(sec.end), false);
                ctx.closePath(); ctx.fill();

                // 发光层（命中时）
                if (active) {
                    ctx.save();
                    ctx.shadowBlur = Math.max(10, r * 0.22);
                    ctx.shadowColor = hexToRgba(sec.color, 0.95);
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.beginPath(); ctx.moveTo(0, 0);
                    ctx.fillStyle = hexToRgba(sec.color, 0.85);
                    ctx.arc(0, 0, r * 0.90, deg2rad(sec.start), deg2rad(sec.end), false);
                    ctx.closePath(); ctx.fill();
                    ctx.restore();
                }

                // 标签：使用跨 0° 安全的中点角度，放到稍外的半径，避免重叠
                const mid = deg2rad(midAngleDeg(sec.start, sec.end));
                const tx = Math.cos(mid) * r * 0.58;
                const ty = Math.sin(mid) * r * 0.58;
                ctx.fillStyle = '#eee';
                ctx.font = Math.round(r * 0.16) + 'px Inter, system-ui, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(sec.label, tx, ty);
            });

            // 外圈
            ctx.strokeStyle = '#9b87f5'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2); ctx.stroke();

            // Hover 描边与提示
            if (state.hoverAbbr) {
                const sec = sectors.find(s => s.abbr === state.hoverAbbr);
                if (sec) {
                    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(0, 0, r * 0.97, deg2rad(sec.start), deg2rad(sec.end), false);
                    ctx.stroke();

                    ctx.fillStyle = '#e6e6e6';
                    ctx.font = Math.round(r * 0.12) + 'px Inter, system-ui, sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                    ctx.fillText('点击查看教学视频', 0, r * 0.60);
                }
            }

            ctx.restore();
        }

        function pickAbbrByPoint(x, y) {
            const dx = x - state.cx, dy = y - state.cy;
            if ((dx * dx + dy * dy) > state.r * state.r) return null;
            let ang = Math.atan2(dy, dx) * 180 / Math.PI;
            if (ang < 0) ang += 360;
            const sec = sectors.find(s => inArc(ang, s.start, s.end));
            return sec ? sec.abbr : null;
        }

        return { layout, trigger, update, draw, pickAbbrByPoint, state, sectors };
    }

    // ---------------- Public API ----------------
    const DrumCanvas = {
        _ctx: null, _drum: null, _raf: 0, _lastTs: 0, _bg: '#2f3036',

        /**
         * 初始化
         * @param {Object} opts
         * @param {string} opts.mount  - 容器选择器，如 '#drum-wrap'
         * @param {number} opts.size   - 画布的固定 CSS 尺寸（px）
         * @param {string} opts.background - 背景色
         */
        init({ mount = '#drum-wrap', size = 260, background = '#2f3036' } = {}) {
            const host = document.querySelector(mount);
            if (!host) throw new Error(`[DrumCanvas] mount element not found: ${mount}`);

            // 固定尺寸：由参数 size 决定，不自适应
            const cvs = document.createElement('canvas');
            cvs.style.width = size + 'px';
            cvs.style.height = size + 'px';
            cvs.style.display = 'block';
            host.innerHTML = '';             // 清空旧内容
            host.appendChild(cvs);

            // HiDPI 适配：物理像素 * dpr，但逻辑坐标保持 CSS 像素
            const dpr = window.devicePixelRatio || 1;
            cvs.width = Math.round(size * dpr);
            cvs.height = Math.round(size * dpr);
            const ctx = cvs.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const sectorsSource = root.DRUM_SECTORS || DEFAULT_SECTORS;
            const drum = createDrum(ctx, sectorsSource);
            this._ctx = ctx; this._drum = drum; this._bg = background;

            // 初始布局（固定 size）
            drum.layout(size, size);

            // 事件：hover / click
            const pt = e => {
                const rect = cvs.getBoundingClientRect();
                return { x: e.clientX - rect.left, y: e.clientY - rect.top };
            };
            cvs.addEventListener('mousemove', e => {
                const { x, y } = pt(e);
                drum.state.hoverAbbr = drum.pickAbbrByPoint(x, y);
            });
            cvs.addEventListener('mouseleave', () => drum.state.hoverAbbr = null);
            cvs.addEventListener('click', e => {
                const { x, y } = pt(e);
                const ab = drum.pickAbbrByPoint(x, y);
                const sec = drum.sectors.find(s => s.abbr === ab);
                if (sec && sec.link) window.open(sec.link, '_blank', 'noopener');
            });

            // 动画循环
            const loop = (ts) => {
                const dt = this._lastTs ? (ts - this._lastTs) : 16;
                this._lastTs = ts;
                drum.update(dt);
                drum.draw(this._bg);  // 每帧先铺满背景
                this._raf = requestAnimationFrame(loop);
            };
            this._raf = requestAnimationFrame(loop);

            return this;
        },

        /** 触发某个扇区的发光 */
        trigger(abbr, ms = 320) { this._drum?.trigger(abbr, ms); }
    };

    // 导出到全局
    root.DrumCanvas = DrumCanvas;
    root.DRUM_SECTORS = root.DRUM_SECTORS || DEFAULT_SECTORS;

})(typeof window !== 'undefined' ? window : globalThis);
