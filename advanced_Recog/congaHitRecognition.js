/**
 * 智能Conga鼓打击识别系统
 * 基于频谱分析和物理特征进行降噪和打击分类
 */

class CongaHitRecognition {
    constructor(options = {}) {
        // 音频处理参数
        this.fftSize = options.fftSize || 2048;
        this.smoothingTimeConstant = options.smoothingTimeConstant || 0.8;
        this.sampleRate = options.sampleRate || 44100;

        // 降噪参数
        this.noiseFloor = options.noiseFloor || 0.02;
        this.noiseGateThreshold = options.noiseGateThreshold || 0.05;
        this.adaptiveNoiseReduction = true;

        // 基于搜索结果的频率特征定义
        this.frequencyProfiles = {
            // Open Tone: 清晰共鸣，中等频率为主
            open: {
                fundamentalRange: [180, 250],    // 基础频率
                harmonicPeaks: [350, 450, 650, 750], // 谐波峰值
                highFreqRatio: 0.3,              // 高频占比
                energyDistribution: [0.4, 0.4, 0.2], // 低、中、高频能量分布
                attackCharacteristics: {
                    riseTime: [10, 30],          // 上升时间 (ms)
                    sustainRatio: 0.6            // 持续比例
                }
            },

            // Slap: 高频特征明显，短促有力
            slap: {
                fundamentalRange: [200, 300],
                harmonicPeaks: [800, 1200, 2500, 5000], // 5kHz特征来自搜索结果
                highFreqRatio: 0.7,              // 高频占比很高
                energyDistribution: [0.2, 0.3, 0.5],
                attackCharacteristics: {
                    riseTime: [5, 15],           // 非常快的上升时间
                    sustainRatio: 0.2            // 短促
                }
            },

            // Bass: 低频为主，深沉共鸣
            bass: {
                fundamentalRange: [80, 180],
                harmonicPeaks: [160, 240, 320, 400],
                highFreqRatio: 0.1,
                energyDistribution: [0.7, 0.25, 0.05],
                attackCharacteristics: {
                    riseTime: [15, 40],
                    sustainRatio: 0.8
                }
            },

            // Tip/Heel: 中频为主，较为闷音
            tip: {
                fundamentalRange: [150, 220],
                harmonicPeaks: [300, 450, 600],
                highFreqRatio: 0.25,
                energyDistribution: [0.3, 0.5, 0.2],
                attackCharacteristics: {
                    riseTime: [8, 25],
                    sustainRatio: 0.4
                }
            }
        };

        // 识别状态
        this.isEnabled = false;
        this.lastDetectionTime = 0;
        this.detectionCooldown = 150; // ms

        // 自适应学习
        this.adaptiveLearning = {
            enabled: (options.adaptiveLearning ?? true),
            sampleHistory: [],
            maxHistorySize: 100
        };

        // 性能监控
        this.performanceStats = {
            totalDetections: 0,
            hitTypeAccuracy: {},
            averageProcessingTime: 0
        };

        // 事件回调
        this.onHitDetected = options.onHitDetected || null;
        this.onNoiseDetected = options.onNoiseDetected || null;

        // 初始化音频组件
        this.initializeAudioComponents();
    }

    initializeAudioComponents() {
        // 将在 init() 方法中初始化
        this.analyser = null;
        this.audioBuffer = null;
        this.frequencyData = null;
        this.timeData = null;

        // 降噪处理器
        this.noiseProfile = new Float32Array(this.fftSize / 2);
        this.noiseSamples = [];
        this.adaptiveNoiseFloor = this.noiseFloor;
    }

    /**
     * 初始化音频分析器
     */
    init(audioInput) {
        if (!audioInput) {
            throw new Error('需要提供音频输入源');
        }

        // 创建音频分析器
        const audioContext = getAudioContext();
        this.analyser = audioContext.createAnalyser();
        this.analyser.fftSize = this.fftSize;
        this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;

        // 连接音频源
        if (audioInput.connect) {
            audioInput.connect(this.analyser);
        }

        // 初始化数据缓冲区
        const bufferLength = this.analyser.frequencyBinCount;
        this.frequencyData = new Uint8Array(bufferLength);
        this.timeData = new Uint8Array(bufferLength);

        // 初始化噪音基线
        this.calibrateNoiseFloor();

        this.isEnabled = true;
        console.log('智能打击识别系统已初始化');

        return this;
    }

    /**
     * 校准噪音基线
     */
    calibrateNoiseFloor(duration = 2000) {
        console.log('开始校准环境噪音基线...');

        const calibrationSamples = [];
        const startTime = Date.now();

        const collectNoise = () => {
            if (Date.now() - startTime < duration) {
                this.analyser.getByteFrequencyData(this.frequencyData);
                calibrationSamples.push(new Uint8Array(this.frequencyData));
                setTimeout(collectNoise, 50);
            } else {
                this.calculateNoiseProfile(calibrationSamples);
                console.log('噪音基线校准完成');
            }
        };

        collectNoise();
    }

    /**
     * 计算噪音轮廓
     */
    calculateNoiseProfile(samples) {
        const binCount = this.frequencyData.length;

        // 计算每个频率段的平均噪音水平
        for (let i = 0; i < binCount; i++) {
            let sum = 0;
            for (let j = 0; j < samples.length; j++) {
                sum += samples[j][i];
            }
            this.noiseProfile[i] = sum / samples.length;
        }

        // 计算自适应噪音阈值
        const avgNoise = this.noiseProfile.reduce((a, b) => a + b) / binCount;
        this.adaptiveNoiseFloor = Math.max(this.noiseFloor, avgNoise / 255 * 1.5);

        console.log(`自适应噪音阈值: ${this.adaptiveNoiseFloor.toFixed(4)}`);
    }

    /**
     * 降噪处理
     */
    applyNoiseReduction(frequencyData) {
        const denoised = new Float32Array(frequencyData.length);

        for (let i = 0; i < frequencyData.length; i++) {
            const signal = frequencyData[i] / 255;
            const noise = this.noiseProfile[i] / 255;

            // 谱减法降噪
            const cleanSignal = signal - (noise * 1.2);

            // 噪音门限
            if (cleanSignal < this.adaptiveNoiseFloor) {
                denoised[i] = 0;
            } else {
                denoised[i] = Math.max(0, cleanSignal);
            }
        }

        return denoised;
    }

    /**
     * 分析频谱特征
     */
    analyzeSpectralFeatures(cleanSpectrum) {
        const nyquist = this.sampleRate / 2;
        const binWidth = nyquist / cleanSpectrum.length;

        // 频段划分
        const lowFreqEnd = Math.floor(500 / binWidth);
        const midFreqEnd = Math.floor(2000 / binWidth);

        // 计算能量分布
        let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
        let totalEnergy = 0;

        for (let i = 0; i < cleanSpectrum.length; i++) {
            const energy = cleanSpectrum[i] * cleanSpectrum[i];
            totalEnergy += energy;

            if (i < lowFreqEnd) {
                lowEnergy += energy;
            } else if (i < midFreqEnd) {
                midEnergy += energy;
            } else {
                highEnergy += energy;
            }
        }

        if (totalEnergy === 0) return null;

        // 寻找基础频率和谐波峰值
        const peaks = this.findSpectralPeaks(cleanSpectrum, binWidth);
        const fundamentalFreq = this.estimateFundamental(peaks, binWidth);

        // 计算瞬态特征
        const attackFeatures = this.analyzeAttackCharacteristics();

        return {
            energyDistribution: [
                lowEnergy / totalEnergy,
                midEnergy / totalEnergy,
                highEnergy / totalEnergy
            ],
            fundamentalFreq,
            peaks,
            totalEnergy,
            highFreqRatio: highEnergy / totalEnergy,
            attackFeatures,
            spectralCentroid: this.calculateSpectralCentroid(cleanSpectrum, binWidth),
            spectralRolloff: this.calculateSpectralRolloff(cleanSpectrum, 0.85)
        };
    }

    /**
     * 寻找频谱峰值
     */
    findSpectralPeaks(spectrum, binWidth, threshold = 0.1) {
        const peaks = [];

        for (let i = 1; i < spectrum.length - 1; i++) {
            if (spectrum[i] > threshold &&
                spectrum[i] > spectrum[i - 1] &&
                spectrum[i] > spectrum[i + 1]) {
                peaks.push({
                    frequency: i * binWidth,
                    magnitude: spectrum[i],
                    bin: i
                });
            }
        }

        // 按幅度排序
        return peaks.sort((a, b) => b.magnitude - a.magnitude).slice(0, 10);
    }

    /**
     * 估算基础频率
     */
    estimateFundamental(peaks, binWidth) {
        if (peaks.length === 0) return 0;

        // 在合理范围内寻找最强峰值
        const fundamentalCandidates = peaks.filter(p =>
            p.frequency >= 60 && p.frequency <= 400
        );

        return fundamentalCandidates.length > 0 ? fundamentalCandidates[0].frequency : peaks[0].frequency;
    }

    /**
     * 分析攻击特征
     */
    analyzeAttackCharacteristics() {
        // 这里需要时域分析，简化处理
        this.analyser.getByteTimeDomainData(this.timeData);

        let peakAmplitude = 0;
        let riseTime = 0;
        let sustainLevel = 0;

        // 寻找峰值
        for (let i = 0; i < this.timeData.length; i++) {
            const sample = Math.abs(this.timeData[i] - 128) / 128;
            if (sample > peakAmplitude) {
                peakAmplitude = sample;
                riseTime = i;
            }
        }

        // 计算持续水平
        const sustainStart = Math.floor(this.timeData.length * 0.3);
        const sustainEnd = Math.floor(this.timeData.length * 0.7);
        let sustainSum = 0;

        for (let i = sustainStart; i < sustainEnd; i++) {
            sustainSum += Math.abs(this.timeData[i] - 128) / 128;
        }
        sustainLevel = sustainSum / (sustainEnd - sustainStart);

        return {
            peakAmplitude,
            riseTime: (riseTime / this.timeData.length) * 1000, // 转换为ms
            sustainRatio: sustainLevel / Math.max(peakAmplitude, 0.001)
        };
    }

    /**
     * 计算频谱质心
     */
    calculateSpectralCentroid(spectrum, binWidth) {
        let weightedSum = 0;
        let magnitudeSum = 0;

        for (let i = 0; i < spectrum.length; i++) {
            const frequency = i * binWidth;
            const magnitude = spectrum[i];
            weightedSum += frequency * magnitude;
            magnitudeSum += magnitude;
        }

        return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    }

    /**
     * 计算频谱滚降点
     */
    calculateSpectralRolloff(spectrum, threshold = 0.85) {
        const totalEnergy = spectrum.reduce((sum, val) => sum + val * val, 0);
        const targetEnergy = totalEnergy * threshold;

        let cumulativeEnergy = 0;
        for (let i = 0; i < spectrum.length; i++) {
            cumulativeEnergy += spectrum[i] * spectrum[i];
            if (cumulativeEnergy >= targetEnergy) {
                return i;
            }
        }

        return spectrum.length - 1;
    }

    /**
     * 分类打击类型
     */
    classifyHitType(features) {
        if (!features || features.totalEnergy < 0.01) {
            return { type: 'noise', confidence: 0, reason: 'Energy too low' };
        }

        const scores = {};

        // 对每种打击类型计算匹配分数
        for (const [hitType, profile] of Object.entries(this.frequencyProfiles)) {
            let score = 0;
            let factors = [];

            // 基础频率匹配 (30%权重)
            const fundMatch = this.calculateFrequencyMatch(
                features.fundamentalFreq,
                profile.fundamentalRange
            );
            score += fundMatch * 0.3;
            factors.push(`Fund:${fundMatch.toFixed(2)}`);

            // 能量分布匹配 (25%权重)
            const energyMatch = this.calculateEnergyMatch(
                features.energyDistribution,
                profile.energyDistribution
            );
            score += energyMatch * 0.25;
            factors.push(`Energy:${energyMatch.toFixed(2)}`);

            // 高频比例匹配 (20%权重)
            const highFreqMatch = 1 - Math.abs(features.highFreqRatio - profile.highFreqRatio);
            score += Math.max(0, highFreqMatch) * 0.2;
            factors.push(`HiFreq:${highFreqMatch.toFixed(2)}`);

            // 攻击特征匹配 (15%权重)
            const attackMatch = this.calculateAttackMatch(
                features.attackFeatures,
                profile.attackCharacteristics
            );
            score += attackMatch * 0.15;
            factors.push(`Attack:${attackMatch.toFixed(2)}`);

            // 谐波匹配 (10%权重)
            const harmonicMatch = this.calculateHarmonicMatch(
                features.peaks,
                profile.harmonicPeaks
            );
            score += harmonicMatch * 0.1;
            factors.push(`Harmonic:${harmonicMatch.toFixed(2)}`);

            scores[hitType] = {
                score: Math.max(0, Math.min(1, score)),
                factors: factors.join(', ')
            };
        }

        // 找到最佳匹配
        const bestMatch = Object.entries(scores).reduce((best, [type, data]) =>
            data.score > best.score ? { type, ...data } : best
            , { type: 'unknown', score: 0, factors: '' });

        // 设置置信度阈值
        const minConfidence = 0.2;
        if (bestMatch.score < minConfidence) {
            return {
                type: 'ambiguous',
                confidence: bestMatch.score,
                reason: `Low confidence: ${bestMatch.factors}`,
                allScores: scores
            };
        }

        return {
            type: bestMatch.type,
            confidence: bestMatch.score,
            reason: bestMatch.factors,
            allScores: scores
        };
    }

    /**
     * 计算频率匹配度
     */
    calculateFrequencyMatch(freq, range) {
        if (freq >= range[0] && freq <= range[1]) {
            return 1.0;
        }

        const distance = Math.min(
            Math.abs(freq - range[0]),
            Math.abs(freq - range[1])
        );

        const tolerance = (range[1] - range[0]) * 0.5;
        return Math.max(0, 1 - distance / tolerance);
    }

    /**
     * 计算能量分布匹配度
     */
    calculateEnergyMatch(actual, expected) {
        let similarity = 0;
        for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
            similarity += 1 - Math.abs(actual[i] - expected[i]);
        }
        return similarity / Math.min(actual.length, expected.length);
    }

    /**
     * 计算攻击特征匹配度
     */
    calculateAttackMatch(actual, expected) {
        const riseTimeMatch = this.calculateFrequencyMatch(
            actual.riseTime,
            expected.riseTime
        );

        const sustainMatch = 1 - Math.abs(actual.sustainRatio - expected.sustainRatio);

        return (riseTimeMatch + Math.max(0, sustainMatch)) / 2;
    }

    /**
     * 计算谐波匹配度
     */
    calculateHarmonicMatch(peaks, expectedHarmonics) {
        if (peaks.length === 0) return 0;

        let matches = 0;
        const tolerance = 50; // Hz

        for (const harmonic of expectedHarmonics) {
            const found = peaks.find(peak =>
                Math.abs(peak.frequency - harmonic) < tolerance
            );
            if (found) matches++;
        }

        return matches / expectedHarmonics.length;
    }

    /**
     * 主要处理方法
     */
    process() {
        if (!this.isEnabled || !this.analyser) return null;

        const startTime = performance.now();
        const currentTime = Date.now();

        // 检查冷却时间
        if (currentTime - this.lastDetectionTime < this.detectionCooldown) {
            return null;
        }

        // 获取频谱数据
        this.analyser.getByteFrequencyData(this.frequencyData);

        // 降噪处理
        const cleanSpectrum = this.applyNoiseReduction(this.frequencyData);

        // 检查是否有足够的信号
        const totalEnergy = cleanSpectrum.reduce((sum, val) => sum + val, 0);
        if (totalEnergy < this.noiseGateThreshold * cleanSpectrum.length) {
            return null;
        }

        // 分析频谱特征
        const features = this.analyzeSpectralFeatures(cleanSpectrum);
        if (!features) return null;

        // 分类打击类型
        const classification = this.classifyHitType(features);

        // 更新性能统计
        const processingTime = performance.now() - startTime;
        this.performanceStats.averageProcessingTime =
            (this.performanceStats.averageProcessingTime + processingTime) / 2;

        if (classification.type !== 'noise' && classification.type !== 'ambiguous') {
            this.lastDetectionTime = currentTime;
            this.performanceStats.totalDetections++;

            // 自适应学习
            if (this.adaptiveLearning.enabled) {
                this.updateAdaptiveLearning(features, classification);
            }

            // 触发回调
            if (this.onHitDetected) {
                this.onHitDetected({
                    type: classification.type,
                    confidence: classification.confidence,
                    features: features,
                    processingTime: processingTime,
                    timestamp: currentTime
                });
            }

            return classification;
        }

        return null;
    }

    /**
     * 自适应学习更新
     */
    updateAdaptiveLearning(features, classification) {
        this.adaptiveLearning.sampleHistory.push({
            features,
            classification,
            timestamp: Date.now()
        });

        // 限制历史记录大小
        if (this.adaptiveLearning.sampleHistory.length > this.adaptiveLearning.maxHistorySize) {
            this.adaptiveLearning.sampleHistory.shift();
        }

        // 周期性优化
        if (this.adaptiveLearning.sampleHistory.length % 20 === 0) {
            this.optimizeParameters();
        }
    }

    /**
     * 参数优化
     */
    optimizeParameters() {
        // 基于历史数据优化识别参数
        console.log('正在优化识别参数...');

        // 分析误分类样本
        const recentSamples = this.adaptiveLearning.sampleHistory.slice(-50);
        const lowConfidenceSamples = recentSamples.filter(s => s.classification.confidence < 0.6);

        if (lowConfidenceSamples.length > 10) {
            // 动态调整噪音阈值
            this.adaptiveNoiseFloor *= 0.95;
            console.log(`降低噪音阈值至: ${this.adaptiveNoiseFloor.toFixed(4)}`);
        }
    }

    /**
     * 获取性能统计
     */
    getPerformanceStats() {
        return {
            ...this.performanceStats,
            adaptiveNoiseFloor: this.adaptiveNoiseFloor,
            historySamples: this.adaptiveLearning.sampleHistory.length
        };
    }

    /**
     * 启用/禁用识别
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log(`打击识别系统: ${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 重置系统
     */
    reset() {
        this.lastDetectionTime = 0;
        this.adaptiveLearning.sampleHistory = [];
        this.performanceStats = {
            totalDetections: 0,
            hitTypeAccuracy: {},
            averageProcessingTime: 0
        };

        // 重新校准噪音基线
        if (this.analyser) {
            this.calibrateNoiseFloor();
        }

        console.log('打击识别系统已重置');
    }
}

// 导出模块
if (typeof window !== 'undefined') {
    window.CongaHitRecognition = CongaHitRecognition;
}