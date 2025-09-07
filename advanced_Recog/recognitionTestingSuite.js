/**
 * 智能打击识别系统测试验证套件
 * 用于评估识别精度、收集训练数据和性能基准测试
 */

class RecognitionTestingSuite {
    constructor(recognitionSystem) {
        this.recognitionSystem = recognitionSystem;

        // 测试状态
        this.isTestingActive = false;
        this.currentTest = null;
        this.testResults = [];

        // 训练数据收集
        this.dataCollection = {
            isActive: false,
            samples: [],
            currentLabel: null,
            sessionId: this.generateSessionId()
        };

        // 性能基准
        this.benchmarks = {
            accuracyTests: [],
            latencyTests: [],
            throughputTests: []
        };

        // 用户标注界面
        this.labelingInterface = null;
        this.testInterface = null;

        // 测试配置
        this.testConfig = {
            minSamplesPerType: 20,
            testDuration: 300000, // 5分钟
            targetTypes: ['open', 'slap', 'bass', 'tip'],
            confidenceThreshold: 0.6
        };

        this.initializeTestingSuite();
    }

    initializeTestingSuite() {
        this.createTestingInterface();
        this.createLabelingInterface();

        console.log('识别系统测试套件已初始化');
    }

    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 创建测试界面
     */
    createTestingInterface() {
        this.testInterface = document.createElement('div');
        this.testInterface.id = 'recognition-testing-interface';
        this.testInterface.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            width: 400px;
            background: rgba(0, 0, 50, 0.95);
            color: #fff;
            font-family: Arial, sans-serif;
            font-size: 14px;
            border: 2px solid #4CAF50;
            border-radius: 10px;
            padding: 20px;
            z-index: 10001;
            display: none;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        `;

        this.testInterface.innerHTML = `
            <div style="border-bottom: 1px solid #4CAF50; padding-bottom: 10px; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #4CAF50;">🧪 识别系统测试套件</h3>
                <button id="close-testing-panel" style="float: right; margin-top: -25px; background: #f44336; border: none; color: white; padding: 2px 8px; border-radius: 3px; cursor: pointer;">×</button>
            </div>
            
            <div class="test-section">
                <h4>📊 精度测试</h4>
                <div style="margin: 10px 0;">
                    <button id="start-accuracy-test" class="test-btn">开始精度测试</button>
                    <button id="stop-accuracy-test" class="test-btn" disabled>停止测试</button>
                </div>
                <div id="accuracy-status"></div>
            </div>
            
            <div class="test-section">
                <h4>📝 数据收集</h4>
                <div style="margin: 10px 0;">
                    <select id="label-selector" style="margin-right: 10px;">
                        <option value="">选择标签</option>
                        <option value="open">Open Tone</option>
                        <option value="slap">Slap</option>
                        <option value="bass">Bass</option>
                        <option value="tip">Tip/Heel</option>
                        <option value="noise">Noise</option>
                    </select>
                    <button id="start-collection" class="test-btn">开始收集</button>
                    <button id="stop-collection" class="test-btn" disabled>停止收集</button>
                </div>
                <div id="collection-status"></div>
            </div>
            
            <div class="test-section">
                <h4>⚡ 性能基准</h4>
                <div style="margin: 10px 0;">
                    <button id="run-benchmark" class="test-btn">运行基准测试</button>
                    <button id="export-results" class="test-btn">导出结果</button>
                </div>
                <div id="benchmark-status"></div>
            </div>
            
            <div class="test-section">
                <h4>📈 测试结果</h4>
                <div id="test-results-summary" style="font-size: 12px; background: rgba(255,255,255,0.1); padding: 10px; border-radius: 5px; margin-top: 10px;">
                    暂无测试数据
                </div>
            </div>
            
            <style>
                .test-btn {
                    background: #4CAF50;
                    border: none;
                    color: white;
                    padding: 6px 12px;
                    margin: 2px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .test-btn:hover { background: #45a049; }
                .test-btn:disabled { background: #666; cursor: not-allowed; }
                .test-section { margin: 15px 0; padding: 10px 0; border-bottom: 1px solid #333; }
            </style>
        `;

        document.body.appendChild(this.testInterface);
        this.bindTestingEvents();
    }

    /**
     * 创建标注界面
     */
    createLabelingInterface() {
        this.labelingInterface = document.createElement('div');
        this.labelingInterface.id = 'hit-labeling-overlay';
        this.labelingInterface.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10002;
            display: none;
            justify-content: center;
            align-items: center;
            font-family: Arial, sans-serif;
        `;

        this.labelingInterface.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 15px; text-align: center; min-width: 400px;">
                <h2 style="margin-top: 0; color: #333;">🎯 请标注刚才的打击类型</h2>
                <p style="color: #666; margin: 20px 0;">系统检测到打击，请选择正确的类型：</p>
                
                <div style="margin: 20px 0;">
                    <div id="prediction-display" style="background: #f0f0f0; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <strong>系统预测：</strong> <span id="predicted-type">--</span>
                        <br><strong>置信度：</strong> <span id="predicted-confidence">--</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 20px 0;">
                    <button class="label-btn" data-label="open" style="background: #4CAF50;">
                        🤲 Open Tone<br><small>开放音色</small>
                    </button>
                    <button class="label-btn" data-label="slap" style="background: #FF9800;">
                        👋 Slap<br><small>掌击</small>
                    </button>
                    <button class="label-btn" data-label="bass" style="background: #2196F3;">
                        👊 Bass<br><small>低音</small>
                    </button>
                    <button class="label-btn" data-label="tip" style="background: #9C27B0;">
                        👆 Tip/Heel<br><small>指尖/手跟</small>
                    </button>
                </div>
                
                <div style="margin: 20px 0;">
                    <button class="label-btn" data-label="noise" style="background: #607D8B; width: 48%;">
                        🔇 Noise/Other<br><small>噪音/其他</small>
                    </button>
                    <button id="skip-labeling" style="background: #666; color: white; border: none; padding: 10px 20px; margin-left: 4%; border-radius: 5px; width: 48%;">
                        ⏭️ 跳过<br><small>Skip</small>
                    </button>
                </div>
                
                <style>
                    .label-btn {
                        border: none;
                        color: white;
                        padding: 15px 10px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: bold;
                        transition: transform 0.1s;
                    }
                    .label-btn:hover { transform: scale(1.05); }
                </style>
            </div>
        `;

        document.body.appendChild(this.labelingInterface);
        this.bindLabelingEvents();
    }

    /**
     * 绑定测试界面事件
     */
    bindTestingEvents() {
        const panel = this.testInterface;

        panel.querySelector('#close-testing-panel').onclick = () => {
            this.hideTestingInterface();
        };

        panel.querySelector('#start-accuracy-test').onclick = () => {
            this.startAccuracyTest();
        };

        panel.querySelector('#stop-accuracy-test').onclick = () => {
            this.stopAccuracyTest();
        };

        panel.querySelector('#start-collection').onclick = () => {
            const label = panel.querySelector('#label-selector').value;
            if (label) {
                this.startDataCollection(label);
            } else {
                alert('请先选择标签类型');
            }
        };

        panel.querySelector('#stop-collection').onclick = () => {
            this.stopDataCollection();
        };

        panel.querySelector('#run-benchmark').onclick = () => {
            this.runPerformanceBenchmark();
        };

        panel.querySelector('#export-results').onclick = () => {
            this.exportTestResults();
        };
    }

    /**
     * 绑定标注界面事件
     */
    bindLabelingEvents() {
        const overlay = this.labelingInterface;

        // 标签按钮
        overlay.querySelectorAll('.label-btn').forEach(btn => {
            btn.onclick = () => {
                const label = btn.getAttribute('data-label');
                this.submitLabel(label);
                this.hideLabelingInterface();
            };
        });

        // 跳过按钮
        overlay.querySelector('#skip-labeling').onclick = () => {
            this.hideLabelingInterface();
        };
    }

    /**
     * 开始精度测试
     */
    startAccuracyTest() {
        this.isTestingActive = true;
        this.currentTest = {
            type: 'accuracy',
            startTime: Date.now(),
            samples: [],
            correctPredictions: 0,
            totalPredictions: 0
        };

        // 注册识别回调
        if (window.hitRecognitionIntegration) {
            window.hitRecognitionIntegration.addRecognitionCallback(
                this.handleAccuracyTestResult.bind(this)
            );
        }

        // 更新界面
        const panel = this.testInterface;
        panel.querySelector('#start-accuracy-test').disabled = true;
        panel.querySelector('#stop-accuracy-test').disabled = false;
        panel.querySelector('#accuracy-status').innerHTML = `
            <div style="color: #4CAF50;">✅ 精度测试进行中...</div>
            <div>样本数: 0 | 准确率: --</div>
            <div style="font-size: 12px; color: #ccc;">请进行各种打击，系统会弹出标注界面</div>
        `;

        console.log('精度测试已开始');
    }

    /**
     * 处理精度测试结果
     */
    handleAccuracyTestResult(result) {
        if (!this.isTestingActive || this.currentTest.type !== 'accuracy') return;

        // 显示标注界面
        this.showLabelingInterface(result);

        // 记录预测
        this.currentTest.samples.push({
            timestamp: Date.now(),
            prediction: result,
            actualLabel: null // 待用户标注
        });

        this.updateAccuracyTestDisplay();
    }

    /**
     * 停止精度测试
     */
    stopAccuracyTest() {
        this.isTestingActive = false;

        if (this.currentTest) {
            this.currentTest.endTime = Date.now();
            this.currentTest.duration = this.currentTest.endTime - this.currentTest.startTime;
            this.testResults.push(this.currentTest);
        }

        // 移除回调
        if (window.hitRecognitionIntegration) {
            window.hitRecognitionIntegration.removeRecognitionCallback(
                this.handleAccuracyTestResult.bind(this)
            );
        }

        // 更新界面
        const panel = this.testInterface;
        panel.querySelector('#start-accuracy-test').disabled = false;
        panel.querySelector('#stop-accuracy-test').disabled = true;

        this.calculateTestResults();
        console.log('精度测试已结束');
    }

    /**
     * 开始数据收集
     */
    startDataCollection(label) {
        this.dataCollection.isActive = true;
        this.dataCollection.currentLabel = label;
        this.dataCollection.startTime = Date.now();

        // 注册识别回调
        if (window.hitRecognitionIntegration) {
            window.hitRecognitionIntegration.addRecognitionCallback(
                this.handleDataCollectionResult.bind(this)
            );
        }

        // 更新界面
        const panel = this.testInterface;
        panel.querySelector('#start-collection').disabled = true;
        panel.querySelector('#stop-collection').disabled = false;
        panel.querySelector('#label-selector').disabled = true;
        panel.querySelector('#collection-status').innerHTML = `
            <div style="color: #4CAF50;">📝 正在收集 "${label}" 数据...</div>
            <div>已收集: 0 样本</div>
            <div style="font-size: 12px; color: #ccc;">请重复进行 "${label}" 类型的打击</div>
        `;

        console.log(`开始收集 "${label}" 训练数据`);
    }

    /**
     * 处理数据收集结果
     */
    handleDataCollectionResult(result) {
        if (!this.dataCollection.isActive) return;

        // 存储样本
        const sample = {
            timestamp: Date.now(),
            label: this.dataCollection.currentLabel,
            features: result.features,
            prediction: result,
            sessionId: this.dataCollection.sessionId
        };

        this.dataCollection.samples.push(sample);

        // 更新显示
        const panel = this.testInterface;
        const count = this.dataCollection.samples.filter(s =>
            s.label === this.dataCollection.currentLabel
        ).length;

        panel.querySelector('#collection-status').innerHTML = `
            <div style="color: #4CAF50;">📝 正在收集 "${this.dataCollection.currentLabel}" 数据...</div>
            <div>已收集: ${count} 样本</div>
            <div style="font-size: 12px; color: #ccc;">目标: ${this.testConfig.minSamplesPerType} 样本</div>
        `;
    }

    /**
     * 停止数据收集
     */
    stopDataCollection() {
        this.dataCollection.isActive = false;

        // 移除回调
        if (window.hitRecognitionIntegration) {
            window.hitRecognitionIntegration.removeRecognitionCallback(
                this.handleDataCollectionResult.bind(this)
            );
        }

        // 更新界面
        const panel = this.testInterface;
        panel.querySelector('#start-collection').disabled = false;
        panel.querySelector('#stop-collection').disabled = true;
        panel.querySelector('#label-selector').disabled = false;

        const count = this.dataCollection.samples.filter(s =>
            s.label === this.dataCollection.currentLabel
        ).length;

        panel.querySelector('#collection-status').innerHTML = `
            <div style="color: #666;">✅ 数据收集已停止</div>
            <div>本次收集: ${count} 样本</div>
            <div>总样本数: ${this.dataCollection.samples.length}</div>
        `;

        console.log(`数据收集结束，共收集 ${count} 个 "${this.dataCollection.currentLabel}" 样本`);
    }

    /**
     * 运行性能基准测试
     */
    async runPerformanceBenchmark() {
        const panel = this.testInterface;
        const statusDiv = panel.querySelector('#benchmark-status');

        statusDiv.innerHTML = '<div style="color: #FF9800;">⚡ 运行基准测试中...</div>';

        const benchmark = {
            timestamp: Date.now(),
            latencyTests: [],
            throughputTest: null,
            memoryUsage: null
        };

        // 延迟测试
        for (let i = 0; i < 50; i++) {
            const start = performance.now();

            // 模拟处理
            if (this.recognitionSystem) {
                this.recognitionSystem.process();
            }

            const latency = performance.now() - start;
            benchmark.latencyTests.push(latency);

            if (i % 10 === 0) {
                statusDiv.innerHTML = `<div style="color: #FF9800;">⚡ 延迟测试: ${i}/50</div>`;
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // 吞吐量测试
        const throughputStart = performance.now();
        let operations = 0;

        const throughputInterval = setInterval(() => {
            if (this.recognitionSystem) {
                this.recognitionSystem.process();
                operations++;
            }
        }, 1);

        await new Promise(resolve => setTimeout(resolve, 1000));
        clearInterval(throughputInterval);

        benchmark.throughputTest = {
            duration: 1000,
            operations: operations,
            operationsPerSecond: operations
        };

        // 内存使用情况
        if (performance.memory) {
            benchmark.memoryUsage = {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            };
        }

        this.benchmarks.push(benchmark);

        // 计算统计
        const avgLatency = benchmark.latencyTests.reduce((a, b) => a + b, 0) / benchmark.latencyTests.length;
        const maxLatency = Math.max(...benchmark.latencyTests);
        const minLatency = Math.min(...benchmark.latencyTests);

        statusDiv.innerHTML = `
            <div style="color: #4CAF50;">✅ 基准测试完成</div>
            <div style="font-size: 12px;">
                平均延迟: ${avgLatency.toFixed(2)}ms<br>
                最大延迟: ${maxLatency.toFixed(2)}ms<br>
                吞吐量: ${operations} ops/s<br>
                内存使用: ${benchmark.memoryUsage ?
                `${(benchmark.memoryUsage.used / 1024 / 1024).toFixed(1)}MB` :
                'N/A'}
            </div>
        `;

        console.log('性能基准测试完成:', benchmark);
    }

    /**
     * 显示标注界面
     */
    showLabelingInterface(prediction) {
        const overlay = this.labelingInterface;

        overlay.querySelector('#predicted-type').textContent = prediction.type;
        overlay.querySelector('#predicted-confidence').textContent =
            `${(prediction.confidence * 100).toFixed(1)}%`;

        overlay.style.display = 'flex';

        // 存储待标注的预测
        this.pendingLabelData = prediction;
    }

    /**
     * 隐藏标注界面
     */
    hideLabelingInterface() {
        this.labelingInterface.style.display = 'none';
        this.pendingLabelData = null;
    }

    /**
     * 提交标注
     */
    submitLabel(actualLabel) {
        if (!this.pendingLabelData || !this.currentTest) return;

        // 查找对应的样本并更新标注
        const sample = this.currentTest.samples.find(s =>
            !s.actualLabel &&
            Math.abs(s.timestamp - this.pendingLabelData.timestamp) < 1000
        );

        if (sample) {
            sample.actualLabel = actualLabel;

            // 计算是否正确
            const isCorrect = sample.prediction.type === actualLabel;
            if (isCorrect) {
                this.currentTest.correctPredictions++;
            }
            this.currentTest.totalPredictions++;

            console.log(`标注提交: 预测=${sample.prediction.type}, 实际=${actualLabel}, 正确=${isCorrect}`);
        }

        this.updateAccuracyTestDisplay();
    }

    /**
     * 更新精度测试显示
     */
    updateAccuracyTestDisplay() {
        if (!this.currentTest || this.currentTest.type !== 'accuracy') return;

        const accuracy = this.currentTest.totalPredictions > 0 ?
            (this.currentTest.correctPredictions / this.currentTest.totalPredictions * 100) : 0;

        const panel = this.testInterface;
        panel.querySelector('#accuracy-status').innerHTML = `
            <div style="color: #4CAF50;">✅ 精度测试进行中...</div>
            <div>样本数: ${this.currentTest.totalPredictions} | 准确率: ${accuracy.toFixed(1)}%</div>
            <div style="font-size: 12px;">正确: ${this.currentTest.correctPredictions} | 错误: ${this.currentTest.totalPredictions - this.currentTest.correctPredictions}</div>
        `;
    }

    /**
     * 计算测试结果
     */
    calculateTestResults() {
        if (!this.currentTest) return;

        const labeled = this.currentTest.samples.filter(s => s.actualLabel !== null);
        const accuracy = labeled.length > 0 ?
            (labeled.filter(s => s.prediction.type === s.actualLabel).length / labeled.length) : 0;

        // 按类型分析
        const typeAnalysis = {};
        this.testConfig.targetTypes.forEach(type => {
            const typesamples = labeled.filter(s => s.actualLabel === type);
            const correctType = typesamples.filter(s => s.prediction.type === type);

            typeAnalysis[type] = {
                samples: typesamples.length,
                correct: correctType.length,
                accuracy: typesamples.length > 0 ? correctType.length / typesamples.length : 0
            };
        });

        // 更新结果显示
        const resultDiv = this.testInterface.querySelector('#test-results-summary');
        resultDiv.innerHTML = `
            <div><strong>最新测试结果</strong></div>
            <div>总体准确率: ${(accuracy * 100).toFixed(1)}%</div>
            <div>测试样本: ${labeled.length}</div>
            <div style="margin-top: 8px; font-size: 11px;">
                ${Object.entries(typeAnalysis).map(([type, data]) =>
            `${type}: ${(data.accuracy * 100).toFixed(0)}% (${data.correct}/${data.samples})`
        ).join('<br>')}
            </div>
        `;

        console.log('测试结果:', { accuracy, typeAnalysis, labeled: labeled.length });
    }

    /**
     * 导出测试结果
     */
    exportTestResults() {
        const exportData = {
            sessionInfo: {
                sessionId: this.dataCollection.sessionId,
                timestamp: Date.now(),
                userAgent: navigator.userAgent
            },
            testResults: this.testResults,
            trainingData: this.dataCollection.samples,
            benchmarks: this.benchmarks,
            systemConfig: window.hitRecognitionIntegration?.getStatus()
        };

        // 创建下载链接
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recognition_test_results_${this.dataCollection.sessionId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('测试结果已导出');
        alert(`测试结果已导出到文件: recognition_test_results_${this.dataCollection.sessionId}.json`);
    }

    /**
     * 显示测试界面
     */
    showTestingInterface() {
        this.testInterface.style.display = 'block';
    }

    /**
     * 隐藏测试界面
     */
    hideTestingInterface() {
        this.testInterface.style.display = 'none';

        // 停止任何正在进行的测试
        if (this.isTestingActive) {
            this.stopAccuracyTest();
        }
        if (this.dataCollection.isActive) {
            this.stopDataCollection();
        }
    }

    /**
     * 获取测试统计
     */
    getTestStatistics() {
        return {
            testResults: this.testResults,
            dataCollection: {
                totalSamples: this.dataCollection.samples.length,
                samplesByType: this.testConfig.targetTypes.reduce((acc, type) => {
                    acc[type] = this.dataCollection.samples.filter(s => s.label === type).length;
                    return acc;
                }, {})
            },
            benchmarks: this.benchmarks
        };
    }
}

// 全局测试套件实例
let recognitionTestingSuite = null;

// 初始化测试套件
function initializeTestingSuite(recognitionSystem) {
    if (!recognitionTestingSuite && recognitionSystem) {
        recognitionTestingSuite = new RecognitionTestingSuite(recognitionSystem);

        // 添加全局快捷键 Ctrl+T
        document.addEventListener('keydown', (e) => {
            if (e.key === 't' && e.ctrlKey) {
                e.preventDefault();
                recognitionTestingSuite.showTestingInterface();
            }
        });

        console.log('测试套件已初始化，按 Ctrl+T 打开测试面板');
    }

    return recognitionTestingSuite;
}

// 导出
if (typeof window !== 'undefined') {
    window.RecognitionTestingSuite = RecognitionTestingSuite;
    window.initializeTestingSuite = initializeTestingSuite;
    window.recognitionTestingSuite = recognitionTestingSuite;
}