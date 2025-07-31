class RhythmManager {
    constructor() {
        this.scoreNotes = [];                  // 灰色谱面音符
        this.bpm = 120;
        this.noteInterval = 60000 / this.bpm / 2; // 8 分音
        this.scrollSpeed = 0.2;                // px / ms
        this.noteY = 200;
        this.judgeLineX = 500;

        this.startTime = null;               // 播放基准
        this.paused = false;
        this.pauseAt = 0;
    }

    /* ---------- 播放控制 ---------- */
    _now() { return this.paused ? this.pauseAt : millis(); }
    getElapsedTime() { return this.startTime === null ? 0 : this._now() - this.startTime; }

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

    setScrollSpeed(v) { this.scrollSpeed = v; }

    /* ---------- 击打判定 ---------- */
    registerHit() {
        const tHit = this.getElapsedTime();

        // 找离点击最近、且尚未判定的音符
        let best = null;
        let bestDiff = Infinity;
        for (const n of this.scoreNotes) {
            if (n.judged) continue;
            const d = Math.abs(n.time - tHit);
            if (d < bestDiff) { bestDiff = d; best = n; }
        }

        // 若找到且在 200 ms 判定范围内 → 绑定结果
        if (best && bestDiff <= 200) {
            best.judged = true;
            best.hitTime = tHit;
            best.result = bestDiff <= 20 ? "Perfect"
                : bestDiff <= 100 ? "Good"
                    : "Miss";            // >100 ms 但仍 ≤200 ms
        }
        // 若没找到匹配音符，则忽略这次点击，不额外生成 Miss
    }

    checkAutoMiss() {
        const tNow = this.getElapsedTime();
        for (const n of this.scoreNotes) {
            if (!n.judged && tNow - n.time > 200) {   // 超时仍未点击
                n.judged = true;
                n.result = "Miss";
            }
        }
    }

    /* ---------- 绘制辅助 ---------- */
    getScrollX(tNote) {
        const tNow = this.getElapsedTime();
        return this.judgeLineX + (tNote - tNow) * this.scrollSpeed;
    }
    getVisibleNotes() {
        const tNow = this.getElapsedTime();
        return this.scoreNotes.filter(n => tNow - n.time < 5000); // 仅渲染近 5 s
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
