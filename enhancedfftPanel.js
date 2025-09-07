// enhanced-fftPanel.js — 根据导师要求改进的FFT频谱面板
// 新增功能：
// 1. 坐标与显示：混合轴（0-200Hz线性 + 200Hz-20kHz对数）
// 2. 阈值/增益：自动校准噪底 + 可视化调节
// 3. 噪声补偿：高通滤波 + 可选带阻
// 4. 启发式分类：基于频域特征的鼓击分类

(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Panel = {
        // === 基础配置 ===
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _fft: null,
        _bins: 2048,  // 提高分辨率
        _smooth: 0.85,
        _bg: '#111319',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,
        _vscale: 2.5,
        _liftPx: 0,

        // === 1. 坐标与显示配置 ===
        _axisMode: 'hybrid_enhanced',  // 新的混合模式
        _linearEndHz: 200,             // 线性部分结束频率
        _logStartHz: 200,              // 对数部分开始频率
        _maxFreqHz: 20000,             // 最大频率
        _yLogScale: true,              // y轴对数缩放
        _antiFlicker: true,            // 抗闪烁
        _movingAvgWindow: 3,           // 移动平均窗口

        // === 2. 阈值/增益配置 ===
        _autoCalibration: true,        // 自动校准
        _noiseFloor: 0.001,           // 噪底
        _inputGain: 1.0,              // 输入增益
        _triggerThreshold: 0.02,      // 触发阈值
        _calibrationSamples: 0,       // 校准采样计数
        _calibrationBuffer: [],       // 校准缓冲区

        // === 3. 噪声补偿配置 ===
        _highPassEnabled: true,       // 高通滤波开关
        _highPassCutoff: 45,          // 高通截止频率
        _notchEnabled: false,         // 带阻滤波开关
        _notchCenter: 150,            // 带阻中心频率
        _notchWidth: 50,              // 带阻宽度

        // === 4. 启发式分类配置 ===
        _classificationEnabled: true,  // 分类开关
        _energyThresholds: {          // 能量阈值
            slap: 0.3,    // 4kHz以上强能量
            bass: 0.4,    // 低频强能量
            touch: 0.1    // 轻触阈值
        },
        _frequencyBands: {            // 频带定义
            low: [40, 200],
            mid: [200, 1000],
            high: [1000, 4000],
            ultra: [4000, 20000]
        },

        // === 历史数据缓存（抗闪烁）===
        _spectrumHistory: [],
        _smoothedSpectrum: null,

        // === 校准状态 ===
        _isCalibrating: false,
        _calibrationStartTime: 0,

        // ==================== 配置方法 ====================

        setAxis(opts = {}) {
            if (opts.linearEnd) this._linearEndHz = Math.max(50, opts.linearEnd);
            if (opts.logStart) this._logStartHz = Math.max(this._linearEndHz, opts.logStart);
            if (opts.maxFreq) this._maxFreqHz = Math.max(1000, opts.maxFreq);
            if (opts.yLogScale !== undefined) this._yLogScale = !!opts.yLogScale;
            if (opts.antiFlicker !== undefined) this._antiFlicker = !!opts.antiFlicker;
            return this;
        },

        setNoiseCompensation(opts = {}) {
            if (opts.highPass !== undefined) this._highPassEnabled = !!opts.highPass;
            if (opts.highPassCutoff) this._highPassCutoff = Math.max(20, opts.highPassCutoff);
            if (opts.notch !== undefined) this._notchEnabled = !!opts.notch;
            if (opts.notchCenter) this._notchCenter = Math.max(50, opts.notchCenter);
            if (opts.notchWidth) this._notchWidth = Math.max(10, opts.notchWidth);
            return this;
        },

        setClassification(opts = {}) {
            if (opts.enabled !== undefined) this._classificationEnabled = !!opts.enabled;
            if (opts.thresholds) Object.assign(this._energyThresholds, opts.thresholds);
            if (opts.bands) Object.assign(this._frequencyBands, opts.bands);
            return this;
        },

        setCalibration(opts = {}) {
            if (opts.auto !== undefined) this._autoCalibration = !!opts.auto;
            if (opts.gain) this._inputGain = Math.max(0.1, opts.gain);
            if (opts.threshold) this._triggerThreshold = Math.max(0.001, opts.threshold);
            return this;
        },

        // ==================== 初始化 ====================

        init({ mic, rectProvider, bins = 2048, smoothing = 0.85, vscale = 1.12, lift = 12 } = {}) {
            this._rect = rectProvider || this._rect;
            this._bins = Math.max(512, bins | 0);
            this._smooth = clamp(smoothing, 0, 0.99);
            this._vscale = vscale;
            this._liftPx = lift;

            this._fft = new p5.FFT(this._smooth, this._bins);
            if (mic) this._fft.setInput(mic);

            // 初始化历史缓存
            this._spectrumHistory = [];
            this._smoothedSpectrum = null;

            return this;
        },

        // ==================== 噪底校准 ====================

        startCalibration(durationMs = 3000) {
            console.log('开始噪底校准，请保持安静...');
            this._isCalibrating = true;
            this._calibrationStartTime = millis();
            this._calibrationBuffer = [];
            this._calibrationSamples = 0;

            setTimeout(() => {
                this._finishCalibration();
            }, durationMs);
        },

        _finishCalibration() {
            if (this._calibrationBuffer.length === 0) {
                console.warn('校准失败：无数据');
                this._isCalibrating = false;
                return;
            }

            // 计算噪底（取平均值的1.2倍作为安全边界）
            const avgNoise = this._calibrationBuffer.reduce((a, b) => a + b, 0) / this._calibrationBuffer.length;
            this._noiseFloor = avgNoise * 1.2;
            this._triggerThreshold = Math.max(this._noiseFloor * 3, 0.01);

            console.log(`噪底校准完成: ${this._noiseFloor.toFixed(4)} -> 触发阈值: ${this._triggerThreshold.toFixed(4)}`);
            this._isCalibrating = false;
        },

        // ==================== 频谱处理 ====================

        _processSpectrum(rawSpectrum) {
            if (!rawSpectrum) return null;

            const N = rawSpectrum.length;
            const nyquist = sampleRate() / 2;
            let spectrum = new Array(N);

            // 1. 应用输入增益
            for (let i = 0; i < N; i++) {
                spectrum[i] = (rawSpectrum[i] / 255) * this._inputGain;
            }

            // 2. 噪声补偿
            if (this._highPassEnabled) {
                spectrum = this._applyHighPass(spectrum, nyquist);
            }

            if (this._notchEnabled) {
                spectrum = this._applyNotchFilter(spectrum, nyquist);
            }

            // 3. 去负值处理（clamp到噪底以上）
            for (let i = 0; i < N; i++) {
                spectrum[i] = Math.max(spectrum[i], this._noiseFloor);
            }

            // 4. 抗闪烁处理
            if (this._antiFlicker) {
                spectrum = this._applySmoothening(spectrum);
            }

            // 5. y轴对数缩放
            if (this._yLogScale) {
                for (let i = 0; i < N; i++) {
                    spectrum[i] = Math.log10(spectrum[i] * 9 + 1); // log10(x*9+1) 避免log(0)
                }
            }

            return spectrum;
        },

        _applyHighPass(spectrum, nyquist) {
            const N = spectrum.length;
            const cutoffBin = Math.floor((this._highPassCutoff / nyquist) * N);

            for (let i = 0; i < cutoffBin; i++) {
                const rolloff = i / cutoffBin; // 0到1的渐变
                spectrum[i] *= rolloff * rolloff; // 平方衰减
            }

            return spectrum;
        },

        _applyNotchFilter(spectrum, nyquist) {
            const N = spectrum.length;
            const centerBin = Math.floor((this._notchCenter / nyquist) * N);
            const halfWidth = Math.floor((this._notchWidth / 2 / nyquist) * N);

            for (let i = Math.max(0, centerBin - halfWidth);
                i <= Math.min(N - 1, centerBin + halfWidth); i++) {
                const distance = Math.abs(i - centerBin);
                const attenuation = 1 - Math.exp(-distance * distance / (halfWidth * halfWidth / 4));
                spectrum[i] *= attenuation;
            }

            return spectrum;
        },

        _applySmoothening(spectrum) {
            // 添加到历史缓存
            this._spectrumHistory.push([...spectrum]);

            // 保持窗口大小
            while (this._spectrumHistory.length > this._movingAvgWindow) {
                this._spectrumHistory.shift();
            }

            // 计算移动平均
            const N = spectrum.length;
            const smoothed = new Array(N).fill(0);

            for (let i = 0; i < N; i++) {
                for (let h = 0; h < this._spectrumHistory.length; h++) {
                    smoothed[i] += this._spectrumHistory[h][i];
                }
                smoothed[i] /= this._spectrumHistory.length;
            }

            return smoothed;
        },

        // ==================== 启发式分类 ====================

        classifyHit(spectrum) {
            if (!this._classificationEnabled || !spectrum) {
                return { type: 'unknown', confidence: 0, features: {} };
            }

            const features = this._extractFeatures(spectrum);
            const classification = this._applyHeuristicRules(features);

            return {
                type: classification.type,
                confidence: classification.confidence,
                features: features
            };
        },

        _extractFeatures(spectrum) {
            const N = spectrum.length;
            const nyquist = sampleRate() / 2;

            const getBandEnergy = (freqRange) => {
                const startBin = Math.floor((freqRange[0] / nyquist) * N);
                const endBin = Math.floor((freqRange[1] / nyquist) * N);
                let energy = 0;
                for (let i = startBin; i <= endBin && i < N; i++) {
                    energy += spectrum[i] * spectrum[i];
                }
                return energy / (endBin - startBin + 1);
            };

            const getPeakFreq = () => {
                let maxVal = 0, maxIdx = 0;
                for (let i = 1; i < N; i++) {
                    if (spectrum[i] > maxVal) {
                        maxVal = spectrum[i];
                        maxIdx = i;
                    }
                }
                return (maxIdx / N) * nyquist;
            };

            return {
                lowEnergy: getBandEnergy(this._frequencyBands.low),
                midEnergy: getBandEnergy(this._frequencyBands.mid),
                highEnergy: getBandEnergy(this._frequencyBands.high),
                ultraEnergy: getBandEnergy(this._frequencyBands.ultra),
                peakFreq: getPeakFreq(),
                totalEnergy: getBandEnergy([20, nyquist])
            };
        },

        _applyHeuristicRules(features) {
            const { lowEnergy, midEnergy, highEnergy, ultraEnergy, peakFreq, totalEnergy } = features;

            // 规则1: Slap - 4kHz以上强能量
            if (ultraEnergy > this._energyThresholds.slap && ultraEnergy / totalEnergy > 0.3) {
                return { type: 'slap', confidence: 0.8 + (ultraEnergy / totalEnergy) * 0.2 };
            }

            // 规则2: Bass - 低频占优
            if (lowEnergy > this._energyThresholds.bass && lowEnergy / totalEnergy > 0.5) {
                return { type: 'bass', confidence: 0.7 + (lowEnergy / totalEnergy) * 0.3 };
            }

            // 规则3: Open - 根据峰值频率判断high/low
            if (midEnergy + highEnergy > this._energyThresholds.slap * 0.6) {
                if (peakFreq > 500) {
                    return { type: 'open_high', confidence: 0.6 };
                } else {
                    return { type: 'open_low', confidence: 0.6 };
                }
            }

            // 规则4: Touch - 总能量较低
            if (totalEnergy < this._energyThresholds.touch) {
                return { type: 'touch', confidence: 0.5 };
            }

            // 默认
            return { type: 'unknown', confidence: 0.3 };
        },

        // ==================== x轴映射 ====================

        _mapFreqToX(fHz, innerW) {
            if (fHz <= this._linearEndHz) {
                // 线性部分: 0-200Hz
                return (fHz / this._linearEndHz) * (innerW * 0.3); // 占30%宽度
            } else {
                // 对数部分: 200Hz-20kHz
                const logStart = Math.log10(this._logStartHz);
                const logEnd = Math.log10(this._maxFreqHz);
                const logF = Math.log10(Math.max(fHz, this._logStartHz));
                const logProgress = (logF - logStart) / (logEnd - logStart);
                return (innerW * 0.3) + logProgress * (innerW * 0.7); // 占70%宽度
            }
        },

        // ==================== 坐标轴绘制 ====================

        _drawEnhancedXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB) {
            const baseY = y + h - padB + 0.5;

            ctx.save();
            // 底线
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + padL, baseY);
            ctx.lineTo(x + w - padR, baseY);
            ctx.stroke();

            // 定义刻度点（按要求8-9个标签）
            const majorTicks = [0, 50, 100, 200, 500, 1000, 5000, 10000, 20000];
            const minorTicks = [25, 75, 150, 300, 750, 2000, 3000, 7000, 15000];

            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = 'bold 11px ui-sans-serif, system-ui, -apple-system';

            // 次刻度（细线）
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            for (const f of minorTicks) {
                if (f <= nyquist) {
                    const px = x + padL + this._mapFreqToX(f, innerW);
                    if (px >= x + padL && px <= x + w - padR) {
                        ctx.beginPath();
                        ctx.moveTo(px + 0.5, y + padT + 8);
                        ctx.lineTo(px + 0.5, baseY - 2);
                        ctx.stroke();
                    }
                }
            }

            // 主刻度（粗线 + 标签）
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1;
            for (const f of majorTicks) {
                if (f <= nyquist) {
                    const px = x + padL + this._mapFreqToX(f, innerW);
                    if (px >= x + padL && px <= x + w - padR) {
                        // 刻度线
                        ctx.beginPath();
                        ctx.moveTo(px + 0.5, y + padT);
                        ctx.lineTo(px + 0.5, baseY);
                        ctx.stroke();

                        // 标签
                        if (f > 0) {
                            let label;
                            if (f >= 1000) {
                                label = (f / 1000) + 'k';
                            } else {
                                label = '' + f;
                            }

                            ctx.fillStyle = 'rgba(255,255,255,0.75)';
                            ctx.fillText(label, px, baseY + 3);
                        }
                    }
                }
            }

            // 频带分界线标注
            const drawBandMarker = (freq, color, label) => {
                const px = x + padL + this._mapFreqToX(freq, innerW);
                if (px >= x + padL && px <= x + w - padR) {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(px + 0.5, y + padT);
                    ctx.lineTo(px + 0.5, baseY);
                    ctx.stroke();

                    ctx.fillStyle = color;
                    ctx.font = 'bold 10px ui-sans-serif';
                    ctx.fillText(label, px, y + padT + 15);
                }
            };

            // 标注关键频带
            drawBandMarker(this._linearEndHz, 'rgba(255, 165, 0, 0.7)', 'LIN|LOG');
            drawBandMarker(4000, 'rgba(255, 100, 100, 0.7)', '4kHz');

            ctx.restore();
        },

        // ==================== 主渲染方法 ====================

        render(ctx, x, y, w, h) {
            const r = this._rect();
            if (r && r.w && r.h) { x = r.x; y = r.y; w = r.w; h = r.h; }
            if (!w || !h || !this._fft) return;

            // 绘制背景
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);

            // 获取和处理频谱数据
            const rawSpectrum = this._fft.analyze();
            const spectrum = this._processSpectrum(rawSpectrum);

            if (!spectrum) return;

            const N = spectrum.length;
            const nyquist = sampleRate() / 2;

            // 校准处理
            if (this._autoCalibration && this._isCalibrating) {
                const avgLevel = spectrum.reduce((a, b) => a + b, 0) / N;
                this._calibrationBuffer.push(avgLevel);
                this._calibrationSamples++;
            }

            // 分类分析
            const classification = this.classifyHit(spectrum);

            // 内边距
            const padL = 10, padR = 10, padT = 6, padB = 14 + this._liftPx;
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;

            // 绘制频谱柱状图
            push();
            translate(x + padL, y + padT);
            colorMode(HSB, 255);
            noStroke();

            const numCols = Math.max(1, Math.floor(innerW));
            for (let col = 0; col < numCols; col++) {
                const xL = col, xR = col + 1;

                // 逆映射找频率区间
                const invMap = (targetX) => {
                    if (targetX <= innerW * 0.3) {
                        // 线性部分
                        return (targetX / (innerW * 0.3)) * this._linearEndHz;
                    } else {
                        // 对数部分
                        const logProgress = (targetX - innerW * 0.3) / (innerW * 0.7);
                        const logStart = Math.log10(this._logStartHz);
                        const logEnd = Math.log10(this._maxFreqHz);
                        const logF = logStart + logProgress * (logEnd - logStart);
                        return Math.pow(10, logF);
                    }
                };

                const fL = invMap(xL);
                const fR = invMap(xR);

                const i0 = Math.max(0, Math.floor((fL / nyquist) * N));
                const i1 = Math.min(N - 1, Math.ceil((fR / nyquist) * N));
                let maxV = 0;
                for (let k = i0; k <= i1; k++) if (spectrum[k] > maxV) maxV = spectrum[k];

                const barH = Math.min(innerH - 1, maxV * innerH * this._vscale);
                const midHz = (fL + fR) * 0.5;

                // 根据频带着色
                let hue;
                if (midHz < 200) hue = 240;      // 蓝色 - 低频
                else if (midHz < 1000) hue = 120; // 绿色 - 中频
                else if (midHz < 4000) hue = 60;  // 黄色 - 高频
                else hue = 0;                     // 红色 - 超高频

                fill(hue, 255, 255);
                rect(col, innerH - barH, 1, barH);
            }
            pop();

            // 绘制坐标轴
            this._drawEnhancedXAxis(ctx, x, y, w, h, nyquist, innerW, padL, padR, padT, padB);

            // 绘制状态信息
            this._drawStatusInfo(ctx, x, y, w, h, classification);
        },

        _drawStatusInfo(ctx, x, y, w, h, classification) {
            ctx.save();
            ctx.textBaseline = 'top';

            // 标题
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 16px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left';
            ctx.fillText('Enhanced FFT', x + 12, y + 10);

            // 校准状态
            if (this._isCalibrating) {
                ctx.fillStyle = 'rgba(255, 165, 0, 0.9)';
                ctx.font = 'bold 14px ui-sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('CALIBRATING...', x + w / 2, y + 8);
            }

            // 分类结果
            if (classification.type !== 'unknown') {
                ctx.fillStyle = 'rgba(0, 255, 100, 0.8)';
                ctx.font = 'bold 14px ui-sans-serif';
                ctx.textAlign = 'right';
                const confStr = `${classification.type} (${(classification.confidence * 100).toFixed(0)}%)`;
                ctx.fillText(confStr, x + w - 12, y + 8);
            }

            // 噪底和阈值显示
            ctx.fillStyle = 'rgba(200,200,200,0.7)';
            ctx.font = '10px ui-sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`Noise: ${this._noiseFloor.toFixed(4)} | Threshold: ${this._triggerThreshold.toFixed(3)}`,
                x + 12, y + h - 15);

            ctx.restore();
        },

        // ==================== 辅助方法 ====================

        _roundRect(ctx, x, y, w, h, r, fill, stroke) {
            const rr = clamp(r, 0, Math.min(w, h) / 2);
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
            ctx.restore();
        },

        // 获取当前配置状态
        getConfig() {
            return {
                axis: {
                    linearEnd: this._linearEndHz,
                    logStart: this._logStartHz,
                    maxFreq: this._maxFreqHz,
                    yLogScale: this._yLogScale
                },
                noise: {
                    highPass: this._highPassEnabled,
                    highPassCutoff: this._highPassCutoff,
                    notch: this._notchEnabled,
                    notchCenter: this._notchCenter
                },
                calibration: {
                    noiseFloor: this._noiseFloor,
                    threshold: this._triggerThreshold,
                    gain: this._inputGain
                },
                classification: {
                    enabled: this._classificationEnabled,
                    thresholds: this._energyThresholds
                }
            };
        }
    };

    root.EnhancedFFTPanel = Panel;
})(window);