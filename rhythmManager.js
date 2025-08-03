// ---- 常量 ----
const MISS_WINDOW = 80;     // ms：超出即 Miss
const PERFECT_WIN = 10;
const GOOD_WINDOW = 40;
const WARMUP_MS = 500;
const INITIAL_OFFSET = 100; // 让谱面整体右移400ms

class RhythmManager {
    constructor() {
        this.bpm = 120;
        this.noteInterval = 60000 / this.bpm / 2;    // 8分音符
        this.scrollSpeed = 0.5;                    // px / ms
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
        this.totalDuration = 0;
        // 用于反馈：每轮判定表
        this.feedbackStates = [];
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
            const tMs = n.time * this.noteInterval + INITIAL_OFFSET;
            this.scoreNotes.push({
                time: tMs,
                type: n.type,
                abbr: n.abbr || n.type[0].toUpperCase()
            });
        }
        // 计算总时长
        const N = this.scoreNotes.length;
        this.totalDuration = N > 0 ? (this.scoreNotes[N - 1].time + this.noteInterval) : 0;

        // 初始化反馈状态（每轮一份）
        this.feedbackStates = this._emptyFeedback();
    }

    _emptyFeedback() {
        return this.scoreNotes.map(() => ({
            judged: false, result: null, hitTime: null
        }));
    }

    /* ---------- 播放控制 ---------- */
    reset() {
        this.startTime = millis();
        this.feedbackStates = this._emptyFeedback();
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
        if (!this.scoreNotes.length) return;
        // 当前循环内时间
        const hitTime = this._t() % this.totalDuration;
        let best = null, bestDiff = Infinity, bestIdx = -1;
        for (let i = 0; i < this.scoreNotes.length; i++) {
            const n = this.scoreNotes[i];
            const state = this.feedbackStates[i];
            if (state.judged) continue;
            const d = Math.abs(n.time - hitTime);
            if (d < bestDiff) { bestDiff = d; best = state; bestIdx = i; }
        }
        if (best && bestDiff <= MISS_WINDOW) {
            best.judged = true; best.hitTime = hitTime;
            best.result = bestDiff <= PERFECT_WIN ? "Perfect"
                : bestDiff <= GOOD_WINDOW ? "Good"
                    : "Miss";
        }
    }

    checkAutoMiss() {
        // 只判定当前可见的本轮音符
        const now = this._t() % this.totalDuration;
        for (let i = 0; i < this.scoreNotes.length; i++) {
            const n = this.scoreNotes[i];
            const state = this.feedbackStates[i];
            if (!state.judged && now - n.time > MISS_WINDOW && now - n.time < this.noteInterval) {
                state.judged = true; state.result = "Miss";
            }
        }
    }

    /* ---------- 绘制辅助 ---------- */
    getScrollX(tNote) { return this.judgeLineX + (tNote - (this._t() % this.totalDuration)) * this.scrollSpeed; }
    getVisibleNotes() {
        // 绘制3轮，主轮+前后轮
        const now = this._t() % this.totalDuration;
        const res = [];
        const N = this.scoreNotes.length;
        const offsetArr = [-1, 0, 1];
        for (let offset of offsetArr) {
            for (let i = 0; i < N; i++) {
                const n = this.scoreNotes[i];
                const t = n.time + offset * this.totalDuration;
                // 可视区音符
                if (now - t < 5000 && t - now < 1000 * 60) {
                    res.push({ ...n, _feedbackIdx: i, _isMainLoop: offset === 0, _displayTime: t });
                }
            }
        }
        return res;
    }

    /* ---------- 统计 ---------- */
    getStats() {
        let hit = 0, miss = 0;
        for (const n of this.feedbackStates) {
            if (!n.judged) continue;
            if (n.result === "Perfect" || n.result === "Good") hit++; else miss++;
        }
        return { hit, miss };
    }

    // 无限循环，不需要 reset feedback，每圈自动清零
    checkLoopAndRestart() {
        // 到新一圈就清理 feedback 状态
        const elapsed = this._t();
        if (this.totalDuration && (elapsed % this.totalDuration) < 20) {
            // 新一轮
            this.feedbackStates = this._emptyFeedback();
        }
    }

    exportCSV() {
        const rows = ["time_ms,result"];
        for (let i = 0; i < this.scoreNotes.length; i++) {
            const n = this.scoreNotes[i];
            const state = this.feedbackStates[i];
            rows.push(`${n.time},${state.result ?? "Unjudged"}`);
        }
        return rows.join("\n");
    }
}
