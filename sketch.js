/* ------------ Globals ------------ */
window.userStartAudio = async function () {
    try {
        if (typeof getAudioContext === 'function') {
            const ac = getAudioContext();
            if (ac && ac.state !== 'running') await ac.resume();
        }
    } catch (e) { console.warn(e); }

    try {
        if (window.metro?.ctx && metro.ctx.state !== 'running') {
            await metro.ctx.resume();
        }
    } catch (e) { console.warn(e); }
};

window.addEventListener('touchstart', () => window.userStartAudio?.(), { once: true, passive: true });
window.addEventListener('mousedown', () => window.userStartAudio?.(), { once: true });

let rm, metro, mic, fftHUD, ampHUD, drumTrigger, settingsPanel;
let running = false, counting = false;
let ctStart = 0;
let judgeLineGlow = 0;
let metronomeEnabled = false;
let chartJSON;
let hasEverStarted = false;
let isPaused = false;
let countdownForResume = false;
let micReady = false;
let debugMode = false;  //可以用鼠标进行debug

const COUNTDOWN_MS = 3000;
const SWEEP_H = 140;

const BPM_MIN = 60, BPM_MAX = 240;
const SPEED_MIN = 0.10, SPEED_MAX = 0.40;

const PX_PER_MS = 0.08;

let _emaE = 0, _emaVar = 1, _alphaE = 0.08;
let ENERGY_Z = 1.6;
const DEBUG = false;

// 仅保留节拍与谱面所需
let METRO_OFFSET_STEPS = 0;
function getMetroOffsetMs() { return (METRO_OFFSET_STEPS || 0) * (rm?.noteInterval || 0); }

// Sweep 导出
window.SWEEP_EXPORT_QUEUE = [];
const SWEEP_EXPORT_MAX = 10;
let _lastCycleForSnap = null;

const NOTE_GLYPH = { S: '×', O: 'O', T: '▲', P: '▼', B: 'B' };
function glyphForAbbr(ab) {
    const k = (ab ?? '').toString().toUpperCase();
    return NOTE_GLYPH[k] || k;
}

const LANE_GAP = 30;
function isBottomDrum(n) {
    if (n.drum === 2) return true;
    const ab = n.abbr || n.type?.[0];
    return !!ab && (ab === ('' + ab).toLowerCase());
}
function laneTopY() { return rm.noteY - LANE_GAP / 2; }
function laneBottomY() { return rm.noteY + LANE_GAP / 2; }

/* ---------- Metronome scheduler ---------- */
const schedulerState = { lastIdx: -1, lastNowMs: null, scheduledNotes: new Map(), guardUntil: 0, forceWindowMs: null, worker: null };

function _ensureSchedWorker() {
    if (schedulerState.worker) return schedulerState.worker;
    const workerCode = `
        let id=null, interval=25;
        onmessage = (e) => {
            const d=e.data||{};
            if(d.cmd==='start'){ if(id) clearInterval(id); id=setInterval(()=>postMessage('tick'), interval); }
            else if(d.cmd==='stop'){ if(id){ clearInterval(id); id=null; } }
            else if(d.cmd==='interval'){ interval=d.value|0; if(id){ clearInterval(id); id=setInterval(()=>postMessage('tick'), interval); } }
        };
    `;
    const blob = new Blob([workerCode], { type: 'text/javascript' });
    schedulerState.worker = new Worker(URL.createObjectURL(blob));
    schedulerState.worker.onmessage = (e) => { if (e.data === 'tick') scheduleTicksOnce(); };
    return schedulerState.worker;
}
function getAheadMs() { return Math.max(140, Math.min(320, rm.noteInterval * 0.75)); }
function startScoreTickScheduler() { stopScoreTickScheduler(); const w = _ensureSchedWorker(); w.postMessage({ cmd: 'interval', value: 25 }); w.postMessage({ cmd: 'start' }); }
function stopScoreTickScheduler() { if (schedulerState.worker) schedulerState.worker.postMessage({ cmd: 'stop' }); }
function resetMetronomeSchedulerState() { schedulerState.lastIdx = -1; schedulerState.lastNowMs = null; schedulerState.scheduledNotes.clear(); schedulerState.guardUntil = 0; schedulerState.forceWindowMs = null; }

function scheduleTicksOnce() {
    if (!metronomeEnabled || !running || !metro || !metro.isLoaded()) return;

    const ctxNow = metro.ctx.currentTime;
    const nowMs = rm._t() % rm.totalDuration;
    const aheadMs = schedulerState.forceWindowMs || getAheadMs();

    // loop restart
    if (schedulerState.lastNowMs != null && nowMs < schedulerState.lastNowMs - 5) {
        schedulerState.lastIdx = -1;
        schedulerState.scheduledNotes.clear();
        schedulerState.guardUntil = 0;
    }
    schedulerState.lastNowMs = nowMs;

    const notes = rm.scoreNotes;
    if (!notes || !notes.length) return;

    // clean expired
    for (const [k, t] of schedulerState.scheduledNotes) {
        if (t < ctxNow - 1.5) schedulerState.scheduledNotes.delete(k);
    }

    const currentMode = RhythmSelector.getCurrentMode() || 'metronome';

    let scheduledCount = 0;
    let checkedCount = 0;

    // 遍历所有音符，找出需要调度的
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];

        // 计算到下次播放该音符的时间差
        let dt = n.time - nowMs;

        // 如果音符时间已过，计算到下个循环的时间
        if (dt < 0) {
            dt += rm.totalDuration;
        }

        // 如果超出预调度范围，跳过
        if (dt > aheadMs) {
            continue;
        }

        checkedCount++;

        // 检查是否应该播放
        let shouldPlay = true;
        if (currentMode === 'clave23') {
            shouldPlay = n.clave23 === 1;
        }
        // else if (currentMode === 'clave32') {
        //     shouldPlay = n.clave32 === 1;
        // }

        if (shouldPlay) {
            const sf = rm?.speedFactor || 1;
            const when = ctxNow + Math.max(0, (dt + getMetroOffsetMs()) / (1000 * sf));

            const lastWhen = schedulerState.scheduledNotes.get(i) ?? -Infinity;
            const recentlyScheduled = Math.abs(when - lastWhen) < 0.04;
            const guarded = schedulerState.guardUntil && when <= schedulerState.guardUntil;

            if (!recentlyScheduled && !guarded) {
                try {
                    if (currentMode === 'metronome') {
                        const strong = ((n.accent | 0) === 1);
                        metro.scheduleAt(when, 'metronome', strong);
                        console.log(`✅ 调度 metronome: idx=${i}, time=${n.time}, dt=${dt.toFixed(1)}, when=${when.toFixed(3)}`);
                    } else {
                        metro.scheduleAt(when, 'clave', true);
                        console.log(`✅ 调度 clave: idx=${i}, time=${n.time}, dt=${dt.toFixed(1)}, when=${when.toFixed(3)}, mode=${currentMode}`);
                    }
                    schedulerState.scheduledNotes.set(i, when);
                    scheduledCount++;
                } catch (error) {
                    console.error(`❌ 调度失败: idx=${i}`, error);
                }
            }
        }
    }

    console.log(`调度结果: 检查了 ${checkedCount} 个音符, 调度了 ${scheduledCount} 个, 模式=${currentMode}, nowMs=${nowMs.toFixed(1)}, totalDuration=${rm.totalDuration}`);

    // 如果没有调度到任何音符，显示应该播放的音符列表用于调试
    if (scheduledCount === 0) {
        const shouldPlayNotes = notes.filter((n, i) => {
            //if (currentMode === 'clave32') return n.clave32 === 1;
            if (currentMode === 'clave23') return n.clave23 === 1;
            return true;
        }).map((n, originalIndex) => {
            const realIndex = notes.indexOf(n);
            let dt = n.time - nowMs;
            if (dt < 0) dt += rm.totalDuration;
            return {
                idx: realIndex,
                time: n.time,
                dt: dt.toFixed(1),
                withinWindow: dt <= aheadMs
            };
        });

        console.log(`应该播放的音符 (${currentMode}):`, shouldPlayNotes);
    }

    schedulerState.forceWindowMs = null;
};

window.onRhythmModeChange = function (mode, modeData) {
    console.log(`Rhythm mode changed to: ${modeData.name}`);

    // 如果节拍器正在运行，重置调度器状态
    if (metronomeEnabled && running && metro.isLoaded()) {
        metro.flushFuture();
        resetMetronomeSchedulerState();
        armNextTickNow();
        schedulerState.guardUntil = metro.ctx.currentTime + 0.02;
    }
};

function armNextTickNow() {
    if (!metronomeEnabled || !metro || !metro.isLoaded() || !rm?.scoreNotes?.length) return;

    const notes = rm.scoreNotes;
    const nowMs = rm._t() % rm.totalDuration;

    let nextIdx = notes.findIndex(n => n.time >= nowMs);
    if (nextIdx < 0) nextIdx = 0;

    const dtNext = (notes[nextIdx].time - nowMs + rm.totalDuration) % rm.totalDuration;

    schedulerState.lastIdx = (nextIdx - 1 + notes.length) % notes.length;
    schedulerState.forceWindowMs = dtNext + 30;

    const prevIdx = schedulerState.lastIdx;
    scheduleTicksOnce();
    if (schedulerState.lastIdx === prevIdx) {
        const now2 = rm._t() % rm.totalDuration;
        schedulerState.forceWindowMs = (rm.totalDuration - now2) + 30;
        scheduleTicksOnce();
    }
    startScoreTickScheduler();
}

/* ------------ p5 preload ------------- */
function preload() {
    chartJSON = loadJSON('assets/bolero.json');
    metro = new Metronome({ bpm: 120, beatsPerBar: 4 });
    metro.preload('assets/metronome/Tic.wav', 'assets/metronome/Toc.wav', 'assets/clave/Clave.wav');
}

/* ------------ Helpers ------------- */
function speedToBPM(speed) { return BPM_MIN + (BPM_MAX - BPM_MIN) * (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN); }
function bpmToSpeed(bpm) { return SPEED_MIN + (bpm - BPM_MIN) * (SPEED_MAX - SPEED_MIN) / (BPM_MAX - BPM_MIN); }
function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }

// 将speedToBPM函数导出到全局，供其他模块使用
window.speedToBPM = speedToBPM;

const GRID = { pad: 10, topHRatio: 0.5 };
const RECT = {
    top: {}, sweep: {}, fft: {}, amp: {}, drum: {}
};
let _canvasHost;

function layoutRects() {
    const topH = Number.isFinite(GRID.topHpx) ? GRID.topHpx : Math.round(height * GRID.topHRatio);

    // 布局顺序：Notes -> Sweep -> 底部HUD（左频谱/声谱独占整行）
    const sweepY = topH + GRID.pad;
    const sweepH = SWEEP_H;
    const hudY = sweepY + sweepH + GRID.pad;
    const hudH = Math.max(160, height - hudY - GRID.pad);
    const insetTop = 8;   // → 顶部收紧
    const insetRight = 10; // → 右侧收紧
    const insetBottom = 6;

    const availW = width - GRID.pad * 2;
    const leftW = Math.round(availW / 2);
    const gap = 8;          // 中间竖向缝
    const pad = 8;          // 四周内边距

    RECT.top = { x: 0, y: 0, w: width, h: topH };
    RECT.sweep = { x: GRID.pad, y: sweepY, w: availW, h: sweepH };
    RECT.fft = { x: GRID.pad, y: hudY + insetTop, w: leftW - insetRight, h: hudH - insetBottom };
    // 右半：再左右拆分
    RECT.rightHalf = { x: GRID.pad + leftW, y: hudY, w: availW - leftW, h: hudH };
    const halfW = Math.floor((RECT.rightHalf.w - gap - pad * 2) / 2);

    RECT.amp = {
        x: RECT.rightHalf.x + pad,
        y: RECT.rightHalf.y + pad,
        w: halfW,
        h: RECT.rightHalf.h - pad * 2
    };
    RECT.drum = {
        x: RECT.rightHalf.x + pad + halfW + gap,
        y: RECT.rightHalf.y + pad,
        w: RECT.rightHalf.w - pad * 2 - halfW - gap,
        h: RECT.rightHalf.h - pad * 2
    };

}

/* ------------ Setup --------------- */
function setup() {
    if (isMobile()) {
        pixelDensity(1);
        frameRate(30);
    } else {
        frameRate(45);
    }

    const NOTES_H = 120;
    const METER_H = 200;
    const totalHeight = NOTES_H + SWEEP_H + METER_H + GRID.pad * 3;

    const cnv = createCanvas(1000, totalHeight);
    cnv.parent('score-wrap');
    GRID.topHpx = NOTES_H;

    _canvasHost = select('#score-wrap');
    _canvasHost.elt.style.position = 'relative';
    _canvasHost.elt.classList.add('fixed-hud');

    // 首次与响应式布局
    layoutRects(cnv);
    window.addEventListener('resize', () => layoutRects(cnv));

    // 初始化节奏管理器
    rm = new RhythmManager();
    rm.initChart(chartJSON.conga);
    rm.noteY = 50;

    // === 添加这段诊断代码 ===
    console.log('=== JSON数据诊断 ===');
    console.log('原始JSON数据:', chartJSON);
    console.log('conga数组:', chartJSON.conga);
    console.log('第一个音符原始数据:', chartJSON.conga[0]);
    console.log('scoreNotes数据:', rm.scoreNotes);
    console.log('第一个scoreNote:', rm.scoreNotes[0]);

    // 检查字段是否存在
    const firstNote = rm.scoreNotes[0];
    console.log('字段检查:', {
        hasTime: 'time' in firstNote,
        hasType: 'type' in firstNote,
        //hasClave32: 'clave32' in firstNote,
        hasClave23: 'clave23' in firstNote,
        //clave32Value: firstNote.clave32,
        clave23Value: firstNote.clave23
    });

    // 初始化音符点亮反馈
    NoteIlluminateFeedback.init({
        rm,
        laneTopY: () => laneTopY(),
        laneBottomY: () => laneBottomY(),
        isBottomDrum: (n) => isBottomDrum(n),
        glyphForAbbr: (ab) => glyphForAbbr(ab)
    });

    // 初始化打击标记系统
    HitMarkers.init({
        rm,
        laneTopY: () => laneTopY(),
        laneBottomY: () => laneBottomY(),
        isBottomDrum: (n) => isBottomDrum(n)
    });

    // === 临时修复：如果字段丢失，手动添加 ===
    if (rm.scoreNotes && rm.scoreNotes.length > 0 && !('clave32' in rm.scoreNotes[0])) {
        console.warn('检测到clave字段丢失，正在修复...');

        // 重新从原始数据复制字段
        for (let i = 0; i < rm.scoreNotes.length && i < chartJSON.conga.length; i++) {
            const originalNote = chartJSON.conga[i];
            const scoreNote = rm.scoreNotes[i];
            //scoreNote.clave32 = originalNote.clave32;
            scoreNote.clave23 = originalNote.clave23;
        }

        console.log('修复后的第一个音符:', rm.scoreNotes[0]);
    }


    // 添加这行：初始化星星特效系统
    StarEffects.init();

    // 初始化 Sweep
    SweepMode = SweepMode.init({
        nowMs: () => rm._t(),
        rectProvider: () => RECT.sweep,
        speedMultiplier: 1,
        getFeedback: () => rm.feedbackStates,
        glyph: (ab) => glyphForAbbr(ab)
    });
    SweepMode.setNotes(rm.scoreNotes, rm.totalDuration);
    SweepMode.setBeatMs(rm.noteInterval);
    SweepMode.setStartGap(COUNTDOWN_MS || 0);
    SweepMode.snapToLeft();
    //更改打击颜色
    SweepMode?.setHitColor('rgba(255,180,0,0.35)', 2);
    SweepMode?.setHitGlow('rgba(255,210,80,0.90)', 14); // Sweep 发光
    _lastCycleForSnap = SweepMode.getCurrentCycle();

    // 初始化节拍器
    metro.onloaded(() => { console.log("Metronome loaded!"); metro.reset(); });

    // 初始化节奏选择器
    RhythmSelector.init();

    // 初始化麦克风 & 分析器
    mic = new p5.AudioIn();
    mic.start();

    //初始化FFT面板
    fftHUD = FFTPanel.init({
        mic,
        rectProvider: () => RECT.fft,
        bins: 1024,
        smoothing: 0.85,
        vscale: 2,
        lift: 5
    });

    ampHUD = AmpPanel.init({
        mic,
        rectProvider: () => RECT.amp,   // 你放 Amplitude 的矩形
        smoothing: 0.7,
        vscale: 5.0,
        historySec: 2.5,
        fastResponse: true     // 启用快速响应模式
    });
    //ampHUD.setInstantAdapt(true);

    //初始化Conga打击检测器
    drumTrigger = DrumTrigger.init({
        mic,
        debug: true,
        onTrigger: (reason) => {
            //检测到鼓击时，执行和鼠标点击相同的操作
            if (running) {
                const hitTime = rm._t();
                rm.registerHit();
                SweepMode?.addHitNow?.();
                HitMarkers.addHitMarker(hitTime);  // 添加打击标记
                judgeLineGlow = 1;
                if (debugMode) {
                    console.log(`Drum hit triggered by: ${reason}`);
                }
            }
        }
    });
    // 默认启用鼓击检测，设置中等灵敏度
    drumTrigger.enable(true);
    drumTrigger.setSensitivity(0.6);

    // 初始化设置面板并确保按钮出现在正确位置
    settingsPanel = SettingsPanel.init();

    // 将设置按钮移动到正确位置（速度控制后面）
    const settingsBtn = document.getElementById('settings-btn');
    const placeholder = document.getElementById('settings-placeholder');
    if (settingsBtn && placeholder) {
        // 替换占位符
        placeholder.parentNode.replaceChild(settingsBtn, placeholder);
    }

    window.statusTracker = {
        successfulHits: 0,
        recentResults: [],
        maxRecentResults: 10,
        currentInputLevel: 0,
        lastUpdateTime: 0
    };

    // 页面加载即尽力启动麦克风；若被策略拒绝，将在用户任何一次交互后自动重试
    tryStartMicEarly();

    //原有节拍器
    select('#metro-toggle').mousePressed(() => {
        metronomeEnabled = !metronomeEnabled;
        updateMetroBtnUI(); // ← 每次切换后更新颜色

        if (metronomeEnabled) {
            metro.enable(true);
            if (running) { resetMetronomeSchedulerState(); armNextTickNow(); }
        } else {
            metro.enable(false);
            stopScoreTickScheduler();
        }
    });
    select('#metro-toggle').html('Metronome');
    updateMetroBtnUI();
    metro.enable(false);

    // 速度/BPM - 确保滑块功能正常
    let initSpeed = parseFloat(select('#speed-slider').value());
    select('#speed-val').html(initSpeed.toFixed(2));
    const initBpm = speedToBPM(initSpeed);
    select('#bpm-val').html(Math.round(initBpm));
    rm.setBPM(initBpm);
    rm.setSpeedFactor(initSpeed);
    rm.noteY = 50;

    select('#start-btn').mousePressed(handleStart);
    select('#pause-btn').mousePressed(handlePause);
    select('#reset-btn').mousePressed(handleReset);
    select('#export-btn').mousePressed(handleExport);

    // 主界面速度滑块事件处理 - 不进行样式修改以保证功能正常
    select('#speed-slider').input(() => {
        const speedVal = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(speedVal.toFixed(2));
        const bpmVal = speedToBPM(speedVal);
        select('#bpm-val').html(Math.round(bpmVal));

        // 更新节拍器BPM
        metro.setBPM(bpmVal);
        rm.setBPM(bpmVal);
        rm.setSpeedFactor(speedVal);

        // 同步其他组件
        SweepMode?.setSpeedMultiplier?.(1);

        // 如果正在运行且节拍器启用，更新调度器
        if (metronomeEnabled && running && metro.isLoaded()) {
            metro.flushFuture();
            resetMetronomeSchedulerState();
            armNextTickNow();
            schedulerState.guardUntil = metro.ctx.currentTime + 0.02;
        }
        // 重置能量统计
        _emaE = 0, _emaVar = 1;
    });
}

async function tryStartMicEarly() {
    try {
        // 有些浏览器允许无手势 resume；允许的话就先试一下
        if (typeof getAudioContext === 'function' && getAudioContext().state !== 'running') {
            await getAudioContext().resume().catch(() => { });
        }
    } catch (_) { }

    try {
        if (!mic) mic = new p5.AudioIn();
        await mic.start();               // 触发权限弹窗；允许后即可就绪
        micReady = true;
        if (ampHUD?.preferAmplitude) {
            // 延迟一小会儿再启用，规避某些浏览器刚接通前几帧的空输入
            setTimeout(() => ampHUD.preferAmplitude(true), 70);
        }
    } catch (e) {
        // 需要用户手势/被拒：挂一次性监听，任意点击/按键后重试
        const retry = async () => {
            try { if (getAudioContext().state !== 'running') await getAudioContext().resume().catch(() => { }); } catch (_) { }
            try { if (!mic) mic = new p5.AudioIn(); await mic.start(); micReady = true; } catch (_) { }
        };
        window.addEventListener('pointerdown', retry, { once: true });
        window.addEventListener('touchstart', retry, { once: true, passive: true });
        window.addEventListener('keydown', retry, { once: true });
    }
}

/* ------------ Control Functions ------------- */
async function handleStart() {
    if (running || counting) return;
    await window.userStartAudio?.();
    try { if (!window.mic) window.mic = new p5.AudioIn(); await mic.start(); } catch (e) { console.warn("Mic start failed:", e); }

    if (isPaused) {
        const pauseMs = (rm.pauseAt - rm.startTime) % rm.totalDuration;
        const notes = rm.scoreNotes;
        for (let i = 0; i < notes.length; i++) {
            if (notes[i].time >= pauseMs) { schedulerState.lastIdx = i - 1; break; }
        }
        startCountdown({ resume: true });
        return;
    }

    startCountdown({ resume: false });
    metro.reset();
    metro.useInternalGrid = false;
    resetMetronomeSchedulerState();
    startScoreTickScheduler();
}

function handlePause() {
    if (!running && !counting) return;
    isPaused = true; running = false;

    const currentMs = rm._t() % rm.totalDuration;
    rm.pauseAt = rm.startTime + currentMs;

    counting = false;
    rm.pause();
    stopScoreTickScheduler();
    if (metro?.isLoaded) metro.flushFuture();
}

function handleReset() {
    running = false; counting = false; isPaused = false;
    rm.reset(); rm.pause(); rm.pauseAt = rm.startTime;

    stopScoreTickScheduler();
    resetMetronomeSchedulerState();
    metro.reset();

    try { if (mic && mic.start) mic.start(); } catch (e) { console.warn(e); }

    SweepMode.clearHits();
    SweepMode.setStartGap(COUNTDOWN_MS || 0);
    SweepMode.snapToLeft();

    StarEffects.clear();
    HitMarkers.clearAllMarkers();  // 清除所有打击标记
    resetStatusTracker();
}

function handleExport() {
    if (SWEEP_EXPORT_QUEUE.length === 0) {
        const r0 = RECT.sweep;
        const curImg = get(r0.x, r0.y, r0.w, r0.h);
        SWEEP_EXPORT_QUEUE.push(curImg);
    }
    const r = RECT.sweep;
    const n = SWEEP_EXPORT_QUEUE.length;
    const totalH = r.h * n;

    const g = createGraphics(r.w, totalH);
    g.clear();
    for (let i = 0; i < n; i++) g.image(SWEEP_EXPORT_QUEUE[i], 0, i * r.h);

    const ts = new Date();
    const name =
        `stack_${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}_` +
        `${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
    saveCanvas(g, name, 'png');
}

function startCountdown(opts = {}) {
    const resume = !!opts.resume;
    countdownForResume = resume;
    hasEverStarted = true;

    if (rm.startTime === null) rm.reset();
    rm.pause();
    running = false;
    counting = true;
    ctStart = millis();

    if (!resume) {
        SweepMode.setStartGap(COUNTDOWN_MS);
        SweepMode.snapToLeft();
    }
}

/* ------------ Draw Loop ----------- */
let frameTimeBuffer = [];
let lastOptimizeCheck = 0;
let performanceMode = 'normal'; // 'normal' | 'performance'
function draw() {
    // Sweep 导出队列
    if (window.SweepMode?.getCurrentCycle) {
        const cur = SweepMode.getCurrentCycle();
        if (_lastCycleForSnap == null) {
            _lastCycleForSnap = cur;
        } else if (cur !== _lastCycleForSnap) {
            const r = RECT.sweep;
            const panelImg = get(r.x, r.y, r.w, r.h);
            SWEEP_EXPORT_QUEUE.push(panelImg);
            if (SWEEP_EXPORT_QUEUE.length > SWEEP_EXPORT_MAX) SWEEP_EXPORT_QUEUE.shift();
            _lastCycleForSnap = cur;
        }
    }

    const frameStart = performance.now();
    background('#3a3a3a');
    judgeLineGlow *= 0.9; if (judgeLineGlow < 0.01) judgeLineGlow = 0;
    // 根据性能模式调整绘制
    if (performanceMode === 'performance') {
        // 性能模式：跳帧绘制网格
        if (frameCount % 2 === 0) drawGrid();
    } else {
        drawGrid();
    }

    // 判定竖线（到 Sweep 顶部）
    let glowLevel = lerp(2, 18, judgeLineGlow);
    let alpha = lerp(120, 255, judgeLineGlow);
    drawingContext.save();
    drawingContext.shadowBlur = glowLevel;
    drawingContext.shadowColor = 'rgba(165, 99, 212, 0.8)';
    stroke(255, 0, 0, alpha);
    strokeWeight(judgeLineGlow > 0.2 ? 4 : 1.5);
    const splitY = RECT.sweep.y - GRID.pad;
    line(rm.judgeLineX, 0, rm.judgeLineX, splitY - 1);
    drawingContext.restore();

    // 倒计时
    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) {
            counting = false; running = true; isPaused = false;
            rm.resume();
            if (metronomeEnabled) {
                metro.enable(true);
                if (!countdownForResume) resetMetronomeSchedulerState();
                armNextTickNow();
            }
            startScoreTickScheduler();
        } else {
            drawCountdown(remain);
        }
    }

    if (running) {
        rm.checkAutoMiss();
        rm.checkLoopAndRestart();
    }
    //更新鼓击检测器
    drumTrigger?.update?.();
    // 绘制音符与反馈
    NoteIlluminateFeedback.render();

    // 绘制打击标记
    HitMarkers.render();

    //更新和绘制星星特效
    StarEffects.update(deltaTime || 16.67);
    StarEffects.render();

    // Sweep
    SweepMode.render(drawingContext, RECT.sweep.x, RECT.sweep.y, RECT.sweep.w, RECT.sweep.h);

    if (performanceMode === 'performance') {
        // 性能模式：降低HUD更新频率
        if (frameCount % 2 === 0) {
            fftHUD?.render?.(drawingContext, RECT.fft.x, RECT.fft.y, RECT.fft.w, RECT.fft.h);
            ampHUD?.render?.(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
        }
    } else {
        fftHUD?.render?.(drawingContext, RECT.fft.x, RECT.fft.y, RECT.fft.w, RECT.fft.h);
        ampHUD?.render?.(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
    }

    // 左侧：FFT 频谱
    fftHUD?.render?.(drawingContext, RECT.fft.x, RECT.fft.y, RECT.fft.w, RECT.fft.h);
    //中间：AMP面板
    ampHUD?.render?.(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);

    //debug面板
    if (debugMode && drumTrigger) {
        const debugW = 200, debugH = 120;
        const debugX = width - debugW - 10;
        const debugY = 10;
        drumTrigger.renderDebugPanel?.(drawingContext, debugX, debugY, debugW, debugH);
    }

    // 分隔线（仅水平两条，去掉中间竖线）
    push();
    stroke(220); strokeWeight(2);
    const yTopDiv = Math.round(RECT.sweep.y - GRID.pad) + 0.5;                    // Notes → Sweep
    const yBelowSweep = Math.round(RECT.sweep.y + RECT.sweep.h + GRID.pad) + 0.5; // Sweep → 下方 HUD
    line(0, yTopDiv, width, yTopDiv);
    line(0, yBelowSweep, width, yBelowSweep);

    //最下面界面分为左右部分
    stroke(220); strokeWeight(2);
    const midX = Math.round(width / 2) + 0.5;
    line(midX, yBelowSweep, midX, height - GRID.pad);

    //右边部分再分左右
    stroke(200); strokeWeight(1.5);
    const midXRight = Math.round(RECT.rightHalf.x + RECT.rightHalf.w / 2) + 0.5;
    line(midXRight, RECT.rightHalf.y, RECT.rightHalf.x + RECT.rightHalf.w, RECT.rightHalf.y); // 顶边短刻度(可选)
    line(midXRight, RECT.rightHalf.y, midXRight, RECT.rightHalf.y + RECT.rightHalf.h);
    pop();
    // 绘制右下角状态
    drawPerformanceStatus();

    //性能监控
    const frameTime = performance.now() - frameStart;
    frameTimeBuffer.push(frameTime);
    if (frameTimeBuffer.length > 10) frameTimeBuffer.shift();

    // 每2秒检查一次性能
    if (millis() - lastOptimizeCheck > 2000) {
        const avgFrameTime = frameTimeBuffer.reduce((a, b) => a + b, 0) / frameTimeBuffer.length;
        const targetFrameTime = 1000 / (isMobile() ? 30 : 45);

        if (avgFrameTime > targetFrameTime * 1.2 && performanceMode === 'normal') {
            // 性能不足，切换到性能模式
            performanceMode = 'performance';
            console.log('Switching to performance mode');
        } else if (avgFrameTime < targetFrameTime * 0.8 && performanceMode === 'performance') {
            // 性能充足，切换回普通模式
            performanceMode = 'normal';
            console.log('Switching to normal mode');
        }

        lastOptimizeCheck = millis();
    }
}

// 状态跟踪函数
function updateStatusTracker(result) {
    if (!window.statusTracker) return;

    window.statusTracker.totalHits++;

    if (result === 'Perfect' || result === 'Good') {
        window.statusTracker.successfulHits++;
    }

    window.statusTracker.recentResults.push(result);
    if (window.statusTracker.recentResults.length > window.statusTracker.maxRecentResults) {
        window.statusTracker.recentResults.shift();
    }

    window.statusTracker.lastUpdateTime = millis();
}

// 重置状态跟踪器
function resetStatusTracker() {
    if (!window.statusTracker) return;
    window.statusTracker.successfulHits = 0;
    window.statusTracker.recentResults = [];
    window.statusTracker.currentInputLevel = 0;
}

// 获取当前同步质量
function getCurrentSyncQuality() {
    const SYNC_QUALITY = {
        EXCELLENT: { label: 'Excellent', color: '#00ff88' },
        GOOD: { label: 'Good', color: '#88ff00' },
        FAIR: { label: 'Fair', color: '#ffaa00' },
        POOR: { label: 'Poor', color: '#ff4444' }
    };

    if (!window.statusTracker || window.statusTracker.recentResults.length < 3) {
        return SYNC_QUALITY.FAIR;
    }

    const recent = window.statusTracker.recentResults.slice(-8);
    const perfectCount = recent.filter(r => r === 'Perfect').length;
    const goodCount = recent.filter(r => r === 'Good').length;
    const successRate = (perfectCount + goodCount) / recent.length;
    const perfectRate = perfectCount / recent.length;

    if (perfectRate >= 0.6) {
        return SYNC_QUALITY.EXCELLENT;
    } else if (successRate >= 0.7) {
        return SYNC_QUALITY.GOOD;
    } else if (successRate >= 0.4) {
        return SYNC_QUALITY.FAIR;
    } else {
        return SYNC_QUALITY.POOR;
    }
}

// 绘制右下角性能状态
function drawPerformanceStatus() {
    if (!window.statusTracker) return;
    push();

    // 位置：顶区底部右右，给一整行空间
    const baseY = RECT.top.h - 25;
    const baseX = width - 350;   // 往左留出宽度，避免被挤出

    // 计算数据
    const totalNotes = rm.scoreNotes ? rm.scoreNotes.length : 0;
    const hitRate = `${window.statusTracker.successfulHits}/${totalNotes}`;
    const percentage = totalNotes > 0 ? Math.round((window.statusTracker.successfulHits / totalNotes) * 100) : 0;

    // 命中率颜色（保持原来的分档）
    let rateColor = '#ff4444';
    if (percentage >= 80) rateColor = '#00ff88';
    else if (percentage >= 60) rateColor = '#88ff00';
    else if (percentage >= 40) rateColor = '#ffaa00';

    const quality = getCurrentSyncQuality(); // {label, color}

    // 文本样式：粗体、左对齐、单行
    textSize(16);
    textStyle(BOLD);
    textAlign(LEFT, TOP);
    noStroke();

    // 逐段绘制，颜色保持不变
    let x = baseX, y = baseY;

    // Hit Rate: xx/yy (zz%)
    fill(208, 209, 210); text('Hit Rate:', x, y); x += textWidth('Hit Rate: ') + 4;
    fill(255); text(hitRate, x, y); x += textWidth(hitRate + ' ');
    fill(rateColor); text(`(${percentage}%)`, x, y); x += textWidth(`(${percentage}%)`);

    // 分隔符
    fill(200); text('  |  ', x, y); x += textWidth('  |  ');

    // In Sync: Quality
    fill(208, 209, 210); text('In Sync:', x, y); x += textWidth('In Sync: ') + 4;
    fill(quality.color); text(quality.label, x, y);

    pop();
}

/* ------------ Visualization ----------- */
function drawCountdown(remain) {
    const n = Math.ceil(remain / 1000);
    const alpha = map(remain % 1000, 999, 0, 255, 0);
    textSize(80);
    fill(255, 87, 34, alpha);
    textAlign(CENTER, CENTER);
    const cy = RECT.top.y + RECT.top.h / 2;
    text(n, width / 2, cy);
}

function drawGrid() {
    stroke(255, 255, 255, 60);
    strokeWeight(1);
    const yTop = laneTopY();
    const yBot = laneBottomY();
    line(0, yTop, width, yTop);
    line(0, yBot, width, yBot);
}

//按下字母'm'用于切换AMP或者RMS
function keyPressed() {
    if (key === 'm' && ampHUD?.preferAmplitude) {
        // 切换
        if (ampHUD._preferAmp) {
            ampHUD.preferAmplitude(false);   // 切回 RMS
        } else {
            ampHUD.preferAmplitude(true);    // 切到 AMP
        }
    }

    if (key === 'f' && ampHUD?.setFastResponse) {
        const current = ampHUD._fastResponse;
        ampHUD.setFastResponse(!current);
        const mode = !current ? 'FAST (0.0/0.9 smooth)' : 'SMOOTH (0.85/0.15 smooth)';
        console.log(`Audio response mode: ${mode}`);
    }

    // 鼓击检测
    if (key === 'd') {
        // 切换调试模式
        debugMode = !debugMode;
        drumTrigger?.setDebug?.(debugMode);
        console.log(`Debug mode: ${debugMode ? 'ON' : 'OFF'}`);
    }
    if (key === 't' && drumTrigger) {
        // 切换鼓击检测开关
        const isEnabled = !drumTrigger._isEnabled;
        drumTrigger.enable(isEnabled);
        console.log(`Drum trigger: ${isEnabled ? 'ON' : 'OFF'}`);
    }
    // 调节灵敏度 (1-5)
    if (key >= '1' && key <= '5' && drumTrigger) {
        const level = parseInt(key);
        const sensitivity = Math.pow(level / 5.0, 0.5); // 0.2, 0.4, 0.6, 0.8, 1.0
        drumTrigger.setSensitivity(sensitivity);
        console.log(`Drum sensitivity: ${level}/5 (${sensitivity.toFixed(1)})`);
    }

    // 重置统计
    if (key === 'r' && drumTrigger) {
        drumTrigger.resetStats();
        console.log('Drum trigger stats reset');
    }
    // 显示当前状态
    if (key === 'i' && drumTrigger) {
        const stats = drumTrigger.getStats();
        console.log('Drum Trigger Stats:', stats);
    }

    // Amplitude 面板缩放模式切换
    if (key === 'a' && ampHUD) {
        // 切换动态缩放开关
        const status = ampHUD.getStatus();
        ampHUD.setDynamicScale(!status.dynamicScale);
        const newStatus = ampHUD.getStatus();
        console.log(`Amplitude scaling: ${newStatus.currentMode} mode`);
    }
    if (key === 's' && ampHUD) {
        // 切换瞬间适应模式（仅在动态缩放开启时有效）
        const status = ampHUD.getStatus();
        if (status.dynamicScale) {
            ampHUD.setInstantAdapt(!status.instantAdapt);
            const newStatus = ampHUD.getStatus();
            console.log(`Amplitude scaling: ${newStatus.currentMode} mode`);
        } else {
            console.log('Dynamic scaling is OFF - enable with "a" key first');
        }
    }

}

//节拍器按钮开启时变成绿色
function updateMetroBtnUI() {
    const btn = select('#metro-toggle');
    const arrowBtn = select('#rhythm-arrow');
    if (!btn) return;

    const bgColor = metronomeEnabled ? '#22c55e' : '#444';
    const textColor = metronomeEnabled ? '#0b1a0b' : '#eee';
    const borderColor = metronomeEnabled ? '#16a34a' : '#555';

    btn.style('background', bgColor);
    btn.style('color', textColor);
    btn.style('border', `1px solid ${borderColor}`);

    // 同步箭头按钮样式
    if (arrowBtn) {
        arrowBtn.style('background', bgColor);
        arrowBtn.style('color', textColor);
        arrowBtn.style('border', `1px solid ${borderColor}`);
        arrowBtn.style('border-left', 'none');
    }
}

/* ------------ Interaction ----------- */
function mousePressed() {
    //鼠标点击仅在调试模式下工作，主要用于测试
    if (running && debugMode) {
        const hitTime = rm._t();
        rm.registerHit();
        SweepMode?.addHitNow?.();
        HitMarkers.addHitMarker(hitTime);  // 添加打击标记
        judgeLineGlow = 1;
        console.log('Manual hit (debug mode)');
    }
}