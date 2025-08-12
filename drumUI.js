// ui/drumUI.js
(function (root) {
    function deg2rad(d) { return d * Math.PI / 180; }
    function normDeg(a) { a = a % 360; return a < 0 ? a + 360 : a; }
    function inArc(ang, start, end) {
        ang = normDeg(ang); start = normDeg(start); end = normDeg(end);
        return (start <= end) ? (ang >= start && ang < end) : (ang >= start || ang < end);
    }

    // 如果你已有 DRUM_SECTORS，就删掉这段默认值
    const DRUM_SECTORS = root.DRUM_SECTORS || [
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
    ];

    class DrumUI {
        constructor(x = 0, y = 0, r = 60) {
            this.x = x; this.y = y; this.r = r;
            this.flash = {};        // {abbr: {t:ms}}
            this.hoverAbbr = null;
        }

        /** 让鼓面根据画布尺寸自动适配（不越界） */
        fitToCanvas(w, h, margin = 10) {
            // 半径不超过画布高度一半 & 不超过画布宽度的 22%
            const rMaxH = Math.max(24, (h - 2 * margin) / 2);
            const rMaxW = Math.max(24, w * 0.22);
            this.r = Math.min(160, rMaxH, rMaxW);
            this.x = w - this.r - margin;
            this.y = h / 2;
            return this;
        }

        trigger(abbr, ms = 320) { this.flash[abbr] = { t: ms }; }

        update(dt) {
            for (const k in this.flash) {
                this.flash[k].t -= dt;
                if (this.flash[k].t <= 0) delete this.flash[k];
            }
        }

        draw() {
            push(); translate(this.x, this.y);

            // 背景
            noStroke(); fill(36, 38, 43); circle(0, 0, this.r * 2);
            fill(20, 20, 23, 140); circle(0, 0, this.r * 1.85);

            // 扇区
            DRUM_SECTORS.forEach(sec => {
                const active = !!this.flash[sec.abbr];
                const base = color(sec.color);
                const a = active ? 220 : 90;
                fill(red(base), green(base), blue(base), a);
                arc(0, 0, this.r * 1.75, this.r * 1.75,
                    deg2rad(sec.start), deg2rad(sec.end), PIE);

                const mid = deg2rad((sec.start + sec.end) / 2);
                const tx = Math.cos(mid) * this.r * 0.75;
                const ty = Math.sin(mid) * this.r * 0.75;
                fill(240); textAlign(CENTER, CENTER); textSize(13);
                text(sec.label, tx, ty);
            });

            // 外圈
            noFill(); stroke('#9b87f5'); strokeWeight(2);
            circle(0, 0, this.r * 1.85);

            // Hover 高亮
            if (this.isMouseInside()) {
                const ab = this.pickAbbrByMouse();   // ← 现在一定存在
                this.hoverAbbr = ab;
                if (ab) {
                    const sec = DRUM_SECTORS.find(s => s.abbr === ab);
                    stroke(255, 255, 255, 180); strokeWeight(3);
                    arc(0, 0, this.r * 1.9, this.r * 1.9,
                        deg2rad(sec.start), deg2rad(sec.end));
                    noStroke(); fill(230); textSize(12); textAlign(CENTER, TOP);
                    text('点击查看教学视频', 0, this.r + 14);
                }
            } else {
                this.hoverAbbr = null;
            }

            pop();
        }

        isMouseInside() {
            const dx = mouseX - this.x, dy = mouseY - this.y;
            return (dx * dx + dy * dy) <= (this.r * this.r);
        }

        /** 这就是你缺的那个方法：按鼠标角度挑扇区（支持跨 0° 的扇区） */
        pickAbbrByMouse() {
            const dx = mouseX - this.x, dy = mouseY - this.y;
            let ang = Math.atan2(dy, dx) * 180 / Math.PI;
            if (ang < 0) ang += 360;
            const hit = DRUM_SECTORS.find(s => inArc(ang, s.start, s.end));
            return hit ? hit.abbr : null;
        }
    }

    root.DrumUI = DrumUI;
    root.DRUM_SECTORS = DRUM_SECTORS;
})(typeof window !== 'undefined' ? window : globalThis);




