// metronome.js — WebAudio 预测调度版（稳定、不“慢一拍”）
class Metronome {
    constructor({ bpm = 120, beatsPerBar = 4 } = {}) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.bpm = bpm; this.beatsPerBar = beatsPerBar;

        this.lookahead = 0.025;        // 25ms 轮询
        this.scheduleAheadTime = 0.12; // 120ms 预调度
        this.nextNoteTime = 0;
        this.currentStep = 0;          // 八分音为步长

        this.enabled = false;
        this._timer = null;
        this.buffers = { weak: null, strong: null };
        this._pending = [];
        this.useInternalGrid = false;
    }

    async preload(weakURL, strongURL) {
        const fetchBuf = async (url) => {
            const res = await fetch(url); const ab = await res.arrayBuffer();
            return await this.ctx.decodeAudioData(ab);
        };
        this.buffers.weak = await fetchBuf(weakURL);
        this.buffers.strong = await fetchBuf(strongURL);
        console.log('Metronome loaded!');
    }

    _schedule(time, strong = false) {
        const src = this.ctx.createBufferSource();
        src.buffer = strong ? this.buffers.strong : this.buffers.weak;
        src.connect(this.ctx.destination);
        src.start(time);
        this._pending.push({ src, at: time });
    }

    _advance() {
        const secPerBeat = 60 / this.bpm;
        this.nextNoteTime += secPerBeat / 2;  // 八分音
        this.currentStep = (this.currentStep + 1) % (this.beatsPerBar * 2);
    }

    _scheduler = () => {
        const ct = this.ctx.currentTime;
        while (this.nextNoteTime < ct + this.scheduleAheadTime) {
            const strong = (this.currentStep % (this.beatsPerBar * 2) === 0);
            this._schedule(this.nextNoteTime, strong);
            this._advance();
        }
    }

    scheduleAt(whenSec, strong = false) {
        if (!this.isLoaded()) return;
        this._schedule(whenSec, strong);
    }


    setBPM(bpm) { this.bpm = Math.max(20, bpm); }

    // 取消“未来还没开始”的点击（用于改速/跳转瞬间）
    flushFuture(cutoffSec = this.ctx.currentTime + 0.001) {
        const keep = [];
        for (const p of this._pending) {
            if (p.at >= cutoffSec) {
                try { p.src.stop(0); p.src.disconnect(); } catch { }
            } else {
                keep.push(p);
            }
        }
        this._pending = keep;
    }

    enable(on) {
        this.enabled = !!on;
        if (this.enabled) {
            this.ctx.resume();
            if (this.useInternalGrid) {
                this.nextNoteTime = this.ctx.currentTime + 0.05;
                this.currentStep = 0;
                if (!this._timer) this._timer = setInterval(this._scheduler, this.lookahead * 1000);
            }
        } else {
            clearInterval(this._timer); this._timer = null;
        }
    }

    reset() {
        this.nextNoteTime = this.ctx.currentTime + 0.05;
        this.currentStep = 0;
        this.flushFuture(0);
        this._pending = [];
    }

    isLoaded() { return !!(this.buffers.weak && this.buffers.strong); }
    onloaded(cb) { if (this.isLoaded()) cb(); /* 简化 */ }
}
if (typeof window !== "undefined") window.Metronome = Metronome;
