class RhythmManager {
    constructor() {
        this.notes = [];
        this.hits = [];
        this.spawnInterval = 120; // 生成音符的帧间隔
        this.noteSpeed = 2;
        this.timer = 0;
        this.pattern = ["open", "open", "slap", "heel", "slap", "open"];
        this.patternIndex = 0;
        this.hitWindow = {
            perfect: 5,
            good: 20
        };
        this.judgementBox = {
            width: 50,
            height: 120,
            get x() { return width / 2 - this.width / 2; },
            get y() { return 180; }
        };
    }

    setSpeed(speed) {
        this.noteSpeed = speed;
    }

    reset() {
        this.notes = [];
        this.hits = [];
        this.timer = 0;
        this.patternIndex = 0;
    }

    update() {
        this.timer++;
        if (this.timer % this.spawnInterval === 0) {
            this.spawnNote();
        }

        for (let note of this.notes) {
            note.x -= this.noteSpeed;
        }

        for (let hit of this.hits) {
            hit.x -= this.noteSpeed;
        }

        // 自动标记miss（音符离开判断框）
        for (let note of this.notes) {
            if (!note.hit && note.x + 10 < this.judgementBox.x) {
                note.hit = true;
                note.result = "Miss";
                this.hits.push({
                    note: note,
                    offset: note.x - (this.judgementBox.x + this.judgementBox.width / 2),
                    result: "Miss"
                });
            }
        }
    }

    spawnNote() {
        const noteType = this.pattern[this.patternIndex];
        this.patternIndex = (this.patternIndex + 1) % this.pattern.length;
        this.notes.push({
            x: width + 20,
            y: this.judgementBox.y + this.judgementBox.height / 2,
            type: noteType,
            hit: false
        });
    }

    registerHit(type) {
        // 寻找最近的未命中的音符
        for (let note of this.notes) {
            if (note.hit || note.type !== type) continue;

            const cx = this.judgementBox.x + this.judgementBox.width / 2;
            const dx = note.x - cx;

            if (Math.abs(dx) <= this.judgementBox.width / 2) {
                let result = "Good";
                if (Math.abs(dx) <= this.hitWindow.perfect) result = "Perfect";
                note.hit = true;
                note.result = result;

                this.hits.push({
                    note: note,
                    offset: dx,
                    result: result
                });
                return result;
            }
        }

        return "Ignored";
    }

    getNotes() {
        return this.notes;
    }

    getHits() {
        return this.hits;
    }

    getBox() {
        return this.judgementBox;
    }

    exportCSV() {
        let lines = ["time,type,result,offset"];
        for (const h of this.hits) {
            lines.push(`${h.note.x},${h.note.type},${h.result},${h.offset}`);
        }
        return lines.join("\n");
    }

    // 允许任意打击类型，只关心 timing 是否对齐
    registerHitAny() {
        for (let note of this.notes) {
            if (note.hit) continue;
            const cx = this.judgementBox.x + this.judgementBox.width / 2;
            const dx = note.x - cx;

            if (Math.abs(dx) <= this.judgementBox.width / 2) {
                let result = "Good";
                if (Math.abs(dx) <= this.hitWindow.perfect) result = "Perfect";
                note.hit = true;
                note.result = result;

                this.hits.push({
                    note: note,
                    offset: dx,
                    result: result
                });
                return result;
            }
        }

        return "Ignored";
    }

    getStats() {
        let hitCount = 0;
        let missCount = 0;
        for (const h of this.hits) {
            if (h.result === "Miss") missCount++;
            else hitCount++;
        }
        return { hit: hitCount, miss: missCount };
    }
}
