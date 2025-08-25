// audioAnalyzer.js - 双面板音频分析器（左：分贝仪，右：频谱图）
(function (root) {
    const dpr = () => (window.devicePixelRatio || 1);

    const AudioAnalyzer = {
        // DOM
        _wrap: null,
        _canvas: null, _ctx: null,
        _grid: null, _gctx: null,

        // 状态
        _running: false,
        _dispDb: null,
        _maxDb: -Infinity,
        _minDb: Infinity,
        _avgDb: 0,
        _dbHistory: [],
        _spectrumHistory: [],

        // 音频
        _analyser: null,
        _frequencyData: null,
        _timeData: null,
        _offsetDb: 0,

        // 布局
        _leftPanel: null,  // 分贝仪区域
        _rightPanel: null, // 频谱图区域

        // 参数
        _dbMin: 0,
        _dbMax: 120,
        _historyLength: 300, // 历史点数
        _fallSpeed: 0.92,    // 回落速度（越小越快）

        /* -------------------- 初始化 -------------------- */
        init({
            mount,
            width = 800,
            height = 400,
            dbMin = 0,
            dbMax = 120,
            fftSize = 2048
        } = {}) {
            this._dbMin = dbMin;
            this._dbMax = dbMax;

            // 创建容器
            this._wrap = typeof mount === 'string' ? document.querySelector(mount) : mount;
            if (!this._wrap) {
                this._wrap = document.createElement('div');
                document.body.appendChild(this._wrap);
            }

            this._wrap.className = 'audio-analyzer';
            this._wrap.style.cssText = `
                position: relative;
                width: ${width}px;
                height: ${height}px;
                background: #1e1f23;
                border-radius: 12px;
                overflow: hidden;
                font-family: -apple-system, "SF Pro Display", sans-serif;
            `;

            // 创建画布
            const d = dpr();
            this._canvas = document.createElement('canvas');
            this._canvas.width = Math.round(width * d);
            this._canvas.height = Math.round(height * d);
            this._canvas.style.cssText = `width: ${width}px; height: ${height}px;`;
            this._wrap.appendChild(this._canvas);
            this._ctx = this._canvas.getContext('2d');
            this._ctx.setTransform(d, 0, 0, d, 0, 0);

            // 网格层
            this._grid = document.createElement('canvas');
            this._grid.width = this._canvas.width;
            this._grid.height = this._canvas.height;
            this._gctx = this._grid.getContext('2d');
            this._gctx.setTransform(d, 0, 0, d, 0, 0);

            // 定义面板区域（左：分贝仪，右：频谱）
            const midX = Math.floor(width / 2);
            this._leftPanel = { x: 0, y: 0, w: midX - 1, h: height };
            this._rightPanel = { x: midX + 1, y: 0, w: width - midX - 1, h: height };

            // 初始化历史数据
            this._dbHistory = new Array(this._historyLength).fill(this._dbMin);
            this._currentDb = this._dbMin;

            this._drawGrid();
            this._fftSize = fftSize;

            return this;
        },

        /* -------------------- 音频设置 -------------------- */
        async setupAudio({ offsetDb = 0, useP5Mic = false } = {}) {
            // 支持选择使用 p5.js 麦克风或独立的 MediaStream。
            // 如果 useP5Mic 为真且存在全局 mic 实例，则直接使用 p5 的音频输入。
            this._offsetDb = offsetDb;

            try {
                // 如果选择使用 p5 AudioIn，尝试从 p5 获取已有的音频上下文和输入
                if (useP5Mic && window.mic && typeof window.getAudioContext === 'function') {
                    const ctx = window.getAudioContext();
                    // 如果已经有 mic.stream（MediaStream），重新创建一个 source
                    const stream = window.mic.stream;
                    if (ctx && stream) {
                        const source = ctx.createMediaStreamSource(stream);
                        this._analyser = ctx.createAnalyser();
                        this._analyser.fftSize = this._fftSize || 2048;
                        this._analyser.smoothingTimeConstant = 0.3;
                        this._analyser.minDecibels = -100;
                        this._analyser.maxDecibels = -10;

                        // 将 mic 流连接到分析器
                        source.connect(this._analyser);

                        const bufferLength = this._analyser.frequencyBinCount;
                        this._frequencyData = new Uint8Array(bufferLength);
                        this._timeData = new Uint8Array(this._analyser.fftSize);

                        this._running = true;
                        if (ctx.state !== 'running') await ctx.resume();
                        return;
                    }
                }
                // 默认情况：直接请求用户媒体
                const AC = window.AudioContext || window.webkitAudioContext;
                const ctx = new AC();

                // 请求麦克风音频流
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: 48000
                    }
                });
                const source = ctx.createMediaStreamSource(stream);

                // 创建分析器
                this._analyser = ctx.createAnalyser();
                this._analyser.fftSize = this._fftSize || 2048;
                this._analyser.smoothingTimeConstant = 0.3;
                this._analyser.minDecibels = -100;
                this._analyser.maxDecibels = -10;

                // 连接输入到分析器
                source.connect(this._analyser);

                // 初始化数据缓冲
                const bufferLength = this._analyser.frequencyBinCount;
                this._frequencyData = new Uint8Array(bufferLength);
                this._timeData = new Uint8Array(this._analyser.fftSize);

                this._running = true;
                await ctx.resume();
            } catch (e) {
                console.error('音频初始化失败:', e);
            }
        },

        /**
         * 在音频分析图上添加一个标记。用户点击时可以调用此方法突出显示一个竖线。
         * @param {string} color 颜色字符串，如 '#ff0000'
         * @param {number} duration 持续时间（毫秒）
         */
        pushMarker(color = '#ff0000', duration = 1000) {
            if (!this._markers) this._markers = [];
            this._markers.push({ color, duration, start: performance.now() });
        },

        /* -------------------- 数据处理 -------------------- */
        _calculateDb() {
            if (!this._analyser) return this._dbMin;

            // 获取时域数据计算RMS
            this._analyser.getByteTimeDomainData(this._timeData);

            let sum = 0;
            for (let i = 0; i < this._timeData.length; i++) {
                const normalized = (this._timeData[i] - 128) / 128;
                sum += normalized * normalized;
            }

            const rms = Math.sqrt(sum / this._timeData.length);
            const db = 20 * Math.log10(Math.max(rms, 1e-6)) + 100 + this._offsetDb;

            return Math.max(this._dbMin, Math.min(this._dbMax, db));
        },

        /* -------------------- 更新循环 -------------------- */
        update() {
            if (!this._running) return;

            // 计算当前分贝值
            const targetDb = this._calculateDb();

            // 快速上升，缓慢下降
            if (targetDb > this._currentDb) {
                this._currentDb = targetDb; // 立即跟随上升
            } else {
                this._currentDb = this._currentDb * this._fallSpeed + targetDb * (1 - this._fallSpeed);
            }

            // 更新统计
            if (this._currentDb > this._maxDb) this._maxDb = this._currentDb;
            if (this._currentDb < this._minDb) this._minDb = this._currentDb;

            // 计算平均值
            const validHistory = this._dbHistory.filter(v => v > this._dbMin);
            if (validHistory.length > 0) {
                this._avgDb = validHistory.reduce((a, b) => a + b, 0) / validHistory.length;
            }

            // 更新历史
            this._dbHistory.push(this._currentDb);
            if (this._dbHistory.length > this._historyLength) {
                this._dbHistory.shift();
            }

            // 更新显示值（平滑）
            if (this._dispDb === null) this._dispDb = this._currentDb;
            this._dispDb = this._dispDb * 0.7 + this._currentDb * 0.3;

            // 获取频谱数据
            if (this._analyser) {
                this._analyser.getByteFrequencyData(this._frequencyData);
            }

            // 绘制
            this._render();
        },

        /* -------------------- 渲染 -------------------- */
        _render() {
            const ctx = this._ctx;
            const W = this._canvas.width / dpr();
            const H = this._canvas.height / dpr();

            // 清空画布
            ctx.clearRect(0, 0, W, H);

            // 绘制网格背景
            ctx.drawImage(this._grid, 0, 0, W, H);

            // 绘制左侧分贝仪
            this._renderMeter(ctx, this._leftPanel);

            // 绘制右侧频谱
            this._renderSpectrum(ctx, this._rightPanel);

            // 绘制分隔线
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.floor(W / 2), 0);
            ctx.lineTo(Math.floor(W / 2), H);
            ctx.stroke();

            // 绘制临时标记（竖线）。在顶部跨越整个图表，以便提供反馈。
            if (this._markers && this._markers.length > 0) {
                const now = performance.now();
                // 默认绘制在右侧频谱区最右端
                const markerX = this._rightPanel.x + this._rightPanel.w - 4;
                this._markers = this._markers.filter(mk => {
                    const t = now - mk.start;
                    if (t <= mk.duration) {
                        const alpha = 1 - t / mk.duration;
                        ctx.save();
                        ctx.strokeStyle = mk.color;
                        ctx.globalAlpha = alpha;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(markerX + 0.5, 0);
                        ctx.lineTo(markerX + 0.5, H);
                        ctx.stroke();
                        ctx.restore();
                        return true;
                    }
                    return false;
                });
            }
        },

        /* -------------------- 分贝仪渲染 -------------------- */
        _renderMeter(ctx, panel) {
            ctx.save();
            ctx.translate(panel.x, panel.y);

            // 绘制大数字
            ctx.fillStyle = '#4fd8ff';
            ctx.font = 'bold 48px "SF Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const dbText = this._dispDb ? this._dispDb.toFixed(1) : '--.-';
            ctx.fillText(dbText, panel.w / 2, 60);

            // dB单位
            ctx.font = '24px "SF Pro Display", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillText('dB', panel.w / 2 + 80, 60);

            // 统计信息
            ctx.font = '13px "SF Pro Display", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.textAlign = 'right';
            ctx.fillText(`最大: ${this._maxDb.toFixed(1)} dB`, panel.w - 20, 110);
            ctx.fillText(`平均: ${this._avgDb.toFixed(1)} dB`, panel.w - 20, 130);
            ctx.fillText(`最小: ${this._minDb.toFixed(1)} dB`, panel.w - 20, 150);

            // 绘制历史曲线
            const graphY = 180;
            const graphH = panel.h - graphY - 40;
            const graphW = panel.w - 40;
            const graphX = 20;

            // 时间轴标签
            ctx.font = '10px "SF Mono", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.textAlign = 'center';
            const timeSpan = this._historyLength * 50 / 1000; // 假设50ms采样
            for (let i = 0; i <= 5; i++) {
                const x = graphX + (graphW * i / 5);
                const time = (timeSpan * (1 - i / 5)).toFixed(0);
                ctx.fillText(`${time}s`, x, panel.h - 10);
            }

            // 绘制曲线
            ctx.strokeStyle = '#ff3b30';
            ctx.lineWidth = 2;
            ctx.beginPath();

            for (let i = 0; i < this._dbHistory.length; i++) {
                const x = graphX + (i / (this._historyLength - 1)) * graphW;
                const db = this._dbHistory[i];
                const y = graphY + graphH * (1 - (db - this._dbMin) / (this._dbMax - this._dbMin));

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();

            // 绘制Y轴刻度
            ctx.font = '10px "SF Mono", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.textAlign = 'right';
            for (let db = this._dbMin; db <= this._dbMax; db += 20) {
                const y = graphY + graphH * (1 - (db - this._dbMin) / (this._dbMax - this._dbMin));
                ctx.fillText(db.toString(), graphX - 5, y);
            }

            ctx.restore();
        },

        /* -------------------- 频谱渲染 -------------------- */
        _renderSpectrum(ctx, panel) {
            if (!this._frequencyData) return;

            ctx.save();
            ctx.translate(panel.x, panel.y);

            // 标题
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = '14px "SF Pro Display", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('频谱分析', panel.w / 2, 20);

            const graphY = 40;
            const graphH = panel.h - graphY - 40;
            const graphW = panel.w - 40;
            const graphX = 20;

            // 绘制频谱
            const barWidth = graphW / this._frequencyData.length * 2;

            // 创建渐变
            const gradient = ctx.createLinearGradient(0, graphY + graphH, 0, graphY);
            gradient.addColorStop(0, '#0066ff');
            gradient.addColorStop(0.5, '#00ddff');
            gradient.addColorStop(1, '#00ff88');

            ctx.fillStyle = gradient;

            for (let i = 0; i < this._frequencyData.length; i++) {
                const x = graphX + (i / this._frequencyData.length) * graphW;
                const value = this._frequencyData[i] / 255;
                const barHeight = value * graphH;

                ctx.fillRect(x, graphY + graphH - barHeight, barWidth - 1, barHeight);
            }

            // 频率标签
            ctx.font = '10px "SF Mono", monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.textAlign = 'center';

            const sampleRate = 48000; // 假设采样率
            const nyquist = sampleRate / 2;
            const freqLabels = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

            for (const freq of freqLabels) {
                const x = graphX + (freq / 22) * graphW;
                ctx.fillText(`${freq}k`, x, panel.h - 10);
            }

            ctx.restore();
        },

        /* -------------------- 网格绘制 -------------------- */
        _drawGrid() {
            const g = this._gctx;
            const W = this._canvas.width / dpr();
            const H = this._canvas.height / dpr();

            g.clearRect(0, 0, W, H);

            // 背景
            g.fillStyle = '#1e1f23';
            g.fillRect(0, 0, W, H);

            // 网格线
            g.strokeStyle = 'rgba(255,255,255,0.05)';
            g.lineWidth = 1;

            // 垂直线
            for (let x = 0; x <= W; x += 40) {
                g.beginPath();
                g.moveTo(x + 0.5, 0);
                g.lineTo(x + 0.5, H);
                g.stroke();
            }

            // 水平线
            for (let y = 0; y <= H; y += 40) {
                g.beginPath();
                g.moveTo(0, y + 0.5);
                g.lineTo(W, y + 0.5);
                g.stroke();
            }
        },

        /* -------------------- 控制方法 -------------------- */
        reset() {
            this._maxDb = -Infinity;
            this._minDb = Infinity;
            this._avgDb = 0;
            this._dbHistory.fill(this._dbMin);
            this._currentDb = this._dbMin;
            this._dispDb = null;
        },

        pause() {
            this._running = false;
        },

        resume() {
            this._running = true;
        },

        setOffsetDb(db) {
            this._offsetDb = db;
        }
    };

    // 导出
    root.AudioAnalyzer = AudioAnalyzer;

})(window);