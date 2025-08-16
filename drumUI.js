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
    ];

    const RING_LAYOUT = [
        {
            abbr: 'O', label: 'Open / Slap', color: '#7cd3ff',
            linkOpen: 'assets/tutorials/conga/open.mp4',
            linkSlap: 'assets/tutorials/conga/slap.mp4',
            r0: 0.62, r1: 0.92
        }, // 外环：半径 62%~92%
        {
            abbr: 'T', label: 'Tip / Palm', color: '#c5e1a5',
            link: 'assets/tutorials/conga/tip.mp4',
            r0: 0.38, r1: 0.62
        }, // 中环：38%~62%
        {
            abbr: 'P', label: 'Bass', color: '#ffd54f',
            link: 'assets/tutorials/conga/bass.mp4',
            r0: 0.00, r1: 0.38
        }  // 内圆：0%~38%
    ];

    function sanitizeSectors(arr) {
        const src = Array.isArray(arr) && arr.length ? arr : DEFAULT_SECTORS;
        return src.map(s => ({ ...s, start: normDeg(s.start), end: normDeg(s.end) }));
    }

    const CANVAS_MARGIN = 4;      // 画布内侧留白（原来相当于 10）
    const SHOW_LABELS = false;    // 关闭圈上文字
    const SHOW_HOVER_HINT = false;// 关闭“点击查看教学视频”提示

    // ---------------- Drum 核心 ----------------
    function createDrum(ctx, sectorsInput) {
        // 关键：统一做兜底 + 角度规范，避免 undefined.forEach 报错
        const isRings = Array.isArray(sectorsInput) && sectorsInput.length && !('start' in sectorsInput[0]);
        const sectors = isRings ? null : sanitizeSectors(sectorsInput);
        const rings = isRings ? sectorsInput.map(r => ({
            ...r,
            r0: Math.max(0, Math.min(0.98, r.r0 ?? 0)),
            r1: Math.max(0.02, Math.min(0.98, r.r1 ?? 1))
        })) : null;

        const state = {
            flashes: new Map(),   // abbr -> 剩余 ms
            hoverAbbr: null,
            cx: 0, cy: 0, r: 60
        };

        function layout(w, h) {
            // 固定尺寸时会传 size,size；这里仍防御一下
            const margin = CANVAS_MARGIN;
            const rMaxH = Math.max(24, (h - 2 * margin) / 2);
            const rMaxW = Math.max(24, (w - 2 * margin) / 2);
            state.r = Math.min(160, rMaxH, rMaxW);
            state.cx = w / 2;
            state.cy = h / 2;
        }

        function trigger(abbr, ms = 320) {
            const key = (rings && abbr === 'S') ? 'O' : abbr;
            state.flashes.set(key, ms);
        }

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

            if (rings) {
                // 底盘
                ctx.fillStyle = '#24262b';
                ctx.beginPath(); ctx.arc(0, 0, r * 1.00, 0, Math.PI * 2); ctx.fill();

                rings.forEach(rg => {
                    // 彩色环：用“外圆-内圆”形成环带
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.fillStyle = hexToRgba(rg.color, 0.45);
                    ctx.arc(0, 0, r * rg.r1, 0, Math.PI * 2);
                    ctx.arc(0, 0, r * rg.r0, 0, Math.PI * 2, true);
                    ctx.closePath(); ctx.fill();

                    // 命中发光
                    const active = state.flashes.has(rg.abbr);
                    if (active) {
                        ctx.save();
                        ctx.shadowBlur = Math.max(10, r * 0.22);
                        ctx.shadowColor = hexToRgba(rg.color, 0.95);
                        ctx.globalCompositeOperation = 'lighter';
                        ctx.beginPath();
                        ctx.arc(0, 0, r * rg.r1, 0, Math.PI * 2);
                        ctx.arc(0, 0, r * rg.r0, 0, Math.PI * 2, true);
                        ctx.closePath(); ctx.fill();
                        ctx.restore();
                    }

                    if (SHOW_LABELS) {
                        ctx.fillStyle = '#eee';
                        ctx.font = Math.round(r * 0.16) + 'px Inter, system-ui, sans-serif';
                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        const midR = (rg.r0 + rg.r1) / 2;
                        ctx.fillText(rg.label, Math.cos(0) * r * midR, -r * (midR + 0.02));
                    }
                });

                // 外圈描边
                ctx.strokeStyle = '#9b87f5'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2); ctx.stroke();

                // Hover 高亮：描出当前环的外边界
                if (state.hoverAbbr) {
                    const rg = rings.find(x => x.abbr === state.hoverAbbr);
                    if (rg) {
                        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3;
                        ctx.beginPath(); ctx.arc(0, 0, r * rg.r1, 0, Math.PI * 2); ctx.stroke();

                        if (SHOW_HOVER_HINT) {
                            ctx.fillStyle = '#e6e6e6';
                            ctx.font = Math.round(r * 0.12) + 'px Inter, system-ui, sans-serif';
                            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                            ctx.fillText('点击查看教学视频', 0, r * (rg.r1 + 0.06));
                        }
                    }
                }
            } else {
                // === 保留你原来的“扇区绘制”分支 ===
                //（这里不贴原文，直接保留你现有的 sectors.forEach(...) 那段）
            }

            ctx.restore();
        }

        function pickAbbrByPoint(x, y) {
            const dx = x - state.cx, dy = y - state.cy;
            const rr = Math.sqrt(dx * dx + dy * dy);
            if (rings) {
                for (const rg of rings) {
                    if (rr >= state.r * rg.r0 && rr < state.r * rg.r1) return rg.abbr;
                }
                return null;
            } else {
                // === 保留原有“按角度挑扇区”的分支 ===
                let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360;
                const sec = sectors.find(s => inArc(ang, s.start, s.end));
                return sec ? sec.abbr : null;
            }
        }

        return { layout, trigger, update, draw, pickAbbrByPoint, state, sectors, rings };
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

            const sourceRings = root.DRUM_RINGS || RING_LAYOUT;
            const sourceSectors = root.DRUM_SECTORS || DEFAULT_SECTORS;
            // 如果对象里有 start/end 就视为“扇区”，否则视为“环区”
            const looksLikeSectors = Array.isArray(sourceRings) && sourceRings[0] && ('start' in sourceRings[0]);
            const config = looksLikeSectors ? sourceSectors : sourceRings;

            const drum = createDrum(ctx, config);
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
                if (!ab) return;

                if (drum.rings) {
                    const rg = drum.rings.find(r => r.abbr === ab) || drum.rings.find(r => r.abbr === 'O');
                    if (!rg) return;
                    if (ab === 'O' && (rg.linkOpen || rg.linkSlap)) {
                        const url = e.shiftKey ? (rg.linkSlap || rg.linkOpen) : (rg.linkOpen || rg.linkSlap);
                        if (url) window.open(url, '_blank', 'noopener');
                    } else {
                        const url = rg.link;
                        if (url) window.open(url, '_blank', 'noopener');
                    }
                } else {
                    const sec = drum.sectors.find(s => s.abbr === ab);
                    if (sec && sec.link) window.open(sec.link, '_blank', 'noopener');
                }
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
