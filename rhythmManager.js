// ---- 常量 ----
const MISS_WINDOW = 120;     // ms：超出即 Miss
const PERFECT_WIN = 20;
const GOOD_WINDOW = 100;

class RhythmManager {
    constructor() {
        this.bpm = 120;
        this.noteInterval = 60000 / this.bpm / 2;    // 8分音符
        this.scrollSpeed = 0.50;                    // px / ms
        this.speedFactor = 1.00;                    // 实时倍率
        this.noteY = 150;
        this.judgeLineX = 500;

        this.resetState();
    }

    /* ---------- 内部状态 ---------- */
    resetState() {
        this.scoreNotes = [];
        this.startTime = null;
        this.paused = false;
        this.pauseAt = 0;
    }

    /* ---------- 时间工具 ---------- */
    _now() { return this.paused ? this.pauseAt : millis(); }
    getElapsedTime() { return this.startTime === null ? 0 : this._now() - this.startTime; }
    _t() { return this.getElapsedTime() * this.speedFactor; }

    setSpeedFactor(f) {
        if (this.startTime === null) { this.speedFactor = f; return; }
        const now = this._now();
        const tVisOld = (now - this.startTime) * this.speedFactor;
        this.speedFactor = f;
        this.startTime = now - tVisOld / f;
    }

    /* ---------- 载入谱面 ---------- */
    initChart(arr) {
        this.resetState();
        for (const n of arr) {
            const tMs = n.time * this.noteInterval;
            this.scoreNotes.push({
                time: tMs,
                type: n.type,
                abbr: n.abbr || n.type[0].toUpperCase(),
                judged: false, result: null, hitTime: null
            });
        }
    }

    /* ---------- 播放控制 ---------- */
    reset() {
        this.startTime = millis();
        for (const n of this.scoreNotes) {
            n.judged = false;
            n.result = null;
            n.hitTime = null;
        }
    }
    pause() { if (!this.paused) { this.paused = true; this.pauseAt = millis(); } }
    resume() {
        if (this.startTime === null) { this.reset(); return; }
        if (this.paused) {
            this.startTime += millis() - this.pauseAt;
            this.paused = false;
        }
    }

    /* ---------- 判定 ---------- */
    registerHit() {
        const hitTime = this._t();
        let best = null, bestDiff = Infinity;
        for (const n of this.scoreNotes) {
            if (n.judged) continue;
            const d = Math.abs(n.time - hitTime);
            if (d < bestDiff) { bestDiff = d; best = n; }
        }
        if (best && bestDiff <= MISS_WINDOW) {
            best.judged = true; best.hitTime = hitTime;
            best.result = bestDiff <= PERFECT_WIN ? "Perfect"
                : bestDiff <= GOOD_WINDOW ? "Good"
                    : "Miss";
        }
    }
    checkAutoMiss() {
        const now = this._t();
        for (const n of this.scoreNotes) {
            if (!n.judged && now - n.time > MISS_WINDOW) {
                n.judged = true; n.result = "Miss";
            }
        }
    }

    /* ---------- 绘制辅助 ---------- */
    getScrollX(tNote) { return this.judgeLineX + (tNote - this._t()) * this.scrollSpeed; }
    getVisibleNotes() { const now = this._t(); return this.scoreNotes.filter(n => now - n.time < 5000); }

    /* ---------- 统计 ---------- */
    getStats() {
        let hit = 0, miss = 0;
        for (const n of this.scoreNotes) {
            if (!n.judged) continue;
            if (n.result === "Perfect" || n.result === "Good") hit++; else miss++;
        }
        return { hit, miss };
    }
    exportCSV() {
        const rows = ["time_ms,result"];
        for (const n of this.scoreNotes) rows.push(`${n.time},${n.result ?? "Unjudged"}`);
        return rows.join("\n");
    }
}
