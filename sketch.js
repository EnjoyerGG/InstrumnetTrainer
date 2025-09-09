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

let rm, metro, mic, fftHUD, ampHUD, drumTrigger, settingsPanel, scoreHUD;
let running = false, counting = false;
let debugPanel = null;

// ★ 调试计数器（AI / TRG 命中与拒绝统计）
window.__HitDebug = window.__HitDebug || {
    aiAccepted: 0,
    aiRejectedByGate: 0,
    aiLowConfidence: 0,
    trgAccepted: 0,
    trgRejectedByGate: 0,
    lastSource: '',
    lastReason: ''
};
// shouldAcceptTrigger 内会写这个原因
window.__GateLastReason = '';


let ctStart = 0;
let judgeLineGlow = 0;
let metronomeEnabled = false;
let chartJSON;
let hasEverStarted = false;
let isPaused = false;
let countdownForResume = false;
let micReady = false;
let debugMode = false;
let waitingForFirstHit = false;
let resumePosition = 0;
let pauseAtLoopTime = 0;
let pauseAtWallTime = 0;
let lastRMCycle = 0;

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

/* ---------- 修复的节拍器调度系统 ---------- */
const schedulerState = {
    lastIdx: -1,
    lastNowMs: null,
    scheduledNotes: new Map(),
    guardUntil: 0,
    forceWindowMs: null,
    worker: null,
    lastCycle: -1
};

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
function startScoreTickScheduler() {
    stopScoreTickScheduler();
    const w = _ensureSchedWorker();
    w.postMessage({ cmd: 'interval', value: 25 });
    w.postMessage({ cmd: 'start' });
}
function stopScoreTickScheduler() {
    if (schedulerState.worker) schedulerState.worker.postMessage({ cmd: 'stop' });
}
function resetMetronomeSchedulerState() {
    schedulerState.lastIdx = -1;
    schedulerState.lastNowMs = null;
    schedulerState.scheduledNotes.clear();
    schedulerState.guardUntil = 0;
    schedulerState.forceWindowMs = null;
    schedulerState.lastCycle = -1;
}

function scheduleTicksOnce() {
    if (!metronomeEnabled || !running || !metro || !metro.isLoaded()) return;

    const ctxNow = metro.ctx.currentTime;
    const nowMs = rm._t() % rm.totalDuration;
    const aheadMs = schedulerState.forceWindowMs || getAheadMs();

    // 检测循环重启 - 更准确的判断
    const currentCycle = Math.floor(rm._t() / rm.totalDuration);
    const isNewCycle = schedulerState.lastCycle !== -1 && currentCycle > schedulerState.lastCycle;

    if (isNewCycle) {
        if (DEBUG) console.log(`新循环开始: ${currentCycle}, 重置调度状态`);
        schedulerState.lastIdx = -1;
        schedulerState.scheduledNotes.clear();
        schedulerState.guardUntil = ctxNow + 0.02;
    }
    schedulerState.lastCycle = currentCycle;
    schedulerState.lastNowMs = nowMs;

    const notes = rm.scoreNotes;
    if (!notes || !notes.length) return;

    // 清理过期音符 - 更保守的策略
    const expiredKeys = [];
    for (const [k, t] of schedulerState.scheduledNotes) {
        if (t < ctxNow - 2.0) {
            expiredKeys.push(k);
        }
    }
    expiredKeys.forEach(k => schedulerState.scheduledNotes.delete(k));

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

        if (shouldPlay) {
            const sf = rm?.speedFactor || 1;
            const when = ctxNow + Math.max(0, (dt + getMetroOffsetMs()) / (1000 * sf));

            // 防重复调度 - 改进的逻辑
            const lastWhen = schedulerState.scheduledNotes.get(i);
            const isRecentlyScheduled = lastWhen && Math.abs(when - lastWhen) < 0.1;
            const isGuarded = schedulerState.guardUntil && when <= schedulerState.guardUntil;
            const isTooEarly = when < ctxNow + 0.01;

            if (!isRecentlyScheduled && !isGuarded && !isTooEarly) {
                try {
                    if (currentMode === 'metronome') {
                        const strong = ((n.accent | 0) === 1);
                        metro.scheduleAt(when, 'metronome', strong);
                    } else {
                        metro.scheduleAt(when, 'clave', true);
                    }
                    schedulerState.scheduledNotes.set(i, when);
                    scheduledCount++;

                    if (DEBUG) {
                        console.log(`调度成功: ${currentMode}, idx=${i}, dt=${dt.toFixed(1)}ms, when=${when.toFixed(3)}s`);
                    }
                } catch (error) {
                    console.error(`调度失败: idx=${i}`, error);
                }
            }
        }
    }

    // 调试信息 - 简化输出
    if (DEBUG && scheduledCount > 0) {
        console.log(`调度: ${scheduledCount}/${checkedCount} (${currentMode}), 时间=${nowMs.toFixed(0)}ms, 循环=${currentCycle}`);
    }

    schedulerState.forceWindowMs = null;
}

window.onRhythmModeChange = function (mode, modeData) {
    console.log(`节拍模式变更: ${modeData.name}`);

    // 如果节拍器正在运行，平滑切换
    if (metronomeEnabled && running && metro.isLoaded()) {
        const ctxNow = metro.ctx.currentTime;
        const futureNotes = [];
        for (const [k, t] of schedulerState.scheduledNotes) {
            if (t > ctxNow + 0.1) {
                futureNotes.push(k);
            }
        }
        futureNotes.forEach(k => schedulerState.scheduledNotes.delete(k));

        schedulerState.forceWindowMs = getAheadMs();
        scheduleTicksOnce();
        schedulerState.guardUntil = ctxNow + 0.05;
    }
};

function calculateHitTiming() {
    // 根据你现有的判定逻辑调整
    if (rm && rm.getTimingError) {
        const error = Math.abs(rm.getTimingError());
        if (error < 30) return 'perfect';
        if (error < 80) return 'good';
        return 'miss';
    }
    // 简化的随机判定（用于演示）
    const rand = Math.random();
    if (rand > 0.8) return 'perfect';  // 20% 完美
    if (rand > 0.4) return 'good';     // 40% 良好  
    return 'miss';                     // 40% 失误
}

function detectHitType() {
    // 基于DrumTrigger的频谱分析
    if (drumTrigger && drumTrigger._fft && !drumTrigger._fallbackMode) {
        try {
            const spectrum = drumTrigger._fft.analyze();
            if (spectrum && spectrum.length > 0) {
                // 分析不同频段的能量
                const lowEnergy = spectrum.slice(0, 64).reduce((a, b) => a + b, 0) / 64;
                const midEnergy = spectrum.slice(64, 256).reduce((a, b) => a + b, 0) / 192;
                const highEnergy = spectrum.slice(256, 512).reduce((a, b) => a + b, 0) / 256;

                const totalEnergy = lowEnergy + midEnergy + highEnergy;

                // 基于频谱特征判断击打类型
                if (lowEnergy / totalEnergy > 0.6) {
                    return 'bass'; // 低频为主 = 低音
                } else if (highEnergy / totalEnergy > 0.4) {
                    return 'slap'; // 高频明显 = 掌击
                } else if (midEnergy > lowEnergy && midEnergy > highEnergy) {
                    return 'open'; // 中频为主 = 开音
                } else {
                    return 'tip'; // 其他情况 = 指尖
                }
            }
        } catch (e) {
            console.warn('频谱分析失败:', e);
        }
    }

    // 回退到随机分配
    const types = ['slap', 'open', 'tip', 'bass'];
    return types[Math.floor(Math.random() * types.length)];
}

function armNextTickNow() {
    if (!metronomeEnabled || !metro || !metro.isLoaded() || !rm?.scoreNotes?.length) return;

    const notes = rm.scoreNotes;
    const nowMs = rm._t() % rm.totalDuration;

    let nextIdx = notes.findIndex(n => n.time >= nowMs);
    if (nextIdx < 0) nextIdx = 0;

    const dtNext = (notes[nextIdx].time - nowMs + rm.totalDuration) % rm.totalDuration;

    schedulerState.lastIdx = (nextIdx - 1 + notes.length) % notes.length;
    schedulerState.forceWindowMs = Math.min(dtNext + 50, getAheadMs());

    scheduleTicksOnce();
    startScoreTickScheduler();

    if (DEBUG) console.log(`启动调度: 下个音符在 ${dtNext.toFixed(0)}ms 后, 窗口=${schedulerState.forceWindowMs}ms`);
}

/* ------------ p5 preload ------------- */
function preload() {
    //chartJSON = loadJSON('assets/bolero.json');
    metro = new Metronome({ bpm: 120, beatsPerBar: 4 });
    metro.preload('assets/metronome/Tic.wav', 'assets/metronome/Toc.wav', 'assets/clave/Clave.wav');
}

/* ------------ Helpers ------------- */
function speedToBPM(speed) { return BPM_MIN + (BPM_MAX - BPM_MIN) * (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN); }
function bpmToSpeed(bpm) { return SPEED_MIN + (bpm - BPM_MIN) * (SPEED_MAX - SPEED_MIN) / (BPM_MAX - BPM_MIN); }
function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }

window.speedToBPM = speedToBPM;

const GRID = { pad: 10, topHRatio: 0.5 };
const RECT = {
    top: {}, sweep: {}, fft: {}, amp: {}, score: {}
};
let _canvasHost;

function layoutRects() {
    const topH = Number.isFinite(GRID.topHpx) ? GRID.topHpx : Math.round(height * GRID.topHRatio);

    const sweepY = topH + GRID.pad;
    const sweepH = SWEEP_H;
    const hudY = sweepY + sweepH + GRID.pad;
    const hudH = Math.max(160, height - hudY - GRID.pad);
    const insetTop = 4;
    const insetRight = 4;
    const insetBottom = 2;

    const availW = width - GRID.pad * 2;
    const leftW = Math.round(availW / 2);
    const gap = 8;
    const pad = 8;

    RECT.top = { x: 0, y: 0, w: width, h: topH };
    RECT.sweep = { x: GRID.pad, y: sweepY, w: availW, h: sweepH };
    RECT.fft = { x: GRID.pad, y: hudY + insetTop, w: leftW - insetRight, h: hudH - insetBottom };
    RECT.rightHalf = { x: GRID.pad + leftW, y: hudY, w: availW - leftW, h: hudH };
    const halfW = Math.floor((RECT.rightHalf.w - gap - pad * 2) / 2);

    RECT.amp = {
        x: RECT.rightHalf.x + pad,
        y: RECT.rightHalf.y + pad,
        w: halfW - 2,
        h: RECT.rightHalf.h - pad + 2
    };
    RECT.score = {
        x: RECT.rightHalf.x + pad + halfW + gap + 5,
        y: RECT.rightHalf.y + pad,
        w: RECT.rightHalf.w - pad - halfW - gap - 2,
        h: RECT.rightHalf.h - pad + 2
    };
}

/* ------------ DrumTrigger 初始化函数 ------------ */
// 触发稳健化参数
const TRIG_REFRACTORY_MS = 140;   // 不可重复期（抑制一次击打被判两次）
const TRIG_MIN_LEVEL = 0.006;     // 背景噪声下限
let _lastTriggerWallMs = 0;

function shouldAcceptTrigger(kindHint = null) {
    const now = millis();

    // ★ 检查当前是否在智能识别模式
    const isIntelligentMode = window.hitRecognitionIntegration?.isEnabled &&
        window.hitRecognitionIntegration?.processingMode === 'intelligent'

    if (isIntelligentMode) {
        // =================================================================
        // 智能模式：宽松收集策略 - 只做最基础的防抖和噪音过滤
        // =================================================================

        // 1) 基础防抖（缩短到更合理的时间）
        const minInterval = 60; // 从140ms大幅缩短到60ms
        if (now - _lastTriggerWallMs < minInterval) {
            window.__GateLastReason = 'smart_refractory_60ms';
            return false;
        }

        // 2) 基础音量门限（大幅降低要求）
        let lvl = 0;
        try {
            if (mic?.getLevel) lvl = mic.getLevel();
        } catch (_) { }

        const relaxedMinLevel = 0.002; // 从0.006降低到0.002
        if (lvl < relaxedMinLevel) {
            window.__GateLastReason = `smart_level<${relaxedMinLevel.toFixed(3)} (lvl=${lvl.toFixed(4)})`;
            return false;
        }

        // 3) 简化的能量检查（替代复杂的频谱分析）
        try {
            const fft = drumTrigger?._fft;
            if (fft) {
                const spec = fft.analyze();
                const totalEnergy = spec.reduce((sum, val) => sum + val, 0) / spec.length;

                // 智能模式下只需要很低的总能量阈值
                if (totalEnergy < 15) { // 从50降低到15
                    window.__GateLastReason = `smart_totalEnergy<15 (=${totalEnergy.toFixed(1)})`;
                    return false;
                }
            }
        } catch (_) {
            // FFT失败不阻止触发，让智能识别系统处理
        }

        // 4) 智能模式成功通过基础门控
        window.__GateLastReason = 'smart_mode_accepted';
        _lastTriggerWallMs = now;

        // ★ 记录调试统计
        if (window.__HitDebug) {
            window.__HitDebug.smartModeAccepted = (window.__HitDebug.smartModeAccepted || 0) + 1;
            window.__HitDebug.lastSource = 'SMART_GATE';
            window.__HitDebug.lastReason = 'relaxed_collection';
        }

        return true;

    } else {
        // =================================================================
        // 传统模式：保持原有的严格筛选逻辑（保证兼容性）
        // =================================================================

        // 1) 硬性不可重复期
        if (now - _lastTriggerWallMs < TRIG_REFRACTORY_MS) {
            window.__GateLastReason = 'classic_refractory';
            return false;
        }

        // 2) 电平门限
        let lvl = 0;
        try { if (mic?.getLevel) lvl = mic.getLevel(); } catch (_) { }
        if (lvl < TRIG_MIN_LEVEL && kindHint !== 'tip') {
            window.__GateLastReason = `classic_level<${TRIG_MIN_LEVEL.toFixed(3)} (lvl=${lvl.toFixed(4)})`;
            return false;
        }

        // 3) 频谱特征检查（保持原有逻辑）
        try {
            const fft = drumTrigger?._fft;
            if (fft) {
                const spec = fft.analyze();
                const N = spec.length, nyq = sampleRate() / 2;
                const idx = hz => Math.max(0, Math.min(N - 1, Math.round(hz / (nyq / N))));
                const low = avg(spec, idx(40), idx(180));
                const mid = avg(spec, idx(180), idx(800));
                const high = avg(spec, idx(1000), idx(4000));
                const total = low + mid + high;

                if (total < 50 && kindHint !== 'tip') {
                    window.__GateLastReason = 'classic_totalEnergy<50';
                    return false;
                }

                const midHighFrac = (mid + high) / Math.max(1, total);
                if (kindHint !== 'tip' && midHighFrac < 0.15) {
                    window.__GateLastReason = `classic_midHighFrac<0.15 (=${midHighFrac.toFixed(2)})`;
                    return false;
                }
            }
        } catch (_) { }

        window.__GateLastReason = 'classic_mode_ok';
        _lastTriggerWallMs = now;
        return true;
    }

    function avg(arr, a, b) {
        let s = 0, c = 0;
        for (let i = a; i <= b; i++) {
            s += arr[i] || 0;
            c++;
        }
        return c ? s / c : 0;
    }
}

function initDrumTriggerForMobile() {
    console.log('移动端 DrumTrigger 初始化');
    console.log('Audio context state:', getAudioContext()?.state);
    console.log('Mic ready:', micReady);

    try {
        drumTrigger = DrumTrigger.init({
            mic,
            debug: true,
            onTrigger: (reason) => {
                console.log('移动端鼓击检测:', reason);

                // ★ 检查是否在等待第一击状态
                if (waitingForFirstHit) {
                    startPerformanceAfterFirstHit();
                    return; // 第一击不计入游戏判定
                }
                const hint = (reason === 'tip') ? 'tip' : null;
                if (!shouldAcceptTrigger(hint)) return;

                if (running) {
                    LatencyProbe?.markNote({
                        reason,
                        mode: window.RhythmSelector?.getCurrentMode?.(),
                        chart: window.ChartSelector?.currentChart?.name || 'unknown',
                        bpm: (window.speedToBPM?.(rm?.speedFactor || 0.25) | 0)
                    });
                    const hitTime = rm._t();
                    rm.registerHit();
                    SweepMode?.addHitNow?.();
                    HitMarkers.addHitMarker(hitTime);
                    judgeLineGlow = 1;
                    const timing = calculateHitTiming();
                    const hitType = detectHitType();
                    scoreHUD?.registerHit?.(timing, hitType);
                }
            }
        });

        drumTrigger.enable(true);
        drumTrigger.setSensitivity(0.9);

        console.log('移动端 DrumTrigger 初始化成功');

        setTimeout(() => {
            console.log('FFT 功能测试');
            if (drumTrigger._fft) {
                try {
                    const spectrum = drumTrigger._fft.analyze();
                    console.log('FFT 工作状态:', !!(spectrum && spectrum.length > 0));
                    console.log('频谱数据长度:', spectrum?.length);
                } catch (e) {
                    console.error('FFT 测试失败:', e);
                }
            } else {
                console.warn('FFT 分析器未创建');
            }

            if (mic) {
                try {
                    const level = mic.getLevel();
                    console.log('当前音量级别:', level.toFixed(4));
                } catch (e) {
                    console.error('音量检测失败:', e);
                }
            }
        }, 2000);

    } catch (error) {
        console.error('DrumTrigger 初始化失败:', error);
    }
}

function initDrumTriggerForDesktop() {
    console.log('桌面端 DrumTrigger 初始化');

    drumTrigger = DrumTrigger.init({
        mic,
        debug: debugMode,
        onTrigger: (reason) => {
            // ★ 检查是否在等待第一击状态
            if (waitingForFirstHit) {
                startPerformanceAfterFirstHit();
                return; // 第一击不计入游戏判定
            }
            const hint = (reason === 'tip') ? 'tip' : null;
            if (!shouldAcceptTrigger(hint)) {
                if (window.__HitDebug) {
                    window.__HitDebug.trgRejectedByGate++;
                    window.__HitDebug.lastSource = 'TRG';
                    window.__HitDebug.lastReason = window.__GateLastReason || 'unknown';
                }
                return;
            }
            if (window.__HitDebug) {
                window.__HitDebug.trgAccepted++;
                window.__HitDebug.lastSource = 'TRG';
                window.__HitDebug.lastReason = 'ok';
            }

            if (running) {
                // ★ 智能模式：交给 AI，传统通道不再记分，避免双计数
                if (window.hitRecognitionIntegration?.isEnabled &&
                    window.hitRecognitionIntegration?.processingMode === 'intelligent') {
                    // 只做视觉反馈的话，可在这里加上需要的 UI 效果；不再 registerHit
                    return;
                }
                // 非智能模式 → 传统处理
                const hitTime = rm._t();
                const hitType = detectHitType();

                if (window.LatencyProbe) {
                    window.LatencyProbe.markNote({
                        reason,
                        mode: window.RhythmSelector?.getCurrentMode?.(),
                        chart: window.ChartSelector?.currentChart?.name || 'unknown',
                        bpm: (window.speedToBPM?.(rm?.speedFactor || 0.25) | 0)
                    });
                }

                rm.registerHit();
                SweepMode?.addHitNow?.();
                HitMarkers.addHitMarker(hitTime);
                judgeLineGlow = 1;
                window._lastHitType = hitType;

                if (debugMode) {
                    console.log(`桌面端鼓击检测: ${reason}, 模式: ${window.hitRecognitionIntegration?.processingMode || '传统'}`);
                }
            }
        }
    });

    drumTrigger.enable(true);
    drumTrigger.setSensitivity(0.6);
}

/* ------------ Setup --------------- */
function setup() {
    if (isMobile()) {
        pixelDensity(1);
        frameRate(30);
        debugMode = true;
        console.log('移动端模式启用，调试模式开启');
    } else {
        pixelDensity(1);
        frameRate(60);
        console.log('桌面端模式：使用标准布局');
    }

    const NOTES_H = 120;
    const METER_H = 200;
    const totalHeight = NOTES_H + SWEEP_H + METER_H + GRID.pad * 3;

    const cnv = createCanvas(1100, totalHeight);
    cnv.parent('score-wrap');
    GRID.topHpx = NOTES_H;

    _canvasHost = select('#score-wrap');
    _canvasHost.elt.style.position = 'relative';
    _canvasHost.elt.classList.add('fixed-hud');

    layoutRects(cnv);
    window.addEventListener('resize', () => layoutRects(cnv));

    rm = new RhythmManager();
    //rm.initChart(chartJSON.conga);
    rm.noteY = 50;

    NoteIlluminateFeedback.init({
        rm,
        laneTopY: () => laneTopY(),
        laneBottomY: () => laneBottomY(),
        isBottomDrum: (n) => isBottomDrum(n),
        glyphForAbbr: (ab) => glyphForAbbr(ab)
    });

    HitMarkers.init({
        rm,
        laneTopY: () => laneTopY(),
        laneBottomY: () => laneBottomY(),
        isBottomDrum: (n) => isBottomDrum(n)
    });

    StarEffects.init();

    // 初始化绘画模式系统
    if (window.DrawingMode) {
        window.DrawingMode = window.DrawingMode.init();
        console.log('DrawingMode initialized');
    }

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
    SweepMode?.setHitColor('rgba(255,180,0,0.35)', 2);
    SweepMode?.setHitGlow('rgba(255,210,80,0.90)', 14);
    _lastCycleForSnap = SweepMode.getCurrentCycle();

    metro.onloaded(() => { console.log("Metronome loaded!"); metro.reset(); });

    RhythmSelector.init();

    mic = new p5.AudioIn();
    mic.start();

    //初始化打分系统
    scoreHUD = ScorePanel.init({
        rectProvider: () => RECT.score,
    })

    fftHUD = FFTPanel.init({
        mic,
        rectProvider: () => RECT.fft,
        bins: 1024,
        smoothing: 0.85,
        vscale: 5,
        lift: 5
    })
    fftHUD.setAxis({ mode: 'hybrid', focusBelowHz: 5000, compressFraction: 0.20, logBase: 10 })
        .showPowerLine50Hz(true)
        .enablePeakMarkers(true);
    console.log('fftHUD axis mode after init:', fftHUD._axisMode);

    //initialize amp HUD
    ampHUD = AmpPanel.init({
        mic,
        rectProvider: () => RECT.amp,
        smoothing: 0.7,
        vscale: 5.0,
        historySec: 2.5,
        fastResponse: true
    });
    ampHUD.setCompressionMode('logarithmic', 0.4)  // 对数压缩，压缩比0.4
        .setSoftClipParams(0.7, 0.95);
    setTimeout(initAmplitudeSystem, 1000);          // 软限幅阈值0.7，最大显示高度95%

    if (isMobile()) {
        setTimeout(() => {
            initDrumTriggerForMobile();
        }, 1500);
    } else {
        setTimeout(() => {
            initDrumTriggerForDesktop();
        }, 500);
    }

    settingsPanel = SettingsPanel.init();

    const settingsBtn = document.getElementById('settings-btn');
    const placeholder = document.getElementById('settings-placeholder');
    if (settingsBtn && placeholder) {
        placeholder.parentNode.replaceChild(settingsBtn, placeholder);
    }

    window.statusTracker = {
        successfulHits: 0,
        recentResults: [],
        maxRecentResults: 10,
        currentInputLevel: 0,
        lastUpdateTime: 0
    };

    tryStartMicEarly();

    select('#metro-toggle').mousePressed(() => {
        metronomeEnabled = !metronomeEnabled;
        updateMetroBtnUI();

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
    select('#metro-toggle').html('Metronome');
    updateMetroBtnUI();
    metro.enable(false);

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

    select('#speed-slider').input(() => {
        const speedVal = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(speedVal.toFixed(2));
        const bpmVal = speedToBPM(speedVal);
        select('#bpm-val').html(Math.round(bpmVal));

        metro.setBPM(bpmVal);
        rm.setBPM(bpmVal);
        rm.setSpeedFactor(speedVal);

        SweepMode?.setSpeedMultiplier?.(1);

        if (metronomeEnabled && running && metro.isLoaded()) {
            metro.flushFuture();
            resetMetronomeSchedulerState();
            armNextTickNow();
            schedulerState.guardUntil = metro.ctx.currentTime + 0.02;
        }
        _emaE = 0, _emaVar = 1;
    });

    //init chart selector
    initChartSelector();

    //scoring system
    setTimeout(() => {
        if (window.rightPanelScoring) {
            integrateScoring();
        }
    }, 2000);

    // //advanced classifier
    setTimeout(async () => {
        console.log('=== 智能识别依赖检查 ===');
        console.log('window.initializeIntelligentRecognition:', typeof window.initializeIntelligentRecognition);
        console.log('window.hitRecognitionIntegration:', !!window.hitRecognitionIntegration);

        if (typeof window.initializeIntelligentRecognition === 'function') {
            await initializeIntelligentRecognitionWrapper();
        } else {
            console.warn('❌ 智能识别模块未正确加载');
        }
    }, 5000);
}

async function initializeIntelligentRecognitionWrapper() {
    if (window._intelligentRecognitionInitializing || window._intelligentRecognitionInitialized) {
        console.log('智能识别系统已在初始化中或已完成，跳过重复初始化');
        return;
    }

    window._intelligentRecognitionInitializing = true;

    // 检查外部智能识别函数是否存在
    if (!mic) {
        console.warn('❌ 麦克风未准备就绪');
        window._intelligentRecognitionInitializing = false;
        return;
    }

    if (typeof window.initializeIntelligentRecognition !== 'function') {
        console.warn('❌ 外部智能识别模块未加载');
        window._intelligentRecognitionInitializing = false;
        return;
    }

    try {
        console.log('正在初始化智能打击识别系统...');

        const config = {
            fftSize: 2048,
            sampleRate: 44100,
            recognition: {
                adaptiveLearning: true,
                noiseFloor: 0.02,
                detectionCooldown: 150
            },
            noiseReduction: {
                spectralSubtraction: { enabled: true },
                adaptiveFilter: { enabled: true },
                gatingFilter: { enabled: true }
            }
        };

        // 现在调用外部模块的函数
        const success = await window.initializeIntelligentRecognition(mic, config);

        if (success) {
            console.log('✅ 智能识别系统启动成功');
            window._intelligentRecognitionInitialized = true;

            // 强制设置为智能模式（禁用混合模式后的默认选择）
            if (window.hitRecognitionIntegration?.setProcessingMode) {
                window.hitRecognitionIntegration.setProcessingMode('intelligent');
                console.log('🎯 默认启用智能识别模式');
            }

            // 初始化其他组件...
            if (window.initializeTestingSuite && window.hitRecognitionIntegration?.recognitionSystem) {
                window.recognitionTestingSuite = window.initializeTestingSuite(
                    window.hitRecognitionIntegration.recognitionSystem
                );
                console.log('测试套件已初始化');
            }
        } else {
            console.log('❌ 智能识别系统启动失败');
        }

    } catch (error) {
        console.error('智能识别系统初始化错误:', error);
    } finally {
        window._intelligentRecognitionInitializing = false;
    }
}

function initAmplitudeSystem() {
    if (ampHUD) {
        // 为 ampHUD 添加状态获取方法
        ampHUD.getAmplitudeState = function () {
            return {
                preferAmp: this._preferAmp,
                dynamicScale: this._dynamicScale,
                instantAdapt: this._instantAdapt,
                fastResponse: this._fastResponse,
                compressionMode: this._compressionMode,
                compressionRatio: this._compressionRatio
            };
        };
        console.log('振幅系统已初始化，支持调试面板');
    }
}

function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function handleDesktopResize(width, height) {
    // 桌面端正常的窗口大小调整逻辑
    // 这里保持你原有的桌面端布局逻辑
    console.log(`桌面端布局调整: ${width}×${height}`);

    // 如果需要调整画布大小（桌面端可选）
    // resizeCanvas(width, height);
    // layoutRects();
}

function integrateScoring() {
    // 集成击打检测
    if (drumTrigger && drumTrigger._onTrigger) {
        const originalTrigger = drumTrigger._onTrigger;
        drumTrigger._onTrigger = function (reason) {
            originalTrigger.call(this, reason);

            // 计算击打质量
            const timing = calculateHitTiming();
            const hitType = detectHitType();

            // 通知打分系统
            window.scoringPanelInterface.onHit(timing, hitType);
        };
    }
}

function calculateHitTiming() {
    // 根据你现有的判定逻辑
    if (rm && rm.getTimingError) {
        const error = Math.abs(rm.getTimingError());
        if (error < 30) return 'perfect';
        if (error < 80) return 'good';
        return 'miss';
    }
    return 'good';
}

function detectHitType() {
    // 基于现有音频分析或默认随机
    const types = ['slap', 'open', 'tip', 'bass'];
    return types[Math.floor(Math.random() * types.length)];
}

function initChartSelector() {
    // 初始化谱子选择器
    ChartSelector.init({
        onChartChange: (chart, chartData) => {
            console.log('Switching to chart:', chart.name);

            // 如果正在运行，先停止
            if (running || counting || waitingForFirstHit) {
                handleReset();
            }

            // 应用新谱子
            applyNewChart(chartData);
        },

        onLoadStart: (chart) => {
            console.log('Loading chart:', chart.name);
            // 可选：显示加载状态
        },

        onLoadComplete: (chart, chartData) => {
            console.log('Chart loaded successfully:', chart.name);
        },

        onLoadError: (chart, error) => {
            console.error('Failed to load chart:', chart.name, error);
        }
    });

    // 加载默认谱子（Bolero）
    loadDefaultChart();
}

function applyNewChart(chartData) {
    try {
        // 更新全局chartJSON变量
        window.chartJSON = chartData;
        // 简化：直接处理beats到毫秒的转换
        const processedNotes = convertBeatsToMilliseconds(chartData.conga, chartData.bpm || 120);

        // 重新初始化RhythmManager
        rm.initChart(processedNotes, true); // true = 毫秒时间模式

        // 如果JSON包含BPM信息，应用它
        if (chartData.bpm && typeof chartData.bpm === 'number') {
            const speed = bpmToSpeed(chartData.bpm);
            rm.setBPM(chartData.bpm);
            rm.setSpeedFactor(speed);

            // 更新UI
            const speedSlider = select('#speed-slider');
            const speedVal = select('#speed-val');
            const bpmVal = select('#bpm-val');

            if (speedSlider && speedVal && bpmVal) {
                speedSlider.value(speed);
                speedVal.html(speed.toFixed(2));
                bpmVal.html(Math.round(chartData.bpm));
            }

            console.log(`应用谱子BPM: ${chartData.bpm}, 速度因子: ${speed.toFixed(2)}`);
        }

        // 重新设置SweepMode
        SweepMode.setNotes(rm.scoreNotes, rm.totalDuration);
        SweepMode.setBeatMs(rm.noteInterval);
        SweepMode.setStartGap(COUNTDOWN_MS || 0);
        SweepMode.clearHits();
        SweepMode.snapToLeft();

        // 重新初始化反馈系统
        // if (rm.scoreNotes && rm.scoreNotes.length > 0) {
        //     // 确保所有必要的字段存在
        //     for (let i = 0; i < rm.scoreNotes.length; i++) {
        //         const scoreNote = rm.scoreNotes[i];
        //         const originalNote = processedChartData.conga[i];

        //         // 复制所有字段
        //         scoreNote.clave23 = originalNote.clave23 || 0;
        //         scoreNote.clave32 = originalNote.clave32 || 0;
        //         scoreNote.accent = originalNote.accent || 0;
        //         scoreNote.abbr = originalNote.abbr || originalNote.type?.[0]?.toUpperCase() || '';
        //     }
        // }

        // 重置所有状态
        running = false;
        counting = false;
        isPaused = false;
        waitingForFirstHit = false;
        pausedAtLoopTime = 0;
        pausedAtWallTime = 0;
        resumePosition = 0;
        lastRMCycle = 0;

        // 清除效果
        StarEffects.clear();
        HitMarkers.clearAllMarkers();
        resetStatusTracker();

        // 重置节拍器
        if (metro) {
            metro.reset();
            resetMetronomeSchedulerState();
        }

        //const chartName = chartData.name || 'Unknown';
        console.log(`新谱子应用成功: ${chartData.name || 'Unknown'}, ${rm.scoreNotes.length}个音符`);

    } catch (error) {
        console.error('应用新谱子失败:', error);
        alert('切换谱子失败: ' + error.message);
    }
}

// function processChartData(rawChartData) {
//     // 创建处理后的数据副本
//     const processedData = JSON.parse(JSON.stringify(rawChartData));

//     // 获取BPM，默认使用120
//     const bpm = rawChartData.bpm || 120;
//     const beatDurationMs = 60000 / bpm; // 一拍的毫秒数

//     console.log(`处理谱子数据: BPM=${bpm}, 每拍=${beatDurationMs.toFixed(1)}ms`);

//     // 将beats时间转换为毫秒时间
//     processedData.conga = rawChartData.conga.map((note, index) => {
//         const processedNote = { ...note };

//         // 将beats转换为毫秒
//         processedNote.time = Math.round(note.time * beatDurationMs);

//         // 确保必要字段存在
//         if (!processedNote.abbr && processedNote.type) {
//             processedNote.abbr = processedNote.type[0].toUpperCase();
//         }

//         // 设置默认值
//         processedNote.accent = processedNote.accent || 0;
//         processedNote.clave23 = processedNote.clave23 || 0;
//         processedNote.clave32 = processedNote.clave32 || 0;

//         return processedNote;
//     });

//     // 按时间排序（防止数据乱序）
//     processedData.conga.sort((a, b) => a.time - b.time);

//     console.log(`时间转换完成: ${processedData.conga.length}个音符, 时长=${Math.max(...processedData.conga.map(n => n.time)).toFixed(0)}ms`);

//     return processedData;
// }

function convertBeatsToMilliseconds(congaArray, bpm) {
    const originalBeatDurationMs = 60000 / bpm;
    const beatDurationMs = originalBeatDurationMs * 0.6;
    console.log(`转换beats到毫秒: BPM=${bpm}, 每拍=${beatDurationMs.toFixed(1)}ms`);

    const processedNotes = congaArray.map((note, index) => {
        const processedNote = { ...note };

        // 转换时间并添加起始延迟
        const INITIAL_OFFSET = 100; // 500ms起始延迟
        processedNote.time = Math.round(note.time * beatDurationMs) + INITIAL_OFFSET;

        // 确保字段完整
        if (!processedNote.abbr && processedNote.type) {
            processedNote.abbr = processedNote.type[0].toUpperCase();
        }
        processedNote.accent = processedNote.accent || 0;
        processedNote.clave23 = processedNote.clave23 || 0;
        processedNote.clave32 = processedNote.clave32 || 0;

        return processedNote;
    });

    processedNotes.sort((a, b) => a.time - b.time);

    console.log(`时间转换完成: ${processedNotes.length}个音符, 最大时间=${Math.max(...processedNotes.map(n => n.time))}ms`);
    return processedNotes;
}


async function loadDefaultChart() {
    try {
        // 首先尝试加载Tumbao谱子
        let defaultFile = 'assets/tumbao.json';
        let fallbackFile = 'assets/bolero.json';

        let response = await fetch(defaultFile);
        if (!response.ok) {
            console.warn(`无法加载${defaultFile}，尝试加载${fallbackFile}`);
            response = await fetch(fallbackFile);
            if (!response.ok) {
                throw new Error(`无法加载任何默认谱子: HTTP ${response.status}`);
            }
        }

        const chartData = await response.json();

        console.log('=== JSON数据诊断 ===');
        console.log('原始JSON:', chartData);
        console.log('conga数组长度:', chartData.conga?.length);
        console.log('第一个音符:', chartData.conga?.[0]);

        // 设置为当前谱子
        window.chartJSON = chartData;
        ChartSelector.currentChart = chartData;
        applyNewChart(chartData);

        // ★ 处理后的数据诊断
        console.log('=== 处理后诊断 ===');
        console.log('scoreNotes长度:', rm.scoreNotes?.length);
        console.log('第一个scoreNote:', rm.scoreNotes?.[0]);
        console.log('总时长:', rm.totalDuration + 'ms');

        // 更新选择器显示的名称
        const currentName = document.getElementById('chart-current-name');
        if (currentName) {
            currentName.textContent = chartData.name || 'Default';
        }

        console.log('默认谱子加载完成:', chartData.name || 'Unknown');

    } catch (error) {
        console.error('加载默认谱子失败:', error);
        alert('无法加载默认谱子: ' + error.message);
    }
}

async function tryStartMicEarly() {
    try {
        if (typeof getAudioContext === 'function' && getAudioContext().state !== 'running') {
            await getAudioContext().resume().catch(() => { });
        }
    } catch (_) { }

    try {
        if (!mic) mic = new p5.AudioIn();
        await mic.start();
        micReady = true;
        if (ampHUD?.preferAmplitude) {
            setTimeout(() => ampHUD.preferAmplitude(true), 70);
        }
    } catch (e) {
        const retry = async () => {
            try { if (getAudioContext().state !== 'running') await getAudioContext().resume().catch(() => { }); } catch (_) { }
            try { if (!mic) mic = new p5.AudioIn(); await mic.start(); micReady = true; } catch (_) { }
        };
        window.addEventListener('pointerdown', retry, { once: true });
        window.addEventListener('touchstart', retry, { once: true, passive: true });
        window.addEventListener('keydown', retry, { once: true });
    }
}

function startPerformanceAfterFirstHit() {
    console.log('检测到第一击，开始演奏！');

    waitingForFirstHit = false;
    running = true;
    isPaused = false;

    if (countdownForResume) {
        console.log('=== 从暂停点恢复演奏 ===');

        // ★ 关键修复：使用精确的时间基准恢复
        const currentWallTime = millis();
        const targetLoopPosition = pausedAtLoopTime;  // 使用保存的精确循环内时间

        // ★ 正确计算新的startTime：让当前wall时间对应到目标循环位置
        rm.startTime = currentWallTime - (targetLoopPosition / rm.speedFactor);
        rm.paused = false;

        console.log(`恢复计算详情:
- 目标循环位置: ${targetLoopPosition.toFixed(1)}ms
- 当前wall时间: ${currentWallTime}ms  
- 速度因子: ${rm.speedFactor}
- 新startTime: ${rm.startTime.toFixed(1)}ms
- 验证: rm._t() = ${rm._t().toFixed(1)}ms
- 验证循环内: ${(rm._t() % rm.totalDuration).toFixed(1)}ms`);

        // ★ 关键：确保SweepMode与RM完全同步
        SweepMode.setStartGap(0);          // 清除倒计时间隙
        SweepMode._phaseBiasMs = 0;        // 重置相位偏移

        // ★ 恢复时重置循环计数器到当前循环
        lastRMCycle = Math.floor(rm._t() / rm.totalDuration);
        console.log(`设置循环计数器为: ${lastRMCycle}`);

        // ★ 验证同步：确保两个HUD指向相同位置
        setTimeout(() => {
            const rmLoopTime = rm._t() % rm.totalDuration;
            const sweepBarX = SweepMode.getBarX(RECT.sweep.x, RECT.sweep.w);
            const expectedBarX = RECT.sweep.x + (rmLoopTime / rm.totalDuration) * RECT.sweep.w;

            console.log(`同步验证:
- RM循环时间: ${rmLoopTime.toFixed(1)}ms (目标: ${targetLoopPosition.toFixed(1)}ms)
- 偏差: ${Math.abs(rmLoopTime - targetLoopPosition).toFixed(1)}ms
- SweepMode bar位置: ${sweepBarX.toFixed(1)}px
- 期望bar位置: ${expectedBarX.toFixed(1)}px
- Bar位置偏差: ${Math.abs(sweepBarX - expectedBarX).toFixed(1)}px`);
        }, 50);

    } else {
        console.log('=== 从头开始演奏 ===');

        // ★ 全新开始：完全重置确保同步
        rm.reset();
        rm.startTime = millis();
        rm.paused = false;
        pausedAtLoopTime = 0;
        pausedAtWallTime = 0;
        resumePosition = 0;
        lastRMCycle = 0;

        // ★ 重置SweepMode到初始状态
        SweepMode.clearHits();
        SweepMode.setStartGap(0);          // 清除倒计时间隙
        SweepMode._phaseBiasMs = 0;        // 重置相位偏移

        // 重置游戏状态
        rm.feedbackStates = rm._emptyFeedback();
        rm._loopIdx = 0;
        HitMarkers.clearAllMarkers();
        StarEffects.clear();
    }

    // 启动节拍器（如果启用）
    if (metronomeEnabled) {
        metro.enable(true);
        resetMetronomeSchedulerState();
        armNextTickNow();
    }

    startScoreTickScheduler();
    console.log('演奏已开始，两个HUD已同步！');

    // ★ 立即验证同步状态
    //setTimeout(() => verifySyncStatus(), 100);
}

/* ------------ Control Functions ------------- */
async function handleStart() {
    if (running || counting) return;
    await window.userStartAudio?.();
    try { if (!window.mic) window.mic = new p5.AudioIn(); await mic.start(); } catch (e) { console.warn("Mic start failed:", e); }

    if (isPaused) {
        // ★ 从暂停状态恢复：使用保存的精确位置
        console.log(`准备从暂停点恢复:
- 暂停的循环内时间: ${pausedAtLoopTime.toFixed(1)}ms
- 暂停的wall时间: ${pausedAtWallTime}ms
- 当前wall时间: ${millis()}ms`);

        // 为节拍器准备
        const notes = rm.scoreNotes;
        for (let i = 0; i < notes.length; i++) {
            if (notes[i].time >= pausedAtLoopTime) {
                schedulerState.lastIdx = i - 1;
                break;
            }
        }
        startCountdown({ resume: true });
        return;
    }
    pausedAtLoopTime = 0;
    pausedAtWallTime = 0;
    resumePosition = 0;
    startCountdown({ resume: false });
    metro.reset();
    metro.useInternalGrid = false;
    resetMetronomeSchedulerState();
}

function handlePause() {
    if (!running && !counting) return;

    if (waitingForFirstHit) {
        // 在等待状态下暂停回到倒计时前状态
        waitingForFirstHit = false;
        counting = false;
        return;
    }

    console.log('===== 暂停演奏 =====');

    isPaused = true; running = false;

    // ★ 关键修复：精确保存暂停时的循环内位置
    const currentTotalTime = rm._t();  // 获取总时间
    pausedAtLoopTime = currentTotalTime % rm.totalDuration;  // 循环内时间
    pausedAtWallTime = millis();  // 当前wall clock时间

    // ★ 为了兼容性保留原变量，但使用新的精确值
    resumePosition = pausedAtLoopTime;
    rm.pauseAt = rm.startTime + currentTotalTime;

    counting = false;
    rm.pause();
    stopScoreTickScheduler();
    if (metro?.isLoaded) metro.flushFuture();

    console.log(`精确暂停信息:
- 总时间: ${currentTotalTime.toFixed(1)}ms
- 循环内时间: ${pausedAtLoopTime.toFixed(1)}ms  
- Wall clock: ${pausedAtWallTime}ms
- 速度因子: ${rm.speedFactor}`);
}

function handleReset() {
    running = false;
    counting = false;
    isPaused = false;
    waitingForFirstHit = false;

    // ★ 重置所有时间记录
    pausedAtLoopTime = 0;
    pausedAtWallTime = 0;
    resumePosition = 0;
    lastRMCycle = 0;

    rm.reset();
    rm.pause();
    rm.pauseAt = rm.startTime;

    stopScoreTickScheduler();
    resetMetronomeSchedulerState();
    metro.reset();

    try { if (mic && mic.start) mic.start(); } catch (e) { console.warn(e); }

    // 重置SweepMode到初始同步状态
    SweepMode.clearHits();
    SweepMode.setStartGap(COUNTDOWN_MS || 0);
    SweepMode._phaseBiasMs = 0;
    SweepMode.snapToLeft();
    scoreHUD?.reset?.();
    StarEffects.clear();
    HitMarkers.clearAllMarkers();
    resetStatusTracker();

    console.log('系统已重置，所有时间记录清除');
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
        SweepMode._phaseBiasMs = 0;  // 重置相位偏移
        SweepMode.snapToLeft();
    }
}

/* ------------ Draw Loop ----------- */
let frameTimeBuffer = [];
let lastOptimizeCheck = 0;
let performanceMode = 'normal';
let resumeMonitorStartTime = 0;
const urgent = window.LatencyProbe?.isUrgent?.() === true;
function draw() {
    // 如果绘画模式激活，暂停主游戏渲染
    if (window.DrawingMode && window.DrawingMode.isActive()) {
        return; // 完全跳过主游戏的渲染
    }

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
    judgeLineGlow *= 0.9;
    if (judgeLineGlow < 0.01) judgeLineGlow = 0;

    if (performanceMode === 'performance') {
        if (frameCount % 2 === 0) drawGrid();
    } else {
        drawGrid();
    }

    // ★ 在适当位置添加恢复监控
    if (running && countdownForResume && !waitingForFirstHit) {
        if (resumeMonitorStartTime === 0) {
            resumeMonitorStartTime = millis();
        } else if (millis() - resumeMonitorStartTime < 5000) {
            // 前5秒进行监控
            if (frameCount % 120 === 0) { // 每2秒检查一次
                monitorSyncAfterResume();
            }
        } else {
            // 监控期结束，重置标志
            resumeMonitorStartTime = 0;
        }
    }

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

    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) {
            counting = false;

            // ★ 进入等待状态时的处理：区分新开始和恢复
            if (countdownForResume) {
                // 从暂停恢复：不需特别处理时间，保持暂停状态
                console.log('倒计时结束，等待第一次打击以从暂停点恢复...');
            } else {
                // 全新开始：暂停时间管理器
                rm.pause();
                console.log('倒计时结束，时间已暂停，等待第一次打击从头开始...');
            }

            waitingForFirstHit = true;
        } else {
            drawCountdown(remain);
        }
    }

    // ★ 等待第一击状态
    if (waitingForFirstHit) {
        drawWaitingForFirstHit();
    }

    // ★ 只有在真正运行且不在等待状态时才更新游戏逻辑
    if (running && !waitingForFirstHit) {
        rm.checkAutoMiss();

        // ★ 关键修复：检查循环切换并清除命中线
        const currentRMCycle = Math.floor(rm._t() / rm.totalDuration);
        if (currentRMCycle > lastRMCycle) {
            console.log(`RM进入新循环 ${currentRMCycle}，清除SweepMode命中线`);
            SweepMode.clearHits();  // 清除所有命中线
            lastRMCycle = currentRMCycle;
        }

        rm.checkLoopAndRestart();

        // ★ 定期同步检查（每60帧检查一次）
        if (frameCount % 60 === 0) {
            verifySyncStatus();
        }
    }

    if (drumTrigger && drumTrigger._isEnabled) {
        drumTrigger.update();

        if (isMobile() && frameCount % 60 === 0) {
            try {
                const currentVol = drumTrigger._getCurrentVolume?.() || 0;
                console.log(`移动端调试 - 音量: ${currentVol.toFixed(4)}, 启用: ${drumTrigger._isEnabled}, 触发次数: ${drumTrigger._triggerCount}`);
            } catch (e) {
                console.warn('移动端调试信息获取失败:', e);
            }
        }
    }

    NoteIlluminateFeedback.render();
    HitMarkers.render();
    StarEffects.update(deltaTime || 16.67);
    StarEffects.render();

    SweepMode.render(drawingContext, RECT.sweep.x, RECT.sweep.y, RECT.sweep.w, RECT.sweep.h);

    if (!urgent) {
        if (performanceMode === 'performance') {
            if (frameCount % 2 === 0) {
                fftHUD?.render?.(drawingContext, RECT.fft.x, RECT.fft.y, RECT.fft.w, RECT.fft.h);
                ampHUD?.render?.(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
            }
        } else {
            fftHUD?.render?.(drawingContext, RECT.fft.x, RECT.fft.y, RECT.fft.w, RECT.fft.h);
            ampHUD?.render?.(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
        }
    }
    scoreHUD?.render?.(drawingContext, RECT.score.x, RECT.score.y, RECT.score.w, RECT.score.h);

    if (debugMode && drumTrigger) {
        const debugW = 200, debugH = 120;
        const debugX = width - debugW - 10;
        const debugY = 10;
        drumTrigger.renderDebugPanel?.(drawingContext, debugX, debugY, debugW, debugH);
    }

    push();
    stroke(220); strokeWeight(2);
    const yTopDiv = Math.round(RECT.sweep.y - GRID.pad) + 0.5;
    const yBelowSweep = Math.round(RECT.sweep.y + RECT.sweep.h + GRID.pad) + 0.5;
    line(0, yTopDiv, width, yTopDiv);
    line(0, yBelowSweep, width, yBelowSweep);

    stroke(220); strokeWeight(2);
    const midX = Math.round(width / 2) + 0.5;
    line(midX, yBelowSweep, midX, height - GRID.pad);

    stroke(200); strokeWeight(1.5);
    const midXRight = Math.round(RECT.rightHalf.x + RECT.rightHalf.w / 2) + 0.5;
    line(midXRight, RECT.rightHalf.y, RECT.rightHalf.x + RECT.rightHalf.w, RECT.rightHalf.y);
    line(midXRight, RECT.rightHalf.y, midXRight, RECT.rightHalf.y + RECT.rightHalf.h);
    pop();

    drawPerformanceStatus();

    const frameTime = performance.now() - frameStart;
    frameTimeBuffer.push(frameTime);
    if (frameTimeBuffer.length > 10) frameTimeBuffer.shift();

    if (millis() - lastOptimizeCheck > 2000) {
        const avgFrameTime = frameTimeBuffer.reduce((a, b) => a + b, 0) / frameTimeBuffer.length;
        const targetFrameTime = 1000 / (isMobile() ? 30 : 45);

        if (avgFrameTime > targetFrameTime * 1.2 && performanceMode === 'normal') {
            performanceMode = 'performance';
            console.log('Switching to performance mode');
        } else if (avgFrameTime < targetFrameTime * 0.8 && performanceMode === 'performance') {
            performanceMode = 'normal';
            console.log('Switching to normal mode');
        }

        lastOptimizeCheck = millis();
    }
    LatencyProbe?.markFrame();
}

function verifySyncStatus() {
    if (!SweepMode || !rm || !running) return;

    const rmTime = rm._t();
    const rmLoopTime = rmTime % rm.totalDuration;
    const rmPhase = rmLoopTime / rm.totalDuration;

    // SweepMode的虚拟时间计算
    const sweepVirtual = (rmTime * SweepMode._speedMul + SweepMode._phaseBiasMs) % SweepMode._loopMs;
    const sweepPhase = sweepVirtual / SweepMode._loopMs;

    // 计算期望的虚拟时间
    const expectedVirtual = (rmLoopTime / rm.totalDuration) * SweepMode._loopMs;
    const expectedPhase = expectedVirtual / SweepMode._loopMs;

    // 计算相位差
    let phaseDiff = Math.abs(sweepPhase - expectedPhase);
    if (phaseDiff > 0.5) phaseDiff = 1 - phaseDiff; // 处理循环边界

    // 如果相位差异超过3%就重新同步
    if (phaseDiff > 0.03) {
        console.log(`检测到HUD相位漂移: ${(phaseDiff * 100).toFixed(1)}%, 重新同步`);

        // 强制同步
        const targetBias = (expectedVirtual - (rmTime * SweepMode._speedMul % SweepMode._loopMs) + SweepMode._loopMs) % SweepMode._loopMs;
        SweepMode._phaseBiasMs = targetBias;

        console.log(`相位修正完成，偏移设置为: ${targetBias.toFixed(1)}ms`);
    }
}

function drawWaitingForFirstHit() {
    push();

    // 半透明背景遮罩
    fill(0, 0, 0, 120);
    rect(0, 0, width, RECT.top.h);

    // 根据是否从暂停恢复显示不同文字
    const mainText = countdownForResume ? 'Hit to Resume' : 'Hit to Start Performance';
    let subText = '';

    if (countdownForResume) {
        // ★ 显示更精确的恢复信息
        const pausedSec = pausedAtLoopTime / 1000;
        subText = `Resume from ${pausedSec.toFixed(1)}s in loop`;
    } else {
        subText = 'Start from Beginning';
    }

    // 主要提示文字
    textSize(48);
    fill(255, 215, 0);
    textAlign(CENTER, CENTER);
    const cy = RECT.top.y + RECT.top.h / 2;
    text(mainText, width / 2, cy - 20);

    // 副提示文字
    textSize(20);
    fill(200, 200, 200);
    text(subText, width / 2, cy + 25);

    // ★ 调试信息（仅在debug模式下显示）
    if (debugMode && countdownForResume) {
        textSize(12);
        fill(150, 150, 150);
        text(`Debug: Wall time ${pausedAtWallTime}, Loop time ${pausedAtLoopTime.toFixed(1)}ms`,
            width / 2, cy + 50);
    }

    // 鼓的图标 - 闪烁效果
    const alpha = map(sin(millis() * 0.006), -1, 1, 0.4, 1.0);
    fill(255, 255, 255, alpha * 255);
    textSize(28);
    text('🥁', width / 2, cy + 65);

    pop();
}

/* ------------ 新增：同步状态监控函数 ------------ */
function monitorSyncAfterResume() {
    // 仅在从暂停恢复后的前几秒进行密集监控
    if (!countdownForResume || !running) return;

    const rmLoopTime = rm._t() % rm.totalDuration;
    const targetTime = pausedAtLoopTime;
    const timeDiff = Math.abs(rmLoopTime - targetTime);

    // 如果偏差超过50ms，报告问题
    if (timeDiff > 50) {
        console.warn(`恢复后同步偏差过大:
- 当前循环时间: ${rmLoopTime.toFixed(1)}ms
- 目标循环时间: ${targetTime.toFixed(1)}ms  
- 偏差: ${timeDiff.toFixed(1)}ms`);
    } else {
        console.log(`恢复同步状态良好，偏差: ${timeDiff.toFixed(1)}ms`);
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

    if (scoreHUD && typeof scoreHUD.registerHit === 'function') {
        const map = { Perfect: 'perfect', Good: 'good', Miss: 'miss' };
        const timing = map[result] || 'miss';
        const hitType = window._lastHitType || 'unknown';
        scoreHUD.registerHit(timing, hitType);
    }
}

function resetStatusTracker() {
    if (!window.statusTracker) return;
    window.statusTracker.successfulHits = 0;
    window.statusTracker.recentResults = [];
    window.statusTracker.currentInputLevel = 0;
}

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

function handleScorePanelClick(x, y, w, h) {
    const gap = 3;

    // 计算各方块的位置
    const topH = Math.floor(h * 0.25);
    const midH = Math.floor(h * 0.38);
    const bottomH = h - topH - midH - gap * 2;
    const bottomHalfW = Math.floor((w - gap) / 2);

    // 检查顶部方块（模式滑块）
    if (y >= 0 && y <= topH) {
        const newMode = !scoreHUD.getScoreData().isEntertainmentMode;
        window.scorePanelInterface?.setMode?.(newMode);
        console.log(`模式切换: ${newMode ? '娱乐模式' : '练习模式'}`);
        return;
    }

    // 检查右下方块（节拍选择器）
    const bottomY = topH + gap + midH + gap;
    const rightBlockX = bottomHalfW + gap;

    if (y >= bottomY && x >= rightBlockX) {
        const relX = x - rightBlockX;
        const relY = y - bottomY;

        // 计算圆圈位置
        const circleRadius = Math.min(bottomHalfW / 5, bottomH / 5);
        const centerX1 = bottomHalfW * 0.3;
        const centerX2 = bottomHalfW * 0.7;
        const centerY1 = bottomH * 0.45;
        const centerY2 = bottomH * 0.75;

        const circles = [
            { x: centerX1, y: centerY1, index: 0 },
            { x: centerX2, y: centerY1, index: 1 },
            { x: centerX1, y: centerY2, index: 2 },
            { x: centerX2, y: centerY2, index: 3 }
        ];

        circles.forEach(circle => {
            const dist = Math.sqrt((relX - circle.x) ** 2 + (relY - circle.y) ** 2);
            if (dist <= circleRadius) {
                window.scorePanelInterface?.selectRhythm?.(circle.index);
                console.log(`选择节拍 ${circle.index + 1}`);
            }
        });
    }
}

function drawPerformanceStatus() {
    if (!window.statusTracker) return;
    push();

    const baseY = RECT.top.h - 25;
    const baseX = width - 350;

    const totalNotes = rm.scoreNotes ? rm.scoreNotes.length : 0;
    const hitRate = `${window.statusTracker.successfulHits}/${totalNotes}`;
    const percentage = totalNotes > 0 ? Math.round((window.statusTracker.successfulHits / totalNotes) * 100) : 0;

    let rateColor = '#ff4444';
    if (percentage >= 80) rateColor = '#00ff88';
    else if (percentage >= 60) rateColor = '#88ff00';
    else if (percentage >= 40) rateColor = '#ffaa00';

    const quality = getCurrentSyncQuality();

    textSize(16);
    textStyle(BOLD);
    textAlign(LEFT, TOP);
    noStroke();

    let x = baseX, y = baseY;

    fill(208, 209, 210); text('Hit Rate:', x, y); x += textWidth('Hit Rate: ') + 4;
    fill(255); text(hitRate, x, y); x += textWidth(hitRate + ' ');
    fill(rateColor); text(`(${percentage}%)`, x, y); x += textWidth(`(${percentage}%)`);

    fill(200); text('  |  ', x, y); x += textWidth('  |  ');

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

function keyPressed() {
    // === 调试模式切换（最高优先级）===
    // Ctrl+I: 调试面板
    if (key === 'i' && keyIsDown(CONTROL)) {
        if (window.hitRecognitionIntegration) {
            window.hitRecognitionIntegration.toggleDebugInterface();
        }
        return;
    }

    // Ctrl+T: 测试套件
    if (key === 't' && keyIsDown(CONTROL)) {
        if (window.recognitionTestingSuite) {
            window.recognitionTestingSuite.showTestingInterface();
        }
        return;
    }

    // Ctrl+V: 频谱可视化
    if (key === 'v' && keyIsDown(CONTROL)) {
        if (window.spectrumVisualizer) {
            window.spectrumVisualizer.toggle();
        }
        return;
    }


    // Shift+M: 切换识别模式
    if (key === 'M') { // 注意这里是大写M，因为按了Shift
        if (window.hitRecognitionIntegration) {
            const modes = ['intelligent', 'simple'];
            const current = window.hitRecognitionIntegration.processingMode;
            const nextIndex = (modes.indexOf(current) + 1) % modes.length;
            window.hitRecognitionIntegration.setProcessingMode(modes[nextIndex]);
            console.log(`模式切换至: ${modes[nextIndex]}`);
        }
        return;
    }

    // Shift+N: 重新校准噪音
    if (key === 'N') { // 注意这里是大写N，因为按了Shift
        if (window.hitRecognitionIntegration?.noiseProcessor) {
            window.hitRecognitionIntegration.noiseProcessor.calibrateNoiseFloor();
            console.log('手动触发噪音校准');
        }
        return;
    }

    if (key === 'd') {
        debugMode = !debugMode;
        drumTrigger?.setDebug?.(debugMode);

        // 初始化调试面板（如果还没有）
        if (!debugPanel) {
            debugPanel = new DebugPanel();
        }

        // 切换调试面板显示
        if (debugMode) {
            debugPanel.show();
            console.log('🔧 Debug Panel: OPENED');
        } else {
            debugPanel.hide();
            console.log('🔧 Debug Panel: CLOSED');
        }

        return; // 防止其他键处理
    }

    // === 调试面板激活时的热键处理 ===
    if (debugPanel && debugPanel.visible) {
        // 调试面板显示时，大部分热键由GUI接管
        // 只保留必要的帮助功能
        if (key.toLowerCase() === 'h') {
            showAmplitudeHelp();
            return;
        }

        // 提示用户使用GUI界面
        console.log('💡 调试面板已激活，请使用图形界面代替热键操作');
        return;
    }

    // === 正常模式下的热键（调试面板未显示时）===

    // 振幅系统热键
    if (key.toLowerCase() === 'a' && ampHUD) {
        cycleAmplitudeMode();
        return;
    }

    if (key.toLowerCase() === 'z' && ampHUD) {
        cycleCompressionMode();
        return;
    }

    if (key.toLowerCase() === 'x' && ampHUD && !isMobile()) {
        toggleFastResponse();
        return;
    }

    if (key.toLowerCase() === 'h') {
        showAmplitudeHelp();
        return;
    }

    // 鼓触发器热键
    if (key === 't' && drumTrigger) {
        const isEnabled = !drumTrigger._isEnabled;
        drumTrigger.enable(isEnabled);
        console.log(`Drum trigger: ${isEnabled ? 'ON' : 'OFF'}`);
    }

    if (key >= '1' && key <= '5' && drumTrigger) {
        const level = parseInt(key);
        const sensitivity = Math.pow(level / 5.0, 0.5);
        drumTrigger.setSensitivity(sensitivity);
        console.log(`Drum sensitivity: ${level}/5 (${sensitivity.toFixed(1)})`);
    }

    if (key === 'r' && drumTrigger) {
        drumTrigger.resetStats();
        console.log('Drum trigger stats reset');
    }

    if (key === 'i' && drumTrigger) {
        const stats = drumTrigger.getStats();
        console.log('Drum Trigger Stats:', stats);
    }

    // FFT热键
    if (key.toLowerCase() === 'l' && fftHUD?.setAxis) {
        const m = (fftHUD._axisMode === 'linear') ? 'hybrid' : 'linear';
        fftHUD.setAxis({ mode: m });
        console.log('FFT axis mode:', m);
    }

    // 移动端特殊功能
    if (key === 'x' && isMobile()) {
        console.log('手动触发移动端测试');
        if (drumTrigger && drumTrigger._onTrigger) {
            drumTrigger._onTrigger('MANUAL_MOBILE_TEST');
        }
    }

    // 保留的开发者功能
    if (key === 'p' && debugMode) {
        if (window.DrawingMode) {
            if (window.DrawingMode.isActive()) {
                window.DrawingMode.deactivate();
            } else {
                window.DrawingMode.activate(0);
            }
        }
    }
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log('桌面端全屏失败:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

function updateMetroBtnUI() {
    const btn = select('#metro-toggle');
    if (!btn) return;

    // 使用CSS类而不是内联样式
    if (metronomeEnabled) {
        // 开启状态：添加 active 类
        btn.addClass('active');
    } else {
        // 关闭状态：移除 active 类
        btn.removeClass('active');
    }

    // 也可以处理下拉箭头按钮（如果存在）
    const arrowBtn = select('#rhythm-arrow');
    if (arrowBtn) {
        if (metronomeEnabled) {
            arrowBtn.addClass('active');
        } else {
            arrowBtn.removeClass('active');
        }
    }

    console.log(`节拍器状态: ${metronomeEnabled ? '开启' : '关闭'}`);
}

/* ------------ Interaction ----------- */
function mousePressed() {
    if (waitingForFirstHit && debugMode) {
        console.log('手动触发第一击（调试模式）');
        startPerformanceAfterFirstHit();
        return;
    }

    // ★ 添加ScorePanel交互检测
    if (scoreHUD && RECT.score) {
        const mx = mouseX;
        const my = mouseY;
        const rect = RECT.score;

        // 检查是否点击在ScorePanel区域内
        if (mx >= rect.x && mx <= rect.x + rect.w &&
            my >= rect.y && my <= rect.y + rect.h) {

            handleScorePanelClick(mx - rect.x, my - rect.y, rect.w, rect.h);
            return;
        }
    }

    if (running && debugMode) {
        const hitTime = rm._t();
        rm.registerHit();
        SweepMode?.addHitNow?.();
        HitMarkers.addHitMarker(hitTime);
        judgeLineGlow = 1;
        console.log('Manual hit (debug mode)');
    }
}

function touchStarted() {
    // ★ 检查是否在等待第一击状态
    if (waitingForFirstHit && (debugMode || isMobile())) {
        console.log('触摸触发第一击（移动端）');
        startPerformanceAfterFirstHit();
        return false;
    }

    if (running && (debugMode || isMobile())) {
        const hitTime = rm._t();
        rm.registerHit();
        SweepMode?.addHitNow?.();
        HitMarkers.addHitMarker(hitTime);
        judgeLineGlow = 1;
        console.log('触摸测试命中已注册 (移动端)');
        return false;
    }
}

/* ------------ 调试工具函数 ------------ */
function debugPauseResumeState() {
    console.log(`=== 暂停恢复状态调试 ===
当前状态:
- running: ${running}
- isPaused: ${isPaused}  
- waitingForFirstHit: ${waitingForFirstHit}
- countdownForResume: ${countdownForResume}

时间记录:
- pausedAtLoopTime: ${pausedAtLoopTime.toFixed(1)}ms
- pausedAtWallTime: ${pausedAtWallTime}ms
- resumePosition: ${resumePosition.toFixed(1)}ms
- rm.speedFactor: ${rm?.speedFactor}

当前时间 (如果running):
- rm._t(): ${running ? rm._t().toFixed(1) : 'N/A'}ms
- 循环内时间: ${running ? (rm._t() % rm.totalDuration).toFixed(1) : 'N/A'}ms
- Wall时间: ${millis()}ms`);
}


//debugging helper functions
function cycleAmplitudeMode() {
    const modes = [
        { name: 'FFT-RMS (固定)', preferAmp: false, dynamicScale: false },
        { name: 'FFT-RMS (自动)', preferAmp: false, dynamicScale: true, instantAdapt: false },
        { name: 'FFT-RMS (快速)', preferAmp: false, dynamicScale: true, instantAdapt: true }
    ];

    // 尝试添加p5.Amplitude模式
    try {
        ampHUD.tryEnableAmplitude();
        if (ampHUD._amp) {
            modes.push(
                { name: 'p5.Amplitude (固定)', preferAmp: true, dynamicScale: false },
                { name: 'p5.Amplitude (自动)', preferAmp: true, dynamicScale: true, instantAdapt: false }
            );
        }
    } catch (e) { }

    const current = ampHUD.getAmplitudeState();
    let currentIndex = modes.findIndex(mode =>
        mode.preferAmp === current.preferAmp &&
        mode.dynamicScale === current.dynamicScale &&
        mode.instantAdapt === current.instantAdapt
    );

    if (currentIndex === -1) currentIndex = 0;
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    ampHUD.preferAmplitude(nextMode.preferAmp);
    ampHUD.setDynamicScale(nextMode.dynamicScale);
    if (nextMode.dynamicScale && nextMode.hasOwnProperty('instantAdapt')) {
        ampHUD.setInstantAdapt(nextMode.instantAdapt);
    }

    console.log(`振幅模式: ${nextMode.name}`);
    showTemporaryStatus(`振幅: ${nextMode.name}`, 2000);
}

function cycleCompressionMode() {
    const modes = [
        { mode: 'none', name: '无压缩' },
        { mode: 'logarithmic', name: '对数压缩' },
        { mode: 'tanh', name: 'Tanh压缩' },
        { mode: 'soft_clip', name: '多项式压缩' }
    ];

    const currentMode = ampHUD._compressionMode || 'logarithmic';
    const currentIndex = modes.findIndex(m => m.mode === currentMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];

    if (nextMode.mode === 'none') {
        ampHUD._compressionMode = 'none';
    } else {
        ampHUD.setCompressionMode(nextMode.mode, 0.4);
    }

    console.log(`压缩模式: ${nextMode.name}`);
    showTemporaryStatus(`压缩: ${nextMode.name}`, 2000);
}

function toggleFastResponse() {
    const current = ampHUD._fastResponse;
    ampHUD.setFastResponse(!current);

    const mode = !current ? '快速响应' : '平滑响应';
    console.log(`响应模式: ${mode}`);
    showTemporaryStatus(`响应: ${mode}`, 1500);
}

function showAmplitudeHelp() {
    const helpText = `
振幅面板控制帮助
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[D] 打开/关闭调试面板 (推荐！)

传统热键 (面板关闭时可用):
[A] 振幅模式循环
[Z] 压缩模式循环  
[X] 响应速度切换 [桌面端]
[H] 显示此帮助

🔧 推荐使用调试面板的图形界面！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `;

    console.log(helpText);
    showTemporaryStatus('振幅帮助已显示 - 按D键打开调试面板', 3000);
}

// 临时状态指示器（如果还没有）
let _statusTimeout = null;
function showTemporaryStatus(message, duration = 2000) {
    if (_statusTimeout) clearTimeout(_statusTimeout);

    let statusDiv = document.getElementById('amp-status-indicator');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'amp-status-indicator';
        statusDiv.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background: rgba(0, 0, 0, 0.8); color: #00ff88;
            padding: 8px 16px; border-radius: 4px;
            font-family: 'Courier New', monospace; font-size: 14px; font-weight: bold;
            z-index: 9999; border: 1px solid rgba(0, 255, 136, 0.3);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(statusDiv);
    }

    statusDiv.textContent = message;
    statusDiv.style.opacity = '1';

    _statusTimeout = setTimeout(() => {
        if (statusDiv) {
            statusDiv.style.opacity = '0';
            setTimeout(() => {
                if (statusDiv && statusDiv.parentNode) {
                    statusDiv.parentNode.removeChild(statusDiv);
                }
            }, 300);
        }
    }, duration);
}