// ampPanel.js — 修复后的振幅面板
(function (root) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const Panel = {
        _rect: () => ({ x: 0, y: 0, w: 0, h: 0 }),
        _amp: null,
        _mic: null,
        _fft: null,
        _smooth: 0.1,
        _vscale: 3.0,
        _hist: [],
        _histMax: 0,
        _historySec: 2.5,
        _ema: 0,
        _bg: '#111319',
        _frame: 'rgba(255,255,255,0.18)',
        _grid: 'rgba(255,255,255,0.06)',
        _corner: 12,
        _preferAmp: false,
        _modeLabel: 'RMS',
        _fastResponse: true,

        _maxLevel: 0,
        _maxLevelDecay: 0.995, // 更慢的衰减，避免跳跃
        _instantAdapt: false,
        _dynamicScale: true,
        _overload: false,
        _overloadThreshold: 0.95, // 提高过载阈值
        _targetFillRatio: 0.75, // 降低目标填充比例

        _compressionMode: 'logarithmic',
        _compressionRatio: 0.3,
        _kneeThreshold: 0.7,
        _headroom: 0.95,

        // 新增：分贝参考电平
        _dbRef: 1.0, // 0 dB 对应的电平值
        _dbRange: 60, // 显示范围 (-60dB 到 0dB)

        init({ mic, rectProvider, smoothing = 0.9, vscale = 3.0, historySec = 2.5, fastResponse = true } = {}) {
            this._rect = rectProvider || this._rect;
            this._smooth = clamp(smoothing, 0, 0.99);
            this._vscale = Math.max(1, vscale);
            this._historySec = Math.max(0.5, historySec);
            this._fastResponse = fastResponse;

            this._mic = mic;
            this._amp = null;
            this._fft = new p5.FFT(0.85, 512);
            if (mic) this._fft.setInput(mic);

            return this;
        },

        // 修复后的分贝计算
        _levelToDb(level) {
            if (level <= 0) return -Infinity;

            // 正确的分贝公式：20 * log10(level/reference)
            // 这里 reference = 1.0，所以简化为 20 * log10(level)
            const db = 20 * Math.log10(level / this._dbRef);

            // 限制在合理范围内
            return Math.max(-this._dbRange, Math.min(0, db));
        },

        // 改进的电平计算
        _currentLevel() {
            let level = 0;

            if (this._preferAmp && this._amp && this._amp.getLevel) {
                level = this._amp.getLevel() || 0;
                this._modeLabel = this._fastResponse ? 'AMP*' : 'AMP';
            } else if (this._fft) {
                const wave = this._fft.waveform(512);
                let rms = 0;
                for (let i = 0; i < wave.length; i++) rms += wave[i] * wave[i];
                rms = Math.sqrt(rms / wave.length);

                if (this._fastResponse) {
                    const alpha = 0.6; // 降低alpha值，减少跳跃
                    this._ema = this._ema ? (this._ema * (1 - alpha) + rms * alpha) : rms;
                } else {
                    const alpha = 1 - this._smooth;
                    this._ema = this._ema ? (this._ema * (1 - alpha) + rms * alpha) : rms;
                }
                level = this._ema;
                this._modeLabel = this._fastResponse ? 'RMS*' : 'RMS';
            }

            // 先应用压缩，再进行动态缩放跟踪
            const compressedLevel = this._applyCompression(Math.max(0, level));

            // 改进的动态缩放逻辑
            if (this._dynamicScale) {
                if (compressedLevel > this._maxLevel) {
                    this._maxLevel = compressedLevel;
                } else {
                    // 更平滑的衰减
                    this._maxLevel *= this._maxLevelDecay;

                    // 防止过度衰减
                    if (this._maxLevel < compressedLevel * 0.1) {
                        this._maxLevel = compressedLevel * 0.5;
                    }
                }
            }

            // 检测过载
            this._overload = compressedLevel > this._overloadThreshold;

            return compressedLevel;
        },

        // 改进的渲染函数
        render(ctx, x, y, w, h) {
            const r = this._rect();
            if (r && r.w && r.h) { x = r.x; y = r.y; w = r.w; h = r.h; }
            if (!w || !h) return;

            if (this._mic && this._fft) {
                try { this._fft.setInput(this._mic); } catch (e) { }
            }

            this._drawBG(ctx, x, y, w, h);

            const padL = 10, padR = 10, padT = 35, padB = 14; // 增加顶部padding给标题留空间
            const innerW = w - padL - padR;
            const innerH = h - padT - padB;
            this._ensureHistCapacity(innerW);

            const level = this._currentLevel();
            const db = this._levelToDb(level);

            this._hist.push(level);
            if (this._hist.length > this._histMax) this._hist.shift();

            // 重新设计波形显示逻辑 - 调整为更合理的动态范围
            const baseY = y + padT + innerH; // 波形底线位置（-60dB）
            const topY = y + padT + innerH * 0.05; // 顶部位置（0dB，顶部5%）
            const usableHeight = baseY - topY; // 可用显示高度

            // 计算dB到像素的映射 - 使用更宽的显示范围
            const dbToPixel = (dbValue) => {
                if (dbValue <= -this._dbRange) return baseY; // -60dB在底部
                if (dbValue >= 0) return topY; // 0dB在顶部5%

                // 非线性映射：让中等电平(-40到-10dB)占用更多显示空间
                const normalizedDb = (dbValue + this._dbRange) / this._dbRange; // 0到1

                // 使用平方根曲线，让较低的dB值获得更多显示空间
                const curvedRatio = Math.sqrt(normalizedDb);

                return baseY - curvedRatio * usableHeight;
            };

            // 绘制dB刻度线（可选）
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);

            // 绘制几条参考线
            const refDbValues = [-50, -40, -30, -20, -10, 0];
            refDbValues.forEach(refDb => {
                const refY = dbToPixel(refDb);
                if (refY >= y + padT && refY <= baseY) {
                    ctx.beginPath();
                    ctx.moveTo(x + padL, refY);
                    ctx.lineTo(x + padL + innerW, refY);
                    ctx.stroke();
                }
            });
            ctx.restore();

            // 绘制波形 - 基于dB值
            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';

            if (this._hist.length > 0) {
                const firstDb = this._levelToDb(this._hist[0]);
                const y0 = dbToPixel(firstDb);
                ctx.moveTo(x + padL, y0);
            }

            for (let i = 1; i < this._hist.length; i++) {
                const px = x + padL + i;
                const histDb = this._levelToDb(this._hist[i]);
                const py = dbToPixel(histDb);
                ctx.lineTo(px, py);
            }
            ctx.stroke();

            // 绘制填充区域（可选，让波形更明显）
            if (this._hist.length > 0) {
                ctx.globalAlpha = 0.2;
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.lineTo(x + padL + this._hist.length - 1, baseY);
                ctx.lineTo(x + padL, baseY);
                ctx.fill();
            }
            ctx.restore();

            // 红色扫描线
            ctx.save();
            ctx.strokeStyle = 'rgba(255,64,64,0.9)';
            ctx.lineWidth = 2;
            const cursorX = x + padL + this._hist.length;
            ctx.beginPath();
            ctx.moveTo(cursorX + 0.5, y + padT);
            ctx.lineTo(cursorX + 0.5, y + padT + innerH);
            ctx.stroke();
            ctx.restore();

            // 过载指示器
            if (this._overload) {
                ctx.save();
                ctx.fillStyle = 'rgba(255,0,0,0.3)';
                ctx.fillRect(x + 2, y + 2, w - 4, 20);
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 12px ui-sans-serif, system-ui, -apple-system';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('OVERLOAD', x + w / 2, y + 12);
                ctx.restore();
            }

            // 标题和dB读数
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = 'bold 14px ui-sans-serif, system-ui, -apple-system';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            const title = `Amplitude (${this._compressionMode.replace('_', ' ')})`;
            ctx.fillText(title, x + 12, y + 10);

            // 模式标签
            ctx.textAlign = 'right';
            ctx.font = 'bold 15px ui-sans-serif, system-ui, -apple-system';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(this._modeLabel, x + w - 180, y + 30);

            // 压缩指示
            if (this._compressionMode !== 'none') {
                ctx.fillStyle = 'rgba(0,255,255,0.6)';
                ctx.font = 'bold 12px ui-sans-serif, system-ui, -apple-system';
                ctx.fillText('COMP', x + w - 60, y + 30);
            }

            // 修正后的dB值显示
            ctx.textAlign = 'right';
            ctx.font = 'bold 18px ui-sans-serif, system-ui, -apple-system';
            ctx.fillStyle = this._overload ? 'rgba(255,100,100,0.9)' : 'rgba(255,255,255,0.85)';

            const dbLabel = (db <= -this._dbRange) ? '−∞ dB' : `${db.toFixed(1)} dB`;
            ctx.fillText(dbLabel, x + w - 12, y + 8);

            // 添加电平百分比显示（可选）
            if (this._dynamicScale && this._maxLevel > 0) {
                const percentage = (level / this._maxLevel * 100).toFixed(0);
                ctx.font = 'bold 12px ui-sans-serif, system-ui, -apple-system';
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillText(`${percentage}%`, x + w - 12, y + 35);
            }

            ctx.restore();
        },

        // 计算有效的缩放系数
        _getEffectiveScale() {
            if (!this._dynamicScale || this._maxLevel <= 0) {
                return this._vscale;
            }

            // 动态调整缩放，但设置最小和最大缩放限制
            const dynamicScale = this._targetFillRatio / this._maxLevel;
            const minScale = this._vscale * 0.1; // 最小缩放
            const maxScale = this._vscale * 10;  // 最大缩放

            return Math.max(minScale, Math.min(maxScale, dynamicScale));
        },

        // 其他方法保持不变...
        tryEnableAmplitude() {
            try {
                if (!this._amp) {
                    this._amp = new p5.Amplitude();
                    const smoothValue = this._fastResponse ? 0.0 : this._smooth;
                    this._amp.smooth(smoothValue);
                    if (this._mic) this._amp.setInput(this._mic);
                }
            } catch (e) { }
        },

        preferAmplitude(on = true) {
            this._preferAmp = !!on;
            if (this._preferAmp) this.tryEnableAmplitude();
        },

        setFastResponse(enabled = true) {
            this._fastResponse = enabled;
            if (this._amp) {
                const smoothValue = this._fastResponse ? 0.0 : this._smooth;
                this._amp.smooth(smoothValue);
            }
        },

        setDynamicScale(enabled = true) {
            this._dynamicScale = enabled;
            if (!enabled) {
                this._maxLevel = 0;
            }
        },

        setInstantAdapt(enabled = true) {
            this._instantAdapt = enabled;
        },

        getAmplitudeState() {
            return {
                preferAmp: this._preferAmp,
                dynamicScale: this._dynamicScale,
                instantAdapt: this._instantAdapt,
                fastResponse: this._fastResponse,
                compressionMode: this._compressionMode,
                compressionRatio: this._compressionRatio
            };
        },

        // 其他辅助方法保持不变...
        _roundRect(ctx, x, y, w, h, r, fill, stroke) {
            const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x + rr, y);
            ctx.arcTo(x + w, y, x + w, y + h, rr);
            ctx.arcTo(x + w, y + h, x, y + h, rr);
            ctx.arcTo(x, y + h, x, y, rr);
            ctx.arcTo(x, y, x + w, y, rr);
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
            ctx.restore();
        },

        _drawBG(ctx, x, y, w, h) {
            this._roundRect(ctx, x, y, w, h, this._corner, this._bg, this._frame);
            ctx.save();
            ctx.strokeStyle = this._grid;
            ctx.lineWidth = 1;
            for (let i = 1; i < 5; i++) {
                const yy = Math.round(y + (h * i) / 5) + 0.5;
                ctx.beginPath(); ctx.moveTo(x + 8, yy); ctx.lineTo(x + w - 8, yy); ctx.stroke();
            }
            ctx.restore();
        },

        _ensureHistCapacity(innerW) {
            const max = Math.max(10, Math.floor(innerW));
            if (max !== this._histMax) {
                this._histMax = max;
                if (this._hist.length > max) this._hist.splice(0, this._hist.length - max);
            }
        },

        // 压缩函数保持不变...
        setCompressionMode(mode = 'logarithmic', ratio = 0.3) {
            this._compressionMode = mode;
            this._compressionRatio = Math.max(0.1, Math.min(1.0, ratio));
            return this;
        },

        setSoftClipParams(kneeThreshold = 0.7, headroom = 0.95) {
            this._kneeThreshold = Math.max(0.1, Math.min(0.9, kneeThreshold));
            this._headroom = Math.max(0.8, Math.min(0.99, headroom));
            return this;
        },

        _logarithmicCompression(level) {
            if (level <= 0) return 0;
            const k = 9;
            return Math.log(1 + k * level) / Math.log(1 + k);
        },

        _tanhCompression(level) {
            if (level <= this._kneeThreshold) {
                return level;
            }
            const excess = level - this._kneeThreshold;
            const maxExcess = 1 - this._kneeThreshold;
            const compressedExcess = Math.tanh(excess * 3) * maxExcess * this._compressionRatio;
            return this._kneeThreshold + compressedExcess;
        },

        _softClipCompression(level) {
            if (level <= this._kneeThreshold) {
                return level;
            }
            const t = (level - this._kneeThreshold) / (1 - this._kneeThreshold);
            const compressed = Math.pow(t, 3) * (1 - this._kneeThreshold) * this._compressionRatio;
            return this._kneeThreshold + compressed;
        },

        _applyCompression(level) {
            switch (this._compressionMode) {
                case 'logarithmic':
                    return this._logarithmicCompression(level);
                case 'tanh':
                    return this._tanhCompression(level);
                case 'soft_clip':
                    return this._softClipCompression(level);
                default:
                    return Math.min(level, 1.0);
            }
        }
    };

    root.AmpPanel = Panel;
})(window);