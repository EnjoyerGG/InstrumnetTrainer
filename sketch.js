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

let rm, metro, mic, guides;
let running = false, counting = false;
let ctStart = 0;
let judgeLineGlow = 0;
let metronomeEnabled = false;
let chartJSON;
let hasEverStarted = false;
let isPaused = false;
let countdownForResume = false;

const COUNTDOWN_MS = 3000;
const SWEEP_H = 140;

const BPM_MIN = 60, BPM_MAX = 240;
const SPEED_MIN = 0.10, SPEED_MAX = 0.40;

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

const NOTE_GLYPH = {
    S: '×',
    O: 'O',
    T: '▲',
    P: '▼',
    B: 'B'
};

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

    // start index
    let idx = schedulerState.lastIdx >= 0
        ? (schedulerState.lastIdx + 1) % notes.length
        : notes.findIndex(n => n.time >= nowMs) || 0;

    let count = 0;
    while (count < notes.length) {
        const n = notes[idx];
        let dt = n.time - nowMs;
        if (dt < 0) dt += rm.totalDuration;
        if (dt > aheadMs) break;

        const sf = rm?.speedFactor || 1;
        const when = ctxNow + Math.max(0, (dt + getMetroOffsetMs()) / (1000 * sf));
        const strong = ((n.accent | 0) === 1);

        const lastWhen = schedulerState.scheduledNotes.get(idx) ?? -Infinity;
        const recentlyScheduled = Math.abs(when - lastWhen) < 0.04;
        const guarded = schedulerState.guardUntil && when <= schedulerState.guardUntil;

        if (!recentlyScheduled && !guarded) {
            metro.scheduleAt(when, strong);
            schedulerState.scheduledNotes.set(idx, when);
        }
        schedulerState.lastIdx = idx;
        idx = (idx + 1) % notes.length;
        count++;
    }
    schedulerState.forceWindowMs = null;
}

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
    chartJSON = loadJSON('assets/tumbao.json');
    metro = new Metronome({ bpm: 120, beatsPerBar: 4 });
    metro.preload('assets/metronome/Tic.wav', 'assets/metronome/Toc.wav');
}

/* ------------ Helpers ------------- */
function speedToBPM(speed) { return BPM_MIN + (BPM_MAX - BPM_MIN) * (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN); }
function bpmToSpeed(bpm) { return SPEED_MIN + (bpm - BPM_MIN) * (SPEED_MAX - SPEED_MIN) / (BPM_MAX - BPM_MIN); }
function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }

const GRID = { pad: 10, topHRatio: 0.5 };
const RECT = { top: {}, amp: {}, drum: {}, sweep: {} };
let _canvasHost;

function layoutRects(cnv) {
    const topH = Number.isFinite(GRID.topHpx) ? GRID.topHpx : Math.round(height * GRID.topHRatio);

    // 布局顺序：Notes -> Sweep -> 底部HUD（分贝仪+鼓面）
    const sweepY = topH + GRID.pad;
    const sweepH = SWEEP_H;

    // HUD在Sweep下面
    const hudY = sweepY + sweepH + GRID.pad;
    const hudH = Math.max(160, height - hudY - GRID.pad);

    // 左右两栏宽度分配
    const midX = Math.round(width * 0.5);

    RECT.top = { x: 0, y: 0, w: width, h: topH };
    RECT.sweep = { x: GRID.pad, y: sweepY, w: width - GRID.pad * 2, h: sweepH };

    // 左侧：分贝仪/波形
    RECT.amp = {
        x: GRID.pad,
        y: hudY,
        w: midX - GRID.pad * 2,
        h: hudH
    };

    // 右侧：鼓面
    RECT.drum = {
        x: midX + GRID.pad,
        y: hudY,
        w: width - midX - GRID.pad * 2,
        h: hudH
    };

    // 更新DOM元素位置
    const hostRect = _canvasHost.elt.getBoundingClientRect();
    const cvsRect = cnv.elt ? cnv.elt.getBoundingClientRect() : { left: hostRect.left, top: hostRect.top };
    const offX = cvsRect.left - hostRect.left;
    const offY = cvsRect.top - hostRect.top;

    // 定位鼓面容器
    const drumWrap = document.getElementById('drum-wrap');
    if (drumWrap) {
        const size = Math.floor(Math.min(RECT.drum.w, RECT.drum.h) * 0.8);
        drumWrap.style.position = 'absolute';
        drumWrap.style.left = (RECT.drum.x + offX + (RECT.drum.w - size) / 2) + 'px';
        drumWrap.style.top = (RECT.drum.y + offY + (RECT.drum.h - size) / 2) + 'px';
        drumWrap.style.width = size + 'px';
        drumWrap.style.height = size + 'px';
        drumWrap.style.zIndex = '10';
    }

    // 定位左侧音频分析容器
    const ampHud = document.getElementById('amp-hud');
    if (ampHud) {
        ampHud.style.position = 'absolute';
        ampHud.style.left = (RECT.amp.x + offX) + 'px';
        ampHud.style.top = (RECT.amp.y + offY) + 'px';
        ampHud.style.width = RECT.amp.w + 'px';
        ampHud.style.height = RECT.amp.h + 'px';
        ampHud.style.zIndex = '10';
    }

    // 更新SampleUI尺寸
    if (window.SampleUI && SampleUI._canvas) {
        const d = window.devicePixelRatio || 1;
        SampleUI._canvas.width = Math.round(RECT.amp.w * d);
        SampleUI._canvas.height = Math.round(RECT.amp.h * d);
        SampleUI._canvas.style.width = RECT.amp.w + 'px';
        SampleUI._canvas.style.height = RECT.amp.h + 'px';

        if (SampleUI._grid) {
            SampleUI._grid.width = Math.round(RECT.amp.w * d);
            SampleUI._grid.height = Math.round(RECT.amp.h * d);
        }

        // 更新面板尺寸
        const midX = Math.floor(RECT.amp.w / 2);
        SampleUI._leftPanel = { x: 0, y: 0, w: midX - 1, h: RECT.amp.h };
        SampleUI._rightPanel = { x: midX + 1, y: 0, w: RECT.amp.w - midX - 1, h: RECT.amp.h };

        SampleUI._drawGrid?.();
    }
}

/* ------------ Setup --------------- */
function setup() {
    if (isMobile()) {
        pixelDensity(1);
        frameRate(45);
    } else {
        frameRate(60);
    }

    const NOTES_H = 120;
    const METER_H = 200; // 增加底部HUD高度
    const totalHeight = NOTES_H + SWEEP_H + METER_H + GRID.pad * 3;

    const cnv = createCanvas(1000, totalHeight);
    cnv.parent('score-wrap');
    GRID.topHpx = NOTES_H;

    _canvasHost = select('#score-wrap');
    _canvasHost.elt.style.position = 'relative';

    // 创建容器
    let ampHud = document.getElementById('amp-hud');
    if (!ampHud) {
        ampHud = document.createElement('div');
        ampHud.id = 'amp-hud';
        ampHud.style.position = 'absolute';
        ampHud.style.background = 'rgba(30, 30, 35, 0.95)';
        ampHud.style.borderRadius = '12px';
        ampHud.style.border = '1px solid #555';
        ampHud.style.overflow = 'hidden';
        _canvasHost.elt.appendChild(ampHud);
    }

    let drumWrap = document.getElementById('drum-wrap');
    if (!drumWrap) {
        drumWrap = document.createElement('div');
        drumWrap.id = 'drum-wrap';
        drumWrap.style.position = 'absolute';
        drumWrap.style.background = 'rgba(30, 30, 35, 0.95)';
        drumWrap.style.borderRadius = '50%';
        drumWrap.style.border = '1px solid #555';
        drumWrap.style.overflow = 'hidden';
        _canvasHost.elt.appendChild(drumWrap);
    }

    // 首次布局
    layoutRects(cnv);

    // 响应式布局
    window.addEventListener('resize', () => {
        layoutRects(cnv);
    });

    // 初始化节奏管理器
    rm = new RhythmManager();
    rm.initChart(chartJSON.conga);
    rm.noteY = 50;

    guides = AmpGuides.init({
        getNowMs: () => rm._t(),
        getRect: () => RECT.amp
    });
    guides.setNotes(rm.scoreNotes, rm.totalDuration);

    // 初始化Sweep
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
    _lastCycleForSnap = SweepMode.getCurrentCycle();

    // 初始化节拍器
    metro.onloaded(() => {
        console.log("Metronome loaded!");
        metro.reset();
    });

    // 初始化麦克风
    mic = new p5.AudioIn();
    mic.start();

    // 初始化音频分析器 - 确保正确连接麦克风
    if (window.SampleUI && !window.__samplerInit) {
        // 延迟初始化以确保DOM就绪
        setTimeout(() => {
            SampleUI.init({
                mount: '#amp-hud',
                width: RECT.amp.w,
                height: RECT.amp.h,
                dbMin: 30,
                dbMax: 90,
                fftSize: 512
            });

            if (mic && mic.stream) {
                SampleUI.setupAudio({
                    offsetDb: 0,
                    useP5Mic: true  // 使用已有麦克风
                });
            } else {
                SampleUI.setupAudio({ offsetDb: 0 });
            }

            SampleUI.pause();
        }, 200);

        window.__samplerInit = true;
    }
    setTimeout(() => {
        if (window.DrumCanvas && !window.DrumCanvas._ctx) {
            const drumSize = Math.min(RECT.drum.w, RECT.drum.h) * 0.8;
            DrumCanvas.init({
                mount: '#drum-wrap',
                size: drumSize,
                background: '#2f3036'
            });
        }
    }, 150);



    // 交互控件
    select('#sens-slider').input(() => { ENERGY_Z = parseFloat(select('#sens-slider').value()); });

    select('#metro-toggle').mousePressed(() => {
        metronomeEnabled = !metronomeEnabled;
        select('#metro-toggle').html(metronomeEnabled ? 'Metronome Off' : 'Metronome On');
        if (metronomeEnabled) {
            metro.enable(true);
            if (running) { resetMetronomeSchedulerState(); armNextTickNow(); }
        } else {
            metro.enable(false);
            stopScoreTickScheduler();
        }
    });
    select('#metro-toggle').html('Metronome On');
    metro.enable(false);

    // 速度/BPM
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

    // 速度滑块
    select('#speed-slider').input(() => {
        const speedVal = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(speedVal.toFixed(2));
        const bpmVal = speedToBPM(speedVal);
        select('#bpm-val').html(Math.round(bpmVal));

        metro.setBPM(bpmVal);
        rm.setBPM(bpmVal);
        rm.setSpeedFactor(speedVal);

        guides.syncFixed?.();
        SweepMode.setSpeedMultiplier(1);

        if (metronomeEnabled && running && metro.isLoaded()) {
            metro.flushFuture();                 // 清掉旧 BPM 预排
            resetMetronomeSchedulerState();      // 清状态
            armNextTickNow();                    // 锁定下一记
            schedulerState.guardUntil = metro.ctx.currentTime + 0.02; // 保护 20ms 防重复
        }
        _emaE = 0; _emaVar = 1;
    });

    select('#totals').html(`Notes ${rm.scoreNotes.length}`);
}

/* ------------ Control Functions ------------- */
async function handleStart() {
    if (running || counting) return;

    await window.userStartAudio?.();

    try {
        await mic.start();
        console.log("Microphone started");
    } catch (e) {
        console.warn("Mic start failed:", e);
    }

    // 确保SampleUI恢复
    if (window.SampleUI) {
        SampleUI.resume();
        console.log("SampleUI resumed");
    }

    if (isPaused) {
        const pauseMs = (rm.pauseAt - rm.startTime) % rm.totalDuration;
        const notes = rm.scoreNotes;
        for (let i = 0; i < notes.length; i++) {
            if (notes[i].time >= pauseMs) {
                schedulerState.lastIdx = i - 1;
                break;
            }
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

    // 保存当前播放位置
    const currentMs = rm._t() % rm.totalDuration;
    rm.pauseAt = rm.startTime + currentMs;

    if (window.SampleUI) SampleUI.pause();
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

    if (window.SampleUI) { SampleUI.reset(); SampleUI.pause(); }

    guides?.setStartGap(COUNTDOWN_MS);
    guides?.clearHits?.();
    SweepMode.clearHits();
    SweepMode.setStartGap(COUNTDOWN_MS || 0);
    SweepMode.snapToLeft();
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
        guides?.setStartGap(COUNTDOWN_MS);
        SweepMode.setStartGap(COUNTDOWN_MS);
        SweepMode.snapToLeft();
    }
}

/* ------------ Draw Loop ----------- */
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

    background('#3a3a3a');
    judgeLineGlow *= 0.9; if (judgeLineGlow < 0.01) judgeLineGlow = 0;
    drawGrid();

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

    // 倒计时
    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) {
            counting = false; running = true; isPaused = false;
            rm.resume();
            if (window.SampleUI) SampleUI.resume();
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
        flashDrumWhenNoteAtLine();
    }

    if (window.DrumCanvas && DrumCanvas.update) {
        DrumCanvas.update();
    }

    drawNotesAndFeedback();
    flashDrumWhenNoteAtLine();

    // 统计
    const { hit, miss } = rm.getStats();
    const info = `Notes ${rm.scoreNotes.length} | Hits ${hit} | Miss ${miss}`;
    noStroke(); fill(240); textSize(16); textAlign(RIGHT, BOTTOM);
    text(info, width - 12, laneBottomY() + 40);

    // 左侧电平/频谱更新
    if (window.SampleUI) SampleUI.update();

    // Sweep
    SweepMode.render(drawingContext, RECT.sweep.x, RECT.sweep.y, RECT.sweep.w, RECT.sweep.h);

    // 分隔线
    push();
    stroke(220); strokeWeight(2);
    const yTopDiv = Math.round(RECT.sweep.y - GRID.pad) + 0.5;                    // Notes ↔ Sweep
    const yBelowSweep = Math.round(RECT.sweep.y + RECT.sweep.h + GRID.pad) + 0.5; // Sweep ↔ 下方 HUD
    line(0, yTopDiv, width, yTopDiv);
    line(0, yBelowSweep, width, yBelowSweep);
    const xSep = Math.round(RECT.drum.x - GRID.pad) + 0.5;                         // 中栏左右分割
    line(xSep, yBelowSweep, xSep, height - GRID.pad);
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

function flashDrumWhenNoteAtLine() {
    if (!window.DrumCanvas || !DrumCanvas.trigger || !rm?.scoreNotes?.length) return;

    const notes = rm.getVisibleNotes ? rm.getVisibleNotes() : rm.scoreNotes;
    const thr = 8; // 增加阈值范围

    for (const n of notes) {
        const x = rm.getScrollX(n._displayTime ?? n.time);
        if (Math.abs(x - rm.judgeLineX) <= thr) {
            const abRaw = n.abbr || n.type?.[0] || 'O';
            const AB = abRaw.toString().toUpperCase();
            const key = (AB === 'O' || AB === 'S') ? 'O' :
                (AB === 'T') ? 'T' :
                    (AB === 'P' || AB === 'B') ? 'P' : 'O';

            // 确保trigger函数被正确调用
            if (typeof DrumCanvas.trigger === 'function') {
                DrumCanvas.trigger(key, 300); // 增加持续时间
            }
            break;
        }
    }
}

function drawNotesAndFeedback() {
    const notes = rm.getVisibleNotes();
    drawingContext.shadowBlur = 6;
    drawingContext.shadowColor = '#888';

    for (const n of notes) {
        const xN = rm.getScrollX(n._displayTime ?? n.time);
        const y = isBottomDrum(n) ? laneBottomY() : laneTopY();
        fill(n.accent === 1 ? 'gold' : color(200, 180));
        noStroke();
        ellipse(xN, y, 20);

        fill('#eeeeee');
        textSize(12);
        textAlign(CENTER, TOP);
        textStyle(BOLD);
        text(glyphForAbbr(n.abbr), xN, y + 12);
        textStyle(NORMAL);

        if (n._isMainLoop && rm.feedbackStates[n._feedbackIdx]?.judged) {
            const state = rm.feedbackStates[n._feedbackIdx];
            if (state.fadeTimer > 0) state.fadeTimer -= deltaTime;
            const alpha = constrain(map(state.fadeTimer, 0, 2000, 0, 255), 0, 255);
            const col = state.result === "Perfect" ? color(174, 79, 214, alpha)
                : state.result === "Good" ? color(85, 187, 90, alpha)
                    : color(211, 47, 47, alpha);
            fill(col);
            textSize(14);
            textAlign(CENTER);
            text(state.result, xN, y - 30);

            if (state.result !== 'Miss') {
                const dt = state.hitTime - rm.scoreNotes[n._feedbackIdx].time;
                const R = 10;          // 仅用于视觉偏移
                const pxOffset = dt / GOOD_WINDOW * R;
                fill(0, alpha);
                ellipse(xN + pxOffset, y, 10);
            }
        }
    }
    drawingContext.shadowBlur = 0;
}

/* ------------ Interaction ----------- */
function mousePressed() {
    // 检查是否点击在音频分析区域
    if (RECT && RECT.amp) {
        if (mouseX >= RECT.amp.x && mouseX < RECT.amp.x + RECT.amp.w &&
            mouseY >= RECT.amp.y && mouseY < RECT.amp.y + RECT.amp.h) {
            if (guides && guides.addHitNow) {
                guides.addHitNow();
            }
            if (window.SampleUI && SampleUI.pushMarker) {
                SampleUI.pushMarker('#a64fd6', 900);
            }
        }
    }

    // 检查是否点击在鼓面区域
    if (RECT && RECT.drum) {
        if (mouseX >= RECT.drum.x && mouseX < RECT.drum.x + RECT.drum.w &&
            mouseY >= RECT.drum.y && mouseY < RECT.drum.y + RECT.drum.h) {
            if (window.DrumCanvas && typeof DrumCanvas.trigger === 'function') {
                DrumCanvas.trigger('EDGE', 400); // 点击外圈效果
            }
        }
    }

    // 通用击打处理
    if (running) {
        rm.registerHit();
        if (window.SweepMode && SweepMode.addHitNow) {
            SweepMode.addHitNow();
        }
        judgeLineGlow = 1;
    }
}
