// drumTrigger.js - 麦克风打击检测模块
// 通过分析麦克风输入的音频信号来检测鼓击，并触发游戏判定逻辑
// 使用多种检测方法：音量突增、高频能量、变化率等
// 针对移动端进行了特殊优化

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    const DrumTrigger = {
        // ===== 配置参数 =====
        _mic: null,
        _fft: null,
        _isEnabled: false,
        _isDebug: false,
        _isMobile: false,

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
        _volumeThreshold: 0.08,        // 基础音量阈值
        _volumeHistory: [],
        _volumeHistorySize: 12,        // 历史记录长度

        // 背景噪音自适应
        _backgroundNoise: 0.02,        // 背景噪音电平
        _noiseAdaptRate: 0.999,        // 背景噪音适应速率

        // 防抖和状态跟踪
        _debounceMs: 80,               // 防抖时间
        _lastTriggerTime: 0,
        _isInTransient: false,         // 当前是否在瞬态中
        _transientStartTime: 0,
        _transientPeakLevel: 0,

        // 移动端专用参数
        _fallbackMode: false,          // 是否使用简化模式（FFT失败时）
        _simpleVolumeThreshold: 0.15,  // 简化模式音量阈值
        _lastVolumeCheckTime: 0,

        // 统计与调试
        _triggerCount: 0,
        _falsePositiveCount: 0,
        _lastTriggerReason: '',
        _initTime: 0,

        // 回调函数
        _onTrigger: null,

        // ===== 初始化 =====
        init({ mic, onTrigger, debug = false } = {}) {
            this._mic = mic;
            this._onTrigger = onTrigger;
            this._isDebug = debug;
            this._isMobile = isMobile();
            this._initTime = Date.now();

            console.log(`DrumTrigger 初始化 - 平台: ${this._isMobile ? '移动端' : '桌面端'}`);

            if (mic) {
                try {
                    // 尝试创建 FFT 分析器
                    this._fft = new p5.FFT(0.75, 1024);
                    this._fft.setInput(mic);
                    console.log('FFT 分析器创建成功');

                    // 测试 FFT 是否真的工作
                    setTimeout(() => {
                        this._testFFTFunctionality();
                    }, 500);

                } catch (error) {
                    console.error('FFT 分析器创建失败:', error);
                    this._fft = null;
                    this._fallbackMode = true;
                    console.log('启用简化检测模式（仅音量）');
                }
            } else {
                console.warn('DrumTrigger: 未提供麦克风输入');
            }

            // 移动端特殊优化
            if (this._isMobile) {
                this._applyMobileOptimizations();
            }

            // 初始化历史记录
            this._volumeHistory = new Array(this._volumeHistorySize).fill(0);

            if (this._isDebug) {
                console.log('DrumTrigger 初始化完成', {
                    platform: this._isMobile ? 'mobile' : 'desktop',
                    hasFFT: !!this._fft,
                    fallbackMode: this._fallbackMode,
                    volumeThreshold: this._volumeThreshold,
                    transientRatio: this._transientRatio
                });
            }

            return this;
        },

        // ===== 移动端优化 =====
        _applyMobileOptimizations() {
            console.log('应用移动端优化设置...');

            // 降低检测阈值，提高灵敏度
            this._volumeThreshold = 0.05;        // 从 0.08 降低到 0.05
            this._transientRatio = 2.2;          // 从 3.0 降低到 2.2
            this._spectralBalance = 0.2;         // 从 0.3 降低到 0.2
            this._debounceMs = 60;              // 从 80 降低到 60
            this._simpleVolumeThreshold = 0.12; // 简化模式阈值

            // 移动端可能音频处理延迟更高
            this._volumeHistorySize = 8;         // 减少历史记录长度

            console.log('移动端优化完成:', {
                volumeThreshold: this._volumeThreshold,
                transientRatio: this._transientRatio,
                debounceMs: this._debounceMs
            });
        },

        // ===== FFT 功能测试 =====
        _testFFTFunctionality() {
            if (!this._fft) return;

            try {
                const spectrum = this._fft.analyze();
                if (!spectrum || spectrum.length === 0) {
                    console.warn('FFT 返回空数据，切换到简化模式');
                    this._fallbackMode = true;
                    return;
                }

                // 检查是否返回有效数据（非全零）
                const hasData = spectrum.some(val => val > 0);
                if (!hasData) {
                    console.warn('FFT 返回全零数据，可能音频输入未就绪');
                    // 不立即切换到简化模式，给音频输入更多时间
                    setTimeout(() => this._testFFTFunctionality(), 1000);
                } else {
                    console.log('FFT 功能测试通过');
                }
            } catch (error) {
                console.error('FFT 功能测试失败:', error);
                this._fallbackMode = true;
            }
        },

        // ===== 控制方法 =====
        enable(enabled = true) {
            this._isEnabled = enabled;
            if (this._isDebug) {
                console.log(`DrumTrigger ${enabled ? '启用' : '禁用'} (${this._isMobile ? '移动端' : '桌面端'})`);
            }
        },

        setDebug(debug = true) {
            this._isDebug = debug;
            if (debug && this._isMobile) {
                console.log('移动端调试模式开启');
            }
        },

        setSensitivity(level) {
            // 便捷方法：设置整体灵敏度 (0-1, 0.5为默认)
            const factor = clamp(level, 0, 1);

            if (this._isMobile) {
                // 移动端使用更激进的灵敏度设置
                this._volumeThreshold = 0.05 * (2.2 - factor * 1.2);    // 0.03 - 0.11
                this._transientRatio = 1.8 + factor * 1.4;              // 1.8 - 3.2
                this._spectralBalance = 0.15 + factor * 0.25;           // 0.15 - 0.4
                this._simpleVolumeThreshold = 0.08 + factor * 0.08;     // 0.08 - 0.16
            } else {
                // 桌面端使用原来的设置
                this._volumeThreshold = 0.08 * (2 - factor);            // 0.08 - 0.16
                this._transientRatio = 2.0 + factor * 2.0;              // 2.0 - 4.0
                this._spectralBalance = 0.2 + factor * 0.2;             // 0.2 - 0.4
            }

            if (this._isDebug) {
                console.log(`灵敏度设置为: ${level.toFixed(1)} (${this._isMobile ? '移动端' : '桌面端'})`, {
                    volumeThreshold: this._volumeThreshold.toFixed(4),
                    transientRatio: this._transientRatio.toFixed(2),
                    spectralBalance: this._spectralBalance.toFixed(3)
                });
            }
        },

        // ===== 核心检测逻辑 =====
        update() {
            if (!this._isEnabled || !this._mic) return;

            const now = millis();
            const currentVolume = this._getCurrentVolume();

            // 检查音量是否有效
            if (currentVolume === null || isNaN(currentVolume)) {
                if (this._isDebug && frameCount % 120 === 0) { // 每4秒输出一次
                    console.warn('音量检测返回无效值');
                }
                return;
            }

            // 使用简化模式或完整分析
            if (this._fallbackMode) {
                this._updateSimpleMode(currentVolume, now);
            } else {
                this._updateFullMode(currentVolume, now);
            }

            // 调试输出（移动端更频繁）
            if (this._isDebug) {
                const debugInterval = this._isMobile ? 30 : 60; // 移动端每0.5秒，桌面端每2秒
                if (frameCount % debugInterval === 0) {
                    this._outputDebugInfo(currentVolume, now);
                }
            }
        },

        // ===== 简化模式更新（仅音量检测）=====
        _updateSimpleMode(currentVolume, now) {
            // 防抖检查
            if (now - this._lastTriggerTime < this._debounceMs) return;

            // 更新背景噪音和历史
            this._updateBackgroundNoise(currentVolume);
            this._updateVolumeHistory(currentVolume);

            // 简化检测：仅基于音量突增
            const recentAvg = this._getRecentAverage();
            const volumeRatio = currentVolume / Math.max(recentAvg, this._backgroundNoise * 2);
            const isLoudEnough = currentVolume > this._simpleVolumeThreshold;
            const hasTransient = volumeRatio > (this._transientRatio * 0.8); // 稍微降低要求

            if (isLoudEnough && hasTransient && currentVolume > this._backgroundNoise * 4) {
                this._triggerHit('SIMPLE_MODE');
            }
        },

        // ===== 完整模式更新 =====
        _updateFullMode(currentVolume, now) {
            // 获取频谱分析
            let spectralFeatures;
            try {
                spectralFeatures = this._analyzeSpectrum();
            } catch (error) {
                if (this._isDebug) {
                    console.warn('频谱分析失败，降级到简化模式:', error);
                }
                this._fallbackMode = true;
                this._updateSimpleMode(currentVolume, now);
                return;
            }

            // 防抖检查
            if (now - this._lastTriggerTime < this._debounceMs) return;

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
        },

        // ===== 音量检测 =====
        _getCurrentVolume() {
            if (!this._mic) return null;

            try {
                // 优先使用 RMS 计算（更稳定）
                if (this._fft && !this._fallbackMode) {
                    const waveform = this._fft.waveform(512);
                    if (!waveform || waveform.length === 0) {
                        // FFT 数据无效，降级使用 mic.getLevel()
                        return this._mic.getLevel() || 0;
                    }

                    let rms = 0;
                    for (let i = 0; i < waveform.length; i++) {
                        rms += waveform[i] * waveform[i];
                    }
                    return Math.sqrt(rms / waveform.length);
                } else {
                    // 使用 p5.js 内置的音量检测
                    return this._mic.getLevel() || 0;
                }
            } catch (error) {
                if (this._isDebug && frameCount % 60 === 0) {
                    console.error('音量检测失败:', error);
                }
                // 尝试使用备用方法
                try {
                    return this._mic.getLevel() || 0;
                } catch (fallbackError) {
                    return 0;
                }
            }
        },

        // ===== 频谱分析 =====
        _analyzeSpectrum() {
            if (!this._fft || this._fallbackMode) {
                // 返回默认值，避免错误
                return {
                    lowEnergy: 0.1,
                    midEnergy: 0.1,
                    highEnergy: 0.05,
                    totalEnergy: 0.25
                };
            }

            const spectrum = this._fft.analyze();
            if (!spectrum || spectrum.length === 0) {
                throw new Error('FFT spectrum is empty');
            }

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
            const volumeAboveBackground = currentVolume > this._backgroundNoise * (this._isMobile ? 2.5 : 3);

            if (!volumeAboveThreshold || !volumeAboveBackground) {
                return { score: 0, reason: 'LOW_VOLUME' };
            }

            // 2. 瞬态攻击检查（关键特征）
            if (this._volumeHistory.length >= 4) {
                const recentAvg = this._getRecentAverage();
                const transientRatio = currentVolume / Math.max(recentAvg, this._backgroundNoise * 2);

                if (transientRatio > this._transientRatio) {
                    score += this._isMobile ? 3.5 : 3.0; // 移动端稍微提高分数
                    reasons.push('TRANSIENT');
                }
            }

            // 3. 频谱形状检查（鼓声特征）- 仅在非简化模式
            if (!this._fallbackMode) {
                const spectralRatio = spectralFeatures.lowEnergy / Math.max(spectralFeatures.highEnergy, 0.01);
                if (spectralRatio > 1.5 && spectralFeatures.lowEnergy > this._spectralBalance) {
                    score += 2.0;
                    reasons.push('SPECTRUM');
                }

                // 4. 中频能量检查（避免纯低频或纯高频噪音）
                if (spectralFeatures.midEnergy > spectralFeatures.totalEnergy * 0.15) { // 移动端降低要求
                    score += 1.0;
                    reasons.push('MIDFREQ');
                }
            }

            // 5. 动态范围检查
            const dynamicRange = currentVolume / Math.max(this._backgroundNoise, 0.001);
            const minDynamicRange = this._isMobile ? 6 : 8; // 移动端降低要求
            if (dynamicRange > minDynamicRange) {
                score += 1.5;
                reasons.push('DYNAMIC');
            }

            return {
                score: score,
                reason: reasons.join('+') || 'WEAK',
                features: {
                    volume: currentVolume,
                    transientRatio: currentVolume / Math.max(this._getRecentAverage(), this._backgroundNoise * 2),
                    spectralRatio: !this._fallbackMode ?
                        (spectralFeatures.lowEnergy / Math.max(spectralFeatures.highEnergy, 0.01)) : 1,
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

                // 移动端缩短瞬态持续时间
                const maxDuration = this._isMobile ? 250 : 300;
                if (duration > maxDuration || sustainRatio < this._maxSustainRatio) {
                    this._isInTransient = false;
                }
            }
        },

        _isDrumHit(drumFeatures, now) {
            // 防抖检查
            if (now - this._lastTriggerTime < this._debounceMs) return false;

            // 移动端和简化模式降低分数要求
            const minScore = this._fallbackMode ? 2.0 : (this._isMobile ? 3.0 : 4.0);

            return drumFeatures.score >= minScore && drumFeatures.reason.includes('TRANSIENT');
        },

        _triggerHit(reason) {
            this._lastTriggerTime = millis();
            this._triggerCount++;
            this._lastTriggerReason = reason;

            if (this._isDebug) {
                const platform = this._isMobile ? '移动端' : '桌面端';
                const mode = this._fallbackMode ? '简化模式' : '完整模式';
                console.log(`🥁 ${platform}鼓声检测! 特征: ${reason}, 模式: ${mode}, 计数: ${this._triggerCount}`);
            }

            if (this._onTrigger) {
                try {
                    this._onTrigger(reason);
                } catch (error) {
                    console.error('触发回调执行失败:', error);
                }
            }
        },

        // ===== 调试输出 =====
        _outputDebugInfo(currentVolume, now) {
            const uptime = ((now - this._lastTriggerTime) / 1000).toFixed(1);
            const mode = this._fallbackMode ? '简化' : 'FFT';
            const platform = this._isMobile ? '移动' : '桌面';

            console.log(`${platform}端调试 [${mode}] - 音量: ${currentVolume.toFixed(4)}, 背景: ${this._backgroundNoise.toFixed(4)}, 瞬态: ${this._isInTransient ? '是' : '否'}, 上次触发: ${uptime}s前, 总计: ${this._triggerCount}`);
        },

        // ===== 调试与状态查询 =====
        getStats() {
            return {
                triggerCount: this._triggerCount,
                falsePositiveCount: this._falsePositiveCount,
                lastTriggerReason: this._lastTriggerReason,
                isEnabled: this._isEnabled,
                isMobile: this._isMobile,
                fallbackMode: this._fallbackMode,
                hasFFT: !!this._fft,
                volumeThreshold: this._volumeThreshold,
                transientRatio: this._transientRatio,
                backgroundNoise: this._backgroundNoise,
                debounceMs: this._debounceMs,
                uptime: ((Date.now() - this._initTime) / 1000).toFixed(1) + 's'
            };
        },

        resetStats() {
            this._triggerCount = 0;
            this._falsePositiveCount = 0;
            this._lastTriggerReason = '';
            console.log('DrumTrigger 统计数据已重置');
        },

        // ===== 调试面板渲染 =====
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
            const platform = this._isMobile ? 'M' : 'D'; // Mobile/Desktop
            const mode = this._fallbackMode ? 'S' : 'F';  // Simple/Full

            const lines = [
                `Drum [${platform}${mode}]: ${this._isEnabled ? 'ON' : 'OFF'}`,
                `Hits: ${this._triggerCount} | FP: ${this._falsePositiveCount}`,
                `Vol: ${currentVolume.toFixed(3)} | Avg: ${recentAvg.toFixed(3)}`,
                `BG: ${this._backgroundNoise.toFixed(3)} | Ratio: ${this._transientRatio.toFixed(1)}`,
                `Transient: ${this._isInTransient ? 'YES' : 'NO'}`,
                `Last: ${this._lastTriggerReason}`,
                `Threshold: ${this._volumeThreshold.toFixed(3)}`,
                `Mode: ${this._fallbackMode ? 'Simple' : 'FFT'}`
            ];

            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], x + 6, y + 14 + i * 12);
            }

            ctx.restore();
        },

        // ===== 手动测试方法 =====
        manualTest() {
            console.log('手动触发测试...');
            this._triggerHit('MANUAL_TEST');
        },

        // ===== 诊断方法 =====
        runDiagnostics() {
            console.log('=== DrumTrigger 诊断报告 ===');
            console.log('平台:', this._isMobile ? '移动端' : '桌面端');
            console.log('模式:', this._fallbackMode ? '简化模式（仅音量）' : 'FFT模式（完整分析）');
            console.log('麦克风状态:', this._mic ? '已连接' : '未连接');
            console.log('FFT分析器状态:', this._fft ? '已创建' : '创建失败');
            console.log('当前设置:', {
                enabled: this._isEnabled,
                volumeThreshold: this._volumeThreshold.toFixed(4),
                transientRatio: this._transientRatio.toFixed(2),
                debounceMs: this._debounceMs,
                backgroundNoise: this._backgroundNoise.toFixed(4)
            });

            if (this._mic) {
                try {
                    const currentLevel = this._mic.getLevel();
                    console.log('当前音量级别:', currentLevel.toFixed(4));
                } catch (e) {
                    console.log('音量检测失败:', e.message);
                }
            }

            console.log('触发统计:', {
                totalTriggers: this._triggerCount,
                lastReason: this._lastTriggerReason,
                timeSinceLastTrigger: ((millis() - this._lastTriggerTime) / 1000).toFixed(1) + 's'
            });
            console.log('=== 诊断报告结束 ===');
        }
    };

    root.DrumTrigger = DrumTrigger;
})(window);