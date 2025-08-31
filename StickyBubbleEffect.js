/* ==========================================
   StickyBubbleEffect.js - 粘性气泡热力效果
   模拟小丑牌热力值的粘性气泡效果
   在连续5次三星combo后触发
   ========================================== */

const StickyBubbleEffect = (() => {
    let isActive = false;
    let bubbles = [];
    let metaBalls = [];
    let heatLevel = 0; // 0-1 热力等级
    let animationTime = 0;
    let consecutiveStarCombo = 0;
    let lastStarCount = 0;

    // 配置参数
    const config = {
        triggerThreshold: 5,        // 触发所需的连续三星次数
        maxBubbles: 25,            // 最大气泡数量
        heatDuration: 8000,        // 热力效果持续时间(ms)
        bubbleLifespan: 6000,      // 单个气泡生命周期(ms)
        metaballThreshold: 0.5,    // metaball融合阈值
        baseColors: {
            hot: { r: 255, g: 100, b: 100 },      // 热色调 - 红色
            warm: { r: 255, g: 180, b: 50 },      // 暖色调 - 橙色  
            cool: { r: 100, g: 200, b: 255 }      // 冷色调 - 蓝色
        }
    };

    // 气泡类定义
    class StickyBubble {
        constructor(x, y, containerBounds) {
            this.x = x;
            this.y = y;
            this.vx = (Math.random() - 0.5) * 0.8;
            this.vy = (Math.random() - 0.5) * 0.8;
            this.size = Math.random() * 15 + 8;
            this.maxSize = this.size * (1.2 + Math.random() * 0.8);
            this.life = 1.0;
            this.decay = 0.0008 + Math.random() * 0.0004;
            this.heat = Math.random() * 0.3 + 0.7; // 初始热量
            this.pulsePhase = Math.random() * Math.PI * 2;
            this.bounds = containerBounds;

            // 粘性参数
            this.sticky = true;
            this.attraction = 0.02 + Math.random() * 0.01;
            this.minDistance = this.size * 1.5;
        }

        update(deltaTime, allBubbles, globalHeat) {
            this.life -= this.decay;
            this.heat = Math.max(0, this.heat - 0.001);

            // 脉动效果
            this.pulsePhase += 0.05;
            const pulseFactor = 1 + Math.sin(this.pulsePhase) * 0.1;
            this.currentSize = this.size * pulseFactor * (0.5 + this.life * 0.5);

            // 根据热力等级调整大小
            this.currentSize *= (0.8 + globalHeat * 0.4);

            // 粘性互动 - 与其他气泡的吸引/排斥
            allBubbles.forEach(other => {
                if (other === this) return;

                const dx = other.x - this.x;
                const dy = other.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const minDist = (this.currentSize + other.currentSize) * 0.7;

                if (distance < minDist && distance > 0) {
                    // 近距离时相互排斥，但保持粘性连接
                    const force = (minDist - distance) * 0.001;
                    const angle = Math.atan2(dy, dx);

                    this.vx -= Math.cos(angle) * force;
                    this.vy -= Math.sin(angle) * force;
                } else if (distance < this.minDistance && distance > 0) {
                    // 中等距离时相互吸引
                    const force = this.attraction * (1 - distance / this.minDistance);
                    const angle = Math.atan2(dy, dx);

                    this.vx += Math.cos(angle) * force;
                    this.vy += Math.sin(angle) * force;
                }
            });

            // 边界反弹效果
            if (this.x <= this.currentSize / 2 || this.x >= this.bounds.w - this.currentSize / 2) {
                this.vx *= -0.8;
                this.x = Math.max(this.currentSize / 2, Math.min(this.bounds.w - this.currentSize / 2, this.x));
            }
            if (this.y <= this.currentSize / 2 || this.y >= this.bounds.h - this.currentSize / 2) {
                this.vy *= -0.8;
                this.y = Math.max(this.currentSize / 2, Math.min(this.bounds.h - this.currentSize / 2, this.y));
            }

            // 应用速度衰减
            this.vx *= 0.98;
            this.vy *= 0.98;

            // 更新位置
            this.x += this.vx;
            this.y += this.vy;

            return this.life > 0;
        }

        getMetaballInfluence(x, y) {
            const dx = x - this.x;
            const dy = y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance === 0) return 1;

            // 使用平滑的势场函数
            const influence = (this.currentSize * this.currentSize) / (distance * distance);
            return influence * this.life * this.heat;
        }
    }

    // Metaball渲染系统
    class MetaballRenderer {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.resolution = 4; // 降低分辨率提高性能
            this.gridW = Math.ceil(width / this.resolution);
            this.gridH = Math.ceil(height / this.resolution);
            this.field = new Float32Array(this.gridW * this.gridH);
        }

        calculateField(bubbles) {
            // 清空场
            this.field.fill(0);

            // 计算每个网格点的势场值
            for (let y = 0; y < this.gridH; y++) {
                for (let x = 0; x < this.gridW; x++) {
                    const worldX = x * this.resolution;
                    const worldY = y * this.resolution;
                    let totalInfluence = 0;

                    bubbles.forEach(bubble => {
                        totalInfluence += bubble.getMetaballInfluence(worldX, worldY);
                    });

                    this.field[y * this.gridW + x] = totalInfluence;
                }
            }
        }

        renderMetaballs(ctx, bubbles, globalHeat) {
            this.calculateField(bubbles);

            const imageData = ctx.createImageData(this.width, this.height);
            const data = imageData.data;

            // 生成热力色彩映射
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const gridX = Math.floor(x / this.resolution);
                    const gridY = Math.floor(y / this.resolution);
                    const fieldValue = this.field[gridY * this.gridW + gridX];

                    const pixelIndex = (y * this.width + x) * 4;

                    if (fieldValue > config.metaballThreshold) {
                        // 根据场强度和全局热力计算颜色
                        const intensity = Math.min(1, fieldValue - config.metaballThreshold);
                        const heatFactor = globalHeat * 0.7 + intensity * 0.3;

                        let color;
                        if (heatFactor > 0.7) {
                            // 高热 - 红色到白色
                            const t = (heatFactor - 0.7) / 0.3;
                            color = {
                                r: 255,
                                g: Math.floor(100 + t * 155),
                                b: Math.floor(100 + t * 155)
                            };
                        } else if (heatFactor > 0.3) {
                            // 中热 - 橙色到红色
                            const t = (heatFactor - 0.3) / 0.4;
                            color = {
                                r: 255,
                                g: Math.floor(180 - t * 80),
                                b: Math.floor(50 + t * 50)
                            };
                        } else {
                            // 低热 - 蓝色到橙色
                            const t = heatFactor / 0.3;
                            color = {
                                r: Math.floor(100 + t * 155),
                                g: Math.floor(200 - t * 20),
                                b: Math.floor(255 - t * 205)
                            };
                        }

                        // 应用透明度
                        const alpha = Math.min(255, intensity * 180 + globalHeat * 75);

                        data[pixelIndex] = color.r;
                        data[pixelIndex + 1] = color.g;
                        data[pixelIndex + 2] = color.b;
                        data[pixelIndex + 3] = alpha;
                    } else {
                        // 透明区域
                        data[pixelIndex + 3] = 0;
                    }
                }
            }

            ctx.putImageData(imageData, 0, 0);
        }
    }

    let metaballRenderer = null;

    // 监控三星combo变化
    function updateStarCombo(currentStars) {
        if (currentStars > lastStarCount && currentStars === 3) {
            consecutiveStarCombo++;
            console.log(`连续三星combo: ${consecutiveStarCombo}`);

            if (consecutiveStarCombo >= config.triggerThreshold) {
                triggerHeatWave();
                consecutiveStarCombo = 0; // 重置计数
            }
        } else if (currentStars < lastStarCount) {
            // 星数下降，重置连击
            if (consecutiveStarCombo > 0) {
                console.log('三星连击中断');
                consecutiveStarCombo = 0;
            }
        }

        lastStarCount = currentStars;
    }

    // 触发热力波效果
    function triggerHeatWave() {
        console.log('触发粘性气泡热力效果！');
        isActive = true;
        heatLevel = 1.0;
        animationTime = 0;

        // 清空现有气泡
        bubbles = [];

        // 播放触发音效（如果有）
        if (window.playSound) {
            window.playSound('heatwave');
        }
    }

    // 生成气泡
    function spawnBubbles(containerBounds, spawnCount = 3) {
        for (let i = 0; i < spawnCount && bubbles.length < config.maxBubbles; i++) {
            const x = containerBounds.x + Math.random() * containerBounds.w;
            const y = containerBounds.y + containerBounds.h * (0.3 + Math.random() * 0.4);

            bubbles.push(new StickyBubble(x - containerBounds.x, y - containerBounds.y, {
                x: 0, y: 0, w: containerBounds.w, h: containerBounds.h
            }));
        }
    }

    // 更新效果
    function update(deltaTime, containerBounds) {
        if (!isActive) return;

        animationTime += deltaTime;

        // 计算全局热力衰减
        const heatProgress = Math.min(1, animationTime / config.heatDuration);
        heatLevel = Math.max(0, 1 - Math.pow(heatProgress, 2));

        // 动态生成气泡
        if (heatLevel > 0.1 && Math.random() < heatLevel * 0.08) {
            spawnBubbles(containerBounds, Math.floor(heatLevel * 3 + 1));
        }

        // 更新现有气泡
        bubbles = bubbles.filter(bubble =>
            bubble.update(deltaTime, bubbles, heatLevel)
        );

        // 检查是否结束
        if (animationTime > config.heatDuration && bubbles.length === 0) {
            isActive = false;
            console.log('热力效果结束');
        }
    }

    // 渲染效果
    function render(ctx, containerBounds) {
        if (!isActive || bubbles.length === 0) return;

        ctx.save();

        // 设置剪裁区域
        ctx.beginPath();
        ctx.rect(containerBounds.x, containerBounds.y, containerBounds.w, containerBounds.h);
        ctx.clip();

        // 创建或更新metaball渲染器
        if (!metaballRenderer ||
            metaballRenderer.width !== containerBounds.w ||
            metaballRenderer.height !== containerBounds.h) {
            metaballRenderer = new MetaballRenderer(containerBounds.w, containerBounds.h);
        }

        // 创建临时canvas用于metaball渲染
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = containerBounds.w;
        tempCanvas.height = containerBounds.h;
        const tempCtx = tempCanvas.getContext('2d');

        // 渲染metaballs
        metaballRenderer.renderMetaballs(tempCtx, bubbles, heatLevel);

        // 应用混合模式并绘制到主canvas
        ctx.globalCompositeOperation = 'screen'; // 热力发光效果
        ctx.globalAlpha = 0.8 + heatLevel * 0.2;
        ctx.drawImage(tempCanvas, containerBounds.x, containerBounds.y);

        // 添加额外的光效
        if (heatLevel > 0.5) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = (heatLevel - 0.5) * 0.4;

            bubbles.forEach(bubble => {
                const gradient = ctx.createRadialGradient(
                    containerBounds.x + bubble.x, containerBounds.y + bubble.y, 0,
                    containerBounds.x + bubble.x, containerBounds.y + bubble.y, bubble.currentSize * 2
                );

                const alpha = bubble.life * bubble.heat * heatLevel;
                gradient.addColorStop(0, `rgba(255, 100, 100, ${alpha})`);
                gradient.addColorStop(0.5, `rgba(255, 180, 50, ${alpha * 0.3})`);
                gradient.addColorStop(1, 'rgba(255, 180, 50, 0)');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(
                    containerBounds.x + bubble.x,
                    containerBounds.y + bubble.y,
                    bubble.currentSize * 2, 0, Math.PI * 2
                );
                ctx.fill();
            });
        }

        ctx.restore();
    }

    // 集成到ScorePanel的接口
    function integrateWithScorePanel() {
        // 监听ScorePanel的星级变化
        const originalRegisterHit = window.scorePanelInterface?.onHit;
        if (originalRegisterHit) {
            window.scorePanelInterface.onHit = function (timing, hitType) {
                originalRegisterHit.call(this, timing, hitType);

                // 获取当前星级状态
                const scoreData = window.scorePanelInterface.getScore();
                if (scoreData && typeof scoreData.stars !== 'undefined') {
                    updateStarCombo(scoreData.stars);
                }
            };
        }

        console.log('粘性气泡热力效果已集成到ScorePanel');
    }

    // 调试接口
    function debugTrigger() {
        console.log('手动触发热力效果（调试）');
        triggerHeatWave();
    }

    // 公共接口
    return {
        // 核心功能
        update,
        render,

        // 控制接口
        triggerHeatWave,
        updateStarCombo,

        // 集成接口
        integrateWithScorePanel,

        // 状态查询
        isActive: () => isActive,
        getHeatLevel: () => heatLevel,
        getBubbleCount: () => bubbles.length,
        getComboCount: () => consecutiveStarCombo,

        // 配置接口
        config,

        // 调试接口
        debug: {
            trigger: debugTrigger,
            setBubbleCount: (count) => {
                bubbles = [];
                for (let i = 0; i < count; i++) {
                    bubbles.push(new StickyBubble(
                        Math.random() * 200,
                        Math.random() * 100,
                        { x: 0, y: 0, w: 200, h: 100 }
                    ));
                }
            },
            setHeatLevel: (level) => {
                heatLevel = Math.max(0, Math.min(1, level));
                if (heatLevel > 0) isActive = true;
            }
        }
    };
})();

// 确保模块可用
if (typeof window !== 'undefined') {
    window.StickyBubbleEffect = StickyBubbleEffect;
}