// metronome.js
class Metronome {
    constructor({ bpm = 120, beatsPerBar = 4 } = {}) {
        this.bpm = bpm;
        this.beatsPerBar = beatsPerBar;
        this.lastBeat = -1;
        this.enabled = true;
        this.strongTick = null;
        this.weakTick = null;
        this._loaded = false;
        this._cbList = [];
    }

    preload(strongTickPath, weakTickPath) {
        this.strongTick = loadSound(strongTickPath, this._onloaded.bind(this));
        this.weakTick = loadSound(weakTickPath, this._onloaded.bind(this));
    }

    _onloaded() {
        if (this.strongTick.isLoaded() && this.weakTick.isLoaded()) {
            this._loaded = true;
            this._cbList.forEach(cb => cb());
            this.cbList = [];
        }
    }

    onloaded(cb) {
        if (this._loaded) cb();
        else this._cbList.push(cb);
    }

    setBPM(bpm) { this.bpm = bpm; }
    setBeatsPerBar(n) { this.beatsPerBar = n; }
    enable(flag) { this.enabled = flag; }
    reset() { this.lastBeat = -1; }

    // 传入全局时间（ms），自动判断是否播放tick
    tick(currentTimeMs) {
        if (!this.enabled || !this._loaded) return;

        const noteInterval = 60000 / this.bpm;
        const curBeat = Math.floor(currentTimeMs / noteInterval);

        if (curBeat !== this.lastBeat) {
            const barIdx = curBeat % this.beatsPerBar;
            if (barIdx === 0) this.strongTick.play();
            else this.weakTick.play();
            this.lastBeat = curBeat;
        }
    }
}

// 如果用 script 引入，也支持 window.Metronome = Metronome;
if (typeof window !== "undefined") window.Metronome = Metronome;