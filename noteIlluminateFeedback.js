// noteIlluminateFeedback.js
// 新的反馈系统：音符默认暗色，Good/Perfect时被"点亮"，Miss保持暗色
// 不显示文字反馈，纯视觉点亮效果

const NoteIlluminateFeedback = (() => {
    const CFG = {
        dotD: 20,
        fadeMs: 3000,                    // 3秒淡出
        dimColor: 'rgba(200,200,200,0.3)',
        dimAccentColor: 'rgba(255,215,0,0.3)',
        litColor: '#ffffff',
        litAccentColor: '#ffd700',
        glowColor: 'rgba(255,210,80,0.6)', // 降低光晕强度
        glowBlur: 6                      // 降低光晕半径
    };

    let _opts = {};
    const colors = {};

    // 重用数组避免垃圾回收
    const drawArrays = {
        dimNormal: [],
        dimAccent: [],
        litNormal: [],
        litAccent: [],
        glyphs: []
    };

    function init() {
        colors.dim = color(CFG.dimColor);
        colors.dimAccent = color(CFG.dimAccentColor);
        colors.lit = color(CFG.litColor);
        colors.litAccent = color(CFG.litAccentColor);
    }

    function clearArrays() {
        drawArrays.dimNormal.length = 0;
        drawArrays.dimAccent.length = 0;
        drawArrays.litNormal.length = 0;
        drawArrays.litAccent.length = 0;
        drawArrays.glyphs.length = 0;
    }

    return {
        init(opts) {
            _opts = opts;
            init();
            return this;
        },

        render() {
            const rm = _opts.rm;
            if (!rm) return;

            const notes = rm.getVisibleNotes();
            if (!notes.length) return;

            clearArrays();

            // 一次遍历完成分组
            for (const n of notes) {
                const x = rm.getScrollX(n._displayTime ?? n.time);
                const y = _opts.isBottomDrum(n) ? _opts.laneBottomY() : _opts.laneTopY();
                const isAccent = (n.accent | 0) === 1;

                // 检查是否点亮（使用更长的淡出时间）
                const lit = n._isMainLoop &&
                    rm.feedbackStates[n._feedbackIdx]?.judged &&
                    (rm.feedbackStates[n._feedbackIdx].result === 'Good' ||
                        rm.feedbackStates[n._feedbackIdx].result === 'Perfect') &&
                    rm.feedbackStates[n._feedbackIdx].fadeTimer > 200; // 提高阈值避免闪烁

                // 音符分组
                if (lit) {
                    if (isAccent) {
                        drawArrays.litAccent.push(x, y);
                    } else {
                        drawArrays.litNormal.push(x, y);
                    }
                } else {
                    if (isAccent) {
                        drawArrays.dimAccent.push(x, y);
                    } else {
                        drawArrays.dimNormal.push(x, y);
                    }
                }

                // 字符数据
                drawArrays.glyphs.push(x, y, _opts.glyphForAbbr(n.abbr), lit ? 1 : 0);
            }

            noStroke();

            // 第一阶段：绘制所有暗色音符（无特效）
            if (drawArrays.dimNormal.length > 0) {
                fill(colors.dim);
                for (let i = 0; i < drawArrays.dimNormal.length; i += 2) {
                    ellipse(drawArrays.dimNormal[i], drawArrays.dimNormal[i + 1], CFG.dotD);
                }
            }

            if (drawArrays.dimAccent.length > 0) {
                fill(colors.dimAccent);
                for (let i = 0; i < drawArrays.dimAccent.length; i += 2) {
                    ellipse(drawArrays.dimAccent[i], drawArrays.dimAccent[i + 1], CFG.dotD);
                }
            }

            // 第二阶段：绘制点亮音符（只在有点亮音符时才开启光晕）
            const hasLitNotes = drawArrays.litNormal.length > 0 || drawArrays.litAccent.length > 0;
            if (hasLitNotes) {
                // 只调用一次save/restore，设置一次光晕
                drawingContext.save();
                drawingContext.shadowColor = CFG.glowColor;
                drawingContext.shadowBlur = CFG.glowBlur;

                if (drawArrays.litNormal.length > 0) {
                    fill(colors.lit);
                    for (let i = 0; i < drawArrays.litNormal.length; i += 2) {
                        ellipse(drawArrays.litNormal[i], drawArrays.litNormal[i + 1], CFG.dotD);
                    }
                }

                if (drawArrays.litAccent.length > 0) {
                    fill(colors.litAccent);
                    for (let i = 0; i < drawArrays.litAccent.length; i += 2) {
                        ellipse(drawArrays.litAccent[i], drawArrays.litAccent[i + 1], CFG.dotD);
                    }
                }

                // 关键：确保光晕被完全清除
                drawingContext.restore();
            }

            // 第三阶段：绘制字符
            if (drawArrays.glyphs.length > 0) {
                textSize(12);
                textAlign(CENTER, TOP);
                textStyle(BOLD);

                // 先绘制所有暗色字符
                fill('#999999');
                for (let i = 0; i < drawArrays.glyphs.length; i += 4) {
                    if (drawArrays.glyphs[i + 3] === 0) { // 暗色
                        text(drawArrays.glyphs[i + 2], drawArrays.glyphs[i], drawArrays.glyphs[i + 1] + 12);
                    }
                }

                // 再绘制所有亮色字符
                fill('#ffffff');
                for (let i = 0; i < drawArrays.glyphs.length; i += 4) {
                    if (drawArrays.glyphs[i + 3] === 1) { // 亮色
                        text(drawArrays.glyphs[i + 2], drawArrays.glyphs[i], drawArrays.glyphs[i + 1] + 12);
                    }
                }

                textStyle(NORMAL);
            }
        }
    };
})();