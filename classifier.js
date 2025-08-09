//teachable machine + ml5.js的conga击法分类器(open, slap, palm, tip)

(function (global) {
    const CANON_MAP = new Map([
        ['open', 'open'],
        ['slap', 'slap'],
        ['palm', 'palm'],
        ['tip', 'tip'],
        ['Background Noise', 'background'],
        ['noise', 'background'],
        ['unknown', 'background'],
        ['_background_noise_', 'background']
    ]);

    function canonLabel(s) {
        const low = (s || '').toLowerCase().trim();
        if (CANON_MAP.has(low)) return CANON_MAP.get(low);
        if (low.includes('open')) return 'open';
        if (low.includes('slap')) return 'slap';
        if (low.includes('palm') || low.includes('bass')) return 'palm';
        if (low.includes('tip') || low.includes('finger')) return 'tip';
        return 'background';
    }

    const CongaClassifier = {
        _classifier: null,
        _ready: false,
        _active: false,

        //当前"稳定后“的预测
        _label: 'waiting...',
        _conf: 0,

        //去抖
        _pendingLabel: null,
        _pendingCount: 0,
        //配置
        _cfg: {
            modelURL: '',
            probabilityThreshold: 0.6, //置信度阈值
            overlapFactor: 0.5, //重叠因子
            includeSpectrogram: false, //是否包含频谱图
            stableFrames: 3,
            allowed: new Set(['open', 'slap', 'palm', 'tip'])   //限定输出类别
        },

        //事件
        _onLabelChange: new Set(),
        _onRaw: new Set(),

        //初始化
        async init(opts = {}) {
            if (!opts.modelURL || !opts.modelURL.endWith('/')) {
                throw new Error('[CongaClassifier] modelURL loads error, must be a directory URL');
            }
            //合并配置
            this._cfg = {
                ...this._cfg,
                ...opts,
                allowed: new Set((opts.allowedLabels || ['open', 'slap', 'palm', 'tip']).map(s => s.toLowerCase()))
            };

            //创建ml5分类器
            this._classifier = await ml5.soundClassifier(this._cfg.modelURL + 'model.json', {
                probabilityThreshold: this._cfg.probabilityThreshold,
                overlapFactor: this._cfg.overlapFactor,
                includeSpectrogram: this._cfg.includeSpectrogram
            });

            this._ready = true;
            return true;
        },

        //开始监听
        start() {
            if (!this._ready || !this._classifier) {
                console.warn('[CongaClassifier] Not ready or classifier not initialized');
                return;
            }
            this._active = true;
            this._classifier.classify(this._gotResult.bind(this));
        },
        //停止监听
        stop() {
            {
                this._active = false;
                if (this._classifier && typeof this._classifier.stop === 'function') {
                    try {
                        this._classifier.stop();
                    } catch (_) { }
                }
            }
        },
        /** 设置本地阈值（运行时更改） */
        setProbabilityThreshold(p) {
            if (Number.isFinite(p)) this._cfg.probabilityThreshold = p;
        },
        /** 读取当前稳定预测 */
        getPrediction() {
            return { label: this._label, confidence: this._conf };
        },
        /** 订阅稳定标签变化 */
        onLabelChange(cb) {
            if (typeof cb === 'function') this._onLabelChange.add(cb);
            return () => this._onLabelChange.delete(cb);
        },
        /** 订阅原始结果流（调试/可视化） */
        onRaw(cb) {
            if (typeof cb === 'function') this._onRaw.add(cb);
            return () => this._onRaw.delete(cb);
        },
        // —— 内部：结果处理 —— //
        _gotResults(err, results) {
            if (!this._active) return;
            if (err) {
                console.error('[CongaClassifier] classify error:', err);
                return;
            }
            if (!results || !results.length) return;

            // 原始结果回调
            this._onRaw.forEach(fn => { try { fn(results); } catch { } });

            const top = results[0];
            const rawLabel = top?.label ?? 'unknown';
            const conf = Number(top?.confidence ?? 0);

            if (conf < this._cfg.probabilityThreshold) return;

            const mapped = canonLabel(rawLabel);
            const finalLabel = this._cfg.allowed.has(mapped) ? mapped : 'background';

            // 去抖：连续 N 帧一致才更新
            if (finalLabel === this._pendingLabel) {
                this._pendingCount++;
            } else {
                this._pendingLabel = finalLabel;
                this._pendingCount = 1;
            }

            if (this._pendingCount >= this._cfg.stableFrames) {
                const changed = (finalLabel !== this._label);
                this._label = finalLabel;
                this._conf = conf;
                if (changed) {
                    const payload = { label: this._label, confidence: this._conf, raw: results };
                    this._onLabelChange.forEach(fn => { try { fn(payload); } catch { } });
                }
            }
        }
    };
    global.CongaClassifier = CongaClassifier;
})(typeof window !== 'undefined' ? window : globalThis);

