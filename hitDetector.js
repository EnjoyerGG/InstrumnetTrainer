// hitDetector.js  —— 只需替换这一文件

class HitDetector {
    constructor(rhythmManager, centerX = 100) {
        this.rm = rhythmManager;   // 引用 RhythmManager
        this.cx = centerX;         // 判定线 X
        this.hw = 15;              // 判定半宽(px) ——与你 sketch 里的框宽一致
        this.epsPerf = 5;               // Perfect ≤ 5px
        this.hits = [];              // { note, offset, label, color }
        this.hitCnt = 0;
        this.missCnt = 0;
    }

    /** 供鼠标/键盘/ML 调用的击打入口 */
    registerHit(inputType = 'mouse') {
        if (!this.rm.loaded) return;

        // 1. 找最近、类型匹配、且未处理过的音符
        let best = null, bestDist = Infinity;
        for (const n of this.rm.notes) {
            if (!n._done &&
                (inputType === 'mouse' || n.type === inputType)) {
                const d = Math.abs(n.x - this.cx);
                if (d < bestDist) { bestDist = d; best = n; }
            }
        }
        // 2. 若最近音符不在判定框内 => 忽略击打
        if (!best || bestDist > this.hw) return;

        // 3. 评定等级
        let label = 'Good', color = '#008000';
        if (bestDist < this.epsPerf) { label = 'Perfect'; color = '#800080'; }
        this.hitCnt++;

        // 4. 记录黑点 —— 保存 note 引用 + 相对偏差 offset
        best._done = true;
        const offset = best.x - this.cx;          // 当下偏差(可正可负)
        this.hits.push({ note: best, offset, label, color });
    }

    /** 每帧调用：判定漏打 */
    checkMisses() {
        if (!this.rm.loaded) return;

        for (const n of this.rm.notes) {
            if (!n._done && n.x < this.cx - this.hw) {
                n._done = true;
                this.missCnt++;
                const offset = n.x - this.cx;
                this.hits.push({ note: n, offset, label: 'Miss', color: '#FF0000' });
            }
        }
    }

    /** 在 sketch.draw() 里调用绘制 */
    displayOverlay() {
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(16);
        for (const h of this.hits) {
            const x = h.note.x - (this.cx - h.offset); // note 当前位置 + 初始偏移
            const y = 180;
            fill('black');
            ellipse(x, y, 10);
            fill(h.color);
            text(h.label, x, y - 30);
        }
    }

    /** 统计 & 重置 */
    getStats() { return { hit: this.hitCnt, miss: this.missCnt }; }

    reset() {
        this.hits.length = 0;
        this.hitCnt = this.missCnt = 0;
        this.rm.notes.forEach(n => delete n._done);
    }
}
