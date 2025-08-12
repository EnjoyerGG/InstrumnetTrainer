// ui/drumCanvas.js  —  Vanilla Canvas drum widget
(function (root) {
    const DEFAULT_SECTORS = (root.DRUM_SECTORS || [
        // Open：Michael Spiro（Conga Masterclass）
        {
            abbr: 'O', label: 'Open', start: -40, end: 40, color: '#7cd3ff',
            link: 'https://www.youtube.com/watch?v=X2wONYkRh58'
        },
        // Slap：PAS（Austin Shoupe）
        {
            abbr: 'S', label: 'Slap', start: 40, end: 140, color: '#ff8a80',
            link: 'https://www.youtube.com/watch?v=rr6l9HZkXmM'
        },
        // Palm/Bass：Kalani
        {
            abbr: 'P', label: 'Palm', start: 140, end: 220, color: '#ffd54f',
            link: 'https://www.youtube.com/watch?v=REICDYAm3cE'
        },
        // Tip / Palm tap（入门系列）
        {
            abbr: 'T', label: 'Tip', start: 220, end: 320, color: '#c5e1a5',
            link: 'https://www.youtube.com/watch?v=oZ-7KGKZqjQ'
        },
    ]).map(s => ({ ...s, start: normDeg(s.start), end: normDeg(s.end) }));

    function deg2rad(d) { return d * Math.PI / 180; }
    function normDeg(a) { a = a % 360; return (a < 0) ? a + 360 : a; }
    function inArc(ang, start, end) {
        ang = normDeg(ang); start = normDeg(start); end = normDeg(end);
        return (start <= end) ? (ang >= start && ang < end)
            : (ang >= start || ang < end); // 跨 0° 情况
    }

    function createDrum(ctx, sectors) {
        const state = {
            flashes: new Map(), // abbr -> remaining ms
            hoverAbbr: null,
            cx: 0, cy: 0, r: 60
        };

        function layout(w, h) {
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

        function draw() {
            const { cx, cy, r } = state;
            ctx.save();
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.translate(cx, cy);

            // 背景
            ctx.fillStyle = '#24262b';
            ctx.beginPath(); ctx.arc(0, 0, r * 1.0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(20,20,23,.6)';
            ctx.beginPath(); ctx.arc(0, 0, r * 0.925, 0, Math.PI * 2); ctx.fill();

            // 扇区
            sectors.forEach(sec => {
                const active = state.flashes.has(sec.abbr);
                const alpha = active ? 0.85 : 0.35;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.fillStyle = hexToRgba(sec.color, alpha);
                ctx.arc(0, 0, r * 0.88, deg2rad(sec.start), deg2rad(sec.end), false);
                ctx.closePath(); ctx.fill();

                // 标签
                const mid = deg2rad((sec.start + sec.end) / 2);
                const tx = Math.cos(mid) * r * 0.37, ty = Math.sin(mid) * r * 0.37;
                ctx.fillStyle = '#eee';
                ctx.font = Math.round(r * 0.16) + 'px Inter, system-ui, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(sec.label, tx, ty);
            });

            // 外圈
            ctx.strokeStyle = '#9b87f5'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2); ctx.stroke();

            // Hover 高亮描边
            if (state.hoverAbbr) {
                const sec = sectors.find(s => s.abbr === state.hoverAbbr);
                if (sec) {
                    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(0, 0, r * 0.97, deg2rad(sec.start), deg2rad(sec.end), false);
                    ctx.stroke();

                    ctx.fillStyle = '#e6e6e6';
                    ctx.font = Math.round(r * 0.12) + 'px Inter, system-ui, sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                    ctx.fillText('点击查看教学视频', 0, r * 0.58);
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

    function hexToRgba(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(124,211,255,${a})`;
        const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    // ---- Public API ---------------------------------------------------------
    const DrumCanvas = {
        _ctx: null, _drum: null, _raf: 0, _lastTs: 0,
        init({ mount = '#drum-wrap' } = {}) {
            const host = document.querySelector(mount);
            if (!host) throw new Error(`[DrumCanvas] mount element not found: ${mount}`);

            // 创建 canvas，并让 CSS 控制尺寸
            const cvs = document.createElement('canvas');
            cvs.style.width = '100%'; cvs.style.height = '100%'; cvs.style.display = 'block';
            host.appendChild(cvs);

            // 物理像素适配
            const ctx = cvs.getContext('2d');
            const drum = createDrum(ctx, DEFAULT_SECTORS);
            this._ctx = ctx; this._drum = drum;

            const resize = () => {
                const dpr = window.devicePixelRatio || 1;
                const w = Math.max(80, host.clientWidth);
                const h = Math.max(80, host.clientHeight);
                cvs.width = Math.round(w * dpr);
                cvs.height = Math.round(h * dpr);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // 逻辑坐标仍按 CSS 像素
                drum.layout(w, h);
                drum.draw();
            };
            resize();

            // 事件：hover / click
            const pt = e => {
                const rect = cvs.getBoundingClientRect();
                const x = e.clientX - rect.left, y = e.clientY - rect.top;
                return { x, y };
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

            // 自适应
            const ro = new ResizeObserver(resize); ro.observe(host);

            // 动画循环
            const loop = (ts) => {
                const dt = this._lastTs ? (ts - this._lastTs) : 16;
                this._lastTs = ts;
                drum.update(dt);
                drum.draw();
                this._raf = requestAnimationFrame(loop);
            };
            this._raf = requestAnimationFrame(loop);

            return this;
        },
        trigger(abbr, ms = 320) { this._drum?.trigger(abbr, ms); }
    };

    root.DrumCanvas = DrumCanvas;
})(typeof window !== 'undefined' ? window : globalThis);
