class RhythmManager {
    constructor() {
        this.scoreNotes = [];                  // 灰色谱面音符
        this.bpm = 120;
        this.noteInterval = 60000 / this.bpm / 2; // 8 分音
        this.scrollSpeed = 0.2;
        this.speedFactor = 1.0;                // px / ms
        this.noteY = 200;
        this.judgeLineX = 500;

        this.startTime = null;               // 播放基准
        this.paused = false;
        this.pauseAt = 0;
    }

    /* ===== 时间工具 ===== */
    _now() { return this.paused ? this.pauseAt : millis(); }
    getElapsedTime() { return this.startTime === null ? 0 : this._now() - this.startTime; }
    _t() { return this.getElapsedTime() * this.speedFactor; }   // 加速后视觉时间
    setSpeedFactor(newF) {
        const now = this._now();
        const tVisOld = (now - this.startTime) * this.speedFactor;      // 旧视觉时间
        this.speedFactor = newF;
        this.startTime = now - tVisOld / newF;                        // 调整 startTime
    }

    /* ---------- 播放控制 ---------- */
    reset() {
        this.scoreNotes.length = 0;
        this.startTime = millis();
        for (let i = 0; i < 32; i++) {
            this.scoreNotes.push({
                time: i * this.noteInterval, // 理论时间
                judged: false,                 // 是否已有反馈
                result: null,                  // Perfect / Good / Miss
                hitTime: null                   // 实际点击时间（仅 Perfect/Good）
            });
        }
    }

    pause() { if (!this.paused) { this.paused = true; this.pauseAt = millis(); } }
    resume() {
        if (this.paused) {
            this.startTime += millis() - this.pauseAt; // 补偿暂停时长
            this.paused = false;
        }
        if (this.startTime === null) this.reset();     // 第一次点击 Start
    }


    /* ---------- 击打判定 ---------- */
    registerHit() {
        const hitTime = this._t();                      // 取加速后时间

        // 寻找最近的未判定音符
        let best = null, bestDiff = Infinity;
        for (const n of this.scoreNotes) {
            if (n.judged) continue;
            const d = Math.abs(n.time - hitTime);
            if (d < bestDiff) { bestDiff = d; best = n; }
        }

        if (best && bestDiff <= 200) {
            best.judged = true;
            best.hitTime = hitTime;
            best.result = bestDiff <= 20 ? "Perfect" :
                bestDiff <= 100 ? "Good" : "Miss";
        }
        /* 若无匹配或 >200 ms，则忽略点击，不生成额外 Miss */
    }

    checkAutoMiss() {
        const now = this._t();
        for (const n of this.scoreNotes) {
            if (!n.judged && now - n.time > 200) {
                n.judged = true;
                n.result = "Miss";
            }
        }
    }

    /* ---------- 绘制辅助 ---------- */
    getScrollX(noteTime) { return this.judgeLineX + (noteTime - this._t()) * this.scrollSpeed; }
    getVisibleNotes() {
        const now = this._t();
        return this.scoreNotes.filter(n => now - n.time < 5000);  // 渲染最近 5 s
    }

    /* ---------- 统计 / 导出 ---------- */
    getStats() {
        let hit = 0, miss = 0;
        for (const n of this.scoreNotes) {
            if (!n.judged) continue;
            if (n.result === "Perfect" || n.result === "Good") hit++;
            else miss++;
        }
        return { hit, miss };
    }
    exportCSV() {
        const rows = ["time_ms,result"];
        for (const n of this.scoreNotes)
            rows.push(`${n.time},${n.result ?? "Unjudged"}`);
        return rows.join("\n");
    }
}
