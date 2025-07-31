let rm;          // RhythmManager 实例
let running = false;

function setup() {
    createCanvas(1000, 400);
    rm = new RhythmManager();

    /* ---------- UI 绑定 ---------- */
    select("#start-btn").mousePressed(() => { running = true; rm.resume(); });
    select("#pause-btn").mousePressed(() => { running = false; rm.pause(); });
    select("#reset-btn").mousePressed(() => { rm.reset(); running = true; });
    select("#export-btn").mousePressed(() =>
        saveStrings([rm.exportCSV()], "hits.csv")
    );
    select("#speed-slider").input(() => {
        const v = parseFloat(select("#speed-slider").value());  // 0.5 ~ 3.0
        select("#speed-val").html(v.toFixed(2));
        rm.setSpeedFactor(v);   // **只改速度倍率**
    });
}

function draw() {
    background("#cccccc");
    stroke(255, 0, 0);
    line(rm.judgeLineX, 0, rm.judgeLineX, height);

    if (running) {
        rm.checkAutoMiss();
    }
    drawNotesAndFeedback();

    const { hit, miss } = rm.getStats();
    select("#status").html(`Hits ${hit} | Miss ${miss}`);
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
                const xHit = rm.getScrollX(n.hitTime);
                fill(0); noStroke(); ellipse(xHit, y, 10);
            }
        }
    }
}

function mousePressed() {
    if (running) rm.registerHit();
}
