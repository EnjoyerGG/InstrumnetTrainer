let rhythmManager;
let isRunning = false;

function setup() {
    createCanvas(1000, 400);
    rhythmManager = new RhythmManager();

    // 按钮绑定到 HTML 中的按钮
    const startBtn = select("#start-btn");
    const pauseBtn = select("#pause-btn");
    const resetBtn = select("#reset-btn");
    const exportBtn = select("#export-btn");
    const speedSlider = select("#speed-slider");
    const speedVal = select("#speed-val");

    startBtn.mousePressed(() => {
        isRunning = true;
    });

    pauseBtn.mousePressed(() => {
        isRunning = false;
    });

    resetBtn.mousePressed(() => {
        rhythmManager.reset();
        isRunning = true;
    });

    exportBtn.mousePressed(() => {
        const csv = rhythmManager.exportCSV();
        saveStrings([csv], "hits.csv");
    });

    speedSlider.input(() => {
        const val = parseFloat(speedSlider.value());
        speedVal.html(val.toFixed(2));
        rhythmManager.setSpeed(val * 4); // 显著影响速度
    });
}

function draw() {
    background(255);

    if (isRunning) {
        rhythmManager.update();
    }

    drawJudgeBox();
    drawNotes();
    drawHits();

    // 更新统计显示
    const stats = rhythmManager.getStats();
    select("#status").html(`Hits ${stats.hit} | Miss ${stats.miss}`);
}

function drawJudgeBox() {
    const box = rhythmManager.getBox();
    noFill();
    stroke(150);
    rect(box.x, box.y, box.width, box.height);
}

function drawNotes() {
    const notes = rhythmManager.getNotes();
    for (let note of notes) {
        if (!note.hit) {
            fill(150);
            noStroke();
            ellipse(note.x, note.y, 20);
        }
    }
}

function drawHits() {
    const hits = rhythmManager.getHits();
    textAlign(CENTER);
    textSize(16);
    for (let h of hits) {
        const x = h.note.x;
        const y = h.note.y;
        fill(0);
        ellipse(x, y, 20);
        if (h.result === "Perfect") fill("purple");
        else if (h.result === "Good") fill("green");
        else fill("red");
        text(h.result, x, y - 30);
    }
}

// 鼠标点击模拟任意打击（忽略类型）
function mousePressed() {
    if (!isRunning) return;
    const result = rhythmManager.registerHitAny(); // 用新的泛型方法
    console.log("Hit result:", result);
}
