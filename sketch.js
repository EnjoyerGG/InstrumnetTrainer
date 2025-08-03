/* ------------ Globals ------------ */
let rm;
let running = false, counting = false;
let ctStart = 0;
let judgeLineGlow = 0; // 红线发光效果
const COUNTDOWN_MS = 3000;

/* ------------ Preload JSON --------*/
let chartJSON;
function preload() { chartJSON = loadJSON('assets/tumbao.json'); }

/* ------------ Setup --------------- */
function setup() {
    createCanvas(1000, 250);

    rm = new RhythmManager();
    rm.initChart(chartJSON.conga, 5);   // 读取 JSON
    rm.setSpeedFactor(0.3);

    /* UI */
    select('#start-btn').mousePressed(handleStart);
    select('#pause-btn').mousePressed(() => { running = false; counting = false; rm.pause(); });
    select('#reset-btn').mousePressed(handleReset);
    select('#export-btn').mousePressed(() => saveStrings([rm.exportCSV()], 'hits.csv'));

    select('#speed-slider').input(() => {
        const v = parseFloat(select('#speed-slider').value());
        select('#speed-val').html(v.toFixed(2));
        rm.setSpeedFactor(v);
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
            const col = state.result === "Perfect" ? "#7b1fa2" :
                state.result === "Good" ? "#2e7d32" : "#d32f2f";
            fill(col); textSize(14); textAlign(CENTER); text(state.result, xN, y - 30);

            if (state.result !== 'Miss') {
                const dt = state.hitTime - rm.scoreNotes[n._feedbackIdx].time;
                const R = 10;
                const pxOffset = dt / GOOD_WINDOW * R;
                fill(0);
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
