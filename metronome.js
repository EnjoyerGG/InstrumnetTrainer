// metronome.js
class Metronome {
    constructor(getBPM) {
        this.getBPM = getBPM;
        this.lastTick = millis();
    }
    update() {
        const bpm = this.getBPM();
        const interval = 60000 / bpm;
        if (millis() - this.lastTick >= interval) {
            this.lastTick += interval;
            playMetronomeSound(); // 节拍器音效
        }
    }
}
