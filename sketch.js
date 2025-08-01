let rm;          // RhythmManager 实例
let running = false;
let counting = false; // 是否正在计时
let ctStart = 0;
const COUNTDOWN_MS = 3000; // 3秒倒计时

function setup() {
    createCanvas(1000, 400);
    rm = new RhythmManager();
    rm.setSpeedFactor(0.3);  // 初始速度倍率0.3x

    /* ---------- UI 绑定 ---------- */
    select("#start-btn").mousePressed(handleStart);
    select("#pause-btn").mousePressed(() => { running = false; counting = false; rm.pause(); });
    select("#reset-btn").mousePressed(handleReset);
    select("#export-btn").mousePressed(() =>
        saveStrings([rm.exportCSV()], "hits.csv")
    );
    select("#speed-slider").input(() => {
        const v = parseFloat(select("#speed-slider").value());  // 0.1 ~ 1.0
        select("#speed-val").html(v.toFixed(2));
        rm.setSpeedFactor(v);   // **只改速度倍率**
    });
    select("#speed-val").html("0.30");
}
/* ---------- Start 逻辑 ---------- */
function handleStart() {
    if (running || counting) return;             // 已在滚动或倒计时中 → 忽略
    startCountdown();
}

function handleReset() {
    running = false;           // 保证重置前不再滚动
    counting = false;

    rm.pause();                  // 先冻结当前计时
    rm.reset();                  // 重新生成谱面 & startTime = now

    // 重新设置 pauseAt = startTime，使倒计时期间完全静止
    rm.pause();                  // 再次 pause，把 pauseAt 对齐到新的 startTime
    rm.pauseAt = rm.startTime;

    counting = true;            // 启动倒计时
    ctStart = millis();
}
/* ---------- Start + 倒计时 ---------- */
function startCountdown() {
    /* 若还没播过，reset 一次生成谱面 */
    if (rm.startTime === null) rm.reset();

    rm.pause();              // 先停住（若是首次播放 pause() 什么都不做）
    running = false;
    counting = true;
    ctStart = millis();
}

function draw() {
    background('#d0d0d0');
    drawGrid();
    stroke(255, 0, 0, 150); strokeWeight(1.5);
    line(rm.judgeLineX, 0, rm.judgeLineX, height);

    /* 倒计时 */
    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);
        if (remain <= 0) { counting = false; running = true; rm.resume(); }
        else drawCountdown(remain);
    }
    if (running) rm.checkAutoMiss();
    drawNotesAndFeedback();

    const { hit, miss } = rm.getStats();
    select('#status').html(`Hits ${hit} | Miss ${miss}`);
}

/* ---------- 渲染 ---------- */
function drawCountdown(remain) {
    const n = Math.ceil(remain / 1000);   // 3 → 1
    textSize(80);
    fill("#ff5722");
    noStroke();
    textAlign(CENTER, CENTER);
    text(n, width / 2, height / 2);
}

function drawGrid() {
    stroke(255, 255, 255, 60); strokeWeight(1);
    const y = rm.noteY;
    for (let o of [-30, -15, 15, 30]) line(0, y + o, width, y + o);
}

function drawNotesAndFeedback() {
    const now = rm._t();
    const notes = rm.getVisibleNotes();

    drawingContext.shadowBlur = 6;
    drawingContext.shadowColor = '#888';

    for (const n of notes) {
        const xN = rm.getScrollX(n.time), y = rm.noteY;

        /* 灰音符 */
        fill(200, 180); noStroke(); ellipse(xN, y, 20);

        if (n.judged) {
            /* 文字颜色 */
            const col = n.result === 'Perfect' ? '#7b1fa2'
                : n.result === 'Good' ? '#2e7d32'
                    : '#d32f2f';

            /* 直接绘制文字（无白框） */
            fill(col); textSize(14); textAlign(CENTER, CENTER);
            text(n.result, xN, y - 30);

            /* 黑点 0.5 s 渐隐 */
            if (n.result !== 'Miss') {
                const age = now - n.hitTime;
                const a = map(age, 0, 500, 255, 0, true);
                fill(0, a); ellipse(rm.getScrollX(n.hitTime), y, 10);
            }
        }
    }
    drawingContext.shadowBlur = 0; // 清除阴影
}

function mousePressed() {
    if (running) rm.registerHit();
}
