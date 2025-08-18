// ui/drumUI.js —— 独立 Canvas 鼓面控件（仅 rings，同心圆），无 p5 依赖
(function (root) {
    // ---------- 工具 ----------
    function hexToRgba(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(124,211,255,${a})`;
        const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
        return `rgba(${r},${g},${b},${a})`;
    }

    // 三同心圆布局
    const RING_LAYOUT = [
        { abbr: 'O', label: 'Open / Slap', color: '#7cd3ff', r0: 0.62, r1: 0.92 },
        { abbr: 'T', label: 'Tip / Palm', color: '#c5e1a5', r0: 0.38, r1: 0.62 },
        { abbr: 'P', label: 'Bass', color: '#ffd54f', r0: 0.00, r1: 0.38 }
    ];

    // 画布与文字配置
    const CANVAS_MARGIN = 4;     // 画布内留白
    const SHOW_LABELS = false; // 关闭圈上文字
    const SHOW_HOVER_HINT = false; // 关闭画布内 hover 提示（我们用外部 tooltip）

    // ---------- Drum（仅 rings） ----------
    function createDrum(ctx, ringsInput) {
        const rings = (Array.isArray(ringsInput) && ringsInput.length ? ringsInput : RING_LAYOUT)
            .map(r => ({
                ...r,
                r0: Math.max(0, Math.min(0.98, r.r0 ?? 0)),
                r1: Math.max(0.02, Math.min(0.98, r.r1 ?? 1))
            }));

        const state = { flashes: new Map(), hoverAbbr: null, cx: 0, cy: 0, r: 60, edgeFlash: 0 };

        function layout(w, h) {
            const margin = CANVAS_MARGIN;
            const rMaxH = Math.max(24, (h - 2 * margin) / 2);
            const rMaxW = Math.max(24, (w - 2 * margin) / 2);
            state.r = Math.min(160, rMaxH, rMaxW);
            state.cx = w / 2; state.cy = h / 2;
        }

        function trigger(abbr, ms = 320) {
            if (abbr === 'EDGE') {
                state.edgeFlash = ms;
                return;
            }
            if (abbr === 'S') abbr = 'O';
            else if (abbr === 'P') abbr = 'T';   // Palm 归中环
            else if (abbr === 'B') abbr = 'P';   // Bass 归内环（本控件内环的 abbr 是 'P'）
            state.flashes.set(abbr, ms);
        }

        function update(dt) {
            for (const [k, t] of [...state.flashes]) {
                const nt = t - dt;
                (nt <= 0) ? state.flashes.delete(k) : state.flashes.set(k, nt);
            }
            if (state.edgeFlash > 0) state.edgeFlash = Math.max(0, state.edgeFlash - dt);
        }

        function draw(bgColor) {
            const dpr = window.devicePixelRatio || 1;
            const W = ctx.canvas.width / dpr, H = ctx.canvas.height / dpr;
            const { cx, cy, r } = state;

            ctx.save();
            // 背景
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = bgColor || '#2f3036';
            ctx.fillRect(0, 0, W, H);

            ctx.translate(cx, cy);

            // 底盘
            ctx.fillStyle = '#24262b';
            ctx.beginPath();
            ctx.arc(0, 0, r * 1.00, 0, Math.PI * 2);
            ctx.fill();

            rings.forEach(rg => {
                // 环带
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.fillStyle = hexToRgba(rg.color, 0.45);
                ctx.arc(0, 0, r * rg.r1, 0, Math.PI * 2);
                ctx.arc(0, 0, r * rg.r0, 0, Math.PI * 2, true);
                ctx.closePath(); ctx.fill();

                // 命中发光
                if (state.flashes.has(rg.abbr)) {
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
                    ctx.fillText(rg.label, 0, -r * (midR + 0.02));
                }
            });

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#e8eaef';
            ctx.shadowColor = 'rgba(0,0,0,.55)';
            ctx.shadowBlur = Math.max(2, r * 0.02);

            // 取各环对象（你的 rings 里每个有 abbr, r0, r1，半径比例）
            const rgInner = rings.find(x => x.abbr === 'P'); // yellow core
            const rgMid = rings.find(x => x.abbr === 'T'); // green ring
            const rgOuter = rings.find(x => x.abbr === 'O'); // blue ring

            // 环中心半径（r0~r1 的中点）和厚度
            const midR = (rg) => r * ((rg.r0 + rg.r1) / 2);
            const thk = (rg) => r * Math.max(0.01, (rg.r1 - rg.r0));

            // 根据环厚度自适应字号（0.6 倍厚度，且不低于 10px）
            const fontPxInner = rgInner ? Math.max(10, Math.round(thk(rgInner) * 0.60)) : 12;
            const fontPxMid = rgMid ? Math.max(10, Math.round(thk(rgMid) * 0.60)) : 12;
            const fontPxOuter = rgOuter ? Math.max(10, Math.round(thk(rgOuter) * 0.60)) : 12;

            // B（黄心）
            if (rgInner) {
                ctx.font = `700 ${fontPxInner}px Inter, system-ui, sans-serif`; // ★ 加粗
                ctx.fillText('B', 0, midR(rgInner));
            }
            // T/P（绿环）
            if (rgMid) {
                ctx.font = `700 ${fontPxMid}px Inter, system-ui, sans-serif`;
                ctx.fillText('T/P', 0, midR(rgMid));
            }
            // O/S（蓝环）
            if (rgOuter) {
                ctx.font = `700 ${fontPxOuter}px Inter, system-ui, sans-serif`;
                ctx.fillText('O/S', 0, midR(rgOuter));
            }
            ctx.restore();

            // 外圈描边
            ctx.strokeStyle = '#9b87f5'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2); ctx.stroke();
            if (state.edgeFlash > 0) {
                ctx.save();
                ctx.shadowBlur = Math.max(12, r * 0.35);
                ctx.shadowColor = '#9b87f5';
                ctx.globalCompositeOperation = 'lighter';
                ctx.strokeStyle = '#9b87f5';
                ctx.lineWidth = Math.max(3, r * 0.06);
                ctx.beginPath();
                ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            // Hover 高亮（只描边，不写字）
            if (state.hoverAbbr) {
                const rg = rings.find(x => x.abbr === state.hoverAbbr);
                if (rg) {
                    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(0, 0, r * rg.r1, 0, Math.PI * 2); ctx.stroke();

                    if (SHOW_HOVER_HINT) {
                        ctx.fillStyle = '#e6e6e6';
                        ctx.font = Math.round(r * 0.12) + 'px Inter, system-ui, sans-serif';
                        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                        ctx.fillText('goto instructional web', 0, r * (rg.r1 + 0.06));
                    }
                }
            }
            ctx.restore();
        }

        function pickAbbrByPoint(x, y) {
            const dx = x - state.cx, dy = y - state.cy;
            const rr = Math.sqrt(dx * dx + dy * dy);
            for (const rg of rings) {
                if (rr >= state.r * rg.r0 && rr < state.r * rg.r1) return rg.abbr;
            }
            return null;
        }

        return { layout, trigger, update, draw, pickAbbrByPoint, state, rings };
    }

    // ---------- Public API ----------
    const DrumCanvas = {
        _ctx: null, _drum: null, _raf: 0, _lastTs: 0, _bg: '#2f3036',

        /**
         * 初始化
         * @param {Object} opts
         * @param {string} opts.mount  - 容器选择器，如 '#drum-wrap'
         * @param {number} opts.size   - 画布固定 CSS 尺寸(px)
         * @param {string} opts.background - 背景色
         */
        init({ mount = '#drum-wrap', size = 260, background = '#2f3036' } = {}) {
            const host = document.querySelector(mount);
            if (!host) throw new Error(`[DrumCanvas] mount element not found: ${mount}`);

            // 固定尺寸画布
            const cvs = document.createElement('canvas');
            cvs.style.width = size + 'px';
            cvs.style.height = size + 'px';
            cvs.style.display = 'block';
            host.innerHTML = ''; host.appendChild(cvs);

            // Hover 提示（跟随鼠标）
            const tip = document.getElementById('drum-tooltip') || (() => {
                const d = document.createElement('div');
                d.id = 'drum-tooltip';
                d.textContent = 'goto instructional web';
                document.body.appendChild(d);
                return d;
            })();

            // HiDPI
            const dpr = window.devicePixelRatio || 1;
            cvs.width = Math.round(size * dpr);
            cvs.height = Math.round(size * dpr);
            const ctx = cvs.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // 仅 rings
            const config = root.DRUM_RINGS || RING_LAYOUT;
            const drum = createDrum(ctx, config);
            this._ctx = ctx; this._drum = drum; this._bg = background;

            // 布局
            drum.layout(size, size);

            // 事件
            const pt = e => {
                const rect = cvs.getBoundingClientRect();
                return { x: e.clientX - rect.left, y: e.clientY - rect.top };
            };

            cvs.addEventListener('mousemove', e => {
                const { x, y } = pt(e);
                const ab = drum.pickAbbrByPoint(x, y);
                drum.state.hoverAbbr = ab;

                if (ab) {
                    tip.textContent =
                        (ab === 'O') ? 'goto Open/Slap tutorial' :
                            (ab === 'T') ? 'goto Tip/Palm tutorial' :
                                (ab === 'P') ? 'goto Bass tutorial' :
                                    'goto instructional web';
                    tip.style.display = 'block';
                    tip.style.left = (e.clientX + 12) + 'px';
                    tip.style.top = (e.clientY + 12) + 'px';
                } else {
                    tip.style.display = 'none';
                }
            });

            cvs.addEventListener('mouseleave', () => {
                drum.state.hoverAbbr = null;
                tip.style.display = 'none';
            });

            // 点击任意环区：统一跳转
            const DEST_URL = 'https://pulsewave.com/classes-workshops/conga-hand-positions-sounds/';
            cvs.addEventListener('click', e => {
                const { x, y } = pt(e);
                const dx = x - drum.state.cx, dy = y - drum.state.cy;
                const rr = Math.hypot(dx, dy);
                if (rr > drum.state.r * 0.98) return;
                window.open(DEST_URL, '_blank', 'noopener');
                drum.trigger('EDGE', 320);
            });

            // 动画循环
            const loop = (ts) => {
                const dt = this._lastTs ? (ts - this._lastTs) : 16;
                this._lastTs = ts;
                drum.update(dt);
                drum.draw(this._bg);
                this._raf = requestAnimationFrame(loop);
            };
            this._raf = requestAnimationFrame(loop);

            return this;
        },

        trigger(abbr, ms = 320) { this._drum?.trigger(abbr, ms); }
    };

    root.DrumCanvas = DrumCanvas;
    // 不再导出/兜底 DRUM_SECTORS
})(typeof window !== 'undefined' ? window : globalThis);
