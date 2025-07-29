let rhythmManager;
let hitDetector;

function preload() {
    rhythmManager = new RhythmManager("congaPatterns/tumbao.json");
}

function setup() {
    createCanvas(960, 480);
    hitDetector = new HitDetector(rhythmManager);
}

function draw() {
    background(255);
    rhythmManager.update();
    rhythmManager.display();
    hitDetector.displayOverlay();
}

function mousePressed() {
    hitDetector.registerHit();
}