// spectrumCollector.js  —  轻量实时频谱 + 特征
class SpectrumCollector {
    constructor(ctx, { fftSize = 2048, smoothing = 0.7, minDb = -100, maxDb = -10 } = {}) {
        this.ctx = ctx;
        this.an = ctx.createAnalyser();
        this.an.fftSize = fftSize;
        this.an.smoothingTimeConstant = smoothing;
        this.an.minDecibels = minDb;
        this.an.maxDecibels = maxDb;
        this.freqBins = new Float32Array(this.an.frequencyBinCount);
        this.timeBuf = new Float32Array(this.an.fftSize);
        this.sampleRate = ctx.sampleRate;
        this.window = this._hann(this.an.fftSize);
        this._lastTs = 0;
    }
    connectFrom(src) { src.connect(this.an); }
    getSpectrum() {
        this.an.getFloatFrequencyData(this.freqBins); // dBFS, 负值
        return this.freqBins;
    }
    // —— 常用频谱特征，供训练用 —— //
    extractFeatures() {
        const mag = this._dbToMag(this.getSpectrum()); // 线性幅值
        const N = mag.length, sr = this.sampleRate, binHz = sr / (this.an.fftSize);
        // 1) 质心
        let num = 0, den = 0;
        for (let k = 0; k < N; k++) { const w = mag[k]; num += k * binHz * w; den += w; }
        const centroid = den > 1e-12 ? num / den : 0;
        // 2) 95% rolloff
        let acc = 0, thr = 0.95 * den, roll = 0;
        for (let k = 0; k < N; k++) { acc += mag[k]; if (acc >= thr) { roll = k * binHz; break; } }
        // 3) 谱通量（与上一帧比较；首次返回0）
        const flux = this._lastMag ? mag.reduce((s, v, i) => s + Math.max(0, v - (this._lastMag[i] || 0)), 0) / N : 0;
        this._lastMag = mag;
        // 4) ZCR（从时域抓一帧）
        this.an.getFloatTimeDomainData(this.timeBuf);
        const zc = this._zeroCross(this.timeBuf) / this.timeBuf.length;
        return { centroid, rolloff: roll, flux, zcr: zc };
    }
    // —— 简易渲染：右半边频谱 —— //
    renderSpectrum(ctx, rect, opts = {}) {
        const { grid = true } = opts;
        const spec = this.getSpectrum(); // dBFS
        const n = spec.length, min = this.an.minDecibels, max = this.an.maxDecibels;
        ctx.save();
        ctx.translate(rect.x, rect.y);
        ctx.fillStyle = '#1e1f23'; ctx.fillRect(0, 0, rect.w, rect.h);
        if (grid) {
            ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
            for (let i = 0; i <= 10; i++) { const x = Math.round(rect.w * i / 10) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.h); ctx.stroke(); }
            for (let i = 0; i <= 8; i++) { const y = Math.round(rect.h * i / 8) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.w, y); ctx.stroke(); }
        }
        ctx.strokeStyle = '#67d4ff'; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = i / (n - 1) * rect.w;
            const y = rect.h * (1 - (spec[i] - min) / (max - min));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
    }
    // —— 左半边：实时 dB 数值 + 红线轨迹（独立时间基） —— //
    renderMeter(ctx, rect) {
        const spec = this.getSpectrum();
        // 粗略等效电平（RMS dB）：在 dBFS 上做 log-avg
        let sum = 0; for (const v of spec) { sum += Math.pow(10, v / 20); }
        const rms = 20 * Math.log10((sum / spec.length) || 1e-6);
        // 滚动缓冲（每 16ms 采样一次）
        const now = performance.now();
        if (!this._meterBuf) this._meterBuf = [];
        if (now - this._lastTs > 16) { this._meterBuf.push(rms); if (this._meterBuf.length > 240) this._meterBuf.shift(); this._lastTs = now; }

        ctx.save();
        ctx.translate(rect.x, rect.y);
        ctx.fillStyle = '#1e1f23'; ctx.fillRect(0, 0, rect.w, rect.h);
        // 网格
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i++) { const y = Math.round(rect.h * i / 10) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.w, y); ctx.stroke(); }
        // 红线轨迹（时间向右滚动，独立于谱面速度）
        ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 2; ctx.beginPath();
        const buf = this._meterBuf, m = buf.length;
        for (let i = 0; i < m; i++) {
            const x = i / (240 - 1) * rect.w;
            const y = rect.h * (1 - (rmsNormalize(buf[i], this.an.minDecibels, this.an.maxDecibels)));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // 右上角显示实时 dB
        ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(rms.toFixed(1) + ' dB', rect.w - 6, 14);
        ctx.restore();

        function rmsNormalize(v, minDb, maxDb) { return Math.min(1, Math.max(0, (v - minDb) / (maxDb - minDb))); }
    }
    // ===== helpers =====
    _hann(N) { const w = new Float32Array(N); for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1))); return w; }
    _dbToMag(db) { const N = db.length, m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = Math.pow(10, db[i] / 20); return m; }
    _zeroCross(x) { let c = 0; for (let i = 1; i < x.length; i++) { if ((x[i - 1] >= 0 && x[i] < 0) || (x[i - 1] < 0 && x[i] >= 0)) c++; } return c; }
}
window.SpectrumCollector = SpectrumCollector;
