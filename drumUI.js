function deg2rad(d) {
    return d * Math.PI / 180;
}

const DRUM_SECTORS = [
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
    constructor(x, y, r) {
        this.x = x;
        this.y = y;
        this.r = r;
        this.flash = {};
        this.hoverAbbr = null;
    }

    trigger(abbr, ms = 320) {
        this.flash[abbr] = { t: ms };
    }

    update(dt) {
        for (const k in this.flash) {
            this.flash[k].t -= dt;
            if (this.flash[k].t <= 0) {
                delete this.flash[k];
            }
        }
    }

    draw() {
        push();
        translate(this.x, this.y);
        noStroke();
        fill(36, 38, 43);
        circle(0, 0, this.r * 2);
        fill(20, 20, 23, 140);
        circle(0, 0, this.r * 1.85);

        DRUM_SECTORS.forEach(sec => {
            const active = !!this.flash[sec.abbr];
            const base = color(sec.color);
            const a = active ? 220 : 90;
            fill(red(base), green(base), blue(base), a);
            arc(0, 0, this.r * 1.75, this.r * 1.75, deg2rad(sec.start), deg2rad(sec.end), PIE);

            const mid = deg2rad((sec.start + sec.end) / 2);
            const tx = Math.cos(mid) * this.r * 0.75;
            const ty = Math.sin(mid) * this.r * 0.75;
            fill(240);
            textAlign(CENTER, CENTER);
            textSize(13);
            text(sec.label, tx, ty);
        });

        noFill();
        stroke('#9b87f5');
        strokeWeight(2);
        circle(0, 0, this.r * 1.85);

        if (this.isMouseInside()) {
            const ab = this.pickAbbrByMouse();
            this.hoverAbbr = ab;
            if (ab) {
                stroke(255, 255, 255, 180);
                strokeWeight(3);
                const sec = DRUM_SECTORS.find(s => s.abbr === ab);
                arc(0, 0, this.r * 1.9, this.r * 1.9, deg2rad(sec.start), deg2rad(sec.end));
                noStroke();
                fill(230);
                textSize(12);
                textAlign(CENTER, TOP);
                text('click to check the instructional video', 0, this.r + 14);
            }
        } else {
            this.hoverAbbr = null;
        }
        pop();
    }

    isMouseInside() {
        const dx = mouseX - this.x;
        const dy = mouseY - this.y;
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang < 0) {
            ang += 360;
        }
        const hit = DRUM_SECTORS.find(s => ang >= ((s.start + 360) % 360) && ang < ((s.end + 360) % 360));
        return hit?.abbr || null;
    }
}

if (typeof window !== 'undefined') {
    window.DrumUI = DrumUI;
}