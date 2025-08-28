/* ==========================================
   ScorePanel.js - 分数HUD模块
   适配RECT.score区域的打分系统
   按照手绘图重新设计布局
   ========================================== */

const ScorePanel = (() => {
    let _rect = null;
    let _rectProvider = null;

    // 核心状态
    let _score = 0;
    let _perfectHits = 0;
    let _goodHits = 0;
    let _missHits = 0;
    let _combo = 0;
    let _maxCombo = 0;

    // 模式管理
    let _isEntertainmentMode = false;

    // 电池充电系统
    let _batteryCharge = 0;
    let _totalCharges = 0;
    let _unlockedSongs = 0;

    // 击打类型识别 - 只显示当前击打
    let _currentHitType = null;
    let _currentHitTime = 0;
    let _hitTypes = {
        slap: { icon: '👋', name: 'Slap', color: '#ff6b6b' },
        open: { icon: '🤲', name: 'Open', color: '#4ecdc4' },
        tip: { icon: '👆', name: 'Tip', color: '#45b7d1' },
        bass: { icon: '👊', name: 'Bass', color: '#f39c12' }
    };

    // 节拍选择（AI互动模式）
    let _selectedRhythm = 0;
    let _rhythmOptions = [
        { name: '节拍1', icon: '♪', unlocked: false },
        { name: '节拍2', icon: '♫', unlocked: false },
        { name: '节拍3', icon: '♬', unlocked: false },
        { name: '节拍4', icon: '♭', unlocked: false }
    ];

    // 视觉效果状态
    let _scoreGlow = 0;
    let _batteryPulse = 0;
    let _floatingTexts = [];

    // 电池泡泡效果
    let _bubbles = [];
    let _bubbleTime = 0;
    let _isBubbleActive = false;

    function init(options = {}) {
        _rectProvider = options.rectProvider || (() => ({ x: 0, y: 0, w: 200, h: 300 }));

        console.log('ScorePanel initialized - New Layout');

        // 注册全局接口
        window.scorePanelInterface = {
            onHit: (timing = 'good', hitType = 'unknown') => registerHit(timing, hitType),
            onPerfectHit: (hitType = 'unknown') => registerHit('perfect', hitType),
            onMiss: () => registerHit('miss'),
            getScore: () => getScoreData(),
            reset: () => reset(),
            setMode: (isEntertainment) => setMode(isEntertainment),
            selectRhythm: (index) => selectRhythm(index),
            triggerBubbles: () => triggerBubbleEffect()
        };

        return {
            render: render,
            registerHit: registerHit,
            reset: reset,
            getScoreData: getScoreData
        };
    }

    function registerHit(timing = 'good', hitType = 'unknown') {
        const now = millis();

        // 更新统计
        if (timing === 'perfect') {
            _perfectHits++;
            _score += 3;
            _batteryCharge += 3;
            _combo++;
            _scoreGlow = 1.0;
            addFloatingText('+3', '#00ff88', 18);

            // 检查电池充满
            checkBatteryCharge();

        } else if (timing === 'good') {
            _goodHits++;
            _score += 1;
            _batteryCharge += 1;
            _combo++;
            _scoreGlow = 0.6;
            addFloatingText('+1', '#ffaa00', 14);

            checkBatteryCharge();

        } else { // miss
            _missHits++;
            _combo = 0;
            addFloatingText('Miss', '#ff4444', 14);
        }

        // 更新最高连击
        if (_combo > _maxCombo) {
            _maxCombo = _combo;
        }

        // 更新当前击打类型显示
        if (_hitTypes[hitType]) {
            _currentHitType = hitType;
            _currentHitTime = now;
        }

        console.log(`击打记录: ${timing} (${hitType}), 分数: ${_score}, 连击: ${_combo}`);
    }

    function checkBatteryCharge() {
        const prevCharge = _batteryCharge;
        _batteryCharge = Math.min(_batteryCharge, 100);

        // 检查是否充满
        if (prevCharge < 100 && _batteryCharge >= 100) {
            _batteryCharge = 0;
            _totalCharges++;
            _batteryPulse = 1.0;
            triggerBubbleEffect();

            // 解锁节拍选项
            if (_unlockedSongs < 4) {
                _rhythmOptions[_unlockedSongs].unlocked = true;
                _unlockedSongs++;
                addFloatingText(`解锁${_rhythmOptions[_unlockedSongs - 1].name}!`, '#ffd700', 16);
            }
        }
    }

    function setMode(isEntertainment) {
        _isEntertainmentMode = isEntertainment;
        console.log(`模式切换至: ${isEntertainment ? '娱乐模式' : '练习模式'}`);
    }

    function selectRhythm(index) {
        if (_isEntertainmentMode && _rhythmOptions[index] && _rhythmOptions[index].unlocked) {
            _selectedRhythm = index;
            console.log(`选择节拍: ${_rhythmOptions[index].name}`);
            // 这里可以触发AI互动模式
        }
    }

    function triggerBubbleEffect() {
        _isBubbleActive = true;
        _bubbleTime = millis();

        // 生成泡泡
        for (let i = 0; i < 12; i++) {
            _bubbles.push({
                x: Math.random() * 0.8 + 0.1,
                y: 0.5,
                size: Math.random() * 3 + 2,
                speed: Math.random() * 0.003 + 0.002,
                life: Math.random() * 2500 + 1500,
                startTime: millis() + Math.random() * 800
            });
        }
    }

    function addFloatingText(text, color, size) {
        if (!_rect) return;

        _floatingTexts.push({
            text: text,
            x: _rect.x + _rect.w * (0.4 + Math.random() * 0.3),
            y: _rect.y + _rect.h * 0.6,
            color: color,
            size: size,
            life: 1800,
            startTime: millis(),
            vy: -1.0 - Math.random() * 0.5
        });
    }

    function render(ctx, x, y, w, h) {
        if (!ctx) return;

        _rect = { x, y, w, h };

        ctx.save();

        // 清空背景
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        ctx.fillRect(x, y, w, h);

        // 边框
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

        const padding = 6;

        // 顶部：模式滑块 - 15%高度
        const sliderH = Math.floor(h * 0.15);
        renderModeSlider(ctx, x + padding, y + padding, w - padding * 2, sliderH);

        // 右上角：总分显示
        renderScoreDisplay(ctx, x, y, w, h);

        // 中间：能量槽 - 30%高度
        const batteryY = y + padding + sliderH + padding;
        const batteryH = Math.floor(h * 0.30);
        renderHorizontalBattery(ctx, x + padding, batteryY, w - padding * 2, batteryH);

        // 底部区域 - 剩余空间
        const bottomY = batteryY + batteryH + padding;
        const bottomH = h - (bottomY - y) - padding;
        const halfW = Math.floor((w - padding * 3) / 2);

        // 左下角：击打识别
        renderCurrentHitDisplay(ctx, x + padding, bottomY, halfW, bottomH);

        // 右下角：节拍选择（4个圆圈）
        renderRhythmSelector(ctx, x + padding + halfW + padding, bottomY, halfW, bottomH);

        // 渲染浮动文字
        renderFloatingTexts(ctx);

        // 更新效果
        updateEffects();

        ctx.restore();
    }

    function renderModeSlider(ctx, x, y, w, h) {
        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(x, y, w, h);

        // 滑块轨道
        const trackY = y + h / 2 - 8;
        const trackH = 16;

        ctx.fillStyle = '#333';
        ctx.fillRect(x + 10, trackY, w - 20, trackH);

        // 滑块按钮
        const sliderX = _isEntertainmentMode ?
            x + w - 30 - 20 : x + 10 + 5;

        ctx.fillStyle = _isEntertainmentMode ? '#ff6b6b' : '#4a9eff';
        ctx.fillRect(sliderX, trackY + 2, 40, trackH - 4);

        // 标签
        ctx.fillStyle = '#aaa';
        ctx.font = '10px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('练习', x + 15, y + h - 8);

        ctx.textAlign = 'right';
        ctx.fillText('娱乐', x + w - 15, y + h - 8);
    }

    function renderScoreDisplay(ctx, x, y, w, h) {
        // 在右上角显示总分
        const scoreX = x + w - 60;
        const scoreY = y + 15;

        // 主分数 - 带发光效果
        const glowAlpha = _scoreGlow * 0.5;
        if (_scoreGlow > 0) {
            ctx.shadowBlur = 8 + _scoreGlow * 4;
            ctx.shadowColor = `rgba(74, 158, 255, ${glowAlpha})`;
        }

        ctx.fillStyle = `rgba(74, 158, 255, ${1.0 - glowAlpha * 0.3})`;
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(_score.toString(), scoreX + 50, scoreY + 15);

        // 重置阴影
        ctx.shadowBlur = 0;

        // 标签
        ctx.fillStyle = '#888';
        ctx.font = '8px Arial';
        ctx.fillText('总分', scoreX + 50, scoreY + 30);
    }

    function renderHorizontalBattery(ctx, x, y, w, h) {
        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x, y, w, h);

        // 标题
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('能量槽', x + 5, y + 15);

        // 百分比
        ctx.textAlign = 'right';
        ctx.fillText(Math.floor(_batteryCharge) + '%', x + w - 5, y + 15);

        // 水平电池主体
        const batteryX = x + 10;
        const batteryY = y + 20;
        const batteryW = w - 30;
        const batteryH = h - 30;

        // 电池边框 - 带脉冲效果
        if (_batteryPulse > 0) {
            ctx.shadowBlur = 6 + _batteryPulse * 6;
            ctx.shadowColor = `rgba(74, 158, 255, ${_batteryPulse})`;
        }

        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        ctx.strokeRect(batteryX, batteryY, batteryW, batteryH);

        // 电池正极
        const capW = 6;
        const capH = batteryH * 0.6;
        ctx.fillStyle = '#4a9eff';
        ctx.fillRect(batteryX + batteryW, batteryY + (batteryH - capH) / 2, capW, capH);

        // 重置阴影
        ctx.shadowBlur = 0;

        // 从左到右的电池填充
        const fillW = (batteryW - 4) * (_batteryCharge / 100);
        if (fillW > 0) {
            // 水平渐变填充
            const gradient = ctx.createLinearGradient(batteryX, 0, batteryX + batteryW, 0);
            gradient.addColorStop(0, '#ff4757');
            gradient.addColorStop(0.3, '#ffa502');
            gradient.addColorStop(0.6, '#2ed573');
            gradient.addColorStop(1, '#4a9eff');

            ctx.fillStyle = gradient;
            ctx.fillRect(batteryX + 2, batteryY + 2, fillW, batteryH - 4);
        }

        // 渲染泡泡效果
        if (_isBubbleActive) {
            renderBubbles(ctx, batteryX, batteryY, batteryW, batteryH);
        }
    }

    function renderCurrentHitDisplay(ctx, x, y, w, h) {
        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x, y, w, h);

        // 标题
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('击打识别', x + w / 2, y + 15);

        // 显示当前击打类型
        if (_currentHitType && millis() - _currentHitTime < 1500) {
            const type = _hitTypes[_currentHitType];

            // 大图标
            ctx.fillStyle = type.color;
            ctx.font = '36px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(type.icon, x + w / 2, y + h / 2 + 5);

            // 名称
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Arial';
            ctx.fillText(type.name, x + w / 2, y + h - 15);

        } else {
            // 待机状态
            ctx.fillStyle = '#666';
            ctx.font = '24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('？', x + w / 2, y + h / 2 + 5);

            ctx.font = '10px Arial';
            ctx.fillText('等待击打', x + w / 2, y + h - 15);
        }
    }

    function renderRhythmSelector(ctx, x, y, w, h) {
        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(x, y, w, h);

        // 标题
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('运势拍', x + w / 2, y + 15);

        // 4个圆圈布局 (2x2)
        const circleSize = Math.min(w / 3, h / 4);
        const circleRadius = circleSize / 2 - 3;
        const centerX1 = x + w * 0.3;
        const centerX2 = x + w * 0.7;
        const centerY1 = y + h * 0.4;
        const centerY2 = y + h * 0.75;

        const positions = [
            { x: centerX1, y: centerY1, index: 0 },
            { x: centerX2, y: centerY1, index: 1 },
            { x: centerX1, y: centerY2, index: 2 },
            { x: centerX2, y: centerY2, index: 3 }
        ];

        positions.forEach(pos => {
            const option = _rhythmOptions[pos.index];

            // 圆圈背景
            const isSelected = _selectedRhythm === pos.index;
            const isUnlocked = option.unlocked;
            const canUse = _isEntertainmentMode && isUnlocked;

            ctx.fillStyle = canUse ?
                (isSelected ? 'rgba(255, 215, 0, 0.3)' : 'rgba(255, 255, 255, 0.1)') :
                'rgba(100, 100, 100, 0.1)';

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, circleRadius, 0, Math.PI * 2);
            ctx.fill();

            // 圆圈边框
            ctx.strokeStyle = canUse ?
                (isSelected ? '#ffd700' : '#4a9eff') : '#666';
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.stroke();

            // 图标
            ctx.fillStyle = canUse ? '#fff' : '#666';
            ctx.font = `${Math.floor(circleRadius * 0.8)}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(option.icon, pos.x, pos.y + 3);

            // 解锁状态指示
            if (!isUnlocked) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, circleRadius, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#888';
                ctx.font = '12px Arial';
                ctx.fillText('🔒', pos.x, pos.y + 2);
            }
        });
    }

    function renderBubbles(ctx, x, y, w, h) {
        ctx.save();

        // 设置剪切区域
        ctx.beginPath();
        ctx.rect(x + 2, y + 2, w - 4, h - 4);
        ctx.clip();

        const currentTime = millis();

        _bubbles.forEach(bubble => {
            if (currentTime < bubble.startTime) return;

            const age = currentTime - bubble.startTime;
            if (age > bubble.life) return;

            // 更新位置（水平移动）
            bubble.x += bubble.speed * (currentTime - (bubble.lastUpdate || bubble.startTime));
            bubble.lastUpdate = currentTime;

            if (bubble.x > 1.1) return; // 泡泡已经离开视野

            // 计算透明度
            const alpha = Math.max(0, 1 - age / bubble.life) * 0.6;

            // 绘制泡泡
            const bubbleX = x + bubble.x * w;
            const bubbleY = y + bubble.y * h;

            ctx.fillStyle = `rgba(0, 212, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(bubbleX, bubbleY, bubble.size, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();

        // 清理过期泡泡
        if (currentTime - _bubbleTime > 4000) {
            _isBubbleActive = false;
            _bubbles = [];
        }
    }

    function renderFloatingTexts(ctx) {
        const currentTime = millis();

        _floatingTexts = _floatingTexts.filter(text => {
            const age = currentTime - text.startTime;
            if (age > text.life) return false;

            // 更新位置
            text.y += text.vy;

            // 计算透明度
            const progress = age / text.life;
            const alpha = Math.max(0, 1 - progress);

            // 绘制文字
            ctx.save();
            ctx.fillStyle = text.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
            ctx.font = `bold ${text.size}px Arial`;
            ctx.textAlign = 'center';
            ctx.shadowBlur = 4;
            ctx.shadowColor = text.color;
            ctx.fillText(text.text, text.x, text.y);
            ctx.restore();

            return true;
        });
    }

    function updateEffects() {
        // 分数发光衰减
        if (_scoreGlow > 0) {
            _scoreGlow *= 0.94;
            if (_scoreGlow < 0.01) _scoreGlow = 0;
        }

        // 电池脉冲衰减  
        if (_batteryPulse > 0) {
            _batteryPulse *= 0.91;
            if (_batteryPulse < 0.01) _batteryPulse = 0;
        }

        // 重置当前击打显示
        if (_currentHitType && millis() - _currentHitTime > 1500) {
            _currentHitType = null;
        }
    }

    function getScoreData() {
        return {
            total: _score,
            perfect: _perfectHits,
            good: _goodHits,
            miss: _missHits,
            combo: _combo,
            maxCombo: _maxCombo,
            batteryCharge: _batteryCharge,
            unlockedSongs: _unlockedSongs,
            isEntertainmentMode: _isEntertainmentMode,
            selectedRhythm: _selectedRhythm
        };
    }

    function reset() {
        console.log('重置ScorePanel');

        _score = 0;
        _perfectHits = 0;
        _goodHits = 0;
        _missHits = 0;
        _combo = 0;
        _batteryCharge = 0;
        _currentHitType = null;

        // 重置节拍解锁状态
        _rhythmOptions.forEach(option => option.unlocked = false);
        _unlockedSongs = 0;
        _selectedRhythm = 0;

        // 清理效果
        _scoreGlow = 0;
        _batteryPulse = 0;
        _floatingTexts = [];
        _bubbles = [];
        _isBubbleActive = false;

        addFloatingText('系统已重置', '#4a9eff', 12);
    }

    return { init };
})();

// 确保模块可用
if (typeof window !== 'undefined') {
    window.ScorePanel = ScorePanel;
}