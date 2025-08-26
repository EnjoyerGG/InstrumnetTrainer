// drumTrigger.js - 麦克风打击检测模块
// 通过分析麦克风输入的音频信号来检测鼓击，并触发游戏判定逻辑
// 使用多种检测方法：音量突增、高频能量、变化率等

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const DrumTrigger = {
        // ===== 配置参数 =====
        _mic: null,
        _fft: null,
        _isEnabled: false,
        _isDebug: false,

        // 音量检测参数
        _volumeThreshold: 0.15,        // 音量阈值 (0-1)
        _volumeChangeThreshold: 0.08,   // 音量变化率阈值
        _volumeHistory: [],
        _volumeHistorySize: 5,

        // 高频检测参数 (检测敲击的特征频率)
        _highFreqStart: 2000,          // 高频开始频率 (Hz)
        _highFreqEnd: 8000,            // 高频结束频率 (Hz)
        _highFreqThreshold: 0.03,      // 高频能量阈值
        _highFreqHistory: [],
        _highFreqHistorySize: 3,

        // 防抖参数
        _debounceMs: 120,              // 防抖时间 (毫秒)
        _lastTriggerTime: 0,

        // 统计与调试
        _triggerCount: 0,
        _lastTriggerReason: '',

        // 回调函数
        _onTrigger: null,              // 检测到打击时的回调

        // ===== 初始化 =====
        init({ mic, onTrigger, debug = false } = {}) {
            this._mic = mic;
            this._onTrigger = onTrigger;
            this._isDebug = debug;

            if (mic) {
                // 创建 FFT 分析器用于频谱分析
                this._fft = new p5.FFT(0.8, 1024);
                this._fft.setInput(mic);
            }

            // 初始化历史记录
            this._volumeHistory = new Array(this._volumeHistorySize).fill(0);
            this._highFreqHistory = new Array(this._highFreqHistorySize).fill(0);

            if (this._isDebug) {
                console.log('DrumTrigger initialized');
            }

            return this;
        },

        // ===== 控制方法 =====
        enable(enabled = true) {
            this._isEnabled = enabled;
            if (this._isDebug) {
                console.log(`DrumTrigger ${enabled ? 'enabled' : 'disabled'}`);
            }
        },

        setDebug(debug = true) {
            this._isDebug = debug;
        },

        // ===== 参数调节 =====
        setVolumeThreshold(threshold) {
            this._volumeThreshold = clamp(threshold, 0, 1);
            if (this._isDebug) {
                console.log(`Volume threshold set to: ${this._volumeThreshold}`);
            }
        },

        setHighFreqThreshold(threshold) {
            this._highFreqThreshold = clamp(threshold, 0, 0.5);
            if (this._isDebug) {
                console.log(`High freq threshold set to: ${this._highFreqThreshold}`);
            }
        },

        setDebounceTime(ms) {
            this._debounceMs = Math.max(50, ms);
        },

        setSensitivity(level) {
            // 便捷方法：设置整体灵敏度 (0-1, 0.5为默认)
            const factor = clamp(level, 0, 1);
            this._volumeThreshold = 0.15 * (2 - factor);          // 灵敏度高 -> 阈值低
            this._volumeChangeThreshold = 0.08 * (2 - factor);
            this._highFreqThreshold = 0.03 * (2 - factor);

            if (this._isDebug) {
                console.log(`Sensitivity set to: ${level} (vol: ${this._volumeThreshold.toFixed(3)}, change: ${this._volumeChangeThreshold.toFixed(3)}, freq: ${this._highFreqThreshold.toFixed(3)})`);
            }
        },

        // ===== 核心检测逻辑 =====
        update() {
            if (!this._isEnabled || !this._mic || !this._fft) return;

            // 防抖检查
            const now = millis();
            if (now - this._lastTriggerTime < this._debounceMs) return;

            // 获取当前音频数据
            const currentVolume = this._getCurrentVolume();
            const currentHighFreq = this._getCurrentHighFreqEnergy();

            // 更新历史记录
            this._updateHistory(currentVolume, currentHighFreq);

            // 多重检测方法
            const triggers = {
                volume: this._checkVolumeThreshold(currentVolume),
                change: this._checkVolumeChange(currentVolume),
                highFreq: this._checkHighFreqSpike(currentHighFreq),
            };

            // 判断是否触发 (任一方法检测到即可)
            let shouldTrigger = false;
            let reason = [];

            if (triggers.volume) { shouldTrigger = true; reason.push('VOL'); }
            if (triggers.change) { shouldTrigger = true; reason.push('CHANGE'); }
            if (triggers.highFreq) { shouldTrigger = true; reason.push('FREQ'); }

            if (shouldTrigger) {
                this._triggerHit(reason.join('+'));
            }

            // 调试输出
            if (this._isDebug && frameCount % 30 === 0) { // 每半秒输出一次
                console.log(`Vol: ${currentVolume.toFixed(3)}, HighFreq: ${currentHighFreq.toFixed(4)}, Triggers: ${Object.values(triggers).some(t => t) ? 'YES' : 'NO'}`);
            }
        },

        // ===== 内部检测方法 =====
        _getCurrentVolume() {
            // 使用 RMS 音量计算
            const waveform = this._fft.waveform(256);
            let rms = 0;
            for (let i = 0; i < waveform.length; i++) {
                rms += waveform[i] * waveform[i];
            }
            return Math.sqrt(rms / waveform.length);
        },

        _getCurrentHighFreqEnergy() {
            // 分析高频段的能量
            const spectrum = this._fft.analyze();
            const nyquist = 22050; // p5.js 默认采样率的一半
            const binSize = nyquist / spectrum.length;

            const startBin = Math.floor(this._highFreqStart / binSize);
            const endBin = Math.floor(this._highFreqEnd / binSize);

            let energy = 0;
            let count = 0;
            for (let i = startBin; i < endBin && i < spectrum.length; i++) {
                energy += spectrum[i] / 255; // 归一化到 0-1
                count++;
            }

            return count > 0 ? energy / count : 0;
        },

        _updateHistory(volume, highFreq) {
            // 滚动更新历史记录
            this._volumeHistory.push(volume);
            if (this._volumeHistory.length > this._volumeHistorySize) {
                this._volumeHistory.shift();
            }

            this._highFreqHistory.push(highFreq);
            if (this._highFreqHistory.length > this._highFreqHistorySize) {
                this._highFreqHistory.shift();
            }
        },

        _checkVolumeThreshold(volume) {
            // 简单音量阈值检测
            return volume > this._volumeThreshold;
        },

        _checkVolumeChange(volume) {
            // 音量变化率检测
            if (this._volumeHistory.length < 2) return false;

            const prevVolume = this._volumeHistory[this._volumeHistory.length - 2];
            const change = volume - prevVolume;

            return change > this._volumeChangeThreshold;
        },

        _checkHighFreqSpike(highFreq) {
            // 高频能量突增检测
            if (this._highFreqHistory.length < 2) return false;

            const avgPrevious = this._highFreqHistory.slice(0, -1).reduce((a, b) => a + b, 0) / (this._highFreqHistory.length - 1);
            const spike = highFreq - avgPrevious;

            return spike > this._highFreqThreshold;
        },

        _triggerHit(reason) {
            this._lastTriggerTime = millis();
            this._triggerCount++;
            this._lastTriggerReason = reason;

            if (this._isDebug) {
                console.log(`🥁 Hit detected! Reason: ${reason}, Count: ${this._triggerCount}`);
            }

            // 调用回调函数
            if (this._onTrigger) {
                this._onTrigger(reason);
            }
        },

        // ===== 调试与状态查询 =====
        getStats() {
            return {
                triggerCount: this._triggerCount,
                lastTriggerReason: this._lastTriggerReason,
                isEnabled: this._isEnabled,
                volumeThreshold: this._volumeThreshold,
                highFreqThreshold: this._highFreqThreshold,
                debounceMs: this._debounceMs
            };
        },

        resetStats() {
            this._triggerCount = 0;
            this._lastTriggerReason = '';
        },

        // ===== 实时调节界面（可选） =====
        renderDebugPanel(ctx, x, y, w, h) {
            if (!this._isDebug || !ctx) return;

            // 简单的调试信息面板
            ctx.save();

            // 背景
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.strokeRect(x, y, w, h);

            // 文字信息
            ctx.fillStyle = 'white';
            ctx.font = '12px monospace';
            ctx.textAlign = 'left';

            const lines = [
                `Drum Trigger: ${this._isEnabled ? 'ON' : 'OFF'}`,
                `Count: ${this._triggerCount}`,
                `Last: ${this._lastTriggerReason}`,
                `Vol Thr: ${this._volumeThreshold.toFixed(3)}`,
                `Freq Thr: ${this._highFreqThreshold.toFixed(4)}`,
                `Debounce: ${this._debounceMs}ms`
            ];

            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], x + 8, y + 16 + i * 14);
            }

            ctx.restore();
        }
    };

    root.DrumTrigger = DrumTrigger;
})(window);