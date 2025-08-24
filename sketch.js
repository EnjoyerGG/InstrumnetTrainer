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

let METRO_OFFSET_STEPS = 0;
function getMetroOffsetMs() { return (METRO_OFFSET_STEPS || 0) * (rm?.noteInterval || 0); }

// Export panel queue
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

function syncHudSpeedToNotes() {
    if (!rm || !window.SampleUI?.setPaperSpeedPxPerSec) return;
    const vNotesPxPerSec = (rm.scrollSpeed || 0.5) * (rm.speedFactor || 1) * 1000;
    SampleUI.setPaperSpeedPxPerSec(vNotesPxPerSec);
}

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

// Improved scheduler state management
const schedulerState = {
    lastIdx: -1,
    lastNowMs: null,
    scheduledNotes: new Map(),
    guardUntil: 0,
    forceWindowMs: null,
    worker: null
};

function _ensureSchedWorker() {
    if (schedulerState.worker) return schedulerState.worker;
    const workerCode = `
        let id=null, interval=25;
        onmessage = (e) => {
            const d=e.data||{};
            if(d.cmd==='start'){ 
                if(id) clearInterval(id); 
                id=setInterval(()=>postMessage('tick'), interval); 
            }
            else if(d.cmd==='stop'){ 
                if(id){ clearInterval(id); id=null; } 
            }
            else if(d.cmd==='interval'){ 
                interval=d.value|0; 
                if(id){ 
                    clearInterval(id); 
                    id=setInterval(()=>postMessage('tick'), interval); 
                } 
            }
        };
    `;
    const blob = new Blob([workerCode], { type: 'text/javascript' });
    schedulerState.worker = new Worker(URL.createObjectURL(blob));
    schedulerState.worker.onmessage = (e) => {
        if (e.data === 'tick') scheduleTicksOnce();
    };
    return schedulerState.worker;
}

function getAheadMs() {
    return Math.max(140, Math.min(320, rm.noteInterval * 0.75));
}

function startScoreTickScheduler() {
    stopScoreTickScheduler();
    const w = _ensureSchedWorker();
    w.postMessage({ cmd: 'interval', value: 25 });
    w.postMessage({ cmd: 'start' });
}

function stopScoreTickScheduler() {
    if (schedulerState.worker) {
        schedulerState.worker.postMessage({ cmd: 'stop' });
    }
}

function resetMetronomeSchedulerState() {
    schedulerState.lastIdx = -1;
    schedulerState.lastNowMs = null;
    schedulerState.scheduledNotes.clear();
    schedulerState.guardUntil = 0;
    schedulerState.forceWindowMs = null;
}

// Improved scheduler function
function scheduleTicksOnce() {
    if (!metronomeEnabled || !running || !metro || !metro.isLoaded()) return;

    const ctxNow = metro.ctx.currentTime;
    const nowMs = rm._t() % rm.totalDuration;
    const aheadMs = schedulerState.forceWindowMs || getAheadMs();

    // Detect loop restart
    if (schedulerState.lastNowMs != null && nowMs < schedulerState.lastNowMs - 5) {
        schedulerState.lastIdx = -1;
        schedulerState.scheduledNotes.clear();
        schedulerState.guardUntil = 0;
    }
    schedulerState.lastNowMs = nowMs;

    const notes = rm.scoreNotes;
    if (!notes || !notes.length) return;

    // Clean expired scheduled notes
    for (const [k, t] of schedulerState.scheduledNotes) {
        if (t < ctxNow - 1.5) schedulerState.scheduledNotes.delete(k);
    }

    // Find starting index
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

        // Check for duplicates and guard time
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

// Force schedule next beat
function armNextTickNow() {
    if (!metronomeEnabled || !metro || !metro.isLoaded() || !rm?.scoreNotes?.length) return;

    const notes = rm.scoreNotes;
    const nowMs = rm._t() % rm.totalDuration;

    let nextIdx = notes.findIndex(n => n.time >= nowMs);
    if (nextIdx < 0) nextIdx = 0;

    const dtNext = (notes[nextIdx].time - nowMs + rm.totalDuration) % rm.totalDuration;

    schedulerState.lastIdx = (nextIdx - 1 + notes.length) % notes.length;
    schedulerState.forceWindowMs = dtNext + 30;

    //scheduleTicksOnce();
    const prevIdx = schedulerState.lastIdx;
    scheduleTicksOnce();                         // 尝试一次
    if (schedulerState.lastIdx === prevIdx) {    // 还没前进？放大窗口覆盖本轮剩余
        const now2 = rm._t() % rm.totalDuration;
        schedulerState.forceWindowMs = (rm.totalDuration - now2) + 30;
        scheduleTicksOnce();
    }
    startScoreTickScheduler();
}

function preload() {
    chartJSON = loadJSON('assets/tumbao.json');
    metro = new Metronome({ bpm: 120, beatsPerBar: 4 });
    metro.preload('assets/metronome/Tic.wav', 'assets/metronome/Toc.wav');
}

function speedToBPM(speed) {
    return BPM_MIN + (BPM_MAX - BPM_MIN) * (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
}

function bpmToSpeed(bpm) {
    return SPEED_MIN + (bpm - BPM_MIN) * (SPEED_MAX - SPEED_MIN) / (BPM_MAX - BPM_MIN);
}

function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

const GRID = { pad: 10, topHRatio: 0.5 };
const RECT = { top: {}, amp: {}, drum: {}, mic: {} };
let _canvasHost;

function layoutRects(cnv) {
    const topH = Number.isFinite(GRID.topHpx) ? GRID.topHpx : Math.round(height * GRID.topHRatio);
    const botY = topH;
    const botH = height - topH;

    const sweepH = SWEEP_H;
    const hudH = Math.max(60, botH - sweepH - GRID.pad * 3);
    const hudY = botY + GRID.pad;

    const col0 = Math.round(width * 0.5);
    const col1 = Math.round(width * 0.25);
    const col2 = width - col0 - col1;

    RECT.top = { x: 0, y: 0, w: width, h: topH };

    RECT.amp = {
        x: GRID.pad, y: hudY,
        w: col0 - GRID.pad * 2, h: hudH
    };

    if (window.SampleUI?.resize) {
        SampleUI.resize(RECT.amp.w, RECT.amp.h);
        if (rm && window.SampleUI && SampleUI.getColsPerSec) {
            syncHudSpeedToNotes();
        }
    }

    RECT.drum = {
        x: col0 + GRID.pad, y: hudY,
        w: col1 - GRID.pad * 2, h: hudH
    };

    RECT.mic = {
        x: col0 + col1 + GRID.pad, y: hudY,
        w: col2 - GRID.pad * 2, h: hudH
    };

    RECT.sweep = {
        x: GRID.pad,
        y: hudY + hudH + GRID.pad + 20,
        w: width - GRID.pad * 2,
        h: sweepH - 20
    };

    // Position DOM panels
    const hostRect = _canvasHost.elt.getBoundingClientRect();
    const cvsRect = cnv.elt.getBoundingClientRect();
    const offX = cvsRect.left - hostRect.left;
    const offY = cvsRect.top - hostRect.top;

    const drumWrap = document.getElementById('drum-wrap');
    if (drumWrap) {
        const size = Math.floor(Math.min(RECT.drum.w, RECT.drum.h));
        drumWrap.style.left = (RECT.drum.x + offX + (RECT.drum.w - size) / 2) + 'px';
        drumWrap.style.top = (RECT.drum.y + offY + (RECT.drum.h - size) / 2) + 'px';
        drumWrap.style.width = size + 'px';
        drumWrap.style.height = size + 'px';
    }

    const micHud = document.getElementById('mic-hud');
    if (micHud) {
        micHud.style.left = (RECT.mic.x + offX) + 'px';
        micHud.style.top = (RECT.mic.y + offY) + 'px';
        micHud.style.width = RECT.mic.w + 'px';
        micHud.style.height = RECT.mic.h + 'px';
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

    const NOTES_H = 120, GAP = 16, METER_H = 160;
    const cnv = createCanvas(1000, NOTES_H + GAP + METER_H + SWEEP_H + GRID.pad);

    cnv.parent('score-wrap');
    GRID.topHpx = NOTES_H;
    _canvasHost = select('#score-wrap');
    select('#mic-hud').parent(_canvasHost);
    select('#drum-wrap').parent(_canvasHost);

    layoutRects(cnv);
    window.addEventListener('resize', () => layoutRects(cnv));

    const elTotals = select('#totals');
    if (elTotals) elTotals.style('display', 'none');
    const elStatus = select('#status');
    if (elStatus) elStatus.style('display', 'none');

    rm = new RhythmManager();
    rm.initChart(chartJSON.conga);

    guides = AmpGuides.init({
        getNowMs: () => rm._t(),
        getRect: () => RECT.amp
    });
    guides.setNotes(rm.scoreNotes, rm.totalDuration);

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

    metro.onloaded(() => {
        console.log("Metronome loaded!");
        metro.reset();
    });

    mic = new p5.AudioIn();
    mic.start();

    if (window.SampleUI && !window.__samplerInit) {
        let savedOffset = Number(localStorage.getItem('splOffset'));
        const legacyOffset = Math.abs(savedOffset - (-20)) < 0.6;
        if (!Number.isFinite(savedOffset) || legacyOffset || Math.abs(savedOffset) > 10) {
            try { localStorage.removeItem('splOffset'); } catch { }
            savedOffset = 0;
        }
        const hasOffset = savedOffset !== 0;

        SampleUI.init({
            headless: true,
            width: width,
            height: METER_H,
            spanSec: 65,
            dbMin: 20,
            dbMax: 100,
            rmsSmoothing: 0.30,
            hudInCanvas: true,
            hudCorner: 'br'
        });

        SampleUI.setPenAtCenter(true);

        SampleUI.setupAudio({
            levelMode: 'rms',
            workletPath: './meter-processor.js',
            offsetDb: Number(localStorage.getItem('splOffset')) || 0
        }).then(() => {
            SampleUI.pause();
            SampleUI.setSampleRateMul(35);
            syncHudSpeedToNotes();
        });

        if (!hasOffset) {
            setTimeout(async () => {
                SampleUI.setScale(20, 100);
            }, 1200);
        }
        window.__samplerInit = true;
    }

    CongaClassifier.init({
        modelURL: 'models/conga/',
        probabilityThreshold: 0.3,
        overlapFactor: 0.85,
        stableFrames: 1,
        cooldownMs: 120
    }).then(() => {
        CongaClassifier.onRaw((top, raw) => {
            if (!raw) return;
            const { scores, labels, energy } = raw;
            HUD.energy = energy || 0;
            HUD.lastFrameTs = performance.now();

            const norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
            const dict = {};
            for (let i = 0; i < labels.length; i++) {
                dict[norm(labels[i])] = scores[i];
            }
            const pick = (...names) => names.reduce((m, k) => Math.max(m, dict[norm(k)] || 0), 0);

            const o = pick('o', 'open');
            const p = pick('p', 'palm', 'bass');
            const t = pick('t', 'tip', 'finger');
            const s = pick('s', 'slap');

            let bg = dict['backgroundnoise'] ?? dict['_backgroundnoise_'] ?? dict['noise'] ?? dict['unknown'];
            if (bg == null) bg = Math.max(0, 1 - (o + p + t + s));

            const sum = o + p + t + s + bg || 1;
            HUD.probs = { O: o / sum, P: p / sum, T: t / sum, S: s / sum, BG: bg / sum };

            if (window.SampleUI) {
                SampleUI.setBars([
                    { label: 'Background / Noise', value: HUD.probs.BG, color: '#f39c12' },
                    { label: 'Open / Slap', value: Math.max(HUD.probs.O, HUD.probs.S), color: '#6ab8ff' },
                    { label: 'Tip / Palm', value: Math.max(HUD.probs.T, HUD.probs.P), color: '#2ecc71' }
                ]);
            }

            if (DEBUG) console.log('top5', top);
            const dd = (HUD.energy ?? 0) - _emaE;
            _emaE += _alphaE * dd;
            _emaVar = (1 - _alphaE) * (_emaVar + _alphaE * dd * dd);
        });

        CongaClassifier.onLabelChange(({ label, confidence, margin, energy }) => {
            if (!running) return;
            const e = energy ?? 0;
            _emaE = (1 - _alphaE) * _emaE + _alphaE * e;
            const dev = e - _emaE;
            _emaVar = (1 - _alphaE) * (_emaVar + _alphaE * dev * dev);
            const z = dev / Math.sqrt(_emaVar + 1e-6);
            if (z < ENERGY_Z) return;
            if (confidence < 0.35 || margin < 0.12) return;

            const s = (label || '').toLowerCase().replace(/\s+/g, '');
            const abbr =
                s.includes('open') ? 'O' :
                    s.includes('slap') ? 'S' :
                        (s.includes('tip') || s.includes('finger')) ? 'T' :
                            s.includes('palm') ? 'T' :
                                s.includes('bass') ? 'B' : null;

            if (abbr) {
                rm.registerHit(abbr);
                judgeLineGlow = 1;

                const ringKey =
                    (abbr === 'O' || abbr === 'S') ? 'O' :
                        (abbr === 'T') ? 'T' :
                            (abbr === 'B') ? 'P' : 'O';

                if (window.DrumCanvas?.trigger) DrumCanvas.trigger(ringKey, 320);
                if (window.SampleUI?.setExternalHit) {
                    SampleUI.setExternalHit(label, confidence, 80);
                    SampleUI.pushMarker('#a64fd6', 900);
                    guides?.addHitNow?.();
                    if (window.SweepMode && SweepMode.addHitNow) SweepMode.addHitNow();
                }
            }
        });
    });

    select('#sens-slider').input(() => {
        ENERGY_Z = parseFloat(select('#sens-slider').value());
    });

    select('#metro-toggle').mousePressed(() => {
        metronomeEnabled = !metronomeEnabled;
        select('#metro-toggle').html(metronomeEnabled ? 'Metronome Off' : 'Metronome On');

        if (metronomeEnabled) {
            metro.enable(true);
            if (running) {
                resetMetronomeSchedulerState();
                armNextTickNow();
            }
        } else {
            metro.enable(false);
            stopScoreTickScheduler();
        }
    });
    select('#metro-toggle').html('Metronome On');
    metro.enable(false);

    /* UI initialization */
    let initSpeed = parseFloat(select('#speed-slider').value());
    select('#speed-val').html(initSpeed.toFixed(2));
    const initBpm = speedToBPM(initSpeed);
    select('#bpm-val').html(Math.round(initBpm));
    rm.setBPM(initBpm);
    rm.setSpeedFactor(initSpeed);
    SampleUI.setSpeedFactor(initSpeed);
    SampleUI.setBPM(initBpm);
    SampleUI.useBeatGrid(true, initBpm, 4);

    if (CongaClassifier.setCooldown) {
        CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4)));
    }

    rm.noteY = 50;

    select('#start-btn').mousePressed(handleStart);
    select('#pause-btn').mousePressed(handlePause);
    select('#reset-btn').mousePressed(handleReset);
    select('#export-btn').mousePressed(handleExport);

    // Improved speed slider handler
    select('#speed-slider').input(() => {
        const speedVal = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(speedVal.toFixed(2));

        const bpmVal = speedToBPM(speedVal);
        select('#bpm-val').html(Math.round(bpmVal));

        metro.setBPM(bpmVal);
        rm.setBPM(bpmVal);
        rm.setSpeedFactor(speedVal);
        SampleUI.setBPM(bpmVal);
        SampleUI.useBeatGrid(true, bpmVal, 4);
        guides.syncFixed?.();
        SweepMode.setSpeedMultiplier(1);

        if (CongaClassifier.setCooldown) {
            CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4)));
        }

        // // Keep metronome running during speed changes
        // if (metronomeEnabled && running && metro.isLoaded()) {
        //     metro.flushFuture();

        //     // Find nearest note to maintain sync
        //     const nowMs = rm._t() % rm.totalDuration;
        //     const notes = rm.scoreNotes;
        //     let nearestIdx = 0;
        //     let minDist = Infinity;

        //     for (let i = 0; i < notes.length; i++) {
        //         const dist = Math.abs(notes[i].time - nowMs);
        //         if (dist < minDist) {
        //             minDist = dist;
        //             nearestIdx = i;
        //         }
        //     }

        //     // Update scheduler position without stopping
        //     schedulerState.lastIdx = nearestIdx - 1;
        //     schedulerState.scheduledNotes.clear();

        //     // Schedule immediate next beat
        //     const nextIdx = (nearestIdx < notes.length - 1) ? nearestIdx : 0;
        //     const dt = (notes[nextIdx].time - nowMs + rm.totalDuration) % rm.totalDuration;

        //     if (dt < 100) { // If very close, schedule it now
        //         const sf = rm?.speedFactor || 1;
        //         const when = metro.ctx.currentTime + Math.max(0.01, (dt + getMetroOffsetMs()) / (1000 * sf));
        //         const strong = (notes[nextIdx].accent | 0) === 1;
        //         metro.scheduleAt(when, strong);
        //         schedulerState.guardUntil = when + 0.02;
        //     }
        // }
        if (metronomeEnabled && running && metro.isLoaded()) {
            metro.flushFuture();                 // 清掉旧 BPM 预排
            resetMetronomeSchedulerState();      // 清状态            armNextTickNow();                    // ✨ 锁定“下一记”并设置一次性 forceWindow
            schedulerState.guardUntil = metro.ctx.currentTime + 0.02; // 保护 20ms 防重复
        }
        _emaE = 0;
        _emaVar = 1;
        syncHudSpeedToNotes();
    });

    select('#totals').html(`Notes ${rm.scoreNotes.length}`);

    if (window.DrumCanvas && !window.DrumCanvas._ctx) {
        DrumCanvas.init({ mount: '#drum-wrap', size: 150, background: '#2f3036' });
    }
}

/* ------------ Control Functions ------------- */
async function handleStart() {
    if (running || counting) return;

    await window.userStartAudio?.();

    try {
        await mic.start();
        if (window.SampleUI && SampleUI.setMic) SampleUI.setMic(mic);
    } catch (e) { console.warn(e); }

    // Resume from pause
    if (isPaused) {
        // Find next note from pause position
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

    // Fresh start
    try {
        if (CongaClassifier.setConstraints) {
            CongaClassifier.setConstraints({
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            });
        }
        CongaClassifier.start();
        if (CongaClassifier.setCooldown) {
            CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4)));
        }
    } catch (e) { console.error(e); }

    startCountdown({ resume: false });
    if (window.SampleUI) SampleUI.resume();

    metro.reset();
    metro.useInternalGrid = false;
    resetMetronomeSchedulerState();
    startScoreTickScheduler();
}

function handlePause() {
    if (!running && !counting) return;

    isPaused = true;
    running = false;

    // Save current position
    const currentMs = rm._t() % rm.totalDuration;
    rm.pauseAt = rm.startTime + currentMs;

    if (window.SampleUI) SampleUI.pause();
    counting = false;
    rm.pause();
    CongaClassifier.stop();
    stopScoreTickScheduler();

    if (metro?.isLoaded) {
        metro.flushFuture();
    }
}

function handleReset() {
    running = false;
    counting = false;
    isPaused = false;

    rm.reset();
    rm.pause();
    rm.pauseAt = rm.startTime;

    stopScoreTickScheduler();
    resetMetronomeSchedulerState();
    metro.reset();
    CongaClassifier.stop();

    try {
        if (mic && mic.start) mic.start();
    } catch (e) { console.warn(e); }

    if (window.SampleUI) {
        SampleUI.reset();
        SampleUI.pause();
        SampleUI.clearHardPeaks?.();
    }

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

    for (let i = 0; i < n; i++) {
        g.image(SWEEP_EXPORT_QUEUE[i], 0, i * r.h);
    }

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
    // Handle sweep panel export queue
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
    judgeLineGlow *= 0.9;
    if (judgeLineGlow < 0.01) judgeLineGlow = 0;
    drawGrid();

    // Judge line glow
    let glowLevel = lerp(2, 18, judgeLineGlow);
    let alpha = lerp(120, 255, judgeLineGlow);
    drawingContext.save();
    drawingContext.shadowBlur = glowLevel;
    drawingContext.shadowColor = 'rgba(165, 99, 212, 0.8)';
    stroke(255, 0, 0, alpha);
    strokeWeight(judgeLineGlow > 0.2 ? 4 : 1.5);
    const splitY = RECT.amp.y - GRID.pad;
    line(rm.judgeLineX, 0, rm.judgeLineX, splitY - 1);

    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) {
            counting = false;
            running = true;
            isPaused = false;
            rm.resume();

            if (window.SampleUI) SampleUI.resume();

            if (metronomeEnabled) {
                metro.enable(true);
                if (!countdownForResume) {
                    resetMetronomeSchedulerState();
                }
                armNextTickNow();
            }

            startScoreTickScheduler();

            try {
                if (!CongaClassifier.isListening || !CongaClassifier.isListening()) {
                    CongaClassifier.start();
                }
                if (CongaClassifier.setCooldown) {
                    CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4)));
                }
            } catch (e) { console.warn(e); }
        } else {
            drawCountdown(remain);
        }
    }

    if (running) {
        rm.checkAutoMiss();
        rm.checkLoopAndRestart();
    }

    drawNotesAndFeedback();
    flashDrumWhenNoteAtLine();

    const { hit, miss } = rm.getStats();

    // Stats display
    const info = `Notes ${rm.scoreNotes.length} | Hits ${hit} | Miss ${miss}`;
    noStroke();
    fill(240);
    textSize(16);
    textAlign(RIGHT, BOTTOM);
    text(info, width - 12, laneBottomY() + 40);

    updateHUDView();

    if (window.SampleUI) {
        SampleUI.update();
        SampleUI.renderTo(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
        guides?.render(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
    }

    SweepMode.render(drawingContext, RECT.sweep.x, RECT.sweep.y, RECT.sweep.w, RECT.sweep.h);

    // Draw separators
    push();
    stroke(220);
    strokeWeight(2);
    const xSep1 = Math.round(RECT.drum.x - GRID.pad) + 0.5;
    const xSep2 = Math.round(RECT.mic.x - GRID.pad) + 0.5;
    const yTopDiv = Math.round(RECT.amp.y - GRID.pad) + 0.5;
    const yBorder = Math.round(RECT.sweep.y - GRID.pad - 10) + 0.5;

    line(0, yTopDiv, width, yTopDiv);
    line(0, yBorder, width, yBorder);
    line(xSep1, yTopDiv, xSep1, yBorder);
    line(xSep2, yTopDiv, xSep2, yBorder);
    pop();

    layoutRects(this._renderer ? this._renderer : { elt: document.querySelector('canvas') });
}

/* ------------ Visualization Functions ----------- */
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
    const thr = 6;

    for (const n of notes) {
        const x = rm.getScrollX(n._displayTime ?? n.time);
        if (Math.abs(x - rm.judgeLineX) <= thr) {
            const abRaw = n.abbr || n.type?.[0] || 'O';
            const AB = abRaw.toString().toUpperCase();
            const key =
                (AB === 'O' || AB === 'S') ? 'O' :
                    (AB === 'T' || AB === 'P') ? 'T' :
                        (AB === 'B') ? 'P' : 'O';
            DrumCanvas.trigger(key, 220);
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
                const R = 10;
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
    if (guides && RECT && RECT.amp) {
        const r = RECT.amp;
        if (mouseX >= r.x && mouseX < r.x + r.w && mouseY >= r.y && mouseY < r.y + r.h) {
            guides.addHitNow?.();
            window.SampleUI?.pushMarker?.('#a64fd6', 900);
        }
    }

    SampleUI.pushMarker('rgba(166,79,214,0.45)', 900);
    if (window.SweepMode && SweepMode.addHitNow) SweepMode.addHitNow();

    if (window.SampleUI && SampleUI.pointerDown(mouseX, mouseY)) {
        return;
    }

    if (running) {
        rm.registerHit();
        SweepMode.addHitNow();
        judgeLineGlow = 1;
    }

    if (window.DrumCanvas && typeof DrumCanvas.trigger === 'function') {
        DrumCanvas.trigger('EDGE', 360);
    }
}

// HUD State
const HUD = {
    lastFrameTs: 0,
    energy: 0,
    probs: { O: 0, P: 0, T: 0, S: 0, BG: 0 }
};

function updateHUDView() {
    const led = document.getElementById('mic-led');
    const msg = document.getElementById('mic-msg');

    const alive = (CongaClassifier?.micAlive?.() === true);
    if (!CongaClassifier?.isListening || !CongaClassifier.isListening()) {
        led.className = 'led err';
        msg.textContent = 'not listening';
    } else if (!alive) {
        led.className = 'led err';
        msg.textContent = 'no data';
    } else {
        if (typeof updateHUDView._emaE !== 'number') {
            updateHUDView._emaE = 0;
            updateHUDView._emaVar = 1e-3;
        }
        const a = 0.08;
        const d = (HUD.energy || 0) - updateHUDView._emaE;
        updateHUDView._emaE += a * d;
        updateHUDView._emaVar = (1 - a) * (updateHUDView._emaVar + a * d * d);
        const z = d / Math.sqrt(updateHUDView._emaVar + 1e-6);

        if (z < 0.3) {
            led.className = 'led warn';
            msg.textContent = 'very low level';
        } else if (z < 1.0) {
            led.className = 'led warn';
            msg.textContent = 'low';
        } else {
            led.className = 'led ok';
            msg.textContent = 'ok';
        }
    }

    const setW = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.round(v * 100) + '%';
    }
    const setV = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Math.round(v * 100) + '%';
    }

    const p = HUD.probs;
    setW('bar-O', p.O); setV('val-O', p.O);
    setW('bar-P', p.P); setV('val-P', p.P);
    setW('bar-T', p.T); setV('val-T', p.T);
    setW('bar-S', p.S); setV('val-S', p.S);
    setW('bar-BG', p.BG); setV('val-BG', p.BG);
}