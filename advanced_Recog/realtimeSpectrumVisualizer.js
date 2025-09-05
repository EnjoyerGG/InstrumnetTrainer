/**
 * 实时频谱分析可视化器
 * 用于实时显示打击识别系统的频谱分析过程
 */

class RealtimeSpectrumVisualizer {
    constructor(options = {}) {
        // 配置参数
        this.width = options.width || 800;
        this.height = options.height || 600;
        this.backgroundColor = options.backgroundColor || '#0a0a0a';
        this.updateInterval = options.updateInterval || 30; // ms

        // 可视化组件
        this.canvas = null;
        this.ctx = null;
        this.isVisible = false;
        this.animationId = null;

        // 数据源
        this.recognitionSystem = null;
        this.noiseProcessor = null;
        this.audioAnalyser = null;

        // 显示模式
        this.displayMode = 'split'; // 'spectrum', 'features', 'split', 'waterfall'
        this.showNoise = true;
        this.showTargetProfiles = true;
        this.paused = false;

        // 频谱数据缓冲
        this.spectrumHistory = [];
        this.maxHistorySize = 150;

        // 视觉效果
        this.colorScheme = {
            raw: '#ff6b6b',
            clean: '#4ecdc4',
            noise: '#95a5a6',
            targetProfiles: {
                open: '#e74c3c',
                slap: '#f39c12',
                bass: '#3498db',
                tip: '#9b59b6'
            },
            grid: '#2c3e50',
            text: '#ecf0f1',
            highlight: '#f1c40f'
        };

        // UI控制面板
        this.controlPanel = null;
        this.infoPanel = null;

        // 频率分析
        this.frequencyMarkers = [];
        this.detectionEvents = [];
        this.maxEvents = 50;

        this.initializeVisualizer();
    }

    initializeVisualizer() {
        this.createCanvas();
        this.createControlPanel();
        this.createInfoPanel();
        this.setupFrequencyMarkers();

        console.log('实时频谱可视化器已初始化');
    }

    /**
     * 创建画布
     */
    createCanvas() {
        const container = document.createElement('div');
        container.id = 'spectrum-visualizer-container';
        container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9998;
            display: none;
            background: ${this.backgroundColor};
            border: 2px solid #34495e;
            border-radius: 10px;
            padding: 10px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        `;

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.cssText = `
            border: 1px solid #34495e;
            border-radius: 5px;
            cursor: crosshair;
        `;

        this.ctx = this.canvas.getContext('2d');

        // 添加鼠标交互
        this.canvas.addEventListener('mousemove', (e) => {
            this.handleMouseMove(e);
        });

        this.canvas.addEventListener('click', (e) => {
            this.handleCanvasClick(e);
        });

        container.appendChild(this.canvas);
        document.body.appendChild(container);

        this.container = container;
    }

    /**
     * 创建控制面板
     */
    createControlPanel() {
        this.controlPanel = document.createElement('div');
        this.controlPanel.style.cssText = `
            margin-top: 10px;
            padding: 10px;
            background: rgba(52, 73, 94, 0.8);
            border-radius: 5px;
            color: #ecf0f1;
            font-family: Arial, sans-serif;
            font-size: 12px;
        `;

        this.controlPanel.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                <div>
                    <label>显示模式:</label>
                    <select id="display-mode" style="margin-left: 5px;">
                        <option value="spectrum">频谱</option>
                        <option value="features">特征</option>
                        <option value="split" selected>分屏</option>
                        <option value="waterfall">瀑布图</option>
                    </select>
                </div>
                
                <div>
                    <label><input type="checkbox" id="show-noise" checked> 显示噪音</label>
                </div>
                
                <div>
                    <label><input type="checkbox" id="show-profiles" checked> 目标轮廓</label>
                </div>
                
                <div>
                    <button id="pause-viz">暂停</button>
                    <button id="clear-history">清除历史</button>
                    <button id="save-screenshot">截图</button>
                    <button id="close-viz">关闭</button>
                </div>
                
                <div id="detection-info" style="margin-left: auto; font-weight: bold;">
                    等待检测...
                </div>
            </div>
        `;

        this.container.appendChild(this.controlPanel);
        this.bindControlEvents();
    }

    /**
     * 创建信息面板
     */
    createInfoPanel() {
        this.infoPanel = document.createElement('div');
        this.infoPanel.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #ecf0f1;
            padding: 10px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            max-width: 200px;
            pointer-events: none;
        `;

        this.canvas.parentElement.appendChild(this.infoPanel);
    }

    /**
     * 设置频率标记
     */
    setupFrequencyMarkers() {
        // 重要的频率点
        this.frequencyMarkers = [
            { freq: 50, label: '50Hz', type: 'powerline' },
            { freq: 100, label: '100Hz', type: 'harmonic' },
            { freq: 200, label: '200Hz', type: 'fundamental' },
            { freq: 400, label: '400Hz', type: 'harmonic' },
            { freq: 800, label: '800Hz', type: 'harmonic' },
            { freq: 1200, label: '1.2kHz', type: 'harmonic' },
            { freq: 2500, label: '2.5kHz', type: 'attack' },
            { freq: 5000, label: '5kHz', type: 'slap' }
        ];
    }

    /**
     * 绑定控制事件
     */
    bindControlEvents() {
        const panel = this.controlPanel;

        panel.querySelector('#display-mode').onchange = (e) => {
            this.displayMode = e.target.value;
        };

        panel.querySelector('#show-noise').onchange = (e) => {
            this.showNoise = e.target.checked;
        };

        panel.querySelector('#show-profiles').onchange = (e) => {
            this.showTargetProfiles = e.target.checked;
        };

        panel.querySelector('#pause-viz').onclick = () => {
            this.paused = !this.paused;
            panel.querySelector('#pause-viz').textContent = this.paused ? '恢复' : '暂停';
        };

        panel.querySelector('#clear-history').onclick = () => {
            this.spectrumHistory = [];
            this.detectionEvents = [];
        };

        panel.querySelector('#save-screenshot').onclick = () => {
            this.saveScreenshot();
        };

        panel.querySelector('#close-viz').onclick = () => {
            this.hide();
        };
    }

    /**
     * 连接数据源
     */
    connectToSystems(recognitionSystem, noiseProcessor, audioAnalyser) {
        this.recognitionSystem = recognitionSystem;
        this.noiseProcessor = noiseProcessor;
        this.audioAnalyser = audioAnalyser;

        // 注册检测事件回调
        if (window.hitRecognitionIntegration) {
            window.hitRecognitionIntegration.addRecognitionCallback((result) => {
                this.addDetectionEvent(result);
            });
        }

        console.log('频谱可视化器已连接到识别系统');
    }

    /**
     * 添加检测事件
     */
    addDetectionEvent(result) {
        this.detectionEvents.push({
            timestamp: Date.now(),
            type: result.type,
            confidence: result.confidence,
            features: result.features
        });

        // 限制事件历史大小
        if (this.detectionEvents.length > this.maxEvents) {
            this.detectionEvents.shift();
        }

        // 更新信息显示
        const info = this.controlPanel.querySelector('#detection-info');
        info.innerHTML = `
            ${result.type.toUpperCase()} 
            (${(result.confidence * 100).toFixed(0)}%)
        `;
        info.style.color = this.colorScheme.targetProfiles[result.type] || '#ecf0f1';
    }

    /**
     * 显示可视化器
     */
    show() {
        this.isVisible = true;
        this.container.style.display = 'block';
        this.startAnimation();
    }

    /**
     * 隐藏可视化器
     */
    hide() {
        this.isVisible = false;
        this.container.style.display = 'none';
        this.stopAnimation();
    }

    /**
     * 开始动画循环
     */
    startAnimation() {
        const animate = () => {
            if (!this.isVisible) return;

            if (!this.paused) {
                this.updateData();
                this.render();
            }

            this.animationId = setTimeout(animate, this.updateInterval);
        };

        animate();
    }

    /**
     * 停止动画循环
     */
    stopAnimation() {
        if (this.animationId) {
            clearTimeout(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * 更新数据
     */
    updateData() {
        if (!this.audioAnalyser) return;

        // 获取原始频谱数据
        const bufferLength = this.audioAnalyser.frequencyBinCount;
        const rawData = new Uint8Array(bufferLength);
        this.audioAnalyser.getByteFrequencyData(rawData);

        // 获取清理后的数据
        let cleanData = null;
        if (this.noiseProcessor) {
            cleanData = this.noiseProcessor.process(rawData);
        }

        // 获取识别特征
        let features = null;
        if (this.recognitionSystem) {
            // 这里简化处理，实际可能需要调用内部方法
            features = this.extractCurrentFeatures();
        }

        // 添加到历史
        const spectrumFrame = {
            timestamp: Date.now(),
            raw: Array.from(rawData),
            clean: cleanData ? Array.from(cleanData) : null,
            features: features
        };

        this.spectrumHistory.push(spectrumFrame);

        // 限制历史大小
        if (this.spectrumHistory.length > this.maxHistorySize) {
            this.spectrumHistory.shift();
        }
    }

    /**
     * 提取当前特征（简化版）
     */
    extractCurrentFeatures() {
        // 这是一个简化版本，实际实现可能需要访问识别系统的内部方法
        return {
            fundamentalFreq: 0,
            energyDistribution: [0, 0, 0],
            spectralCentroid: 0,
            spectralRolloff: 0
        };
    }

    /**
     * 渲染可视化
     */
    render() {
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.width, this.height);

        switch (this.displayMode) {
            case 'spectrum':
                this.renderSpectrum();
                break;
            case 'features':
                this.renderFeatures();
                break;
            case 'split':
                this.renderSplitView();
                break;
            case 'waterfall':
                this.renderWaterfall();
                break;
        }

        this.renderOverlay();
    }

    /**
     * 渲染频谱视图
     */
    renderSpectrum() {
        if (this.spectrumHistory.length === 0) return;

        const latest = this.spectrumHistory[this.spectrumHistory.length - 1];
        const spectrumHeight = this.height - 100;

        // 绘制原始频谱
        this.drawSpectrum(latest.raw, 0, 0, this.width, spectrumHeight / 2, this.colorScheme.raw, '原始频谱');

        // 绘制清理后的频谱
        if (latest.clean && this.showNoise) {
            this.drawSpectrum(latest.clean, 0, spectrumHeight / 2, this.width, spectrumHeight / 2, this.colorScheme.clean, '降噪后');
        }

        // 绘制目标轮廓
        if (this.showTargetProfiles) {
            this.drawTargetProfiles(0, 0, this.width, spectrumHeight);
        }
    }

    /**
     * 渲染特征视图
     */
    renderFeatures() {
        const latest = this.spectrumHistory[this.spectrumHistory.length - 1];
        if (!latest || !latest.features) return;

        // 绘制能量分布饼图
        this.drawEnergyDistribution(50, 50, 100);

        // 绘制频谱质心
        this.drawSpectralCentroid(250, 50, 200, 100);

        // 绘制最近的检测事件
        this.drawRecentDetections(50, 200, 300, 150);
    }

    /**
     * 渲染分屏视图
     */
    renderSplitView() {
        const halfHeight = (this.height - 60) / 2;

        // 上半部分：频谱
        if (this.spectrumHistory.length > 0) {
            const latest = this.spectrumHistory[this.spectrumHistory.length - 1];
            this.drawSpectrum(latest.raw, 0, 0, this.width, halfHeight, this.colorScheme.raw, '实时频谱');

            if (latest.clean && this.showNoise) {
                this.drawSpectrumOverlay(latest.clean, 0, 0, this.width, halfHeight, this.colorScheme.clean);
            }
        }

        // 下半部分：检测历史
        this.drawDetectionHistory(0, halfHeight + 30, this.width, halfHeight - 30);
    }

    /**
     * 渲染瀑布图
     */
    renderWaterfall() {
        const waterfallHeight = this.height - 50;
        const timeWidth = Math.min(this.width, this.spectrumHistory.length);

        for (let i = 0; i < timeWidth; i++) {
            const frameIndex = this.spectrumHistory.length - timeWidth + i;
            if (frameIndex < 0) continue;

            const frame = this.spectrumHistory[frameIndex];
            const data = frame.clean || frame.raw;

            this.drawWaterfallColumn(data, i, 0, 1, waterfallHeight);
        }

        // 绘制时间轴
        this.drawTimeAxis(0, waterfallHeight, this.width, 30);
    }

    /**
     * 绘制频谱
     */
    drawSpectrum(data, x, y, width, height, color, title) {
        if (!data || data.length === 0) return;

        const nyquist = 22050; // 假设44.1kHz采样率
        const binWidth = width / data.length;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();

        for (let i = 0; i < data.length; i++) {
            const amplitude = Array.isArray(data) ? data[i] : (data[i] / 255);
            const barHeight = (amplitude * height * 0.8);
            const barX = x + i * binWidth;
            const barY = y + height - barHeight;

            if (i === 0) {
                this.ctx.moveTo(barX, barY);
            } else {
                this.ctx.lineTo(barX, barY);
            }
        }

        this.ctx.stroke();

        // 绘制频率标记
        this.drawFrequencyMarkers(x, y, width, height, nyquist);

        // 绘制标题
        if (title) {
            this.ctx.fillStyle = this.colorScheme.text;
            this.ctx.font = '12px Arial';
            this.ctx.fillText(title, x + 10, y + 20);
        }
    }

    /**
     * 绘制频谱叠加
     */
    drawSpectrumOverlay(data, x, y, width, height, color) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.6;
        this.drawSpectrum(data, x, y, width, height, color);
        this.ctx.restore();
    }

    /**
     * 绘制频率标记
     */
    drawFrequencyMarkers(x, y, width, height, nyquist) {
        this.ctx.strokeStyle = this.colorScheme.grid;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 2]);

        this.frequencyMarkers.forEach(marker => {
            if (marker.freq > nyquist) return;

            const markerX = x + (marker.freq / nyquist) * width;

            // 绘制垂直线
            this.ctx.beginPath();
            this.ctx.moveTo(markerX, y);
            this.ctx.lineTo(markerX, y + height);
            this.ctx.stroke();

            // 绘制标签
            this.ctx.save();
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = this.colorScheme.text;
            this.ctx.font = '10px Arial';
            this.ctx.translate(markerX + 2, y + height - 10);
            this.ctx.rotate(-Math.PI / 4);
            this.ctx.fillText(marker.label, 0, 0);
            this.ctx.restore();
        });

        this.ctx.setLineDash([]);
    }

    /**
     * 绘制目标轮廓
     */
    drawTargetProfiles(x, y, width, height) {
        if (!this.recognitionSystem?.frequencyProfiles) return;

        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        this.ctx.lineWidth = 2;

        Object.entries(this.recognitionSystem.frequencyProfiles).forEach(([type, profile]) => {
            const color = this.colorScheme.targetProfiles[type];
            if (!color) return;

            this.ctx.strokeStyle = color;
            this.ctx.beginPath();

            // 简化的轮廓绘制
            const fundamentalX = (profile.fundamentalRange[0] / 22050) * width;
            const fundamentalY = y + height * 0.7;

            this.ctx.moveTo(x + fundamentalX, fundamentalY);

            profile.harmonicPeaks.forEach(freq => {
                const harmX = (freq / 22050) * width;
                const harmY = y + height * (0.9 - profile.energyDistribution[0] * 0.5);
                this.ctx.lineTo(x + harmX, harmY);
            });

            this.ctx.stroke();
        });

        this.ctx.restore();
    }

    /**
     * 绘制检测历史
     */
    drawDetectionHistory(x, y, width, height) {
        if (this.detectionEvents.length === 0) return;

        const timeSpan = 10000; // 10秒
        const currentTime = Date.now();
        const eventWidth = width / (timeSpan / 100); // 每100ms一个单位

        this.detectionEvents.forEach(event => {
            const age = currentTime - event.timestamp;
            if (age > timeSpan) return;

            const eventX = x + width - (age / timeSpan) * width;
            const eventY = y + height * (1 - event.confidence);
            const eventH = height * event.confidence;

            const color = this.colorScheme.targetProfiles[event.type] || this.colorScheme.highlight;

            this.ctx.fillStyle = color;
            this.ctx.fillRect(eventX - eventWidth / 2, eventY, eventWidth, eventH);

            // 添加类型标签
            if (eventWidth > 20) {
                this.ctx.fillStyle = this.colorScheme.text;
                this.ctx.font = '8px Arial';
                this.ctx.save();
                this.ctx.translate(eventX, eventY + eventH / 2);
                this.ctx.rotate(-Math.PI / 2);
                this.ctx.fillText(event.type, 0, 0);
                this.ctx.restore();
            }
        });

        // 绘制时间轴
        this.ctx.strokeStyle = this.colorScheme.grid;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y + height);
        this.ctx.lineTo(x + width, y + height);
        this.ctx.stroke();

        // 绘制标题
        this.ctx.fillStyle = this.colorScheme.text;
        this.ctx.font = '12px Arial';
        this.ctx.fillText('检测历史 (最近10秒)', x + 10, y + 20);
    }

    /**
     * 绘制瀑布图列
     */
    drawWaterfallColumn(data, x, y, width, height) {
        if (!data) return;

        const binHeight = height / data.length;

        for (let i = 0; i < data.length; i++) {
            const amplitude = Array.isArray(data) ? data[i] : (data[i] / 255);
            const intensity = Math.floor(amplitude * 255);

            this.ctx.fillStyle = `rgb(${intensity}, ${intensity * 0.5}, ${Math.max(0, intensity - 128)})`;
            this.ctx.fillRect(x, y + i * binHeight, width, binHeight);
        }
    }

    /**
     * 渲染覆盖层
     */
    renderOverlay() {
        // 绘制FPS和性能信息
        this.drawPerformanceInfo();

        // 更新信息面板
        this.updateInfoPanel();
    }

    /**
     * 绘制性能信息
     */
    drawPerformanceInfo() {
        const fps = Math.round(1000 / this.updateInterval);
        const memUsage = performance.memory ?
            `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB` : 'N/A';

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(this.width - 150, this.height - 60, 140, 50);

        this.ctx.fillStyle = this.colorScheme.text;
        this.ctx.font = '10px monospace';
        this.ctx.fillText(`FPS: ${fps}`, this.width - 140, this.height - 45);
        this.ctx.fillText(`Memory: ${memUsage}`, this.width - 140, this.height - 30);
        this.ctx.fillText(`History: ${this.spectrumHistory.length}`, this.width - 140, this.height - 15);
    }

    /**
     * 更新信息面板
     */
    updateInfoPanel() {
        const latest = this.spectrumHistory[this.spectrumHistory.length - 1];
        if (!latest) return;

        const totalEnergy = latest.raw.reduce((sum, val) => sum + val, 0) / latest.raw.length;
        const peakFreq = this.findPeakFrequency(latest.raw);

        this.infoPanel.innerHTML = `
            <div><strong>实时分析</strong></div>
            <div>总能量: ${totalEnergy.toFixed(1)}</div>
            <div>峰值频率: ${peakFreq}Hz</div>
            <div>历史帧数: ${this.spectrumHistory.length}</div>
            <div>检测事件: ${this.detectionEvents.length}</div>
            ${this.detectionEvents.length > 0 ? `
                <div style="margin-top: 8px;"><strong>最近检测:</strong></div>
                <div style="color: ${this.colorScheme.targetProfiles[this.detectionEvents[this.detectionEvents.length - 1].type]}">
                    ${this.detectionEvents[this.detectionEvents.length - 1].type.toUpperCase()}
                </div>
            ` : ''}
        `;
    }

    /**
     * 查找峰值频率
     */
    findPeakFrequency(spectrum) {
        let maxVal = 0;
        let maxIndex = 0;

        for (let i = 1; i < spectrum.length; i++) {
            if (spectrum[i] > maxVal) {
                maxVal = spectrum[i];
                maxIndex = i;
            }
        }

        const nyquist = 22050;
        return Math.round((maxIndex / spectrum.length) * nyquist);
    }

    /**
     * 处理鼠标移动
     */
    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 计算对应的频率
        const freq = (x / this.width) * 22050;
        this.canvas.title = `频率: ${freq.toFixed(0)}Hz`;
    }

    /**
     * 处理画布点击
     */
    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;

        // 添加自定义频率标记
        const freq = (x / this.width) * 22050;
        this.frequencyMarkers.push({
            freq: freq,
            label: `${freq.toFixed(0)}Hz`,
            type: 'custom'
        });

        console.log(`添加频率标记: ${freq.toFixed(0)}Hz`);
    }

    /**
     * 保存截图
     */
    saveScreenshot() {
        const link = document.createElement('a');
        link.download = `spectrum_analysis_${Date.now()}.png`;
        link.href = this.canvas.toDataURL();
        link.click();

        console.log('频谱分析截图已保存');
    }

    /**
     * 切换可见性
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// 全局可视化器实例
let spectrumVisualizer = null;

// 初始化可视化器
function initializeSpectrumVisualizer(recognitionSystem, noiseProcessor, audioAnalyser) {
    if (!spectrumVisualizer) {
        spectrumVisualizer = new RealtimeSpectrumVisualizer({
            width: 900,
            height: 600,
            updateInterval: 33 // ~30 FPS
        });

        // 连接到系统
        if (recognitionSystem || noiseProcessor || audioAnalyser) {
            spectrumVisualizer.connectToSystems(recognitionSystem, noiseProcessor, audioAnalyser);
        }

        // 添加全局快捷键 Ctrl+V
        document.addEventListener('keydown', (e) => {
            if (e.key === 'v' && e.ctrlKey) {
                e.preventDefault();
                spectrumVisualizer.toggle();
            }
        });

        console.log('频谱可视化器已初始化，按 Ctrl+V 切换显示');
    }

    return spectrumVisualizer;
}

// 导出
if (typeof window !== 'undefined') {
    window.RealtimeSpectrumVisualizer = RealtimeSpectrumVisualizer;
    window.initializeSpectrumVisualizer = initializeSpectrumVisualizer;
    window.spectrumVisualizer = spectrumVisualizer;
}