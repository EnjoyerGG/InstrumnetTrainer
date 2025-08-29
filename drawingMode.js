/* ==========================================
   DrawingMode.js - 交互绘画模式系统
   当在Fun模式下点击已解锁的韵律灯时激活
   ========================================== */

const DrawingMode = (() => {
    let _isActive = false;
    let _canvas = null;
    let _ctx = null;
    let _audioContext = null;
    let _analyser = null;
    let _dataArray = null;
    let _oscillators = [];
    let _currentSong = 0;

    // 绘画相关
    let _isDrawing = false;
    let _lastX = 0;
    let _lastY = 0;
    let _hue = 0;

    // 4首歌曲的音频文件路径（需要预加载）
    const _songPaths = [
        'assets/songs/song1.mp3',
        'assets/songs/song2.mp3',
        'assets/songs/song3.mp3',
        'assets/songs/song4.mp3'
    ];
    let _audioBuffers = [];
    let _currentSource = null;

    function init() {
        console.log('DrawingMode initialized');

        // 预加载音频文件
        preloadAudioFiles();

        return {
            activate: activate,
            deactivate: deactivate,
            isActive: () => _isActive
        };
    }

    async function preloadAudioFiles() {
        try {
            if (!_audioContext) {
                _audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            for (let i = 0; i < _songPaths.length; i++) {
                try {
                    const response = await fetch(_songPaths[i]);
                    const arrayBuffer = await response.arrayBuffer();
                    const audioBuffer = await _audioContext.decodeAudioData(arrayBuffer);
                    _audioBuffers[i] = audioBuffer;
                    console.log(`Loaded song ${i + 1}`);
                } catch (error) {
                    console.warn(`Failed to load song ${i + 1}:`, error);
                    // 创建空的音频缓冲区作为备用
                    _audioBuffers[i] = null;
                }
            }
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
        }
    }

    function activate(songIndex = 0) {
        if (_isActive) return;

        _isActive = true;
        _currentSong = songIndex;

        console.log(`Activating drawing mode with song ${songIndex + 1}`);

        // 创建全屏画布
        createDrawingCanvas();

        // 初始化音频
        initAudio();

        // 开始播放选定的歌曲
        playCurrentSong();

        // 绑定事件
        bindEvents();

        // 通知其他系统暂停
        pauseMainGame();
    }

    function deactivate() {
        if (!_isActive) return;

        _isActive = false;

        console.log('Deactivating drawing mode');

        // 停止音频
        stopAudio();

        // 移除画布
        removeDrawingCanvas();

        // 解绑事件
        unbindEvents();

        // 恢复主游戏
        resumeMainGame();
    }

    function createDrawingCanvas() {
        // 创建全屏透明画布覆盖层
        _canvas = document.createElement('canvas');
        _canvas.id = 'drawing-canvas';
        _canvas.width = window.innerWidth;
        _canvas.height = window.innerHeight;

        // 样式设置
        _canvas.style.position = 'fixed';
        _canvas.style.top = '0';
        _canvas.style.left = '0';
        _canvas.style.width = '100vw';
        _canvas.style.height = '100vh';
        _canvas.style.zIndex = '9999';
        _canvas.style.cursor = 'crosshair';
        _canvas.style.background = 'rgba(0, 0, 0, 0.1)'; // 轻微半透明背景

        _ctx = _canvas.getContext('2d');
        _ctx.lineCap = 'round';
        _ctx.lineJoin = 'round';

        document.body.appendChild(_canvas);

        // 添加退出按钮
        createExitButton();
    }

    function createExitButton() {
        const exitBtn = document.createElement('button');
        exitBtn.id = 'drawing-exit-btn';
        exitBtn.innerHTML = '✕ Exit Drawing';
        exitBtn.style.position = 'fixed';
        exitBtn.style.top = '20px';
        exitBtn.style.right = '20px';
        exitBtn.style.zIndex = '10000';
        exitBtn.style.padding = '10px 15px';
        exitBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        exitBtn.style.border = '2px solid #333';
        exitBtn.style.borderRadius = '5px';
        exitBtn.style.cursor = 'pointer';
        exitBtn.style.fontSize = '14px';
        exitBtn.style.fontWeight = 'bold';

        exitBtn.onclick = deactivate;

        document.body.appendChild(exitBtn);
    }

    function removeDrawingCanvas() {
        if (_canvas) {
            document.body.removeChild(_canvas);
            _canvas = null;
            _ctx = null;
        }

        const exitBtn = document.getElementById('drawing-exit-btn');
        if (exitBtn) {
            document.body.removeChild(exitBtn);
        }
    }

    function initAudio() {
        if (!_audioContext) return;

        // 创建分析器节点
        _analyser = _audioContext.createAnalyser();
        _analyser.fftSize = 256;
        _analyser.connect(_audioContext.destination);

        const bufferLength = _analyser.frequencyBinCount;
        _dataArray = new Uint8Array(bufferLength);
    }

    function playCurrentSong() {
        if (!_audioContext || !_audioBuffers[_currentSong]) {
            console.warn(`No audio buffer for song ${_currentSong + 1}`);
            return;
        }

        // 停止当前播放的音频
        if (_currentSource) {
            _currentSource.stop();
        }

        // 创建新的音频源
        _currentSource = _audioContext.createBufferSource();
        _currentSource.buffer = _audioBuffers[_currentSong];
        _currentSource.loop = true; // 循环播放

        // 连接到分析器
        _currentSource.connect(_analyser);

        // 开始播放
        _currentSource.start();

        console.log(`Playing song ${_currentSong + 1}`);
    }

    function stopAudio() {
        if (_currentSource) {
            _currentSource.stop();
            _currentSource = null;
        }
    }

    function bindEvents() {
        _canvas.addEventListener('mousedown', startDrawing);
        _canvas.addEventListener('mousemove', draw);
        _canvas.addEventListener('mouseup', stopDrawing);
        _canvas.addEventListener('mouseout', stopDrawing);

        // 触摸事件支持
        _canvas.addEventListener('touchstart', handleTouch);
        _canvas.addEventListener('touchmove', handleTouch);
        _canvas.addEventListener('touchend', stopDrawing);

        // 键盘事件
        document.addEventListener('keydown', handleKeyPress);

        // 窗口大小改变
        window.addEventListener('resize', handleResize);

        // 开始动画循环
        requestAnimationFrame(animate);
    }

    function unbindEvents() {
        if (_canvas) {
            _canvas.removeEventListener('mousedown', startDrawing);
            _canvas.removeEventListener('mousemove', draw);
            _canvas.removeEventListener('mouseup', stopDrawing);
            _canvas.removeEventListener('mouseout', stopDrawing);
            _canvas.removeEventListener('touchstart', handleTouch);
            _canvas.removeEventListener('touchmove', handleTouch);
            _canvas.removeEventListener('touchend', stopDrawing);
        }

        document.removeEventListener('keydown', handleKeyPress);
        window.removeEventListener('resize', handleResize);
    }

    function startDrawing(e) {
        _isDrawing = true;
        const rect = _canvas.getBoundingClientRect();
        _lastX = e.clientX - rect.left;
        _lastY = e.clientY - rect.top;
    }

    function draw(e) {
        if (!_isDrawing) return;

        const rect = _canvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        // 根据音频频谱数据调整绘画效果
        updateDrawingStyle();

        _ctx.beginPath();
        _ctx.moveTo(_lastX, _lastY);
        _ctx.lineTo(currentX, currentY);
        _ctx.stroke();

        _lastX = currentX;
        _lastY = currentY;

        // 根据鼠标移动生成额外的视觉效果
        createParticleEffect(currentX, currentY);
    }

    function stopDrawing() {
        _isDrawing = false;
    }

    function handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        if (touch) {
            const mouseEvent = new MouseEvent(e.type.replace('touch', 'mouse'), {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            _canvas.dispatchEvent(mouseEvent);
        }
    }

    function handleKeyPress(e) {
        switch (e.key) {
            case 'Escape':
                deactivate();
                break;
            case 'c':
            case 'C':
                clearCanvas();
                break;
            case '1':
            case '2':
            case '3':
            case '4':
                const songIndex = parseInt(e.key) - 1;
                switchSong(songIndex);
                break;
        }
    }

    function handleResize() {
        if (_canvas) {
            _canvas.width = window.innerWidth;
            _canvas.height = window.innerHeight;
        }
    }

    function updateDrawingStyle() {
        if (!_analyser || !_dataArray) return;

        // 获取频谱数据
        _analyser.getByteFrequencyData(_dataArray);

        // 计算平均音量
        let sum = 0;
        for (let i = 0; i < _dataArray.length; i++) {
            sum += _dataArray[i];
        }
        const average = sum / _dataArray.length;

        // 根据音量调整绘画属性
        const volume = average / 255;
        _ctx.lineWidth = 2 + volume * 20; // 线条粗细随音量变化

        // 颜色随频谱变化
        _hue = (_hue + volume * 2) % 360;
        const saturation = 50 + volume * 50;
        const lightness = 40 + volume * 30;

        _ctx.strokeStyle = `hsla(${_hue}, ${saturation}%, ${lightness}%, 0.8)`;
        _ctx.shadowColor = _ctx.strokeStyle;
        _ctx.shadowBlur = volume * 10;
    }

    function createParticleEffect(x, y) {
        if (!_analyser || !_dataArray) return;

        _analyser.getByteFrequencyData(_dataArray);

        // 从高频数据创建粒子
        for (let i = 0; i < 5; i++) {
            const freq = _dataArray[i + 50] / 255;
            if (freq > 0.3) { // 只在频率足够高时创建粒子
                const particleX = x + (Math.random() - 0.5) * 50;
                const particleY = y + (Math.random() - 0.5) * 50;
                const size = freq * 10;

                _ctx.save();
                _ctx.globalAlpha = freq;
                _ctx.fillStyle = `hsl(${(_hue + i * 30) % 360}, 70%, 60%)`;
                _ctx.beginPath();
                _ctx.arc(particleX, particleY, size, 0, Math.PI * 2);
                _ctx.fill();
                _ctx.restore();
            }
        }
    }

    function clearCanvas() {
        if (_ctx) {
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
        }
    }

    function switchSong(songIndex) {
        if (songIndex >= 0 && songIndex < _audioBuffers.length && _audioBuffers[songIndex]) {
            _currentSong = songIndex;
            playCurrentSong();
            console.log(`Switched to song ${songIndex + 1}`);
        }
    }

    function animate() {
        if (!_isActive) return;

        // 持续的背景频谱可视化
        drawSpectrumVisualization();

        requestAnimationFrame(animate);
    }

    function drawSpectrumVisualization() {
        if (!_analyser || !_dataArray || !_ctx) return;

        _analyser.getByteFrequencyData(_dataArray);

        const barWidth = _canvas.width / _dataArray.length * 2;
        let x = 0;

        for (let i = 0; i < _dataArray.length; i++) {
            const barHeight = (_dataArray[i] / 255) * _canvas.height * 0.3;

            const hue = i / _dataArray.length * 360;
            _ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.1)`;

            // 在底部绘制频谱条
            _ctx.fillRect(x, _canvas.height - barHeight, barWidth, barHeight);

            x += barWidth;
        }
    }

    function pauseMainGame() {
        // 通知主游戏系统暂停
        if (typeof window.handlePause === 'function') {
            window.handlePause();
        }

        // 隐藏主UI
        const scoreWrap = document.getElementById('score-wrap');
        if (scoreWrap) {
            scoreWrap.style.display = 'none';
        }
    }

    function resumeMainGame() {
        // 恢复主UI显示
        const scoreWrap = document.getElementById('score-wrap');
        if (scoreWrap) {
            scoreWrap.style.display = 'block';
        }
    }

    return { init };
})();

// 确保模块可用
if (typeof window !== 'undefined') {
    window.DrawingMode = DrawingMode;
}