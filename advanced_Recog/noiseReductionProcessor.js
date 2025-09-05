/**
 * 高级降噪处理器
 * 专门用于处理麦克风输入的环境噪音和干扰
 */

class NoiseReductionProcessor {
    constructor(options = {}) {
        // 基础参数
        this.fftSize = options.fftSize || 2048;
        this.sampleRate = options.sampleRate || 44100;
        this.smoothingFactor = options.smoothingFactor || 0.95;

        // 降噪算法参数
        this.algorithms = {
            spectralSubtraction: {
                enabled: true,
                overSubtractionFactor: 2.0,
                spectralFloor: 0.002
            },
            adaptiveFilter: {
                enabled: true,
                learningRate: 0.01,
                adaptationSpeed: 0.1
            },
            gatingFilter: {
                enabled: true,
                threshold: 0.025,
                attack: 0.003,  // 3ms
                release: 0.050  // 50ms
            }
        };

        // 噪音轮廓
        this.noiseProfile = {
            spectrum: new Float32Array(this.fftSize / 2),
            energy: 0,
            spectralCentroid: 0,
            variance: new Float32Array(this.fftSize / 2),
            confidence: 0,
            updateCount: 0
        };

        // 自适应参数
        this.adaptiveParameters = {
            environmentType: 'unknown', // quiet, normal, noisy
            dominantNoiseType: 'white', // white, pink, brown, hum
            noiseFloor: 0.01,
            signalToNoiseRatio: 0
        };

        // 频域特征分析
        this.frequencyAnalysis = {
            powerLineFreqs: [50, 60, 100, 120], // 工频及谐波
            environmentalPeaks: [],
            adaptiveNotches: []
        };

        // 处理缓冲区
        this.buffers = {
            inputSpectrum: new Float32Array(this.fftSize / 2),
            cleanSpectrum: new Float32Array(this.fftSize / 2),
            noiseEstimate: new Float32Array(this.fftSize / 2),
            gain: new Float32Array(this.fftSize / 2)
        };

        // 性能统计
        this.stats = {
            totalProcessed: 0,
            noiseReductionRatio: 0,
            averageProcessingTime: 0,
            qualityMetrics: {
                snr: 0,
                thd: 0,
                clarity: 0
            }
        };

        // 初始化
        this.initializeProcessor();
    }

    initializeProcessor() {
        // 初始化增益数组为1（无衰减）
        this.buffers.gain.fill(1.0);

        // 预设常见环境噪音频率
        this.identifyCommonNoiseFrequencies();

        console.log('高级降噪处理器已初始化');
    }

    /**
     * 识别常见噪音频率
     */
    identifyCommonNoiseFrequencies() {
        const nyquist = this.sampleRate / 2;
        const binWidth = nyquist / (this.fftSize / 2);

        // 工频噪音及其谐波
        this.frequencyAnalysis.powerLineFreqs.forEach(freq => {
            const bin = Math.round(freq / binWidth);
            if (bin < this.buffers.gain.length) {
                // 在这些频率周围创建较窄的抑制
                for (let i = Math.max(0, bin - 1); i <= Math.min(this.buffers.gain.length - 1, bin + 1); i++) {
                    this.frequencyAnalysis.adaptiveNotches.push({
                        bin: i,
                        frequency: i * binWidth,
                        type: 'powerLine',
                        strength: 0.7
                    });
                }
            }
        });
    }

    /**
     * 学习噪音轮廓
     */
    learnNoiseProfile(spectrumData, isNoiseSample = false) {
        const spectrum = this.normalizeSpectrum(spectrumData);

        if (isNoiseSample || this.isLikelyNoise(spectrum)) {
            // 使用指数移动平均更新噪音轮廓
            const alpha = Math.min(0.1, 1.0 / (this.noiseProfile.updateCount + 1));

            for (let i = 0; i < spectrum.length; i++) {
                this.noiseProfile.spectrum[i] =
                    (1 - alpha) * this.noiseProfile.spectrum[i] + alpha * spectrum[i];

                // 更新方差估计
                const diff = spectrum[i] - this.noiseProfile.spectrum[i];
                this.noiseProfile.variance[i] =
                    (1 - alpha) * this.noiseProfile.variance[i] + alpha * (diff * diff);
            }

            this.noiseProfile.updateCount++;
            this.updateEnvironmentClassification(spectrum);

            return true;
        }

        return false;
    }

    /**
     * 归一化频谱数据
     */
    normalizeSpectrum(rawData) {
        const normalized = new Float32Array(rawData.length);

        for (let i = 0; i < rawData.length; i++) {
            normalized[i] = rawData[i] / 255.0;
        }

        return normalized;
    }

    /**
     * 判断是否为噪音样本
     */
    isLikelyNoise(spectrum) {
        // 计算频谱特征
        const spectralCentroid = this.calculateSpectralCentroid(spectrum);
        const spectralFlatness = this.calculateSpectralFlatness(spectrum);
        const energy = spectrum.reduce((sum, val) => sum + val * val, 0);

        // 噪音特征：
        // 1. 能量较低
        // 2. 频谱相对平坦
        // 3. 没有明显的谐波结构
        const isLowEnergy = energy < 0.1;
        const isFlat = spectralFlatness > 0.5;

        return isLowEnergy && isFlat;
    }

    /**
     * 计算频谱质心
     */
    calculateSpectralCentroid(spectrum) {
        let weightedSum = 0;
        let magnitudeSum = 0;

        for (let i = 0; i < spectrum.length; i++) {
            const frequency = i * (this.sampleRate / 2) / spectrum.length;
            weightedSum += frequency * spectrum[i];
            magnitudeSum += spectrum[i];
        }

        return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
    }

    /**
     * 计算频谱平坦度
     */
    calculateSpectralFlatness(spectrum) {
        let geometricMean = 1;
        let arithmeticMean = 0;
        let count = 0;

        for (let i = 1; i < spectrum.length; i++) { // 跳过DC分量
            if (spectrum[i] > 0) {
                geometricMean *= Math.pow(spectrum[i], 1.0 / (spectrum.length - 1));
                arithmeticMean += spectrum[i];
                count++;
            }
        }

        arithmeticMean /= count;

        return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;
    }

    /**
     * 更新环境分类
     */
    updateEnvironmentClassification(spectrum) {
        const energy = spectrum.reduce((sum, val) => sum + val * val, 0);
        const flatness = this.calculateSpectralFlatness(spectrum);

        // 根据能量和频谱特征分类环境
        if (energy < 0.05 && flatness > 0.7) {
            this.adaptiveParameters.environmentType = 'quiet';
        } else if (energy < 0.2 && flatness > 0.4) {
            this.adaptiveParameters.environmentType = 'normal';
        } else {
            this.adaptiveParameters.environmentType = 'noisy';
        }

        // 分析噪音类型
        this.analyzeNoiseType(spectrum);
    }

    /**
     * 分析噪音类型
     */
    analyzeNoiseType(spectrum) {
        const nyquist = this.sampleRate / 2;
        const binWidth = nyquist / spectrum.length;

        // 分析低频、中频、高频能量分布
        const lowFreqEnd = Math.floor(500 / binWidth);
        const midFreqEnd = Math.floor(2000 / binWidth);

        let lowEnergy = 0, midEnergy = 0, highEnergy = 0;

        for (let i = 0; i < spectrum.length; i++) {
            const energy = spectrum[i] * spectrum[i];
            if (i < lowFreqEnd) {
                lowEnergy += energy;
            } else if (i < midFreqEnd) {
                midEnergy += energy;
            } else {
                highEnergy += energy;
            }
        }

        const totalEnergy = lowEnergy + midEnergy + highEnergy;
        if (totalEnergy === 0) return;

        const lowRatio = lowEnergy / totalEnergy;
        const highRatio = highEnergy / totalEnergy;

        // 根据频率分布判断噪音类型
        if (lowRatio > 0.6) {
            this.adaptiveParameters.dominantNoiseType = 'brown'; // 低频为主
        } else if (highRatio > 0.5) {
            this.adaptiveParameters.dominantNoiseType = 'white'; // 高频较多
        } else {
            this.adaptiveParameters.dominantNoiseType = 'pink';  // 相对平衡
        }
    }

    /**
     * 主要降噪处理方法
     */
    process(rawSpectrumData) {
        const startTime = performance.now();

        // 归一化输入
        const inputSpectrum = this.normalizeSpectrum(rawSpectrumData);
        this.buffers.inputSpectrum.set(inputSpectrum);

        // 尝试学习噪音轮廓
        this.learnNoiseProfile(inputSpectrum);

        // 应用多重降噪算法
        let processedSpectrum = new Float32Array(inputSpectrum);

        if (this.algorithms.spectralSubtraction.enabled) {
            processedSpectrum = this.applySpectralSubtraction(processedSpectrum);
        }

        if (this.algorithms.adaptiveFilter.enabled) {
            processedSpectrum = this.applyAdaptiveFiltering(processedSpectrum);
        }

        if (this.algorithms.gatingFilter.enabled) {
            processedSpectrum = this.applyNoiseGating(processedSpectrum);
        }

        // 应用自适应陷波滤波器
        processedSpectrum = this.applyAdaptiveNotchFilters(processedSpectrum);

        // 后处理：平滑和限制
        processedSpectrum = this.postProcess(processedSpectrum);

        this.buffers.cleanSpectrum.set(processedSpectrum);

        // 更新统计信息
        this.updateStatistics(inputSpectrum, processedSpectrum, performance.now() - startTime);

        return processedSpectrum;
    }

    /**
     * 频谱减法降噪
     */
    applySpectralSubtraction(spectrum) {
        const result = new Float32Array(spectrum.length);
        const config = this.algorithms.spectralSubtraction;

        for (let i = 0; i < spectrum.length; i++) {
            const signal = spectrum[i];
            const noise = this.noiseProfile.spectrum[i];
            const noiseVariance = this.noiseProfile.variance[i];

            // 自适应过减法因子
            const adaptiveFactor = config.overSubtractionFactor *
                (1 + Math.sqrt(noiseVariance));

            // 计算增益
            const noisyPower = signal * signal;
            const noisePower = noise * noise * adaptiveFactor;

            let gain = 1;
            if (noisyPower > noisePower) {
                gain = Math.sqrt((noisyPower - noisePower) / noisyPower);
            } else {
                gain = config.spectralFloor;
            }

            // 应用增益，但保持最小频谱底噪
            result[i] = Math.max(signal * gain, signal * config.spectralFloor);
        }

        return result;
    }

    /**
     * 自适应滤波
     */
    applyAdaptiveFiltering(spectrum) {
        const result = new Float32Array(spectrum);
        const config = this.algorithms.adaptiveFilter;

        // LMS自适应滤波器简化实现
        for (let i = 1; i < spectrum.length - 1; i++) {
            const predicted = (this.buffers.cleanSpectrum[i - 1] + this.buffers.cleanSpectrum[i + 1]) / 2;
            const error = spectrum[i] - predicted;

            // 如果误差小，说明可能是噪音
            if (Math.abs(error) < 0.05) {
                result[i] = predicted * (1 - config.learningRate) + spectrum[i] * config.learningRate;
            }
        }

        return result;
    }

    /**
     * 噪音门限
     */
    applyNoiseGating(spectrum) {
        const result = new Float32Array(spectrum);
        const config = this.algorithms.gatingFilter;

        // 计算当前帧的总能量
        const energy = spectrum.reduce((sum, val) => sum + val * val, 0) / spectrum.length;

        // 自适应阈值
        const adaptiveThreshold = config.threshold *
            (1 + this.adaptiveParameters.noiseFloor * 10);

        // 门限控制
        if (energy < adaptiveThreshold) {
            // 信号太弱，应用强衰减
            const gateGain = Math.max(0.01, energy / adaptiveThreshold);
            for (let i = 0; i < result.length; i++) {
                result[i] *= gateGain;
            }
        }

        return result;
    }

    /**
     * 自适应陷波滤波器
     */
    applyAdaptiveNotchFilters(spectrum) {
        const result = new Float32Array(spectrum);

        // 对每个陷波点应用滤波
        this.frequencyAnalysis.adaptiveNotches.forEach(notch => {
            if (notch.bin < result.length) {
                // 检查该频率是否确实有问题
                const localPower = result[notch.bin] * result[notch.bin];
                const neighborAvg = this.getNeighborAverage(result, notch.bin, 2);

                // 如果该频率明显高于周围频率，则抑制
                if (localPower > neighborAvg * 2) {
                    result[notch.bin] *= (1 - notch.strength);
                }
            }
        });

        return result;
    }

    /**
     * 获取邻近频率的平均值
     */
    getNeighborAverage(spectrum, centerBin, radius) {
        let sum = 0;
        let count = 0;

        for (let i = centerBin - radius; i <= centerBin + radius; i++) {
            if (i >= 0 && i < spectrum.length && i !== centerBin) {
                sum += spectrum[i] * spectrum[i];
                count++;
            }
        }

        return count > 0 ? sum / count : 0;
    }

    /**
     * 后处理
     */
    postProcess(spectrum) {
        const result = new Float32Array(spectrum);

        // 频谱平滑
        for (let i = 1; i < result.length - 1; i++) {
            result[i] = 0.25 * result[i - 1] + 0.5 * result[i] + 0.25 * result[i + 1];
        }

        // 限制动态范围
        const maxVal = Math.max(...result);
        if (maxVal > 1.0) {
            for (let i = 0; i < result.length; i++) {
                result[i] = Math.tanh(result[i]); // 软限制
            }
        }

        return result;
    }

    /**
     * 更新统计信息
     */
    updateStatistics(input, output, processingTime) {
        this.stats.totalProcessed++;

        // 计算降噪比
        const inputEnergy = input.reduce((sum, val) => sum + val * val, 0);
        const outputEnergy = output.reduce((sum, val) => sum + val * val, 0);

        if (inputEnergy > 0) {
            const currentReduction = 1 - (outputEnergy / inputEnergy);
            this.stats.noiseReductionRatio =
                (this.stats.noiseReductionRatio + currentReduction) / 2;
        }

        // 更新处理时间
        this.stats.averageProcessingTime =
            (this.stats.averageProcessingTime + processingTime) / 2;

        // 更新质量指标
        this.updateQualityMetrics(input, output);
    }

    /**
     * 更新质量指标
     */
    updateQualityMetrics(input, output) {
        // 简化的SNR估算
        const signalPower = output.reduce((sum, val) => sum + val * val, 0);
        const noisePower = this.noiseProfile.spectrum.reduce((sum, val) => sum + val * val, 0);

        if (noisePower > 0) {
            this.stats.qualityMetrics.snr = 10 * Math.log10(signalPower / noisePower);
        }

        // 清晰度指标（高频保持度）
        const highFreqStart = Math.floor(output.length * 0.7);
        let inputHighFreq = 0, outputHighFreq = 0;

        for (let i = highFreqStart; i < output.length; i++) {
            inputHighFreq += input[i];
            outputHighFreq += output[i];
        }

        this.stats.qualityMetrics.clarity =
            inputHighFreq > 0 ? outputHighFreq / inputHighFreq : 1;
    }

    /**
     * 获取处理器状态
     */
    getStatus() {
        return {
            environmentType: this.adaptiveParameters.environmentType,
            noiseType: this.adaptiveParameters.dominantNoiseType,
            noiseProfileConfidence: Math.min(1, this.noiseProfile.updateCount / 100),
            stats: this.stats,
            adaptiveNotches: this.frequencyAnalysis.adaptiveNotches.length
        };
    }

    /**
     * 配置算法参数
     */
    configure(newConfig) {
        Object.assign(this.algorithms, newConfig);
        console.log('降噪处理器配置已更新');
    }

    /**
     * 重置处理器
     */
    reset() {
        this.noiseProfile.spectrum.fill(0);
        this.noiseProfile.variance.fill(0);
        this.noiseProfile.updateCount = 0;
        this.buffers.cleanSpectrum.fill(0);

        this.stats = {
            totalProcessed: 0,
            noiseReductionRatio: 0,
            averageProcessingTime: 0,
            qualityMetrics: { snr: 0, thd: 0, clarity: 0 }
        };

        console.log('降噪处理器已重置');
    }
}

// 导出模块
if (typeof window !== 'undefined') {
    window.NoiseReductionProcessor = NoiseReductionProcessor;
}