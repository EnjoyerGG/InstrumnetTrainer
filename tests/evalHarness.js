// evalHarness.js
(function () {
    const S = { rows: [], autoLogEvery: 200 };
    const now = () => performance.now();

    window.LatencyProbe = {
        // 在“检测命中”那一刻打点（带上当前模式/谱子/速度等meta）
        markNote(meta = {}) { S._last = { t: now(), meta }; },

        // 在“本帧渲染完成”那一刻打点（p5.js 的 draw() 末尾调用）
        markFrame() {
            if (!S._last) return;
            const tUI = now();
            const { t: tDetect, meta } = S._last;
            S.rows.push({ tDetect, tUI, dt: tUI - tDetect, meta });
            S._last = null;

            if (S.rows.length % S.autoLogEvery === 0) {
                console.log("[Latency]", window.LatencyProbe.summary());
            }
        },

        // 汇总统计：min / avg / p50 / p90 / p95 / max
        summary() {
            const a = S.rows.map(r => r.dt).sort((x, y) => x - y);
            if (!a.length) return { n: 0 };
            const q = p => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
            const avg = a.reduce((s, x) => s + x, 0) / a.length;
            return { n: a.length, min: a[0], p50: q(0.5), p90: q(0.9), p95: q(0.95), max: a[a.length - 1], avg };
        },

        // 导出 CSV
        dumpCSV() {
            const head = "tDetect_ms,tUI_ms,dt_ms,meta_json";
            const lines = S.rows.map(r => {
                const meta = JSON.stringify(r.meta).replace(/,/g, ';'); // 兼容性更好
                return [r.tDetect.toFixed(3), r.tUI.toFixed(3), r.dt.toFixed(3), meta].join(",");
            });
            return [head, ...lines].join("\n");
        },

        // 可选：重置数据
        reset() { S.rows.length = 0; S._last = null; },

        // 可选：调整自动日志频率
        setAutoLogEvery(n = 200) { S.autoLogEvery = Math.max(1, n | 0); }
    };

    // 简易合成触发器：不走麦克风，也能压测 UI 链路
    window.TestHarness = {
        async syntheticHits({ bpm = 120, count = 300, meta = {} } = {}) {
            const interval = 60000 / bpm; // ms
            for (let i = 0; i < count; i++) {
                try {
                    // 模拟一次“检测命中”：与真实 onTrigger 同步走你的 UI 路径
                    window.LatencyProbe.markNote({ ...meta, i, bpm });

                    // 复用你现有逻辑：注册命中、发光、记分等（需与真实 onTrigger 一致）
                    window.rm?.registerHit?.();
                    window.SweepMode?.addHitNow?.();
                    window.HitMarkers?.addHitMarker?.(window.rm?._t?.());
                } catch (e) {
                    console.warn(e);
                }
                await new Promise(r => setTimeout(r, interval));
            }
            console.log("[Synthetic] Done.", window.LatencyProbe.summary());
        },

        exportCSV(filename = "latency.csv") {
            const csv = window.LatencyProbe.dumpCSV();
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
        }
    };
})();
