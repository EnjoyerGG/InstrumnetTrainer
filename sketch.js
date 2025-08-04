/* ------------ Globals ------------ */
let rm;
let running = false, counting = false;
let ctStart = 0;
let judgeLineGlow = 0; // 红线发光效果
const COUNTDOWN_MS = 3000;

const BPM_MIN = 60, BPM_MAX = 240;
const SPEED_MIN = 0.10, SPEED_MAX = 0.40;

/* ------------ Preload JSON --------*/
let chartJSON;
function preload() { chartJSON = loadJSON('assets/tumbao.json'); }

function speedToBPM(speed) {
    return BPM_MIN + (BPM_MAX - BPM_MIN) * (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
}
function bpmToSpeed(bpm) {
    return SPEED_MIN + (bpm - BPM_MIN) * (SPEED_MAX - SPEED_MIN) / (BPM_MAX - BPM_MIN);
}

/* ------------ Setup --------------- */
function setup() {
    createCanvas(1000, 80);
    rm = new RhythmManager();
    rm.initChart(chartJSON.conga, 5);   // 读取 JSON
    /* UI */
    let initSpeed = parseFloat(select('#speed-slider').value());
    select('#speed-val').html(initSpeed.toFixed(2));
    const initBpm = speedToBPM(initSpeed);
    select('#bpm-val').html(Math.round(initBpm));
    rm.setBPM(initBpm);
    rm.setSpeedFactor(initSpeed);
    rm.noteY = 40;

    select('#start-btn').mousePressed(handleStart);
    select('#pause-btn').mousePressed(() => { running = false; counting = false; rm.pause(); });
    select('#reset-btn').mousePressed(handleReset);
    select('#export-btn').mousePressed(() => saveStrings([rm.exportCSV()], 'hits.csv'));

    select('#speed-slider').input(() => {
        const speedVal = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(speedVal.toFixed(2));
        // 速度和BPM双向绑定
        const bpmVal = speedToBPM(speedVal);
        select('#bpm-val').html(Math.round(bpmVal));
        rm.setBPM(bpmVal);        // 判定与滚动
        rm.setSpeedFactor(speedVal); // 视觉速度
    });
    select('#totals').html(`Notes ${rm.scoreNotes.length}`);
}

/* ------------ Control ------------- */
function handleStart() {
    if (running || counting) return;
    startCountdown();
}
function handleReset() {
    running = false; counting = false;
    rm.pause(); rm.reset(); rm.pause(); rm.pauseAt = rm.startTime;
    counting = true; ctStart = millis();
}
function startCountdown() {
    if (rm.startTime === null) rm.reset();
    rm.pause(); running = false; counting = true; ctStart = millis();
}

/* ------------ Draw Loop ----------- */
function draw() {
    background('#3a3a3a');            // 深灰背景
    judgeLineGlow *= 0.9;
    if (judgeLineGlow < 0.01) judgeLineGlow = 0;
    drawGrid();

    // 判定线发光
    let glowLevel = lerp(2, 18, judgeLineGlow);
    let alpha = lerp(120, 255, judgeLineGlow);
    drawingContext.save();
    drawingContext.shadowBlur = glowLevel;
    drawingContext.shadowColor = 'rgba(255,30,30,0.8)';
    stroke(255, 0, 0, alpha);
    strokeWeight(judgeLineGlow > 0.2 ? 4 : 1.5);
    line(rm.judgeLineX, 0, rm.judgeLineX, height);
    drawingContext.restore();

    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) { counting = false; running = true; rm.resume(); }
        else drawCountdown(remain);
    }

    if (running) {
        rm.checkAutoMiss();
        rm.checkLoopAndRestart();
    }
    drawNotesAndFeedback();


    const { hit, miss } = rm.getStats();
    select('#status').html(`Hits ${hit} | Miss ${miss}`);
}

/* ------------ Visualization ------- */
function drawCountdown(remain) {
    const n = Math.ceil(remain / 1000);
    const alpha = map(remain % 1000, 999, 0, 255, 0);
    textSize(80); fill(255, 87, 34, alpha);
    textAlign(CENTER, CENTER); text(n, width / 2, height / 2);
}
function drawGrid() {
    stroke(255, 255, 255, 60); strokeWeight(1);
    const y = rm.noteY;
    for (const o of [-30, -15, 15, 30]) line(0, y + o, width, y + o);
}

function drawNotesAndFeedback() {
    const notes = rm.getVisibleNotes();
    drawingContext.shadowBlur = 6; drawingContext.shadowColor = '#888';
    for (const n of notes) {
        const xN = rm.getScrollX(n._displayTime ?? n.time), y = rm.noteY;
        fill(200, 180); noStroke(); ellipse(xN, y, 20);   // 灰音符

        // 显示简写字母
        fill('#eeeeee'); textSize(12);
        textAlign(CENTER, TOP);
        text(n.abbr, xN, y + 12);

        // 只在“主循环”才显示反馈
        if (n._isMainLoop && rm.feedbackStates[n._feedbackIdx]?.judged) {
            const state = rm.feedbackStates[n._feedbackIdx];
            if (state.fadeTimer > 0) state.fadeTimer -= deltaTime;
            const alpha = constrain(map(state.fadeTimer, 0, 2000, 0, 255), 0, 255);
            const col = state.result === "Perfect" ? color(174, 79, 214, alpha)
                : state.result === "Good" ? color(85, 187, 90, alpha)
                    : color(211, 47, 47, alpha);
            fill(col); textSize(14); textAlign(CENTER); text(state.result, xN, y - 30);

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
    if (running) {
        rm.registerHit();
        judgeLineGlow = 1;
    }
}
