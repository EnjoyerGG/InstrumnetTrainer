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
    background("#cccccc");
    stroke(255, 0, 0);
    line(rm.judgeLineX, 0, rm.judgeLineX, height);

    /* --- 倒计时逻辑 --- */
    if (counting) {
        const remain = COUNTDOWN_MS - (millis() - ctStart);

        if (remain <= 0) {          // 倒计时结束 → 开始播放
            counting = false;
            running = true;
            rm.resume();
        } else {
            drawCountdown(remain);
        }
    }

    if (running) {
        rm.checkAutoMiss();
    }
    drawNotesAndFeedback();

    const { hit, miss } = rm.getStats();
    select("#status").html(`Hits ${hit} | Miss ${miss}`);
}

/* ---------- 渲染 ---------- */
function drawCountdown(remain) {
    const n = Math.ceil(remain / 1000);   // 3 → 1
    textSize(80);
    fill("#ff5722");
    textAlign(CENTER, CENTER);
    text(n, width / 2, height / 2);
}

function drawNotesAndFeedback() {
    const notes = rm.getVisibleNotes();
    for (const n of notes) {
        const xNote = rm.getScrollX(n.time);
        const y = rm.noteY;

        /* 灰音符 */
        fill(180);
        noStroke();
        ellipse(xNote, y, 20);

        if (n.judged) {
            /* 文字 */
            textSize(14);
            textAlign(CENTER);
            fill(n.result === "Perfect" ? "purple" :
                n.result === "Good" ? "green" : "red");
            text(n.result, xNote, y - 30);

            /* 黑点（仅 Perfect / Good）*/
            if (n.result === "Perfect" || n.result === "Good") {
                fill(0);
                const xHit = rm.getScrollX(n.hitTime);
                noStroke(); ellipse(xHit, y, 10);
            }
        }
    }
}

function mousePressed() {
    if (running) rm.registerHit();
}
