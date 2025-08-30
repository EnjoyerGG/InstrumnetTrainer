// bgAuraParticles.js — rainbow links + even distribution + built-in sliders
(() => {
    if (window.__BG_AURA_V2__) return;
    window.__BG_AURA_V2__ = true;

    const config = {
        particleCount: 140,   // 颗粒数
        particleSize: 3,      // 颗粒半径基准
        sensitivity: 1.5,     // 音频敏感度
        baseSpeed: 1.0,       // 基础速度
        linkDist: 120,        // 连接距离
        hueDrift: 0.25,       // 每帧色相漂移（彩虹流动速度）
        wrapMargin: 40,       // 环绕缓冲（越出多少像素开始从另一侧出现）
        mode: 'mouse',        // 'mouse' | 'audio'
    };

    let cvs, ctx, DPR = 1, W = 0, H = 0;
    let particles = [];
    let audioContext, analyser, micSource, audioData;

    const mouse = { x: -1e9, y: -1e9, active: false };

    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else fn();
    }

    onReady(init);

    function init() {
        // 背景画布
        cvs = document.createElement('canvas');
        cvs.id = 'bgAuraParticles';
        Object.assign(cvs.style, {
            position: 'fixed', inset: '0', zIndex: '0',
            width: '100vw', height: '100vh',
            pointerEvents: 'none', display: 'block'
        });
        document.body.prepend(cvs);
        ctx = cvs.getContext('2d');

        // 若页面有 p5 画布，抬高层级
        const p5c = document.querySelector('canvas#defaultCanvas0, canvas.p5Canvas');
        if (p5c) { p5c.style.position ||= 'relative'; p5c.style.zIndex = '1'; }

        // DPR / 尺寸
        DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
        resize(); window.addEventListener('resize', resize);

        // 指针
        window.addEventListener('mousemove', e => {
            mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
        });
        window.addEventListener('mouseleave', () => { mouse.active = false; mouse.x = mouse.y = -1e9; });
        window.addEventListener('touchmove', e => {
            const t = e.touches[0]; if (!t) return;
            mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true;
        }, { passive: true });
        window.addEventListener('touchend', () => { mouse.active = false; });

        // 快捷键：P 面板；A 音频；M 鼠标；R 重置
        window.addEventListener('keydown', e => {
            const k = e.key.toLowerCase();
            if (k === 'p') togglePanel();
            else if (k === 'a') enableAudio().catch(() => { });
            else if (k === 'm') setMode('mouse');
            else if (k === 'r') resetParticles();
        });

        // 粒子 + 动画
        createParticlesEven();
        animate();

        // 内置设置面板（可选）
        injectPanel();

        // 若页面本身提供这些控件则自动接管（可选）
        hookOptionalUI();
    }

    function resize() {
        W = cvs.clientWidth; H = cvs.clientHeight;
        cvs.width = Math.floor(W * DPR); cvs.height = Math.floor(H * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // 粒子
    class Particle {
        constructor(x = Math.random() * W, y = Math.random() * H) {
            this.x = x; this.y = y;
            this.baseSize = 1 + Math.random() * config.particleSize;
            this.size = this.baseSize;
            this.hue = Math.random() * 360;        // 彩虹
            this.vx = (Math.random() - 0.5) * config.baseSpeed;
            this.vy = (Math.random() - 0.5) * config.baseSpeed;
        }
        reset() {
            this.x = Math.random() * W; this.y = Math.random() * H;
            this.baseSize = 1 + Math.random() * config.particleSize;
            this.size = this.baseSize;
            this.hue = Math.random() * 360;
            this.vx = (Math.random() - 0.5) * config.baseSpeed;
            this.vy = (Math.random() - 0.5) * config.baseSpeed;
        }
        update(audioLevel = 0) {
            // 鼠标吸引/扰动
            if (config.mode === 'mouse' && mouse.active) {
                const dx = this.x - mouse.x, dy = this.y - mouse.y;
                const R = 100, d2 = dx * dx + dy * dy;
                if (d2 < R * R) {
                    const d = Math.max(1, Math.sqrt(d2));
                    const f = (1 - d / R) * 0.55;
                    this.vx += (-dx / d) * f * 0.25;
                    this.vy += (-dy / d) * f * 0.25;
                }
            }

            // 音频：随音量膨胀 + 抖动
            if (config.mode === 'audio') {
                this.size = this.baseSize + audioLevel * config.sensitivity * 6;
                const ang = Math.random() * Math.PI * 2, j = audioLevel * 0.9;
                this.vx += Math.cos(ang) * j * 0.12; this.vy += Math.sin(ang) * j * 0.12;
            }

            // 运动
            this.x += this.vx; this.y += this.vy;
            this.vx *= 0.985; this.vy *= 0.985;

            // 彩虹缓慢流动
            this.hue = (this.hue + config.hueDrift) % 360;

            // 边界环绕（不在边框“挤成一圈”）
            const m = config.wrapMargin;
            if (this.x < -m) this.x = W + m; else if (this.x > W + m) this.x = -m;
            if (this.y < -m) this.y = H + m; else if (this.y > H + m) this.y = -m;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsl(${this.hue},100%,68%)`;
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // 均匀分布：网格抖动初始化，后续随机游走 + 环绕
    function createParticlesEven() {
        const areaScale = Math.min(2.0, (W * H) / (1280 * 720));
        const target = Math.max(10, Math.round(config.particleCount * areaScale));

        particles = [];
        // 估算列行
        const cols = Math.ceil(Math.sqrt(target * (W / H)));
        const rows = Math.ceil(target / cols);
        const cw = W / cols, ch = H / rows;

        let i = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols && i < target; c++, i++) {
                // 每个网格里随机一点，保证“均匀但不死板”
                const x = c * cw + (0.15 + 0.7 * Math.random()) * cw;
                const y = r * ch + (0.15 + 0.7 * Math.random()) * ch;
                particles.push(new Particle(x, y));
            }
        }
    }
    function resetParticles() { createParticlesEven(); }

    // 音频
    async function enableAudio() {
        if (config.mode === 'audio' && analyser) return;
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micSource = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            micSource.connect(analyser);
            audioData = new Uint8Array(analyser.frequencyBinCount);
            setMode('audio');
        } catch (err) {
            console.warn('mic unavailable:', err);
            setMode('mouse');
        }
    }
    function getAudioLevel() {
        if (!analyser) return 0;
        analyser.getByteFrequencyData(audioData);
        let sum = 0; for (let i = 0; i < audioData.length; i++) sum += audioData[i];
        return (sum / (audioData.length || 1)) / 255; // 0~1
    }

    // 绘制
    function animate() {
        requestAnimationFrame(animate);
        ctx.clearRect(0, 0, W, H);

        const audioLevel = (config.mode === 'audio' && analyser) ? getAudioLevel() : 0;

        // 连接线（按距离衰减 & 彩虹色）
        const L = config.linkDist;
        for (let i = 0; i < particles.length; i++) {
            const a = particles[i];
            for (let j = i + 1; j < particles.length; j++) {
                const b = particles[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const d = Math.hypot(dx, dy);
                if (d < L) {
                    const hue = (a.hue + b.hue) * 0.5;
                    ctx.strokeStyle = `hsla(${hue},100%,70%,${1 - d / L})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
        }

        // 粒子
        for (const p of particles) { p.update(audioLevel); p.draw(); }
    }

    // 模式/外部 API
    function setMode(mode) {
        config.mode = (mode === 'audio') ? 'audio' : 'mouse';
        const mouseBtn = document.getElementById('mouseMode');
        const audioBtn = document.getElementById('audioMode');
        mouseBtn?.classList.toggle('active', config.mode === 'mouse');
        audioBtn?.classList.toggle('active', config.mode === 'audio');
        if (config.mode === 'audio' && !analyser) enableAudio().catch(() => { });
    }

    // -------- 内置简易面板（点击右下角齿轮或按 P 显示） --------
    let panel, gearBtn;
    function injectPanel() {
        const style = document.createElement('style');
        style.textContent = `
      #bgAuraGear{position:fixed;right:16px;bottom:16px;z-index:9999;pointer-events:auto}
      #bgAuraGear button{font:600 12px ui-sans-serif,system-ui,-apple-system;
        padding:8px 10px;border-radius:10px;border:0;cursor:pointer;
        background:#20222a;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25)}
      #bgAuraPanel{position:fixed;right:16px;bottom:56px;z-index:9999;
        width:260px;padding:12px 12px 8px;border-radius:12px;background:#121317;
        color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.35);display:none;pointer-events:auto}
      #bgAuraPanel h4{margin:2px 0 8px 0;font:700 13px/1 ui-sans-serif,system-ui}
      #bgAuraPanel .row{display:flex;align-items:center;gap:8px;margin:8px 0}
      #bgAuraPanel .row label{width:110px;font:500 12px ui-sans-serif,system-ui;opacity:.9}
      #bgAuraPanel input[type=range]{flex:1}
      #bgAuraPanel .btns{display:flex;gap:8px;margin-top:6px}
      #bgAuraPanel .btns button{flex:1;background:#2a2e3a;color:#fff;border:0;
        padding:6px 8px;border-radius:8px;cursor:pointer}
    `;
        document.head.appendChild(style);

        gearBtn = document.createElement('div');
        gearBtn.id = 'bgAuraGear';
        gearBtn.innerHTML = `<button title="Particles Settings (P)">⚙️ Particles</button>`;
        document.body.appendChild(gearBtn);

        panel = document.createElement('div');
        panel.id = 'bgAuraPanel';
        panel.innerHTML = `
      <h4>Particle Settings</h4>
      <div class="row"><label>Count: <span id="cntVal">${config.particleCount}</span></label>
        <input id="cnt" type="range" min="50" max="600" value="${config.particleCount}">
      </div>
      <div class="row"><label>Size: <span id="sizVal">${config.particleSize}</span></label>
        <input id="siz" type="range" min="1" max="8" value="${config.particleSize}">
      </div>
      <div class="row"><label>Link Dist: <span id="linkVal">${config.linkDist}</span></label>
        <input id="lnk" type="range" min="60" max="220" value="${config.linkDist}">
      </div>
      <div class="row"><label>Speed: <span id="spdVal">${config.baseSpeed.toFixed(2)}</span></label>
        <input id="spd" type="range" min="0.2" max="2.0" step="0.01" value="${config.baseSpeed}">
      </div>
      <div class="row"><label>Hue Drift: <span id="hueVal">${config.hueDrift.toFixed(2)}</span></label>
        <input id="hue" type="range" min="0" max="1.5" step="0.01" value="${config.hueDrift}">
      </div>
      <div class="btns">
        <button id="modeMouse">Mouse</button>
        <button id="modeAudio">Audio</button>
        <button id="reset">Reset</button>
      </div>
    `;
        document.body.appendChild(panel);

        gearBtn.addEventListener('click', togglePanel);

        const $ = id => panel.querySelector(id);
        $('#cnt').addEventListener('input', e => {
            config.particleCount = +e.target.value; panel.querySelector('#cntVal').textContent = e.target.value; createParticlesEven();
        });
        $('#siz').addEventListener('input', e => {
            config.particleSize = +e.target.value; panel.querySelector('#sizVal').textContent = e.target.value;
        });
        $('#lnk').addEventListener('input', e => {
            config.linkDist = +e.target.value; panel.querySelector('#linkVal').textContent = e.target.value;
        });
        $('#spd').addEventListener('input', e => {
            config.baseSpeed = +e.target.value; panel.querySelector('#spdVal').textContent = (+e.target.value).toFixed(2);
            // 立即更新现有粒子速度幅度（轻微缩放）
            for (const p of particles) { p.vx *= 0.9; p.vy *= 0.9; }
        });
        $('#hue').addEventListener('input', e => {
            config.hueDrift = +e.target.value; panel.querySelector('#hueVal').textContent = (+e.target.value).toFixed(2);
        });
        $('#modeMouse').addEventListener('click', () => setMode('mouse'));
        $('#modeAudio').addEventListener('click', () => enableAudio());
        $('#reset').addEventListener('click', resetParticles);
    }

    function togglePanel() {
        if (!panel) return;
        panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
    }

    // 如果页面里本就有这些控件（id 同名），也能控制
    function hookOptionalUI() {
        const mouseBtn = document.getElementById('mouseMode');
        const audioBtn = document.getElementById('audioMode');
        const resetBtn = document.getElementById('resetBtn');
        const countSlider = document.getElementById('particleCountSlider');
        const sizeSlider = document.getElementById('particleSizeSlider');
        const sensSlider = document.getElementById('sensitivitySlider');
        const enableBtn = document.getElementById('enableAudio');

        mouseBtn?.addEventListener('click', () => setMode('mouse'));
        audioBtn?.addEventListener('click', () => enableAudio());
        resetBtn?.addEventListener('click', resetParticles);
        enableBtn?.addEventListener('click', () => enableAudio());

        countSlider?.addEventListener('input', () => { config.particleCount = +countSlider.value; createParticlesEven(); });
        sizeSlider?.addEventListener('input', () => { config.particleSize = +sizeSlider.value; });
        sensSlider?.addEventListener('input', () => { config.sensitivity = +sensSlider.value; });
    }

    // 对外暴露（可在控制台调）
    window.BGAura = {
        setMode, enableAudio, reset: resetParticles,
        setParticleCount(n) { config.particleCount = Math.max(10, n | 0); createParticlesEven(); },
        setParticleSize(s) { config.particleSize = Math.max(1, +s || 1); },
        setSensitivity(k) { config.sensitivity = Math.max(0.1, +k || 1.5); },
        setSpeed(v) { config.baseSpeed = Math.max(0.05, +v || 1); },
        setLinkDist(v) { config.linkDist = Math.max(20, +v || 120); },
        setHueDrift(v) { config.hueDrift = Math.max(0, +v || 0.25); },
    };
})();
