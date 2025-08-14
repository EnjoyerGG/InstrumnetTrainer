
(function (global) {
    const TMRecognizer = {
        _rec: null, _ready: false, _active: false,
        _labels: [],
        _probGate: 0.6, _stable: 3, _overlap: 0.5,
        _cooldownMs: 250, _lastEmitTs: 0,
        _pending: { label: null, count: 0 },
        _onLabel: new Set(), _onRaw: new Set(),
        _lastFrameTs: 0,
        isListening() { return this._active; },
        micAlive(timeoutMs = 1500) { return (performance.now() - this._lastFrameTs) < timeoutMs; },
        _micConstraints: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        setConstraints(c) { this._micConstraints = { ...this._micConstraints, ...c }; },

        async init({ modelURL, probabilityThreshold = 0.6, stableFrames = 3, overlapFactor = 0.5, cooldownMs = 250 } = {}) {
            if (!modelURL) throw new Error('modelURL 不能为空');

            const toAbsRoot = (u) => {
                let root = /^(https?:|file:)/.test(u) ? u : new URL(u, location.href).href;
                if (!root.endsWith('/')) root += '/';
                return root;
            };
            const root = toAbsRoot(modelURL);

            this._probGate = probabilityThreshold;
            this._stable = stableFrames;
            this._overlap = overlapFactor;
            this._cooldownMs = cooldownMs;

            this._rec = speechCommands.create(
                'BROWSER_FFT',
                undefined,
                root + 'model.json',
                root + 'metadata.json'
            )


            await this._rec.ensureModelLoaded();
            this._labels = this._rec.wordLabels();
            this._ready = true;
            return true;
        },

        async start() {
            if (!this._ready || this._active) return;
            this._active = true;

            // 预热：申请一次带约束的麦克风，提升移动端拾音概率并降低系统延迟
            if (navigator.mediaDevices?.getUserMedia) {
                try {
                    const s = await navigator.mediaDevices.getUserMedia({ audio: this._micConstraints });
                    s.getTracks().forEach(t => t.stop());
                } catch (e) { console.warn('getUserMedia with constraints failed', e); }
            }


            this._rec.listen(result => {
                let energy = 0;
                if (result.spectrogram && result.spectrogram.data) {
                    const arr = result.spectrogram.data;
                    let sumSq = 0;
                    for (let i = 0; i < arr.length; i++) {
                        sumSq += arr[i] * arr[i];
                    }
                    energy = Math.sqrt(sumSq / arr.length); //RMS
                    window._tmEnergy = energy;  //让UI能够显示TM能量
                }

                const scores = Array.from(result.scores);
                const idx = scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);

                // 原始 topN 给到调试
                const top = idx.slice(0, Math.min(5, idx.length))
                    .map(([v, i]) => ({ label: this._labels[i], confidence: v }));
                // 把原始 scores / labels / energy 一起发给 UI（HUD/门控使用）
                this._onRaw.forEach(fn => {
                    try { fn(top, { scores, labels: this._labels, energy }); } catch { }
                });
                this._lastFrameTs = performance.now(); // 记录最近一帧时间（HUD判活）

                const [s1, i1] = idx[0], [s2] = idx[1] || [0];
                if (s1 < this._probGate) return; // 置信度门限（外部也可自己再做门控）
                const lab = this._labels[i1];

                // 简易去抖
                if (this._pending.label === lab) this._pending.count++;
                else this._pending = { label: lab, count: 1 };

                if (this._pending.count >= this._stable) {
                    const now = performance.now();
                    if (now - this._lastEmitTs >= this._cooldownMs) {
                        this._lastEmitTs = now;
                        const payload = { label: lab, confidence: s1, margin: s1 - s2, energy, raw: top };
                        this._onLabel.forEach(fn => { try { fn(payload); } catch { } });
                    }
                }
            }, {
                includeSpectrogram: true,
                probabilityThreshold: 0,              // 放开，让我们自己 gate
                invokeCallbackOnNoiseAndUnknown: true,
                overlapFactor: this._overlap
            });
        },

        stop() {
            if (!this._active) return;
            this._active = false;
            this._rec.stopListening();
            this._pending = { label: null, count: 0 };
            this._lastEmitTs = 0;
        },

        onLabelChange(cb) { if (typeof cb === 'function') this._onLabel.add(cb); },
        onRaw(cb) { if (typeof cb === 'function') this._onRaw.add(cb); },

        setCooldown(ms) {
            this._cooldownMs = Math.max(0, ms | 0);
        },

        setProbGate(p) {
            if (Number.isFinite(p)) {
                this._probGate = Math.max(0, Math.min(1, p));
            }
        },

        setStableFrames(n) {
            if (Number.isFinite(n)) {
                this._stable = Math.max(1, n | 0);
            }
        },

        setOverlap(f) {
            if (Number.isFinite(f)) {
                this._overlap = Math.max(0, Math.min(0.99, f));
            }
        }
    };

    global.CongaClassifier = TMRecognizer; // 用原来的名字，sketch.js 无需大改
})(typeof window !== 'undefined' ? window : globalThis);
