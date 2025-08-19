/* ------------ Globals ------------ */
let rm;
let metro;
let running = false, counting = false;
let ctStart = 0;
let judgeLineGlow = 0; // 红线发光效果
let metronomeEnabled = false;
let chartJSON;
let lastNoteIdx = -1;
let mic;
const COUNTDOWN_MS = 3000;

const BPM_MIN = 60, BPM_MAX = 240;
const SPEED_MIN = 0.10, SPEED_MAX = 0.40;

let _emaE = 0, _emaVar = 1, _alphaE = 0.08;
const MIN_MARGIN = 0.08;
let ENERGY_Z = 1.6; //默认阈值
const DEBUG = false;         // 统一开关：需要时改成 true 再看日志
const ACCENT_MODE = 'score';

let METRO_OFFSET_STEPS = 0;
function getMetroOffsetMs() { return (METRO_OFFSET_STEPS || 0) * (rm?.noteInterval || 0); }

const NOTE_GLYPH = {
    S: '×',  // Slap
    O: 'O',  // Open tone
    T: '▲',  // Tip
    P: '▼',  // Palm
    B: 'B'   // Bass
};
function glyphForAbbr(ab) {
    const k = (ab ?? '').toString().toUpperCase();
    return NOTE_GLYPH[k] || k;
}

// 两条谱线之间的垂直间距（像素）
const LANE_GAP = 30;

// 判定：这个音符是否属于“下面那只鼓”
function isBottomDrum(n) {
    // 优先看 JSON 是否提供 drum:2；否则用小写 abbr 作为简易标记
    if (n.drum === 2) return true;
    const ab = n.abbr || n.type?.[0];
    return !!ab && (ab === ('' + ab).toLowerCase());
}

// 取两条谱线的 Y 坐标（以 rm.noteY 为中心上下各一条）
function laneTopY() { return rm.noteY - LANE_GAP / 2; }
function laneBottomY() { return rm.noteY + LANE_GAP / 2; }

// —— 按谱面驱动的 WebAudio 预调度 —— //
let _tickSchedTimer = null;

// 根据当前速度动态给预调度窗口：慢速更早排、快速保持紧凑
function getAheadMs() {
    // 每格(八分音)时长：rm.noteInterval
    // 窗口 ≈ 0.75 格，限制在 [140ms, 320ms]
    const win = Math.max(140, Math.min(320, rm.noteInterval * 0.75));
    return win;
}

function startScoreTickScheduler() {
    stopScoreTickScheduler();
    scheduleTicksOnce._lastIdx = -1;   // 重置上次调度位置
    scheduleTicksOnce();
    _tickSchedTimer = setInterval(scheduleTicksOnce, 22);
}
function stopScoreTickScheduler() {
    if (_tickSchedTimer) {
        clearInterval(_tickSchedTimer);
        _tickSchedTimer = null;
    }
}

function scheduleTicksOnce() {
    if (!metronomeEnabled || !running || !metro || !metro.isLoaded()) return;
    const ctxNow = metro.ctx.currentTime;
    const nowMs = rm._t() % rm.totalDuration;
    const aheadMs = getAheadMs();

    if (scheduleTicksOnce._lastNowMs != null && nowMs < scheduleTicksOnce._lastNowMs - 5) {
        scheduleTicksOnce._lastIdx = -1;
        if (scheduleTicksOnce._seen) scheduleTicksOnce._seen.clear();
        scheduleTicksOnce._guardUntil = 0;
    }
    scheduleTicksOnce._lastNowMs = nowMs;

    const notes = rm.scoreNotes;
    if (!notes || !notes.length) return;

    if (typeof scheduleTicksOnce._lastIdx !== 'number') scheduleTicksOnce._lastIdx = -1;

    // 从下一个音符开始，安排落在 [0, aheadMs] 的所有音符
    // 从下一个音符开始，安排落在 [0, aheadMs] 的所有音符
    let idx = ((scheduleTicksOnce._lastIdx ?? -1) + 1 + notes.length) % notes.length;
    let count = 0;

    while (count < notes.length) {
        const n = notes[idx];
        // 该音符距离“现在”的毫秒（回环修正）
        let dt = n.time - nowMs;
        if (dt < 0) dt += rm.totalDuration;
        if (dt > aheadMs) break; // 超出预调度窗口

        const sf = rm?.speedFactor || 1;
        const when = ctxNow + Math.max(0, (dt + getMetroOffsetMs()) / (1000 * sf));
        const strong = ((n.accent | 0) === 1);          // ★ 严格按 JSON 的 accent

        // —— 去重与保护 —— //
        if (!scheduleTicksOnce._seen) scheduleTicksOnce._seen = new Map();
        // 清理过期记录（>1.5s 的安排）
        for (const [k, t] of scheduleTicksOnce._seen) {
            if (t < ctxNow - 1.5) scheduleTicksOnce._seen.delete(k);
        }

        const lastWhen = scheduleTicksOnce._seen.get(idx) ?? -Infinity;
        const recentlyScheduled = Math.abs(when - lastWhen) < 0.04;       // 40ms 内视为重复
        const guarded = !!(scheduleTicksOnce._guardUntil && when <= scheduleTicksOnce._guardUntil);

        if (!recentlyScheduled && !guarded) {
            metro.scheduleAt(when, strong);                         // 真正安排播放
            scheduleTicksOnce._seen.set(idx, when);                 // 记录这次安排（用于去重）
        }

        scheduleTicksOnce._lastIdx = idx;                         // 向后推进指针
        idx = (idx + 1) % notes.length;
        count++;
    }

}

// 立刻对“最靠近判定线”的音符打一下（用于改速时相位重锁）
function forceClickNearestIfCentered(centerMs = 35) {
    if (!metronomeEnabled || !metro || !metro.isLoaded() || !rm?.scoreNotes?.length) return;
    const nowTs = performance.now();
    if (rm.noteInterval >= 450) centerMs = Math.max(centerMs, 60);
    if (forceClickNearestIfCentered._last && (nowTs - forceClickNearestIfCentered._last) < 280) return;
    const nowMs = rm._t() % rm.totalDuration;

    // 找到“前一个”和“后一个”音符
    const notes = rm.scoreNotes;
    let nextIdx = notes.findIndex(n => n.time >= nowMs);
    if (nextIdx < 0) nextIdx = 0;
    const prevIdx = (nextIdx - 1 + notes.length) % notes.length;

    const dNext = Math.abs(notes[nextIdx].time - nowMs);
    const dPrev = Math.abs(nowMs - notes[prevIdx].time);
    // 选更近的那个
    const nearestIdx = (dNext <= dPrev) ? nextIdx : prevIdx;
    const nearestDist = Math.min(dNext, dPrev);

    // 足够靠近判定线才触发（避免乱敲）
    if (nearestDist <= centerMs) {
        const isStrong = ((notes[nearestIdx].accent | 0) === 1);
        const sf = rm?.speedFactor || 1;
        const offsetSec = Math.max(0.03, getMetroOffsetMs() / (1000 * sf));
        metro.scheduleAt(metro.ctx.currentTime + offsetSec, isStrong);
        // 让预调度从“下一个音符”开始排，避免重复
        scheduleTicksOnce._lastIdx = nearestIdx;
        forceClickNearestIfCentered._last = nowTs;
    }
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


const GRID = { pad: 10, topHRatio: 0.5 };   // 上半占总高 1/2
const RECT = { top: {}, amp: {}, drum: {}, mic: {} };
let _canvasHost;

function layoutRects(cnv) {
    const topH = Number.isFinite(GRID.topHpx)
        ? GRID.topHpx
        : Math.round(height * GRID.topHRatio);
    const botY = topH, botH = height - topH;

    const col0 = Math.round(width * 0.5);     // 左 1/2
    const col1 = Math.round(width * 0.25);    // 中 1/4
    const col2 = width - col0 - col1;         // 右 1/4

    RECT.top = { x: 0, y: 0, w: width, h: topH };

    RECT.amp = {
        x: GRID.pad, y: botY + GRID.pad,
        w: col0 - GRID.pad * 2, h: botH - GRID.pad * 2
    };
    if (window.SampleUI?.resize) {
        SampleUI.resize(RECT.amp.w, RECT.amp.h);  // ★ 使内部画布与槽位一致
    }

    RECT.drum = {
        x: col0 + GRID.pad, y: botY + GRID.pad,
        w: col1 - GRID.pad * 2, h: botH - GRID.pad * 2
    };

    RECT.mic = {
        x: col0 + col1 + GRID.pad, y: botY + GRID.pad,
        w: col2 - GRID.pad * 2, h: botH - GRID.pad * 2
    };

    // —— 把两个 DOM 面板摆到中/右两格 —— //
    const hostRect = _canvasHost.elt.getBoundingClientRect();
    const cvsRect = cnv.elt.getBoundingClientRect();
    const offX = cvsRect.left - hostRect.left;
    const offY = cvsRect.top - hostRect.top;

    // 鼓面（等宽高，居中）
    const drumWrap = document.getElementById('drum-wrap');
    if (drumWrap) {
        const size = Math.floor(Math.min(RECT.drum.w, RECT.drum.h));
        drumWrap.style.left = (RECT.drum.x + offX + (RECT.drum.w - size) / 2) + 'px';
        drumWrap.style.top = (RECT.drum.y + offY + (RECT.drum.h - size) / 2) + 'px';
        drumWrap.style.width = size + 'px';
        drumWrap.style.height = size + 'px';
    }

    // Mic HUD（充满右 1/4 区）
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
        pixelDensity(1);       // 降低 GPU 压力
        frameRate(45);         // 或 30，按你体验调整
    } else {
        frameRate(60);
    }

    //const cnv = createCanvas(1000, 120);
    const NOTES_H = 120, GAP = 16, METER_H = 160;
    const cnv = createCanvas(1000, NOTES_H + GAP + METER_H);
    cnv.parent('score-wrap');
    GRID.topHpx = NOTES_H;
    _canvasHost = select('#score-wrap');      // 主容器（父节点）
    select('#mic-hud').parent(_canvasHost);   // 把 mic HUD 放进主容器
    select('#drum-wrap').parent(_canvasHost); // 把鼓面放进主容器

    layoutRects(cnv);
    window.addEventListener('resize', () => layoutRects(cnv));

    const elTotals = select('#totals');
    if (elTotals) elTotals.style('display', 'none');
    const elStatus = select('#status');
    if (elStatus) elStatus.style('display', 'none');

    // const meterSlot = createDiv();
    // meterSlot.id('meter-slot');
    // meterSlot.parent(cnv.parent());          // 和画布同一个父容器
    // meterSlot.style('width', width + 'px');
    // meterSlot.style('margin-top', '10px');   // 画布与面板之间的垂直间距

    rm = new RhythmManager();
    rm.initChart(chartJSON.conga);   // 读取 JSON
    metro.onloaded(() => {
        console.log("Metronome loaded!");
        metro.reset();
    });
    mic = new p5.AudioIn();
    mic.start();
    if (window.SampleUI && !window.__samplerInit) {
        let savedOffset = Number(localStorage.getItem('splOffset'));
        const legacyOffset = Math.abs(savedOffset - (-20)) < 0.6;  // 识别旧的 -20dB
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

        SampleUI.setupAudio({
            levelMode: 'rms',
            workletPath: './meter-processor.js',
            offsetDb: Number(localStorage.getItem('splOffset')) || 0
        }).then(() => {
            SampleUI.pause();
            SampleUI.setSampleRateMul(35);
        });

        // ③ 自动校准：如果没保存过 offset，就采样 1.5s 把环境噪声对齐到“45 dB”附近
        if (!hasOffset) {
            setTimeout(async () => {
                SampleUI.setScale(20, 100);               // ★ 切换到 SPL 刻度
            }, 1200);
        }
        window.__samplerInit = true;       // 防止重复初始化
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
            // 四类打击分数（尽量多给几个常见别名）
            const o = pick('o', 'open');
            const p = pick('p', 'palm', 'bass');
            const t = pick('t', 'tip', 'finger');
            const s = pick('s', 'slap');

            // 背景/未知：优先使用模型里的专用类别；没有就用 1-∑ 兜底
            let bg = dict['backgroundnoise'] ?? dict['_backgroundnoise_'] ?? dict['noise'] ?? dict['unknown'];
            if (bg == null) bg = Math.max(0, 1 - (o + p + t + s));

            // 归一化给 HUD
            const sum = o + p + t + s + bg || 1;
            HUD.probs = { O: o / sum, P: p / sum, T: t / sum, S: s / sum, BG: bg / sum };

            // 同步到上方面板的 Output 条
            if (window.SampleUI) {
                SampleUI.setBars([
                    { label: 'Background / Noise', value: HUD.probs.BG, color: '#f39c12' },
                    { label: 'Open / Slap', value: Math.max(HUD.probs.O, HUD.probs.S), color: '#6ab8ff' },
                    { label: 'Tip / Palm', value: Math.max(HUD.probs.T, HUD.probs.P), color: '#2ecc71' }
                    // 需要也可以把五条都展示：
                    // { label: 'Open', value: HUD.probs.O, color: '#6ab8ff' },
                    // { label: 'Slap', value: HUD.probs.S, color: '#e74c3c' },
                    // { label: 'Tip',  value: HUD.probs.T, color: '#2ecc71' },
                    // { label: 'Palm', value: HUD.probs.P, color: '#9b59b6' },
                ]);
            }

            if (DEBUG) console.log('top5', top);
            const dd = (HUD.energy ?? 0) - _emaE; _emaE += _alphaE * dd; _emaVar = (1 - _alphaE) * (_emaVar + _alphaE * dd * dd);
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

            // 标签映射更“宽容”：忽略大小写和空格
            const s = (label || '').toLowerCase().replace(/\s+/g, '');
            // 先得到“记谱标签”
            const abbr =
                s.includes('open') ? 'O' :
                    s.includes('slap') ? 'S' :
                        (s.includes('tip') || s.includes('finger')) ? 'T' :
                            s.includes('palm') ? 'T' :         // Palm 归中环
                                s.includes('bass') ? 'B' : null;   // Bass 单独标出
            if (abbr) {
                rm.registerHit(abbr);
                judgeLineGlow = 1;
                // 再把“记谱标签”映射到鼓面三环：O/S→外；T→中；B→内(=P)
                const ringKey =
                    (abbr === 'O' || abbr === 'S') ? 'O' :
                        (abbr === 'T') ? 'T' :
                            (abbr === 'B') ? 'P' : 'O';
                if (window.DrumCanvas?.trigger) DrumCanvas.trigger(ringKey, 320);
            }
        });
    });

    select('#sens-slider').input(() => {
        ENERGY_Z = parseFloat(select('#sens-slider').value());
    });

    select('#metro-toggle').mousePressed(() => {
        metronomeEnabled = !metronomeEnabled;
        if (metronomeEnabled) {
            select('#metro-toggle').html('Metronome Off');
        } else {
            select('#metro-toggle').html('Metronome On');
        }
        metro.enable(metronomeEnabled);
        if (metronomeEnabled) {
            scheduleTicksOnce._lastIdx = -1;
            startScoreTickScheduler();
        } else {
            stopScoreTickScheduler();
        }
    });
    select('#metro-toggle').html('Metronome On');
    metro.enable(false);

    /* UI */
    let initSpeed = parseFloat(select('#speed-slider').value());
    select('#speed-val').html(initSpeed.toFixed(2));
    const initBpm = speedToBPM(initSpeed);
    select('#bpm-val').html(Math.round(initBpm));
    rm.setBPM(initBpm);
    rm.setSpeedFactor(initSpeed);
    SampleUI.setSpeedFactor(initSpeed);
    if (CongaClassifier.setCooldown) {
        CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4))); // 设置冷却时间
    }
    if (typeof scheduleTicksOnce._lastIdx === 'number') {
        scheduleTicksOnce._lastIdx = -1;
    }
    rm.noteY = 50;

    select('#start-btn').mousePressed(handleStart);
    select('#pause-btn').mousePressed(() => {
        running = false;
        if (window.SampleUI) SampleUI.pause();
        //if (window.SampleUI) SampleUI.reset();
        counting = false;
        rm.pause();
        CongaClassifier.stop();
    });
    select('#reset-btn').mousePressed(handleReset);
    select('#export-btn').mousePressed(() => saveStrings([rm.exportCSV()], 'hits.csv'));

    select('#speed-slider').input(() => {
        const speedVal = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(speedVal.toFixed(2));
        // 速度和BPM双向绑定
        const bpmVal = speedToBPM(speedVal);
        select('#bpm-val').html(Math.round(bpmVal));
        metro.setBPM(bpmVal);        // 判定与滚动
        rm.setBPM(bpmVal);        // 判定与滚动
        rm.setSpeedFactor(speedVal); // 视觉速度
        SampleUI.setSpeedFactor(speedVal);
        if (CongaClassifier.setCooldown) {
            CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4)));
        }
        if (typeof scheduleTicksOnce._lastIdx === 'number') {
            scheduleTicksOnce._lastIdx = -1;
            if (scheduleTicksOnce._seen) scheduleTicksOnce._seen.clear(); // ← 清空已排表
            scheduleTicksOnce._guardUntil = 0;                             // ← 清掉旧保护时间

        }
        // —— A) 若红线就在音符附近，立刻敲一下，避免改速瞬间的“静音错觉” —— //
        forceClickNearestIfCentered(35);

        // —— B) 100ms 防抖：按“下一记谱面音符”补排一次，并设置 guard 防重复 —— //
        clearTimeout(window._speedDebounce);
        window._speedDebounce = setTimeout(() => {
            const notes = rm.scoreNotes || [];
            if (!notes.length || !metro || !metro.isLoaded()) return;

            const nowMs = rm._t() % rm.totalDuration;
            let nextIdx = notes.findIndex(n => n.time > nowMs);
            if (nextIdx < 0) nextIdx = 0;

            let dt = notes[nextIdx].time - nowMs;
            if (dt < 0) dt += rm.totalDuration;

            const sf = rm?.speedFactor || 1;
            const when = metro.ctx.currentTime + Math.max(0.03, (dt + getMetroOffsetMs()) / (1000 * sf));
            const strong = (notes[nextIdx].accent | 0) === 1;

            // 设置保护时间，防止调度器紧接着再排同一记
            scheduleTicksOnce._guardUntil = when + 0.02;
            metro.scheduleAt(when, strong);

            // 让预调度从它之后继续
            scheduleTicksOnce._lastIdx = nextIdx;
        }, 100);

        // —— C) 能量门限的 EMA 清一次，让灵敏度快速贴合新速度 —— //
        _emaE = 0; _emaVar = 1;
    });

    select('#totals').html(`Notes ${rm.scoreNotes.length}`);

    if (window.DrumCanvas && !window.DrumCanvas._ctx) {
        DrumCanvas.init({ mount: '#drum-wrap', size: 150, background: '#2f3036' });
    }
}

/* ------------ Control ------------- */
async function handleStart() {
    if (running || counting) return;

    if (typeof getAudioContext === 'function') {
        const ac = getAudioContext();
        if (ac && ac.state !== 'running') {
            try { await ac.resume(); } catch (e) { console.warn(e); }
        }
    }

    if (metro?.ctx && metro.ctx.state !== 'running') {
        try { await metro.ctx.resume(); } catch (e) { console.warn(e); }
    }

    try {
        await mic.start();
        if (window.SampleUI && SampleUI.setMic) SampleUI.setMic(mic);
        // 仅第一次创建音频链
        if (!window.__meterAudioReady) {
            // await SampleUI.setupAudio({
            //     levelMode: 'rms',
            //     workletPath: './meter-processor.js',
            //     offsetDb: Number(localStorage.getItem('splOffset')) || 0
            // });
            window.__meterAudioReady = true;
        }
        //if (window.SampleUI) { SampleUI.reset(); SampleUI.resume(); }
    } catch (e) { console.warn(e); }

    try {
        if (CongaClassifier.setConstraints) {
            CongaClassifier.setConstraints({
                echoCancellation: false, noiseSuppression: false,
                autoGainControl: false
            });
        }

        CongaClassifier.start();
        if (CongaClassifier.setCooldown) {
            CongaClassifier.setCooldown(Math.max(70, Math.min(180, rm.noteInterval * 0.4))); // 设置冷却时间
        }
    } catch (e) {
        console.error(e);
    }

    startCountdown();
    if (window.SampleUI) SampleUI.resume();
    lastNoteIdx = -1; // 重置音符索引
    metro.reset();
    metro.useInternalGrid = false;  // 明确用谱面驱动
    scheduleTicksOnce._lastIdx = -1;
    if (scheduleTicksOnce._seen) scheduleTicksOnce._seen.clear();
    scheduleTicksOnce._guardUntil = 0;
    startScoreTickScheduler();

    if (!window.__didOnceCalib) {
        setTimeout(async () => {
            try {
                localStorage.removeItem('splOffset');
                if (window.SampleUI?.setOffsetDb) SampleUI.setOffsetDb(0);
                await SampleUI.calibrateSPL(45, 1.5);
                SampleUI.setScale(20, 100);
            } catch (e) { }
        }, 1200);
        window.__didOnceCalib = true;
    }
}

function handleReset() {
    running = false;
    counting = false;
    lastNoteIdx = -1;
    rm.reset();
    rm.pause();
    rm.pauseAt = rm.startTime;
    stopScoreTickScheduler();
    scheduleTicksOnce._lastIdx = -1;
    if (scheduleTicksOnce._seen) scheduleTicksOnce._seen.clear();
    scheduleTicksOnce._guardUntil = 0;
    metro.reset();
    CongaClassifier.stop();
    try {
        if (mic && mic.start) mic.start();
    } catch (e) {
        console.warn(e);
    }
    if (window.SampleUI) {
        SampleUI.reset();
        SampleUI.pause();
    }
}

function startCountdown() {
    if (rm.startTime === null) rm.reset();
    rm.pause();
    running = false;
    counting = true;
    ctStart = millis();
}

/* ------------ Draw Loop ----------- */
function draw() {
    background('#3a3a3a');
    judgeLineGlow *= 0.9;
    if (judgeLineGlow < 0.01) judgeLineGlow = 0;
    drawGrid();

    // 判定线发光
    let glowLevel = lerp(2, 18, judgeLineGlow);
    let alpha = lerp(120, 255, judgeLineGlow);
    drawingContext.save();
    drawingContext.shadowBlur = glowLevel;
    drawingContext.shadowColor = 'rgba(165, 99, 212, 0.8)';
    stroke(255, 0, 0, alpha);
    strokeWeight(judgeLineGlow > 0.2 ? 4 : 1.5);
    const splitY = RECT.amp.y - GRID.pad;  // 下半 HUD 顶边 = 分界线
    line(rm.judgeLineX, 0, rm.judgeLineX, splitY - 1);

    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) {
            counting = false;
            running = true;
            rm.resume();
            if (window.SampleUI) SampleUI.resume();
            if (typeof scheduleTicksOnce._lastIdx === 'number') scheduleTicksOnce._lastIdx = -1;

            if (scheduleTicksOnce._seen) scheduleTicksOnce._seen.clear();
            scheduleTicksOnce._guardUntil = 0;
        }
        else drawCountdown(remain);
    }

    if (running) {
        rm.checkAutoMiss();
        rm.checkLoopAndRestart();

    }
    drawNotesAndFeedback();
    flashDrumWhenNoteAtLine();

    const { hit, miss } = rm.getStats();

    // —— 右下角一行统计：Notes | Hits | Miss —— //
    const info = `Notes ${rm.scoreNotes.length} | Hits ${hit} | Miss ${miss}`;
    noStroke();
    fill(240);
    textSize(16);
    textAlign(RIGHT, BOTTOM);
    // laneBottomY() 是下路中线；往上留 8px，不压线
    text(info, width - 12, laneBottomY() + 40);

    // 其他 HUD 仍照常更新
    updateHUDView();

    if (window.SampleUI) {
        SampleUI.update();
        SampleUI.renderTo(drawingContext, RECT.amp.x, RECT.amp.y, RECT.amp.w, RECT.amp.h);
    }

    // ===== 分隔线（横向 1 条 + 纵向 2 条）=====
    stroke(220); strokeWeight(2);
    line(0, RECT.amp.y - GRID.pad, width, RECT.amp.y - GRID.pad);               // 上下分界
    line(RECT.drum.x - GRID.pad, RECT.amp.y - GRID.pad, RECT.drum.x - GRID.pad, height); // 左/中
    line(RECT.mic.x - GRID.pad, RECT.amp.y - GRID.pad, RECT.mic.x - GRID.pad, height); // 中/右

    // —— 每帧确保两个 DOM HUD 跟随布局 —— //
    layoutRects(this._renderer ? this._renderer : { elt: document.querySelector('canvas') });
}

/* ------------ Visualization ------- */
function drawCountdown(remain) {
    const n = Math.ceil(remain / 1000);
    const alpha = map(remain % 1000, 999, 0, 255, 0);
    textSize(80); fill(255, 87, 34, alpha);
    textAlign(CENTER, CENTER);
    const cy = RECT.top.y + RECT.top.h / 2;   // 上半区域中心
    text(n, width / 2, cy);
}

function drawGrid() {
    stroke(255, 255, 255, 60);
    strokeWeight(1);
    const yTop = laneTopY();
    const yBot = laneBottomY();
    line(0, yTop, width, yTop);   // 上路中线
    line(0, yBot, width, yBot);   // 下路中线
}

function flashDrumWhenNoteAtLine() {
    if (!window.DrumCanvas || !DrumCanvas.trigger || !rm?.scoreNotes?.length) return;

    const notes = rm.getVisibleNotes ? rm.getVisibleNotes() : rm.scoreNotes;
    const thr = 6;                             // 距红线容差（像素）
    for (const n of notes) {
        const x = rm.getScrollX(n._displayTime ?? n.time);
        if (Math.abs(x - rm.judgeLineX) <= thr) {
            const abRaw = n.abbr || n.type?.[0] || 'O';
            const AB = abRaw.toString().toUpperCase(); // 大小写无关
            const key =
                (AB === 'O' || AB === 'S') ? 'O' :
                    (AB === 'T' || AB === 'P') ? 'T' :
                        (AB === 'B') ? 'P' : 'O';
            DrumCanvas.trigger(key, 220);          // 发光 220ms
            break;                                 // 一帧一次就够
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
        ellipse(xN, y, 20);   // 灰音符

        // 显示简写字母
        fill('#eeeeee');
        textSize(12);
        textAlign(CENTER, TOP);
        textStyle(BOLD);
        text(glyphForAbbr(n.abbr), xN, y + 12);
        textStyle(NORMAL);

        // 只在“主循环”才显示反馈
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

/* ------------ Interaction --------- */
function mousePressed() {
    if (window.SampleUI && SampleUI.pointerDown(mouseX, mouseY)) return;
    if (running) {
        rm.registerHit();
        judgeLineGlow = 1;
    }
    if (window.DrumCanvas && typeof DrumCanvas.trigger === 'function') {
        DrumCanvas.trigger('EDGE', 360); // 发光时长可调：260~420ms
    }
}


// —— Mic HUD 状态 —— //
const HUD = {
    lastFrameTs: 0, energy: 0,
    probs: { O: 0, P: 0, T: 0, S: 0, BG: 0 }
};
function updateHUDView() {
    const led = document.getElementById('mic-led');
    const msg = document.getElementById('mic-msg');

    const alive = (CongaClassifier?.micAlive?.() === true);
    if (!CongaClassifier?.isListening || !CongaClassifier.isListening()) {
        led.className = 'led err'; msg.textContent = 'not listening';
    } else if (!alive) {
        led.className = 'led err'; msg.textContent = 'no data';
    } else {
        // 用 HUD.energy 做一份独立 EMA 来算 z 分数
        if (typeof updateHUDView._emaE !== 'number') { updateHUDView._emaE = 0; updateHUDView._emaVar = 1e-3; }
        const a = 0.08;
        const d = (HUD.energy || 0) - updateHUDView._emaE;
        updateHUDView._emaE += a * d;
        updateHUDView._emaVar = (1 - a) * (updateHUDView._emaVar + a * d * d);
        const z = d / Math.sqrt(updateHUDView._emaVar + 1e-6);
        if (z < 0.3) { led.className = 'led warn'; msg.textContent = 'very low level'; }
        else if (z < 1.0) { led.className = 'led warn'; msg.textContent = 'low'; }
        else { led.className = 'led ok'; msg.textContent = 'ok'; }
    }

    const setW = (id, v) => { const el = document.getElementById(id); if (el) el.style.width = Math.round(v * 100) + '%'; }
    const setV = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = Math.round(v * 100) + '%'; }
    const p = HUD.probs;
    setW('bar-O', p.O); setV('val-O', p.O);
    setW('bar-P', p.P); setV('val-P', p.P);
    setW('bar-T', p.T); setV('val-T', p.T);
    setW('bar-S', p.S); setV('val-S', p.S);
    setW('bar-BG', p.BG); setV('val-BG', p.BG);
}