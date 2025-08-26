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

        // 瞬态检测参数（鼓声的关键特征）
        _transientRatio: 3.0,          // 瞬态攻击比率：当前音量 / 历史平均值
        _sustainCheckFrames: 8,         // 检查持续时间的帧数
        _maxSustainRatio: 0.6,         // 最大持续音量比率（鼓声应该快速衰减）

        // 频谱特征参数
        _lowFreqRange: [80, 800],      // 鼓声低频主体范围 (Hz)
        _midFreqRange: [800, 4000],    // 中频范围
        _highFreqRange: [4000, 12000], // 高频瞬态范围
        _spectralBalance: 0.3,         // 低频与高频能量比率阈值

        // 基础检测参数
        _volumeThreshold: 0.08,        // 降低基础音量阈值
        _volumeHistory: [],
        _volumeHistorySize: 12,        // 增加历史记录长度

        // 背景噪音自适应
        _backgroundNoise: 0.02,        // 背景噪音电平
        _noiseAdaptRate: 0.999,        // 背景噪音适应速率

        // 防抖和状态跟踪
        _debounceMs: 80,               // 减少防抖时间
        _lastTriggerTime: 0,
        _isInTransient: false,         // 当前是否在瞬态中
        _transientStartTime: 0,
        _transientPeakLevel: 0,

        // 统计与调试
        _triggerCount: 0,
        _falsePositiveCount: 0,
        _lastTriggerReason: '',

        // 回调函数
        _onTrigger: null,

        // ===== 初始化 =====
        init({ mic, onTrigger, debug = false } = {}) {
            this._mic = mic;
            this._onTrigger = onTrigger;
            this._isDebug = debug;

            if (mic) {
                // 创建 FFT 分析器用于频谱分析
                this._fft = new p5.FFT(0.75, 1024);
                this._fft.setInput(mic);
            }

            // 初始化历史记录
            this._volumeHistory = new Array(this._volumeHistorySize).fill(0);

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

        setSensitivity(level) {
            // 便捷方法：设置整体灵敏度 (0-1, 0.5为默认)
            const factor = clamp(level, 0, 1);
            this._volumeThreshold = 0.08 * (2 - factor);          // 灵敏度高 -> 阈值低
            this._transientRatio = 2.0 + factor * 2.0;  // 2.0 - 4.0
            this._spectralBalance = 0.2 + factor * 0.2; // 0.2 - 0.4

            if (this._isDebug) {
                console.log(`Sensitivity set to: ${level} (vol: ${this._volumeThreshold.toFixed(3)}, trans: ${this._transientRatio.toFixed(3)}, spec: ${this._spectralBalance.toFixed(3)})`);
            }
        },

        // ===== 核心检测逻辑 =====
        update() {
            if (!this._isEnabled || !this._mic || !this._fft) return;

            // 防抖检查
            const now = millis();
            const currentVolume = this._getCurrentVolume();
            const spectralFeatures = this._analyzeSpectrum();

            // 更新背景噪音估计
            this._updateBackgroundNoise(currentVolume);

            // 更新历史记录
            this._updateVolumeHistory(currentVolume);

            // 检测鼓声特征
            const drumFeatures = this._analyzeDrumFeatures(currentVolume, spectralFeatures);

            // 状态机：跟踪瞬态过程
            this._updateTransientState(currentVolume, now);

            // 判定是否为鼓声
            if (this._isDrumHit(drumFeatures, now)) {
                this._triggerHit(drumFeatures.reason);
            }

            // 调试输出
            if (this._isDebug && frameCount % 45 === 0) {
                console.log(`Vol: ${currentVolume.toFixed(3)}, BG: ${this._backgroundNoise.toFixed(3)}, Transient: ${this._isInTransient}, Features: ${drumFeatures.score.toFixed(2)}`);
            }
        },

        // ===== 内部检测方法 =====
        _getCurrentVolume() {
            // 使用 RMS 音量计算
            const waveform = this._fft.waveform(512);
            let rms = 0;
            for (let i = 0; i < waveform.length; i++) {
                rms += waveform[i] * waveform[i];
            }
            return Math.sqrt(rms / waveform.length);
        },

        _analyzeSpectrum() {
            const spectrum = this._fft.analyze();
            const nyquist = 22050;
            const binSize = nyquist / spectrum.length;

            const getLowEnergy = () => {
                const start = Math.floor(this._lowFreqRange[0] / binSize);
                const end = Math.floor(this._lowFreqRange[1] / binSize);
                return this._getFreqEnergy(spectrum, start, end);
            };

            const getMidEnergy = () => {
                const start = Math.floor(this._midFreqRange[0] / binSize);
                const end = Math.floor(this._midFreqRange[1] / binSize);
                return this._getFreqEnergy(spectrum, start, end);
            };

            const getHighEnergy = () => {
                const start = Math.floor(this._highFreqRange[0] / binSize);
                const end = Math.floor(this._highFreqRange[1] / binSize);
                return this._getFreqEnergy(spectrum, start, end);
            };

            return {
                lowEnergy: getLowEnergy(),
                midEnergy: getMidEnergy(),
                highEnergy: getHighEnergy(),
                totalEnergy: getLowEnergy() + getMidEnergy() + getHighEnergy()
            };
        },

        _getFreqEnergy(spectrum, startBin, endBin) {
            let energy = 0;
            let count = 0;
            for (let i = startBin; i < endBin && i < spectrum.length; i++) {
                energy += spectrum[i] / 255;
                count++;
            }
            return count > 0 ? energy / count : 0;
        },

        _updateBackgroundNoise(currentVolume) {
            // 只在安静时更新背景噪音
            if (currentVolume < this._backgroundNoise * 2) {
                this._backgroundNoise = this._backgroundNoise * this._noiseAdaptRate +
                    currentVolume * (1 - this._noiseAdaptRate);
            }
        },

        _updateVolumeHistory(volume) {
            this._volumeHistory.push(volume);
            if (this._volumeHistory.length > this._volumeHistorySize) {
                this._volumeHistory.shift();
            }
        },

        _analyzeDrumFeatures(currentVolume, spectralFeatures) {
            let score = 0;
            let reasons = [];

            // 1. 音量阈值检查（基础条件）
            const volumeAboveThreshold = currentVolume > this._volumeThreshold;
            const volumeAboveBackground = currentVolume > this._backgroundNoise * 3;

            if (!volumeAboveThreshold || !volumeAboveBackground) {
                return { score: 0, reason: 'LOW_VOLUME' };
            }

            // 2. 瞬态攻击检查（关键特征）
            if (this._volumeHistory.length >= 4) {
                const recentAvg = this._getRecentAverage();
                const transientRatio = currentVolume / Math.max(recentAvg, this._backgroundNoise * 2);

                if (transientRatio > this._transientRatio) {
                    score += 3.0;
                    reasons.push('TRANSIENT');
                }
            }

            // 3. 频谱形状检查（鼓声特征）
            const spectralRatio = spectralFeatures.lowEnergy / Math.max(spectralFeatures.highEnergy, 0.01);
            if (spectralRatio > 1.5 && spectralFeatures.lowEnergy > this._spectralBalance) {
                score += 2.0;
                reasons.push('SPECTRUM');
            }

            // 4. 中频能量检查（避免纯低频或纯高频噪音）
            if (spectralFeatures.midEnergy > spectralFeatures.totalEnergy * 0.2) {
                score += 1.0;
                reasons.push('MIDFREQ');
            }

            // 5. 动态范围检查
            const dynamicRange = currentVolume / Math.max(this._backgroundNoise, 0.001);
            if (dynamicRange > 8) {
                score += 1.5;
                reasons.push('DYNAMIC');
            }

            return {
                score: score,
                reason: reasons.join('+') || 'WEAK',
                features: {
                    volume: currentVolume,
                    transientRatio: currentVolume / Math.max(this._getRecentAverage(), this._backgroundNoise * 2),
                    spectralRatio: spectralRatio,
                    dynamicRange: dynamicRange
                }
            };
        },

        _getRecentAverage() {
            if (this._volumeHistory.length < 3) return this._backgroundNoise;
            const recent = this._volumeHistory.slice(-4, -1); // 排除当前值
            return recent.reduce((sum, v) => sum + v, 0) / recent.length;
        },

        _updateTransientState(currentVolume, now) {
            if (!this._isInTransient) {
                // 检测瞬态开始
                const recentAvg = this._getRecentAverage();
                if (currentVolume > recentAvg * this._transientRatio && currentVolume > this._volumeThreshold) {
                    this._isInTransient = true;
                    this._transientStartTime = now;
                    this._transientPeakLevel = currentVolume;
                }
            } else {
                // 瞬态进行中
                this._transientPeakLevel = Math.max(this._transientPeakLevel, currentVolume);

                // 检测瞬态结束条件
                const duration = now - this._transientStartTime;
                const sustainRatio = currentVolume / this._transientPeakLevel;

                if (duration > 300 || sustainRatio < this._maxSustainRatio) {
                    this._isInTransient = false;
                }
            }
        },


        _isDrumHit(drumFeatures, now) {
            // 防抖检查
            if (now - this._lastTriggerTime < this._debounceMs) return false;

            // 需要足够高的特征分数
            const minScore = 4.0; // 至少需要多个特征同时满足

            return drumFeatures.score >= minScore && drumFeatures.reason.includes('TRANSIENT');
        },

        _triggerHit(reason) {
            this._lastTriggerTime = millis();
            this._triggerCount++;
            this._lastTriggerReason = reason;

            if (this._isDebug) {
                console.log(`🥁 Drum detected! Features: ${reason}, Count: ${this._triggerCount}`);
            }

            if (this._onTrigger) {
                this._onTrigger(reason);
            }
        },

        // ===== 调试与状态查询 =====
        getStats() {
            return {
                triggerCount: this._triggerCount,
                falsePositiveCount: this._falsePositiveCount,
                lastTriggerReason: this._lastTriggerReason,
                isEnabled: this._isEnabled,
                volumeThreshold: this._volumeThreshold,
                transientRatio: this._transientRatio,
                backgroundNoise: this._backgroundNoise,
                debounceMs: this._debounceMs
            };
        },

        resetStats() {
            this._triggerCount = 0;
            this._falsePositiveCount = 0;
            this._lastTriggerReason = '';
        },

        renderDebugPanel(ctx, x, y, w, h) {
            if (!this._isDebug || !ctx) return;

            ctx.save();

            // 背景
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.strokeRect(x, y, w, h);

            // 文字信息
            ctx.fillStyle = 'white';
            ctx.font = '11px monospace';
            ctx.textAlign = 'left';

            const currentVolume = this._volumeHistory[this._volumeHistory.length - 1] || 0;
            const recentAvg = this._getRecentAverage();

            const lines = [
                `Drum Trigger: ${this._isEnabled ? 'ON' : 'OFF'}`,
                `Hits: ${this._triggerCount} | FP: ${this._falsePositiveCount}`,
                `Vol: ${currentVolume.toFixed(3)} | Avg: ${recentAvg.toFixed(3)}`,
                `BG: ${this._backgroundNoise.toFixed(3)} | Ratio: ${this._transientRatio.toFixed(1)}`,
                `Transient: ${this._isInTransient ? 'YES' : 'NO'}`,
                `Last: ${this._lastTriggerReason}`,
                `Debounce: ${this._debounceMs}ms`
            ];

            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], x + 6, y + 14 + i * 12);
            }

            ctx.restore();
        }
    };
    root.DrumTrigger = DrumTrigger;
})(window);