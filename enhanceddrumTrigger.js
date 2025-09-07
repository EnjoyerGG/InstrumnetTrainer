// enhanced-drumTrigger.js — 集成新FFT分析的增强鼓击检测器
// 结合启发式分类和自适应阈值调节

(function (root) {

    const EnhancedDrumTrigger = {
        // === 基础配置 ===
        _mic: null,
        _fftPanel: null,  // 引用增强的FFT面板
        _isEnabled: false,
        _sensitivity: 0.8,
        _onTrigger: null,
        _debug: false,

        // === 分类相关 ===
        _classificationEnabled: true,
        _lastClassification: null,
        _classificationHistory: [],
        _confidenceThreshold: 0.5,

        // === 自适应阈值 ===
        _adaptiveThreshold: true,
        _baseThreshold: 0.02,
        _dynamicThreshold: 0.02,
        _backgroundLevel: 0.001,
        _adaptationRate: 0.1,

        // === 触发控制 ===
        _triggerCooldown: 150,  // 毫秒
        _lastTriggerTime: 0,
        _triggerCount: 0,

        // === 性能监控 ===
        _stats: {
            totalTriggers: 0,
            classificationResults: {},
            falsePositives: 0,
            averageConfidence: 0
        },

        // ==================== 初始化 ====================

        init({ mic, fftPanel, debug = false, onTrigger = null } = {}) {
            this._mic = mic;
            this._fftPanel = fftPanel;
            this._debug = debug;
            this._onTrigger = onTrigger;

            // 初始化统计
            this._resetStats();

            console.log('增强鼓击检测器初始化完成');
            return this;
        },

        // ==================== 配置方法 ====================

        setClassification(enabled = true, confidenceThreshold = 0.5) {
            this._classificationEnabled = enabled;
            this._confidenceThreshold = Math.max(0.1, Math.min(1.0, confidenceThreshold));
            return this;
        },

        setAdaptiveThreshold(enabled = true, adaptationRate = 0.1) {
            this._adaptiveThreshold = enabled;
            this._adaptationRate = Math.max(0.01, Math.min(0.5, adaptationRate));
            return this;
        },

        setSensitivity(level) {
            this._sensitivity = Math.max(0.1, Math.min(1.0, level));
            this._updateThresholds();
            return this;
        },

        setDebug(enabled) {
            this._debug = enabled;
            return this;
        },

        enable(enabled) {
            this._isEnabled = enabled;
            if (enabled) {
                this._startBackgroundMonitoring();
            }
            return this;
        },

        // ==================== 核心检测逻辑 ====================

        update() {
            if (!this._isEnabled || !this._mic || !this._fftPanel) return;

            try {
                // 获取当前音频级别
                const currentLevel = this._mic.getLevel();

                // 更新背景噪声级别
                this._updateBackgroundLevel(currentLevel);

                // 更新动态阈值
                this._updateDynamicThreshold();

                // 检查触发条件
                if (this._shouldTrigger(currentLevel)) {
                    this._processTrigger();
                }

                // 定期清理历史数据
                this._cleanupHistory();

            } catch (error) {
                if (this._debug) console.error('检测更新错误:', error);
            }
        },

        _shouldTrigger(currentLevel) {
            // 1. 基础级别检查
            if (currentLevel < this._dynamicThreshold) return false;

            // 2. 冷却时间检查
            const now = millis();
            if (now - this._lastTriggerTime < this._triggerCooldown) return false;

            // 3. 信噪比检查
            const snr = currentLevel / Math.max(this._backgroundLevel, 0.0001);
            if (snr < 3.0) return false; // 至少3倍于背景噪声

            return true;
        },

        _processTrigger() {
            const now = millis();
            this._lastTriggerTime = now;
            this._triggerCount++;

            // 获取FFT分类结果
            let classification = null;
            if (this._classificationEnabled && this._fftPanel) {
                try {
                    // 获取当前频谱数据进行分类
                    const rawSpectrum = this._fftPanel._fft?.analyze();
                    if (rawSpectrum) {
                        const processedSpectrum = this._fftPanel._processSpectrum(rawSpectrum);
                        classification = this._fftPanel.classifyHit(processedSpectrum);
                    }
                } catch (error) {
                    if (this._debug) console.warn('分类失败:', error);
                }
            }

            // 验证分类置信度
            const isValidClassification = classification &&
                classification.confidence >= this._confidenceThreshold;

            if (isValidClassification) {
                this._lastClassification = classification;
                this._updateClassificationHistory(classification);
                this._updateStats(classification);

                if (this._debug) {
                    console.log(`鼓击检测: ${classification.type} (置信度: ${(classification.confidence * 100).toFixed(1)}%)`);
                }

                // 触发回调
                if (this._onTrigger) {
                    this._onTrigger(classification.type, classification);
                }
            } else {
                // 分类失败或置信度不足，使用通用触发
                if (this._debug) {
                    console.log('通用鼓击检测 (分类失败或置信度不足)');
                }

                if (this._onTrigger) {
                    this._onTrigger('generic', { type: 'generic', confidence: 0.3 });
                }
            }
        },

        // ==================== 自适应阈值管理 ====================

        _updateBackgroundLevel(currentLevel) {
            // 仅在较低级别时更新背景噪声
            if (currentLevel < this._baseThreshold * 2) {
                const alpha = 0.01; // 很慢的更新速率
                this._backgroundLevel = (1 - alpha) * this._backgroundLevel + alpha * currentLevel;
            }
        },

        _updateDynamicThreshold() {
            if (!this._adaptiveThreshold) {
                this._dynamicThreshold = this._baseThreshold * this._sensitivity;
                return;
            }

            // 基于背景噪声和敏感度计算动态阈值
            const noiseFactor = Math.max(3.0, 5.0 / this._sensitivity); // 敏感度越高，倍数越低
            const noiseBasedThreshold = this._backgroundLevel * noiseFactor;
            const sensitivityBasedThreshold = this._baseThreshold * this._sensitivity;

            // 取两者中较大值，确保在噪声环境中不会过于敏感
            const newThreshold = Math.max(noiseBasedThreshold, sensitivityBasedThreshold);

            // 平滑更新
            const alpha = this._adaptationRate;
            this._dynamicThreshold = (1 - alpha) * this._dynamicThreshold + alpha * newThreshold;
        },

        _updateThresholds() {
            // 当敏感度改变时立即更新阈值
            this._updateDynamicThreshold();
        },

        // ==================== 分类历史管理 ====================

        _updateClassificationHistory(classification) {
            this._classificationHistory.push({
                type: classification.type,
                confidence: classification.confidence,
                timestamp: millis(),
                features: classification.features
            });

            // 保持历史记录在合理大小
            if (this._classificationHistory.length > 50) {
                this._classificationHistory.shift();
            }
        },

        _cleanupHistory() {
            const now = millis();
            const maxAge = 30000; // 30秒

            this._classificationHistory = this._classificationHistory.filter(
                entry => now - entry.timestamp < maxAge
            );
        },

        // ==================== 统计和分析 ====================

        _resetStats() {
            this._stats = {
                totalTriggers: 0,
                classificationResults: {},
                falsePositives: 0,
                averageConfidence: 0,
                sessionStartTime: millis()
            };
        },

        _updateStats(classification) {
            this._stats.totalTriggers++;

            // 更新分类计数
            const type = classification.type;
            if (!this._stats.classificationResults[type]) {
                this._stats.classificationResults[type] = { count: 0, totalConfidence: 0 };
            }
            this._stats.classificationResults[type].count++;
            this._stats.classificationResults[type].totalConfidence += classification.confidence;

            // 更新平均置信度
            let totalConfidence = 0;
            let totalCount = 0;
            for (const type in this._stats.classificationResults) {
                totalConfidence += this._stats.classificationResults[type].totalConfidence;
                totalCount += this._stats.classificationResults[type].count;
            }
            this._stats.averageConfidence = totalCount > 0 ? totalConfidence / totalCount : 0;
        },

        getStats() {
            const sessionDuration = (millis() - this._stats.sessionStartTime) / 1000;
            const triggersPerMinute = this._stats.totalTriggers / (sessionDuration / 60);

            return {
                ...this._stats,
                sessionDuration: sessionDuration,
                triggersPerMinute: triggersPerMinute,
                currentThreshold: this._dynamicThreshold,
                backgroundLevel: this._backgroundLevel,
                lastClassification: this._lastClassification
            };
        },

        // ==================== 后台监控 ====================

        _startBackgroundMonitoring() {
            // 定期分析环境噪声特征
            this._monitoringInterval = setInterval(() => {
                this._analyzeEnvironment();
            }, 5000); // 每5秒分析一次
        },

        _analyzeEnvironment() {
            if (!this._fftPanel || !this._mic) return;

            try {
                const currentLevel = this._mic.getLevel();

                // 分析频谱特征以识别环境噪声模式
                const rawSpectrum = this._fftPanel._fft?.analyze();
                if (rawSpectrum) {
                    const processedSpectrum = this._fftPanel._processSpectrum(rawSpectrum);
                    const features = this._fftPanel._extractFeatures(processedSpectrum);

                    // 检测是否有持续的噪声源
                    if (this._isPersistentNoise(features)) {
                        this._adjustForNoise(features);
                    }
                }
            } catch (error) {
                if (this._debug) console.warn('环境分析错误:', error);
            }
        },

        _isPersistentNoise(features) {
            // 检测持续性噪声的简单启发式
            const totalEnergy = features.totalEnergy;
            const energyDistribution = [
                features.lowEnergy / totalEnergy,
                features.midEnergy / totalEnergy,
                features.highEnergy / totalEnergy,
                features.ultraEnergy / totalEnergy
            ];

            // 如果能量分布相对均匀，可能是风噪或其他持续噪声
            const maxRatio = Math.max(...energyDistribution);
            const minRatio = Math.min(...energyDistribution);

            return (maxRatio - minRatio) < 0.3 && totalEnergy > 0.01;
        },

        _adjustForNoise(features) {
            // 根据检测到的噪声调整阈值
            if (features.lowEnergy > 0.05) {
                // 低频噪声较强，适当提高阈值
                this._baseThreshold = Math.max(this._baseThreshold, 0.03);
            }

            if (this._debug) {
                console.log('检测到环境噪声，调整阈值至:', this._baseThreshold.toFixed(4));
            }
        },

        // ==================== 调试和可视化 ====================

        renderDebugPanel(ctx, x, y, w, h) {
            if (!this._debug) return;

            ctx.save();

            // 背景
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.strokeRect(x, y, w, h);

            // 标题
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.font = 'bold 12px ui-sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Enhanced Drum Trigger Debug', x + 5, y + 15);

            // 状态信息
            const stats = this.getStats();
            const lines = [
                `Enabled: ${this._isEnabled ? 'YES' : 'NO'}`,
                `Sensitivity: ${(this._sensitivity * 100).toFixed(0)}%`,
                `Threshold: ${this._dynamicThreshold.toFixed(4)}`,
                `Background: ${this._backgroundLevel.toFixed(4)}`,
                `Triggers: ${stats.totalTriggers}`,
                `Avg Confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`,
                `Last: ${this._lastClassification?.type || 'none'}`
            ];

            ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
            ctx.font = '10px ui-sans-serif';

            lines.forEach((line, idx) => {
                ctx.fillText(line, x + 5, y + 30 + idx * 12);
            });

            // 实时级别指示器
            if (this._mic) {
                const currentLevel = this._mic.getLevel();
                const barWidth = w - 10;
                const barHeight = 8;
                const barY = y + h - 15;

                // 背景条
                ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
                ctx.fillRect(x + 5, barY, barWidth, barHeight);

                // 当前级别
                const levelWidth = (currentLevel / 0.1) * barWidth; // 假设0.1为满量程
                ctx.fillStyle = currentLevel > this._dynamicThreshold ?
                    'rgba(255, 100, 100, 0.8)' : 'rgba(100, 255, 100, 0.8)';
                ctx.fillRect(x + 5, barY, Math.min(levelWidth, barWidth), barHeight);

                // 阈值线
                const thresholdX = x + 5 + (this._dynamicThreshold / 0.1) * barWidth;
                ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(thresholdX, barY);
                ctx.lineTo(thresholdX, barY + barHeight);
                ctx.stroke();
            }

            ctx.restore();
        },

        // ==================== 清理 ====================

        destroy() {
            if (this._monitoringInterval) {
                clearInterval(this._monitoringInterval);
                this._monitoringInterval = null;
            }

            this._isEnabled = false;
            this._mic = null;
            this._fftPanel = null;
        }
    };

    root.EnhancedDrumTrigger = EnhancedDrumTrigger;
})(window);