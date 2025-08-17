// meter-processor.js
// AudioWorklet：计算 A-weight 链路之后的 FAST(125ms) RMS 与 峰值保持，并把 dB 发送给主线程。

class MeterProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const p = (options && options.processorOptions) || {};
        // FAST 时间常数（IEC 61672：125ms）
        this.tauFast = p.timeConstantFast || 0.125;
        // 校准偏移（用 1 kHz 参考音做一次校准后可以在主线程传进来）
        this.offsetDb = p.offsetDb || 0;

        this.alphaFast = null;   // 按块时长计算
        this.rms2Fast = 0;       // 对“平方”做 EMA
        this.peakHold = 0;       // 峰值保持
        this.decay = 0.95;       // 峰值衰减系数（每块）

        this.port.onmessage = (e) => {
            if (e.data && e.data.type === 'setOffset') {
                this.offsetDb = +e.data.value || 0;
            }
        };
    }

    process(inputs/*, outputs, parameters */) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch) return true;

        // 初始化平滑系数（与块长相关）
        if (!this.alphaFast) {
            const dt = ch.length / sampleRate;            // 当前块时长（秒）
            this.alphaFast = Math.exp(-dt / this.tauFast);
        }

        // 本块 RMS^2 与 峰值
        let sum = 0, peak = 0;
        for (let i = 0; i < ch.length; i++) {
            const x = ch[i];
            const ax = Math.abs(x);
            sum += x * x;
            if (ax > peak) peak = ax;
        }
        const rms2Block = sum / ch.length;

        // FAST 平滑（平方域 EMA）
        this.rms2Fast = this.rms2Fast * this.alphaFast + rms2Block * (1 - this.alphaFast);
        const rmsFast = Math.sqrt(this.rms2Fast);

        // 峰值保持 + 衰减
        this.peakHold = Math.max(peak, this.peakHold * this.decay);

        // 转 dBFS（附校准偏移）
        const fastDb = 20 * Math.log10(rmsFast + 1e-12) + this.offsetDb;
        const peakDb = 20 * Math.log10(this.peakHold + 1e-12) + this.offsetDb;

        // 发给主线程
        this.port.postMessage({ fastDb, peakDb });
        return true; // 继续处理
    }
}

registerProcessor('meter-processor', MeterProcessor);
