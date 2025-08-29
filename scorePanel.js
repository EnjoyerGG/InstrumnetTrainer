/* ==========================================
   ScorePanel.js - 分数HUD模块
   适配RECT.score区域的打分系统
   按照手绘图重新设计布局
   ========================================== */

const ScorePanel = (() => {
    let _rect = null;
    let _rectProvider = null;
    let _drawWin = null;

    // —— 星星激励（连击）——
    let _stars = 0;                        // 已点亮的星星数量 0..3
    let _starEnabled = false;              // 是否已解锁（出现过一次 perfect 才开始计数）
    let _streakForStar = 0;                // 当前用于点亮下一颗星的连击计数
    let _failStrikes = 0;                  // miss（或错误击打）累计次数，用于熄灭
    const _starSteps = [3, 4, 5];          // 依次需要连击 3 / 4 / 5 次点亮第1/2/3颗

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
        { name: 'song1', icon: '♪', unlocked: false },
        { name: 'song2', icon: '♫', unlocked: false },
        { name: 'song3', icon: '♬', unlocked: false },
        { name: 'song4', icon: '♭', unlocked: false }
    ];

    // 视觉效果状态
    let _scoreGlow = 0;
    let _batteryPulse = 0;
    let _floatingTexts = [];

    // 电池泡泡效果
    let _bubbles = [];
    let _bubbleTime = 0;
    let _isBubbleActive = false;

    // —— Rhythm selector UI runtime state —— 
    let _rhythmButtons = [];           // [{x,y,r,index}]
    let _hoverRhythmIndex = -1;        // 当前鼠标悬停的按钮索引（仅对已解锁生效）
    let _unlockBurstQueue = [];        // 解锁的等待触发项（索引）
    let _unlockBursts = [];            // 正在播放的解锁闪光特效 [{x,y,r,start,life}]

    function queueUnlockBurst(index) {
        // 渲染前先记录索引，等 renderRhythmSelector 算出坐标后再落位
        _unlockBurstQueue.push(index);
    }

    function drawUnlockBursts(ctx) {
        const now = millis();
        _unlockBursts = _unlockBursts.filter(b => {
            const t = (now - b.start) / b.life; // 0 → 1
            if (t >= 1) return false;

            // 扩散金色圆环
            const grow = b.r * (0.6 + 1.2 * t);
            ctx.save();
            ctx.lineWidth = 2 + (1 - t) * 3;
            ctx.shadowBlur = 18 * (1 - t);
            ctx.shadowColor = 'rgba(255,215,0,0.9)';
            ctx.strokeStyle = `rgba(255,215,0,${1 - t})`;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r + grow, 0, Math.PI * 2);
            ctx.stroke();

            // 中心星光（十字小闪）
            ctx.globalAlpha = Math.max(0, 1 - t);
            ctx.beginPath();
            ctx.moveTo(b.x - b.r * 0.3, b.y);
            ctx.lineTo(b.x + b.r * 0.3, b.y);
            ctx.moveTo(b.x, b.y - b.r * 0.3);
            ctx.lineTo(b.x, b.y + b.r * 0.3);
            ctx.stroke();
            ctx.restore();
            return true;
        });
    }

    // 圆角矩形绘制辅助函数
    function drawRoundedRect(ctx, x, y, w, h, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    function drawPanel(ctx, x, y, w, h, radius, strokeAlpha = 0.65) {
        // 背景
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fill();

        // 与 Learn/Fun 滑块一致的描边
        ctx.strokeStyle = `rgba(199, 199, 199, ${strokeAlpha})`; // = 0.65
        ctx.lineWidth = 1; // 想更醒目可改 1.2–1.4
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
        ctx.stroke();
    }

    function init(options = {}) {
        _rectProvider = options.rectProvider || (() => ({ x: 0, y: 0, w: 200, h: 300 }));

        console.log('ScorePanel initialized - New Layout with Rounded Corners');

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
            _batteryCharge = Math.max(0, _batteryCharge - 1);
            addFloatingText('Miss', '#ff4444', 14);
        }

        // 更新最高连击
        if (_combo > _maxCombo) {
            _maxCombo = _combo;
        }

        if (!_starEnabled && (timing === 'perfect' || timing === 'good')) {
            _starEnabled = true;                 // 首次 perfect 才开始计星
        }

        // 成功击打（perfect/good）计入连击
        if (timing === 'perfect' || timing === 'good') {
            if (_starEnabled && _stars < 3) {
                _streakForStar++;
                //_failStrikes = 0;                  // 成功重置失败计数

                // 达到当前目标阈值则点亮一颗星
                const need = _starSteps[_stars];   // 先点亮第 _stars+1 颗所需连击
                if (_streakForStar >= need) {
                    _stars++;
                    _streakForStar = 0;
                    // ⭐ 在该星星的位置触发粒子特效（与顶部 HUD 相同）
                    const pos = getStarCenterForIndex(_stars - 1); // 0/1/2 对应第1/2/3颗
                    if (pos) {
                        StarEffects.triggerPerfect(pos.x, pos.y);    // 直接复用现有 StarEffects
                    }
                }
            }
        } else { // miss（或将来接入“错误击打”时也走这里）
            if (_starEnabled && _stars > 0) {
                _failStrikes++;
                _streakForStar = 0;                // 失败打断连击
                if (_failStrikes >= 3) {           // 连续 3 次 miss/错误 → 熄灭 1 颗
                    _stars--;
                    _failStrikes = 0;
                    addFloatingText(`★ -1`, '#ff6666', 16);
                    const pos = getStarCenterForIndex(_stars);
                    if (pos) StarEffects.triggerPerfect(pos.x, pos.y);
                }
            }
        }

        // 更新当前击打类型显示
        if (_hitTypes[hitType]) {
            _currentHitType = hitType;
            _currentHitTime = now;
        }

        console.log(`击打记录: ${timing} (${hitType}), 分数: ${_score}, 连击: ${_combo}`);
    }

    function checkBatteryCharge() {
        // 支持一次性冲过 100 多点，也支持连环解锁
        while (_batteryCharge >= 100) {
            _batteryCharge -= 100;
            _batteryPulse = 1.0;
            triggerBubbleEffect();

            if (_unlockedSongs < _rhythmOptions.length) {
                _rhythmOptions[_unlockedSongs].unlocked = true;
                queueUnlockBurst(_unlockedSongs);
                _unlockedSongs++;
                addFloatingText(`Unlock${_rhythmOptions[_unlockedSongs - 1].name}!`, '#ffd700', 16);
            }
        }
    }

    function setMode(isEntertainment) {
        _isEntertainmentMode = isEntertainment;
        console.log(`模式切换至: ${isEntertainment ? '娱乐模式' : '练习模式'}`);
    }

    function selectRhythm(index) {
        // if (_isEntertainmentMode && _rhythmOptions[index] && _rhythmOptions[index].unlocked) {
        //     _selectedRhythm = index;
        //     console.log(`选择节拍: ${_rhythmOptions[index].name}`);

        //     // ★ 激活绘画模式
        //     if (window.DrawingMode) {
        //         console.log(`激活绘画模式，歌曲索引: ${index}`);
        //         window.DrawingMode.activate(index);
        //     }
        // } else if (_isEntertainmentMode && !_rhythmOptions[index].unlocked) {
        //     // 显示未解锁提示
        //     addFloatingText('Lock!', '#ff6666', 14);
        // } else if (!_isEntertainmentMode) {
        //     // 显示模式错误提示
        //     addFloatingText('Please switch Fun mode!', '#ffaa00', 14);
        // }
        if (_isEntertainmentMode && _rhythmOptions[index] && _rhythmOptions[index].unlocked) {
            _selectedRhythm = index;

            // 打开新页面（只开一次，已开则聚焦；顺便把选择的节拍带过去）
            const url = `draw.html?mode=${index}`;
            if (!_drawWin || _drawWin.closed) {
                _drawWin = window.open(url, '_blank', 'noopener,noreferrer');
            } else {
                _drawWin.focus();
                // 如果你在 draw.html 里用 postMessage 接收，也可以把状态发过去：
                _drawWin.postMessage({ type: 'changeMode', index }, '*');
            }
            return;
        }

        if (_isEntertainmentMode && !_rhythmOptions[index].unlocked) {
            addFloatingText('Lock!', '#ff6666', 14);
        } else if (!_isEntertainmentMode) {
            addFloatingText('Please switch to Fun mode!', '#ffaa00', 14);
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

        // ========== 布局尺寸控制参数 ==========
        const gap = 3;                          // 方块间距 (进一步减小间距)
        const radius = 12;                      // 圆角半径

        // ========== 垂直分布比例 (最大化使用垂直空间) ==========
        const topH = Math.floor(h * 0.24);     // 顶部高度比例 (24%)
        const midH = Math.floor(h * 0.38);     // 中部高度比例 (38%) 
        const bottomH = h - topH - midH - gap * 2; // 底部自动计算 (约38%)

        // ========== 水平分布比例 (最大化使用水平空间) ==========  
        const topLeftRatio = 0.50;             // 顶部左侧宽度比例 (50%)
        const topRightRatio = 1 - topLeftRatio; // 顶部右侧宽度比例 (50%)

        const bottomLeftRatio = 0.54;          // 底部左侧宽度比例 (54%)
        const bottomRightRatio = 1 - bottomLeftRatio; // 底部右侧宽度比例 (46%)

        // ========== 计算实际尺寸 ==========
        const topLeftW = Math.floor((w - gap) * topLeftRatio);
        const topRightW = Math.floor((w - gap) * topRightRatio);
        const bottomLeftW = Math.floor((w - gap) * bottomLeftRatio);
        const bottomRightW = Math.floor((w - gap) * bottomRightRatio);

        let currentY = y;

        // 1. 顶部左方块：模式滑块 (使用新的尺寸变量)
        renderSliderBlock(ctx, x, currentY, topLeftW, topH, radius);

        // 2. 顶部右方块：总分 (使用新的尺寸变量)
        renderScoreBlock(ctx, x + topLeftW + gap, currentY, topRightW, topH, radius);

        currentY += topH + gap;

        // 3. 中部方块：能量槽 (保持全宽)
        renderBatteryBlock(ctx, x, currentY, w, midH, radius);
        currentY += midH + gap;

        // 4. 左下方块：击打识别 (使用新的尺寸变量)
        renderHitDisplayBlock(ctx, x, currentY, bottomLeftW, bottomH, radius);

        // 5. 右下方块：节拍选择 (使用新的尺寸变量)
        renderRhythmBlock(ctx, x + bottomLeftW + gap, currentY, bottomRightW, bottomH, radius);

        // 渲染浮动文字
        renderFloatingTexts(ctx);

        // 更新效果
        updateEffects();

        ctx.restore();
    }

    function renderSliderBlock(ctx, x, y, w, h, radius) {
        // 方块背景和边框 - 圆角
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fill();

        ctx.strokeStyle = 'rgba(199, 199, 199, 0.65)';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
        ctx.stroke();

        const padding = 6;

        // 标题
        // ctx.fillStyle = '#4a9eff';
        // ctx.font = 'bold 10px Arial';
        // ctx.textAlign = 'center';
        // ctx.fillText('模式', x + w / 2, y + 15);

        // 滑块 - 调整大小以适应较小的区域
        renderModeSlider(ctx, x + padding, y + padding + 2, w - padding * 2, h - padding * 2 - 2);
    }

    function renderScoreBlock(ctx, x, y, w, h, radius) {
        // 方块背景和边框 - 圆角
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
        ctx.stroke();

        // 渲染星星
        drawPanel(ctx, x, y, w, h, radius);
        renderStarsBlock(ctx, x, y, w, h);
    }

    function renderBatteryBlock(ctx, x, y, w, h, radius) {
        // 方块背景和边框 - 圆角
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
        ctx.stroke();

        drawPanel(ctx, x, y, w, h, radius);
        const padding = 6;
        renderHorizontalBattery(ctx, x + padding, y + padding, w - padding * 2, h - padding * 2);
    }

    function renderHitDisplayBlock(ctx, x, y, w, h, radius) {
        // 方块背景和边框 - 圆角
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
        ctx.stroke();

        drawPanel(ctx, x, y, w, h, radius);
        const padding = 6;
        renderCurrentHitDisplay(ctx, x + padding, y + padding, w - padding * 2, h - padding * 2);
    }

    function renderRhythmBlock(ctx, x, y, w, h, radius) {
        // 方块背景和边框 - 圆角
        ctx.fillStyle = 'rgba(15, 15, 35, 0.9)';
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
        ctx.stroke();

        drawPanel(ctx, x, y, w, h, radius);
        const padding = 6;
        renderRhythmSelector(ctx, x + padding, y + padding, w - padding * 2, h - padding * 2);
    }

    // function renderScoreInCenter(ctx, x, y, w, h) {
    //     // 标题
    //     ctx.fillStyle = '#4a9eff';
    //     ctx.font = 'bold 10px Arial';
    //     ctx.textAlign = 'center';
    //     ctx.fillText('总分', x + w / 2, y + 15);

    //     // 主分数 - 带发光效果
    //     const glowAlpha = _scoreGlow * 0.5;
    //     if (_scoreGlow > 0) {
    //         ctx.shadowBlur = 6 + _scoreGlow * 3;
    //         ctx.shadowColor = `rgba(74, 158, 255, ${glowAlpha})`;
    //     }

    //     ctx.fillStyle = `rgba(74, 158, 255, ${1.0 - glowAlpha * 0.3})`;
    //     ctx.font = 'bold 24px Arial';
    //     ctx.textAlign = 'center';
    //     ctx.fillText(_score.toString(), x + w / 2, y + h / 2 + 8);

    //     // 重置阴影
    //     ctx.shadowBlur = 0;
    // }

    function drawStarIcon(ctx, cx, cy, r, filled, glow = 0) {
        ctx.save();
        if (glow > 0 && filled) {
            ctx.shadowBlur = 8 + glow * 6;
            ctx.shadowColor = 'rgba(255,215,0,0.9)';
        }
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
            const x1 = cx + Math.cos(a) * r;
            const y1 = cy + Math.sin(a) * r;
            const a2 = a + Math.PI / 5;
            const x2 = cx + Math.cos(a2) * r * 0.45;
            const y2 = cy + Math.sin(a2) * r * 0.45;
            if (i === 0) ctx.moveTo(x1, y1); else ctx.lineTo(x1, y1);
            ctx.lineTo(x2, y2);
        }
        ctx.closePath();
        if (filled) {
            ctx.fillStyle = '#ffd700';
            ctx.fill();
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }

    function getStarCenterForIndex(i) {
        if (!_rect) return null; // 尚未渲染过
        const { x, y, w, h } = _rect; // _rect 是这个得分面板的区域

        const padX = Math.max(10, Math.min(18, w * 0.04));
        const gap = Math.max(10, Math.min(18, w * 0.06));
        // 自适应半径：不超过面板高度的 22%，也不超过可用宽度能放下3颗星的上限
        const R = Math.min(h * 0.22, (w - 2 * padX - 2 * gap) / 6);
        const totalW = 2 * R * 3 + 2 * gap;
        const startX = x + (w - totalW) / 2 + R;
        const cy = y + h / 2 + 2; // 轻微下移让视觉更自然

        return {
            x: startX + i * (2 * R + gap),
            y: cy,
            r: R
        };
    }


    function renderStarsBlock(ctx, x, y, w, h) {
        // 面板背景和边框（保持与你原来一致）
        // —— 计算排版（自适应大小）——
        const padX = Math.max(10, Math.min(18, w * 0.04));
        const gap = Math.max(10, Math.min(18, w * 0.06));
        const R = Math.min(h * 0.22, (w - 2 * padX - 2 * gap) / 6); // ⭐合适的星星半径
        const totalW = 2 * R * 3 + 2 * gap;
        const startX = x + (w - totalW) / 2 + R;  // 水平居中
        const cy = y + h / 2 + 2;                 // 垂直居中，略微下移

        for (let i = 0; i < 3; i++) {
            const filled = i < _stars;
            const glow = filled ? 1 : 0;
            const cx = startX + i * (2 * R + gap);
            drawStarIcon(ctx, cx, cy, R, filled, glow);
        }
    }

    function renderModeSlider(ctx, x, y, w, h) {
        // 1) 计算一块在容器内居中的“胶囊轨道”
        const trackH = Math.min(34, h - 8);             // 轨道高度
        const trackW = Math.min(w - 10, 260);           // 轨道宽度（留点边距，并限制上限）
        const trackX = x + (w - trackW) / 2;            // 水平居中
        const trackY = y + (h - trackH) / 2;            // 垂直居中（想再上移可减几像素，如 - 4）
        const trackR = trackH / 2;                      // 胶囊：半径=高度一半

        // 背景轨道：胶囊形
        ctx.fillStyle = '#333';
        drawRoundedRect(ctx, trackX, trackY, trackW, trackH, trackR);
        ctx.fill();

        // 2) 胶囊按钮（同样用圆角=高度/2）
        const pad = 3;
        const btnH = trackH - pad * 2;
        const btnW = (trackW - pad * 2) / 2;  // 按钮宽度：接近一半
        const btnR = btnH / 2;

        const sliderX = _isEntertainmentMode
            ? (trackX + trackW - pad - btnW)              // 右侧（Leisure）
            : (trackX + pad);                              // 左侧（Practice）
        const sliderY = trackY + pad;

        ctx.fillStyle = _isEntertainmentMode ? '#317ecc' : '#d91c1c';
        drawRoundedRect(ctx, sliderX, sliderY, btnW, btnH, btnR);
        ctx.fill();

        // 3) 文字居中
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';             // 微调基线
        ctx.fillText(_isEntertainmentMode ? 'Fun' : 'Learn', sliderX + btnW / 2, sliderY + btnH / 2);
    }

    function renderHorizontalBattery(ctx, x, y, w, h) {
        // 标题和百分比
        ctx.fillStyle = '#d8d8d8ff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Combo', x, y + 10);

        ctx.textAlign = 'right';
        ctx.fillText(Math.floor(_batteryCharge) + '%', x + w, y + 10);

        // 电池主体
        const batteryY = y + 18;
        const batteryH = h - 24;

        // 电池边框 - 带脉冲效果
        if (_batteryPulse > 0) {
            ctx.shadowBlur = 5 + _batteryPulse * 5;
            ctx.shadowColor = `rgba(74, 158, 255, ${_batteryPulse})`;
        }

        ctx.strokeStyle = '#acc3efff';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, x + 5, batteryY, w - 15, batteryH, 4);
        ctx.stroke();

        // 电池正极
        const capW = 4;
        const capH = batteryH * 0.5;
        ctx.fillStyle = '#acc3efff';
        drawRoundedRect(ctx, x + w - 10, batteryY + (batteryH - capH) / 2, capW, capH, 2);
        ctx.fill();

        // 重置阴影
        ctx.shadowBlur = 0;

        // 从左到右的电池填充
        const fillW = (w - 20) * (_batteryCharge / 100);
        if (fillW > 0) {
            // 水平渐变填充
            const gradient = ctx.createLinearGradient(x + 5, 0, x + w - 15, 0);
            gradient.addColorStop(0, '#ff4757');
            gradient.addColorStop(0.3, '#ffa502');
            gradient.addColorStop(0.6, '#2ed573');
            gradient.addColorStop(1, '#4a9eff');

            ctx.fillStyle = gradient;

            // 使用圆角矩形进行裁剪
            ctx.save();
            drawRoundedRect(ctx, x + 7, batteryY + 2, fillW, batteryH - 4, 3);
            ctx.clip();
            ctx.fillRect(x + 7, batteryY + 2, fillW, batteryH - 4);
            ctx.restore();
        }

        // 渲染泡泡效果
        if (_isBubbleActive) {
            renderBubbles(ctx, x + 5, batteryY, w - 15, batteryH);
        }
    }

    function renderCurrentHitDisplay(ctx, x, y, w, h) {
        // 显示当前击打类型
        if (_currentHitType && millis() - _currentHitTime < 1500) {
            const type = _hitTypes[_currentHitType];

            // 大图标
            ctx.fillStyle = type.color;
            ctx.font = '28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(type.icon, x + w / 2, y + h / 2 + 5);

            // 名称
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Arial';
            ctx.fillText(type.name, x + w / 2, y + h - 15);

        } else {
            // 待机状态
            ctx.fillStyle = '#cbcbcbff';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting...', x + w / 2, y + h / 2 + 5);

            // ctx.font = '9px Arial';
            // ctx.fillText('Waiting', x + w / 2, y + h - 15);
        }
    }

    function renderRhythmSelector(ctx, x, y, w, h) {
        // 2×2 布局
        const r = Math.min(w / 6, h / 6);
        const gapX = w * 0.15, gapY = h * 0.15;
        const totalW = r * 4 + gapX, totalH = r * 4 + gapY;
        const startX = x + (w - totalW) / 2 + r;
        const startY = y + (h - totalH) / 2 + r;

        const positions = [
            { x: startX, y: startY, index: 0 },
            { x: startX + r * 2 + gapX, y: startY, index: 1 },
            { x: startX, y: startY + r * 2 + gapY, index: 2 },
            { x: startX + r * 2 + gapX, y: startY + r * 2 + gapY, index: 3 }
        ];

        // 记录按钮几何用于 hover/点击
        _rhythmButtons = positions.map(p => ({ x: p.x, y: p.y, r: r, index: p.index }));

        // 计算鼠标悬停索引（仅对已解锁按钮）
        _hoverRhythmIndex = -1;
        if (typeof mouseX !== 'undefined') {
            for (const b of _rhythmButtons) {
                const opt = _rhythmOptions[b.index];
                if (!opt.unlocked) continue;
                const dx = mouseX - b.x, dy = mouseY - b.y;
                if (dx * dx + dy * dy <= b.r * b.r) { _hoverRhythmIndex = b.index; break; }
            }
        }

        // 把待播放的解锁索引转成“已落位”的动画实例
        if (_unlockBurstQueue.length) {
            const now = millis();
            _unlockBurstQueue.forEach(idx => {
                const btn = _rhythmButtons.find(b => b.index === idx);
                if (btn) _unlockBursts.push({ x: btn.x, y: btn.y, r: btn.r, start: now, life: 550 });
            });
            _unlockBurstQueue.length = 0;
        }

        // 背景+边框（保持你原来的卡片风格）
        // ctx.save();
        // ctx.fillStyle = 'rgba(0,0,0,0)'; // 背景已由父容器绘制，这里不再重复画底
        // ctx.restore();

        // 实际绘制四个圆
        positions.forEach(pos => {
            const option = _rhythmOptions[pos.index];
            const isUnlocked = option.unlocked;
            const isSelected = _selectedRhythm === pos.index;
            const isHover = _hoverRhythmIndex === pos.index;

            // —— 背景：解锁后更“明亮”，未解锁更“灰暗”
            ctx.save();
            if (isUnlocked) {
                ctx.fillStyle = isSelected
                    ? 'rgba(255, 215, 0, 0.25)'    // 选中：偏金色
                    : 'rgba(255, 255, 255, 0.10)'; // 未选中：明亮淡白
            } else {
                ctx.fillStyle = 'rgba(80, 85, 100, 0.10)';
            }
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            ctx.fill();

            // —— 边框与发光：只对“已解锁 & (悬停或选中)”显示金色
            if (isUnlocked && (isHover || isSelected)) {
                ctx.shadowBlur = 12;
                ctx.shadowColor = 'rgba(255,215,0,0.85)';
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 3;
            } else {
                ctx.shadowBlur = 0;
                ctx.strokeStyle = isUnlocked ? 'rgba(86,140,255,0.9)' : '#555';
                ctx.lineWidth = isUnlocked ? 2 : 1;
            }
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
            ctx.stroke();

            // —— 图标：已解锁用亮色，未解锁变暗
            ctx.fillStyle = isUnlocked ? '#ffffff' : '#6b6f7a';
            ctx.font = `${Math.floor(r * 0.8)}px Arial`;
            ctx.textAlign = 'center';
            ctx.fillText(option.icon, pos.x, pos.y + 3);

            // —— 锁：仅未解锁时覆盖显示
            if (!isUnlocked) {
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#666'; ctx.font = '14px Arial';
                ctx.fillText('🔒', pos.x, pos.y + 5);
            }
            ctx.restore();
        });

        // 播放“解锁金色闪光”特效（在按钮之上）
        drawUnlockBursts(ctx);
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

        _stars = 0;
        _starEnabled = false;
        _streakForStar = 0;
        _failStrikes = 0;

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

        addFloatingText('System Reset', '#4a9eff', 12);
    }

    return { init };
})();

// 确保模块可用
if (typeof window !== 'undefined') {
    window.ScorePanel = ScorePanel;
}