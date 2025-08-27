// starEffects.js - Perfect判定时的星星特效系统
// 高性能设计：对象池、批量绘制、简单动画

const StarEffects = (() => {
    const CFG = {
        maxStars: 30,           // 最大星星数量（对象池大小）
        starLifeMs: 1500,       // 星星生命周期（毫秒）
        starSize: 8,            // 星星大小
        bounceSpeed: 0.3,       // 弹跳初始速度
        gravity: 0.0008,        // 重力加速度
        spread: 120,            // 发散角度（度数）
        fadeStart: 0.7,         // 何时开始淡出（生命周期比例）
        colors: ['#FFD700', '#FFA500', '#FFFF00'] // 星星颜色
    };

    // 星星对象池
    const starPool = [];
    const activeStars = [];

    // 初始化对象池
    function initPool() {
        for (let i = 0; i < CFG.maxStars; i++) {
            starPool.push({
                x: 0, y: 0,
                vx: 0, vy: 0,
                life: 0,
                maxLife: CFG.starLifeMs,
                size: CFG.starSize,
                color: CFG.colors[0],
                active: false
            });
        }
    }

    // 获取可用星星
    function getStar() {
        for (let star of starPool) {
            if (!star.active) {
                star.active = true;
                return star;
            }
        }
        return null; // 池满了，忽略
    }

    // 回收星星
    function recycleStar(star) {
        star.active = false;
        const index = activeStars.indexOf(star);
        if (index > -1) {
            activeStars.splice(index, 1);
        }
    }

    // 创建三个星星特效
    function createPerfectEffect(x, y) {
        const baseAngle = -90; // 向上方向为基准
        const angleStep = CFG.spread / 3; // 三个星星的角度间隔

        for (let i = 0; i < 3; i++) {
            const star = getStar();
            if (!star) continue; // 对象池满了

            // 计算发射角度
            const angle = baseAngle + (i - 1) * angleStep + (Math.random() - 0.5) * 20; // 添加随机偏移
            const radian = angle * Math.PI / 180;

            // 初始速度（带随机性）
            const speed = CFG.bounceSpeed * (0.8 + Math.random() * 0.4);

            star.x = x;
            star.y = y;
            star.vx = Math.cos(radian) * speed;
            star.vy = Math.sin(radian) * speed;
            star.life = CFG.starLifeMs;
            star.maxLife = CFG.starLifeMs;
            star.size = CFG.starSize + Math.random() * 3; // 大小变化
            star.color = CFG.colors[i % CFG.colors.length];

            activeStars.push(star);
        }
    }

    // 更新所有星星
    function update(deltaMs) {
        for (let i = activeStars.length - 1; i >= 0; i--) {
            const star = activeStars[i];

            // 更新生命周期
            star.life -= deltaMs;
            if (star.life <= 0) {
                recycleStar(star);
                continue;
            }

            // 物理更新
            star.vy += CFG.gravity * deltaMs; // 重力影响
            star.x += star.vx * deltaMs;
            star.y += star.vy * deltaMs;
        }
    }

    // 绘制五角星形状
    function drawStar(ctx, x, y, size, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);

        // 简化的五角星绘制
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const x1 = Math.cos(angle) * size;
            const y1 = Math.sin(angle) * size;

            if (i === 0) {
                ctx.moveTo(x1, y1);
            } else {
                ctx.lineTo(x1, y1);
            }

            // 内角
            const innerAngle = angle + (2 * Math.PI) / 10;
            const x2 = Math.cos(innerAngle) * size * 0.4;
            const y2 = Math.sin(innerAngle) * size * 0.4;
            ctx.lineTo(x2, y2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // 批量绘制所有星星
    function render() {
        if (activeStars.length === 0) return;

        drawingContext.save();

        // 按颜色分组减少状态切换
        const starsByColor = {};
        for (const star of activeStars) {
            if (!starsByColor[star.color]) {
                starsByColor[star.color] = [];
            }

            // 计算透明度
            const lifeRatio = star.life / star.maxLife;
            const alpha = lifeRatio > CFG.fadeStart
                ? 1.0
                : lifeRatio / CFG.fadeStart;

            starsByColor[star.color].push({
                x: star.x,
                y: star.y,
                size: star.size,
                alpha: alpha
            });
        }

        // 按颜色批量绘制
        for (const [color, stars] of Object.entries(starsByColor)) {
            drawingContext.fillStyle = color;
            for (const star of stars) {
                drawStar(drawingContext, star.x, star.y, star.size, star.alpha);
            }
        }

        drawingContext.restore();
    }

    // 公共接口
    return {
        init() {
            initPool();
            return this;
        },

        // 触发Perfect特效
        triggerPerfect(x, y) {
            createPerfectEffect(x, y);
        },

        // 每帧更新
        update(deltaMs = 16.67) {
            update(deltaMs);
        },

        // 绘制所有特效
        render() {
            render();
        },

        // 清除所有特效
        clear() {
            for (const star of activeStars) {
                recycleStar(star);
            }
        },

        // 获取状态信息（调试用）
        getStats() {
            return {
                active: activeStars.length,
                poolUsed: starPool.filter(s => s.active).length,
                poolTotal: starPool.length
            };
        }
    };
})();