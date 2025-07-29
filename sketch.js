let rhythmManager;
let hitDetector;

function preload() {
    rhythmManager = new rhythmManager("congaPatterns/tumbao.json");
}

function setup() {
    createCanvas(960, 480);
    hitDetector = new hitDetector(rhythmManager);
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