// ---- 常量 ----
const MISS_WINDOW = 140;     // ms：超出即 Miss
const EARLY_WINDOW = 25;
const PERFECT_WIN = 12;
const GOOD_WINDOW = 45;
//const WARMUP_MS = 500;
const INITIAL_OFFSET = 100; // 让谱面整体右移100ms
const TAIL_GAP_EIGHTHS = 2;

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
        this.feedbackStates = [];
        this._loopIdx = 0;
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
                abbr: n.abbr || n.type[0].toUpperCase(),
                accent: (n.accent !== undefined ? n.accent : 0) | 0
            });
        }
        // 计算总时长
        const N = this.scoreNotes.length;
        this.totalDuration = N > 0 ? (this.scoreNotes[N - 1].time + this.noteInterval * TAIL_GAP_EIGHTHS) : 0;
        this.feedbackStates = this._emptyFeedback();
    }

    _emptyFeedback() {
        return this.scoreNotes.map(() => ({
            judged: false, result: null, hitTime: null, fadeTimer: 0
        }));
    }

    /* ---------- 播放控制 ---------- */
    reset() {
        this.startTime = millis();
        this.feedbackStates = this._emptyFeedback();
        this._loopIdx = 0;
    }

    pause() {
        if (!this.paused) {
            this.paused = true; this.pauseAt = millis();
        }
    }

    resume() {
        if (this.startTime === null) { this.reset(); return; }
        if (this.paused) {
            this.startTime += millis() - this.pauseAt;
            this.paused = false;
        }
    }

    /* ---------- 判定 ---------- */
    registerHit(kind) {
        if (!this.scoreNotes.length || !this.totalDuration) return;
        // 当前循环内时间
        const hitTime = this._t() % this.totalDuration;

        const norm = (k) => {
            if (!k) return null;
            const s = String(k).toLowerCase();
            if (s === 'o' || s === 'open') return 'O';
            if (s === 'p' || s === 'palm' || s === 'bass') return 'P';
            if (s === 't' || s === 'tip' || s === 'finger') return 'T';
            if (s === 's' || s === 'slap') return 'S';
            return null;
        };
        const want = norm(kind);

        let bestDiff = Infinity;
        let bestIdx = -1;

        for (let i = 0; i < this.scoreNotes.length; i++) {
            const n = this.scoreNotes[i];
            const state = this.feedbackStates[i];
            if (state.judged) continue;
            if (want && n.abbr !== want) continue;

            const dsigned = n.time - hitTime;
            //只允许在[-MISS_WINDOW, EARLY_WINDOW]内判定
            if (dsigned < -MISS_WINDOW || dsigned > EARLY_WINDOW) continue;
            const dabs = Math.abs(dsigned);
            if (dabs < bestDiff || (dabs === bestDiff && dsigned <= 0)) {
                bestDiff = dabs;
                bestIdx = i;
            }
        }

        if (bestIdx < 0) {
            return;
        }

        const st = this.feedbackStates[bestIdx];
        st.judged = true;
        st.hitTime = hitTime;
        if (bestDiff <= PERFECT_WIN) {
            st.result = "Perfect";
        } else if (bestDiff <= GOOD_WINDOW) {
            st.result = "Good";
        } else if (bestDiff <= MISS_WINDOW) {
            st.result = "Miss";
        } else {
            // 超过 MISS_WINDOW：建议也直接判 Miss，
            // 否则需要等到 checkAutoMiss() 扫描后才显示
            st.result = "Miss";
        }
        st.fadeTimer = 1000;

        // 添加这行来更新状态跟踪器
        if (typeof updateStatusTracker === 'function') {
            updateStatusTracker(st.result);
        }
    }

    setBPM(bpm) {
        this.bpm = bpm;
        this.noteInterval = 60000 / bpm / 2;
    }

    checkAutoMiss() {
        const now = this._t() % this.totalDuration;
        const deltaMs = deltaTime; // p5.js 提供的帧间时间

        for (let i = 0; i < this.scoreNotes.length; i++) {
            const n = this.scoreNotes[i];
            const state = this.feedbackStates[i];

            // 批量更新 fadeTimer
            if (state.judged && state.fadeTimer > 0) {
                state.fadeTimer = Math.max(0, state.fadeTimer - deltaMs);
            }

            // 自动Miss检查
            if (!state.judged && now - n.time > MISS_WINDOW && now - n.time < this.noteInterval) {
                state.judged = true;
                state.result = "Miss";
                state.fadeTimer = 1000;
            }
        }
    }

    /* ---------- 绘制辅助 ---------- */
    getScrollX(tNote) {
        return this.judgeLineX + (tNote - (this._t() % this.totalDuration)) * this.scrollSpeed;
    }

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
        if (!this.totalDuration) return;
        const idx = Math.floor(this._t() / this.totalDuration);
        if (idx !== this._loopIdx) {
            this._loopIdx = idx;
            this.feedbackStates = this._emptyFeedback();
            if (typeof resetStatusTracker === 'function') {
                resetStatusTracker();
            }
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
