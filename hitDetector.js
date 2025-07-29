class HitDetector {
    constructor(rhythmManager) {
        this.manager = rhythmManager;
        this.hitTime = [];
        this.feedback = [];
    }

    registerHit() {
        let now = this.manager.getCurrentTime();
        let target = this.manager.getTargetNotes();
        let minDiff = Infinity;
        let closest = null;

        for (let note of targets) {
            let diff = Math.abs(note.time - now);
            if (diff < minDiff && diff < 0.3) {  //容差300ms
                minDiff = diff;
                closest = note;
            }
        }

        if (closest) {
            this.feedback.push({
                time: now,
                target: closest.time,
                diff: now - closest.time
            });
        }
    }

    displayOverlay() {
        stroke(0, 0, 0, 50);
        for (let f of this.feedback) {
            let x = 100 + (f.target / this.manager.interval) * 100 - (this.manager.getCurrentTime() / this.manager.interval) * 100;
            let offset = f.diff * 200;
            fill(50, 50);
            ellipse(x + offset, 200, 10);
        }
    }
}