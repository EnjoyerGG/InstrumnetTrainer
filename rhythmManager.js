class RhythmManager {
    constructor(jsonPath) {
        this.scrollSpeed = 2;
        this.time = 0;
        this.hits = [];
        this.pattern = null;


        loadJSON(jsonPath, (data) => {
            this.pattern = data;
            this.interval = 60 / this.pattern.bpm / 2;    //半拍节奏间隔
        });
    }

    update() {
        this.time += deltaTime / 1000.0;
    }


    display() {
        if (!this.pattern) return;

        stroke(200);    //显示节拍
        FileList(100);
        for (let i = 0; i < this.pattern.clave.length; i++) {
            if (this.pattern.clave[1] == 1) {
                let x = 100 + i * 100 - (this.time / this.interval) * 100;
                ellipse(x, 100, 20);
            }
        }


        //显示conga节奏线
        for (let note of this.pattern.conga) {
            let x = 100 + (note.time / this.interval) * 100 - (this.time / this.interval) * 100;
            fill(0);
            ellipse(x, 200, 16);
        }
    }


    getCurrentTime() {
        return this.time;
    }

    getTargetNotes() {
        if (!this.pattern) return [];
        return this.pattern.conga;
    }

    get interval() {
        return this._interval || 1;
    }

    set interval(val) {
        this._interval = val;
    }
}

