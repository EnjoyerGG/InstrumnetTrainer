/**
 * 打击识别系统集成模块
 * 将智能识别系统无缝集成到现有的drumming游戏中
 */

class HitRecognitionIntegration {
    constructor() {
        // 系统组件
        this.recognitionSystem = null;
        this.noiseProcessor = null;
        this.isInitialized = false;

        // 集成状态
        this.isEnabled = false;
        this.fallbackToSimple = true; // 发生错误时回退到简单识别
        this.processingMode = 'intelligent'; // 'intelligent' | 'simple' | 'hybrid'

        // 性能监控
        this.performanceMonitor = {
            enabled: true,
            maxProcessingTime: 10, // ms
            errorCount: 0,
            successRate: 0,
            adaptiveDowngrade: false
        };

        // 识别结果缓存
        this.resultBuffer = {
            recent: [],
            maxSize: 20,
            consistency: 0
        };

        // 配置界面
        this.debugInterface = null;
        this.debugVisible = false;

        // 事件处理
        this.originalTriggerHandler = null;
        this.recognitionCallbacks = new Set();

        console.log('打击识别集成模块已创建');
    }

    /**
     * 初始化整个识别系统
     */
    async initialize(micInput, options = {}) {
        try {
            console.log('正在初始化智能打击识别系统...');

            // 创建降噪处理器
            this.noiseProcessor = new NoiseReductionProcessor({
                fftSize: options.fftSize || 2048,
                sampleRate: options.sampleRate || 44100,
                ...options.noiseReduction
            });

            // 创建识别系统
            this.recognitionSystem = new CongaHitRecognition({
                fftSize: options.fftSize || 2048,
                sampleRate: options.sampleRate || 44100,
                adaptiveLearning: true,
                onHitDetected: (result) => this.handleRecognitionResult(result),
                ...options.recognition
            });

            // 初始化识别系统
            this.recognitionSystem.init(micInput);

            // 保存原始触发处理器
            if (window.drumTrigger && window.drumTrigger._onTrigger) {
                this.originalTriggerHandler = window.drumTrigger._onTrigger;
            }

            // 创建调试界面
            this.createDebugInterface();

            // 开始处理循环
            this.startProcessingLoop();

            this.isInitialized = true;
            this.isEnabled = true;
            if (typeof window !== 'undefined') {
                window.hitRecognitionIntegration = this;
            }

            console.log('智能打击识别系统初始化完成');

            // 通知用户
            this.showNotification('智能打击识别系统已启用', 'success');

            return true;

        } catch (error) {
            console.error('智能识别系统初始化失败:', error);
            this.showNotification('智能识别系统初始化失败，使用简单模式', 'warning');
            this.processingMode = 'simple';
            return false;
        }
    }

    /**
     * 处理识别结果
     */
    handleRecognitionResult(result) {
        if (!this.isEnabled) return;

        const currentTime = Date.now();

        // 添加到结果缓冲区
        this.resultBuffer.recent.push({
            ...result,
            timestamp: currentTime
        });

        // 保持缓冲区大小
        if (this.resultBuffer.recent.length > this.resultBuffer.maxSize) {
            this.resultBuffer.recent.shift();
        }

        // 分析识别一致性
        this.analyzeRecognitionConsistency();

        // 根据处理模式决定如何处理
        switch (this.processingMode) {
            case 'intelligent':
                this.processIntelligentResult(result);
                break;

            case 'hybrid':
                this.processHybridResult(result);
                break;

            case 'simple':
                // 仍然记录但不使用智能结果
                break;
        }

        // 通知回调
        this.recognitionCallbacks.forEach(callback => {
            try {
                callback(result);
            } catch (error) {
                console.warn('识别回调出错:', error);
            }
        });

        // 更新调试界面
        if (this.debugInterface) {
            this.debugInterface.updateRecognitionResult(result);
        }
    }

    /**
     * 处理智能识别结果
     */
    processIntelligentResult(result) {
        if (result.confidence < 0.5) {
            // 置信度太低，可能需要回退到简单模式
            this.performanceMonitor.errorCount++;
            return;
        }

        // 触发游戏事件
        this.triggerGameEvent(result.type, result);

        // 更新性能统计
        this.performanceMonitor.successRate =
            (this.performanceMonitor.successRate * 0.9) + (result.confidence * 0.1);
    }

    /**
     * 处理混合模式结果
     */
    processHybridResult(result) {
        // 智能识别作为增强，简单识别作为基础
        if (result.confidence > 0.7) {
            // 高置信度，使用智能结果
            this.triggerGameEvent(result.type, result);
        } else {
            // 低置信度，触发简单事件但记录智能数据
            this.triggerSimpleEvent();

            // 记录用于学习
            if (this.recognitionSystem.adaptiveLearning.enabled) {
                // 标记为低置信度样本，供后续优化
            }
        }
    }

    /**
     * 触发游戏事件
     */
    triggerGameEvent(hitType, recognitionData) {
        try {
            // 检查是否在等待第一击状态
            if (window.waitingForFirstHit) {
                window.startPerformanceAfterFirstHit();
                return;
            }

            // 检查触发条件
            if (!window.shouldAcceptTrigger(hitType)) {
                return;
            }

            // 如果游戏正在运行
            if (window.running && window.rm) {
                // 记录延迟分析
                if (window.LatencyProbe) {
                    window.LatencyProbe.markNote({
                        reason: hitType,
                        mode: window.RhythmSelector?.getCurrentMode?.(),
                        chart: window.ChartSelector?.currentChart?.name || 'unknown',
                        bpm: (window.speedToBPM?.(window.rm?.speedFactor || 0.25) | 0),
                        confidence: recognitionData.confidence,
                        processingTime: recognitionData.processingTime
                    });
                }

                const hitTime = window.rm._t();

                // 调用游戏的击打注册
                window.rm.registerHit(hitType);

                // 添加视觉效果
                if (window.SweepMode?.addHitNow) {
                    window.SweepMode.addHitNow();
                }

                if (window.HitMarkers?.addHitMarker) {
                    window.HitMarkers.addHitMarker(hitTime);
                }

                // 设置发光效果
                if (typeof window.judgeLineGlow !== 'undefined') {
                    window.judgeLineGlow = 1;
                }

                // 记录最后击打类型
                window._lastHitType = hitType;

                console.log(`智能识别: ${hitType} (置信度: ${(recognitionData.confidence * 100).toFixed(1)}%)`);
            }

        } catch (error) {
            console.error('触发游戏事件失败:', error);
            this.performanceMonitor.errorCount++;

            // 回退到简单模式
            if (this.fallbackToSimple) {
                this.triggerSimpleEvent();
            }
        }
    }

    /**
     * 触发简单事件（回退方案）
     */
    triggerSimpleEvent() {
        if (this.originalTriggerHandler) {
            try {
                this.originalTriggerHandler.call(window.drumTrigger, 'fallback');
            } catch (error) {
                console.warn('简单触发器也失败了:', error);
            }
        }
    }

    /**
     * 分析识别一致性
     */
    analyzeRecognitionConsistency() {
        if (this.resultBuffer.recent.length < 5) return;

        const recentTypes = this.resultBuffer.recent.slice(-5).map(r => r.type);
        const avgConfidence = this.resultBuffer.recent.slice(-5)
            .reduce((sum, r) => sum + r.confidence, 0) / 5;

        // 计算类型一致性
        const typeCount = {};
        recentTypes.forEach(type => {
            typeCount[type] = (typeCount[type] || 0) + 1;
        });

        const maxCount = Math.max(...Object.values(typeCount));
        this.resultBuffer.consistency = maxCount / recentTypes.length;

        // 自适应调整
        if (avgConfidence < 0.6 && this.resultBuffer.consistency < 0.6) {
            if (this.processingMode === 'intelligent') {
                console.log('识别质量下降，切换到混合模式');
                this.processingMode = 'hybrid';
                this.showNotification('识别质量下降，启用混合模式', 'info');
            }
        } else if (avgConfidence > 0.8 && this.resultBuffer.consistency > 0.8) {
            if (this.processingMode === 'hybrid') {
                console.log('识别质量改善，切换到智能模式');
                this.processingMode = 'intelligent';
                this.showNotification('识别质量改善，返回智能模式', 'success');
            }
        }
    }

    /**
     * 开始处理循环
     */
    startProcessingLoop() {
        const processFrame = () => {
            if (!this.isEnabled || !this.isInitialized) {
                requestAnimationFrame(processFrame);
                return;
            }

            try {
                const startTime = performance.now();

                // 执行识别处理
                if (this.recognitionSystem) {
                    this.recognitionSystem.process();
                }

                const processingTime = performance.now() - startTime;

                // 性能监控
                if (this.performanceMonitor.enabled) {
                    this.monitorPerformance(processingTime);
                }

            } catch (error) {
                console.error('处理循环出错:', error);
                this.performanceMonitor.errorCount++;

                // 错误过多时自动降级
                if (this.performanceMonitor.errorCount > 10) {
                    this.processingMode = 'simple';
                    this.showNotification('错误过多，降级到简单模式', 'warning');
                }
            }

            requestAnimationFrame(processFrame);
        };

        requestAnimationFrame(processFrame);
    }

    /**
     * 性能监控
     */
    monitorPerformance(processingTime) {
        // 检查处理时间
        if (processingTime > this.performanceMonitor.maxProcessingTime) {
            console.warn(`处理时间过长: ${processingTime.toFixed(2)}ms`);

            if (!this.performanceMonitor.adaptiveDowngrade) {
                this.performanceMonitor.adaptiveDowngrade = true;
                this.processingMode = 'hybrid';
                this.showNotification('性能优化：启用混合模式', 'info');
            }
        }
    }

    /**
     * 创建调试界面
     */
    createDebugInterface() {
        this.debugInterface = new HitRecognitionDebugPanel({
            integration: this,
            recognitionSystem: this.recognitionSystem,
            noiseProcessor: this.noiseProcessor
        });
    }

    /**
     * 显示/隐藏调试界面
     */
    toggleDebugInterface() {
        if (!this.debugInterface) {
            this.createDebugInterface();
        }

        this.debugVisible = !this.debugVisible;
        this.debugInterface.setVisible(this.debugVisible);

        console.log(`调试界面: ${this.debugVisible ? '显示' : '隐藏'}`);
    }

    /**
     * 添加识别回调
     */
    addRecognitionCallback(callback) {
        this.recognitionCallbacks.add(callback);
    }

    /**
     * 移除识别回调
     */
    removeRecognitionCallback(callback) {
        this.recognitionCallbacks.delete(callback);
    }

    /**
     * 配置系统
     */
    configure(config) {
        if (config.recognition && this.recognitionSystem) {
            Object.assign(this.recognitionSystem, config.recognition);
        }

        if (config.noiseReduction && this.noiseProcessor) {
            this.noiseProcessor.configure(config.noiseReduction);
        }

        if (config.integration) {
            Object.assign(this, config.integration);
        }

        console.log('识别系统配置已更新');
    }

    /**
     * 获取系统状态
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            enabled: this.isEnabled,
            mode: this.processingMode,
            performance: this.performanceMonitor,
            consistency: this.resultBuffer.consistency,
            recognitionStats: this.recognitionSystem?.getPerformanceStats(),
            noiseStats: this.noiseProcessor?.getStatus()
        };
    }

    /**
     * 启用/禁用系统
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;

        if (this.recognitionSystem) {
            this.recognitionSystem.setEnabled(enabled);
        }

        console.log(`智能识别系统: ${enabled ? '启用' : '禁用'}`);
        this.showNotification(
            `智能识别系统${enabled ? '已启用' : '已禁用'}`,
            enabled ? 'success' : 'info'
        );
    }

    /**
     * 切换处理模式
     */
    setProcessingMode(mode) {
        const validModes = ['intelligent', 'simple', 'hybrid'];
        if (!validModes.includes(mode)) {
            console.warn('无效的处理模式:', mode);
            return;
        }

        this.processingMode = mode;
        console.log(`处理模式切换到: ${mode}`);
        this.showNotification(`切换到${mode}模式`, 'info');
    }

    /**
     * 重置系统
     */
    reset() {
        if (this.recognitionSystem) {
            this.recognitionSystem.reset();
        }

        if (this.noiseProcessor) {
            this.noiseProcessor.reset();
        }

        this.resultBuffer.recent = [];
        this.resultBuffer.consistency = 0;
        this.performanceMonitor.errorCount = 0;
        this.performanceMonitor.adaptiveDowngrade = false;

        console.log('识别系统已重置');
    }

    /**
     * 显示通知
     */
    showNotification(message, type = 'info') {
        // 简单的通知系统
        const notification = document.createElement('div');
        notification.className = `hit-recognition-notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 15px;
            border-radius: 5px;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            max-width: 300px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: opacity 0.3s ease;
            background: ${type === 'success' ? '#4CAF50' :
                type === 'warning' ? '#FF9800' :
                    type === 'error' ? '#F44336' : '#2196F3'};
        `;

        document.body.appendChild(notification);

        // 自动移除
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

/**
 * 调试面板类
 */
class HitRecognitionDebugPanel {
    constructor(options) {
        this.integration = options.integration;
        this.recognitionSystem = options.recognitionSystem;
        this.noiseProcessor = options.noiseProcessor;

        this.panel = null;
        this.visible = false;
        this.updateInterval = null;

        this.createPanel();
    }

    createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'hit-recognition-debug-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 50px;
            right: 20px;
            width: 350px;
            max-height: 80vh;
            background: rgba(0, 0, 0, 0.9);
            color: #fff;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 15px;
            z-index: 9999;
            overflow-y: auto;
            display: none;
        `;

        this.panel.innerHTML = `
            <div style="border-bottom: 1px solid #444; padding-bottom: 10px; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #4CAF50;">智能打击识别调试面板</h3>
                <button id="close-debug-panel" style="float: right; margin-top: -25px;">×</button>
            </div>
            
            <div id="debug-content">
                <div class="debug-section">
                    <h4>系统状态</h4>
                    <div id="system-status"></div>
                </div>
                
                <div class="debug-section">
                    <h4>识别结果</h4>
                    <div id="recognition-results"></div>
                </div>
                
                <div class="debug-section">
                    <h4>性能监控</h4>
                    <div id="performance-stats"></div>
                </div>
                
                <div class="debug-section">
                    <h4>控制面板</h4>
                    <div id="control-panel"></div>
                </div>
            </div>
        `;

        document.body.appendChild(this.panel);

        // 绑定事件
        this.panel.querySelector('#close-debug-panel').onclick = () => {
            this.setVisible(false);
        };

        this.createControlPanel();
    }

    createControlPanel() {
        const controlPanel = this.panel.querySelector('#control-panel');

        controlPanel.innerHTML = `
            <div style="margin: 5px 0;">
                <label>处理模式:</label>
                <select id="processing-mode" style="margin-left: 5px;">
                    <option value="intelligent">智能</option>
                    <option value="hybrid">混合</option>
                    <option value="simple">简单</option>
                </select>
            </div>
            
            <div style="margin: 5px 0;">
                <label>
                    <input type="checkbox" id="enable-recognition" checked> 启用识别
                </label>
            </div>
            
            <div style="margin: 5px 0;">
                <button id="reset-system" style="padding: 3px 8px;">重置系统</button>
                <button id="calibrate-noise" style="padding: 3px 8px;">校准噪音</button>
            </div>
        `;

        // 绑定控制事件
        const modeSelect = controlPanel.querySelector('#processing-mode');
        modeSelect.value = this.integration.processingMode;
        modeSelect.onchange = (e) => {
            this.integration.setProcessingMode(e.target.value);
        };

        const enableCheckbox = controlPanel.querySelector('#enable-recognition');
        enableCheckbox.checked = this.integration.isEnabled;
        enableCheckbox.onchange = (e) => {
            this.integration.setEnabled(e.target.checked);
        };

        controlPanel.querySelector('#reset-system').onclick = () => {
            this.integration.reset();
        };

        controlPanel.querySelector('#calibrate-noise').onclick = () => {
            if (this.noiseProcessor) {
                this.noiseProcessor.calibrateNoiseFloor();
            }
        };
    }

    setVisible(visible) {
        this.visible = visible;
        this.panel.style.display = visible ? 'block' : 'none';

        if (visible) {
            this.startUpdating();
        } else {
            this.stopUpdating();
        }
    }

    startUpdating() {
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 500);
    }

    stopUpdating() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    updateDisplay() {
        this.updateSystemStatus();
        this.updatePerformanceStats();
    }

    updateSystemStatus() {
        const status = this.integration.getStatus();
        const statusDiv = this.panel.querySelector('#system-status');

        statusDiv.innerHTML = `
            <div>初始化: ${status.initialized ? '✓' : '✗'}</div>
            <div>启用: ${status.enabled ? '✓' : '✗'}</div>
            <div>模式: ${status.mode}</div>
            <div>一致性: ${(status.consistency * 100).toFixed(1)}%</div>
        `;
    }

    updatePerformanceStats() {
        const status = this.integration.getStatus();
        const statsDiv = this.panel.querySelector('#performance-stats');

        statsDiv.innerHTML = `
            <div>错误计数: ${status.performance.errorCount}</div>
            <div>成功率: ${(status.performance.successRate * 100).toFixed(1)}%</div>
            <div>自适应降级: ${status.performance.adaptiveDowngrade ? '是' : '否'}</div>
            ${status.recognitionStats ? `
                <div>总检测: ${status.recognitionStats.totalDetections}</div>
                <div>平均处理时间: ${status.recognitionStats.averageProcessingTime.toFixed(2)}ms</div>
            ` : ''}
        `;
    }

    updateRecognitionResult(result) {
        const resultsDiv = this.panel.querySelector('#recognition-results');

        resultsDiv.innerHTML = `
            <div>类型: ${result.type}</div>
            <div>置信度: ${(result.confidence * 100).toFixed(1)}%</div>
            <div>处理时间: ${result.processingTime.toFixed(2)}ms</div>
            <div>时间戳: ${new Date(result.timestamp).toLocaleTimeString()}</div>
        `;
    }
}

// 全局集成实例
let hitRecognitionIntegration = null;

// 初始化函数
async function initializeIntelligentRecognition(micInput, options = {}) {
    if (!hitRecognitionIntegration) {
        hitRecognitionIntegration = new HitRecognitionIntegration();
    }

    return await hitRecognitionIntegration.initialize(micInput, options);
}

// 全局快捷键处理
document.addEventListener('keydown', (e) => {
    if (e.key === 'i' && e.ctrlKey) { // Ctrl+I
        e.preventDefault();
        if (hitRecognitionIntegration) {
            hitRecognitionIntegration.toggleDebugInterface();
        }
    }
});

// 导出到全局
if (typeof window !== 'undefined') {
    window.HitRecognitionIntegration = HitRecognitionIntegration;
    window.initializeIntelligentRecognition = initializeIntelligentRecognition;
    window.hitRecognitionIntegration = hitRecognitionIntegration;
}