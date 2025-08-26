// noteIlluminateFeedback.js
// 新的反馈系统：音符默认暗色，Good/Perfect时被"点亮"，Miss保持暗色
// 不显示文字反馈，纯视觉点亮效果

const NoteIlluminateFeedback = (() => {
    const CFG = {
        dotD: 20,                    // 音符圆直径
        dimAlpha: 0.35,              // 暗色透明度
        litAlphaMin: 0.85,           // 点亮后最小亮度
        litAlphaMax: 1.0,            // 点亮瞬间最大亮度
        glowMax: 12,                 // 最大光晕强度
        glowDuration: 1200,          // 点亮效果持续时间（毫秒）
        dimAccentColor: 'rgba(255,215,0,0.35)',      // 暗色accent
        dimNormalColor: 'rgba(200,200,200,0.35)',    // 暗色普通
        litAccentColor: '#ffd700',   // 点亮accent（金色）
        litNormalColor: '#ffffff',   // 点亮普通（白色）
        glowColor: 'rgba(255,210,80,0.8)',
        glyphDim: '#999999',         // 暗色字符
        glyphLit: '#ffffff'          // 点亮字符
    };

    let _opts = {
        rm: null,
        laneTopY: null,
        laneBottomY: null,
        isBottomDrum: null,
        glyphForAbbr: (ab) => (ab || '?')
    };

    // 缓存颜色对象避免重复创建
    const colorCache = {
        dimAccent: null,
        dimNormal: null,
        litAccent: null,
        litNormal: null,
        initialized: false
    };

    function initColorCache() {
        if (colorCache.initialized) return;
        colorCache.dimAccent = color(CFG.dimAccentColor);
        colorCache.dimNormal = color(CFG.dimNormalColor);
        colorCache.litAccent = color(CFG.litAccentColor);
        colorCache.litNormal = color(CFG.litNormalColor);
        colorCache.initialized = true;
    }

    function yOf(n) {
        return _opts.isBottomDrum(n) ? _opts.laneBottomY() : _opts.laneTopY();
    }

    function isAccentNote(n) {
        return (n.accent | 0) === 1;
    }

    function isIlluminated(n) {
        if (!n._isMainLoop) return false;
        const fb = _opts.rm.feedbackStates[n._feedbackIdx];
        return fb?.judged && (fb.result === 'Good' || fb.result === 'Perfect');
    }

    function getIlluminationIntensity(n) {
        if (!isIlluminated(n)) return 0;
        const fb = _opts.rm.feedbackStates[n._feedbackIdx];
        if (!fb || !fb.fadeTimer) return 0;
        // 归一化强度 0-1，fadeTimer从2000递减到0
        return Math.max(0, Math.min(1, fb.fadeTimer / CFG.glowDuration));
    }

    return {
        init(opts) {
            _opts = Object.assign(_opts, opts || {});
            initColorCache();
            return this;
        },

        render() {
            const rm = _opts.rm;
            if (!rm) return;

            const notes = rm.getVisibleNotes();
            if (notes.length === 0) return;

            // 分组处理：暗色音符和点亮音符
            const dimNotes = [];
            const litNotes = [];
            const glyphs = [];

            // 预处理分组
            for (const n of notes) {
                const x = rm.getScrollX(n._displayTime ?? n.time);
                const y = yOf(n);
                const isAccent = isAccentNote(n);
                const lit = isIlluminated(n);
                const intensity = lit ? getIlluminationIntensity(n) : 0;

                const noteData = { x, y, isAccent, n };

                if (lit && intensity > 0) {
                    litNotes.push({ ...noteData, intensity });
                } else {
                    dimNotes.push(noteData);
                }

                // 收集字符数据
                glyphs.push({
                    x, y,
                    glyph: _opts.glyphForAbbr(n.abbr),
                    lit: lit && intensity > 0.1  // 只有足够亮度才算点亮
                });
            }

            // 批量绘制暗色音符
            if (dimNotes.length > 0) {
                noStroke();
                drawingContext.save();
                drawingContext.shadowBlur = 0;

                // 分别绘制普通和accent暗色音符
                const dimNormal = dimNotes.filter(n => !n.isAccent);
                const dimAccent = dimNotes.filter(n => n.isAccent);

                if (dimNormal.length > 0) {
                    fill(colorCache.dimNormal);
                    for (const { x, y } of dimNormal) {
                        ellipse(x, y, CFG.dotD);
                    }
                }

                if (dimAccent.length > 0) {
                    fill(colorCache.dimAccent);
                    for (const { x, y } of dimAccent) {
                        ellipse(x, y, CFG.dotD);
                    }
                }

                drawingContext.restore();
            }

            // 批量绘制点亮音符
            if (litNotes.length > 0) {
                noStroke();
                drawingContext.save();

                // 按强度分组减少状态切换
                const intensityGroups = new Map();
                for (const noteData of litNotes) {
                    const intensityLevel = Math.round(noteData.intensity * 5); // 量化为0-5级
                    if (!intensityGroups.has(intensityLevel)) {
                        intensityGroups.set(intensityLevel, { normal: [], accent: [] });
                    }
                    const group = intensityGroups.get(intensityLevel);
                    if (noteData.isAccent) {
                        group.accent.push(noteData);
                    } else {
                        group.normal.push(noteData);
                    }
                }

                // 按强度绘制
                for (const [level, { normal, accent }] of intensityGroups) {
                    const intensity = level / 5;
                    if (intensity <= 0) continue;

                    // 设置光晕
                    drawingContext.shadowColor = CFG.glowColor;
                    drawingContext.shadowBlur = CFG.glowMax * intensity;

                    // 绘制普通点亮音符
                    if (normal.length > 0) {
                        const alpha = CFG.litAlphaMin + (CFG.litAlphaMax - CFG.litAlphaMin) * intensity;
                        colorCache.litNormal.setAlpha(255 * alpha);
                        fill(colorCache.litNormal);
                        for (const { x, y } of normal) {
                            ellipse(x, y, CFG.dotD);
                        }
                    }

                    // 绘制accent点亮音符
                    if (accent.length > 0) {
                        const alpha = CFG.litAlphaMin + (CFG.litAlphaMax - CFG.litAlphaMin) * intensity;
                        colorCache.litAccent.setAlpha(255 * alpha);
                        fill(colorCache.litAccent);
                        for (const { x, y } of accent) {
                            ellipse(x, y, CFG.dotD);
                        }
                    }
                }

                drawingContext.restore();
            }

            // 批量绘制字符
            if (glyphs.length > 0) {
                textSize(12);
                textAlign(CENTER, TOP);
                textStyle(BOLD);
                noStroke();

                // 分组绘制暗色和亮色字符
                const dimGlyphs = glyphs.filter(g => !g.lit);
                const litGlyphs = glyphs.filter(g => g.lit);

                if (dimGlyphs.length > 0) {
                    fill(CFG.glyphDim);
                    for (const { x, y, glyph } of dimGlyphs) {
                        text(glyph, x, y + 12);
                    }
                }

                if (litGlyphs.length > 0) {
                    fill(CFG.glyphLit);
                    for (const { x, y, glyph } of litGlyphs) {
                        text(glyph, x, y + 12);
                    }
                }

                textStyle(NORMAL);
            }
        }
    };
})();