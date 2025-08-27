// hitMarkers.js - 实时打击落点标记系统

const HitMarkers = (() => {
    let rm, laneTopY, laneBottomY, isBottomDrum;
    let hitMarkers = []; // 存储打击标记 {time, lane, cycleIndex}
    let currentCycleIndex = 0;

    // 配置
    const MARKER_CONFIG = {
        radius: 4,           // 标记点半径
        color: '#000000',    // 红色标记
        strokeColor: 'none', // 白色边框
        strokeWeight: 0,
        alpha: 1.0
    };

    function init(config) {
        rm = config.rm;
        laneTopY = config.laneTopY;
        laneBottomY = config.laneBottomY;
        isBottomDrum = config.isBottomDrum;

        // 重置状态
        hitMarkers = [];
        currentCycleIndex = 0;

        return HitMarkers;
    }

    // 添加打击标记
    function addHitMarker(hitTime) {
        if (!rm || !rm.totalDuration) return;

        // 计算当前循环内的时间
        const cycleTime = hitTime % rm.totalDuration;

        // 找到最接近的音符来判断应该在哪个轨道
        let closestNote = null;
        let minDiff = Infinity;

        for (const note of rm.scoreNotes) {
            const diff = Math.abs(note.time - cycleTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestNote = note;
            }
        }

        // 根据音符类型判断轨道位置
        let lane = 'center';
        if (closestNote && minDiff < 100) { // 在100ms内的音符
            lane = isBottomDrum(closestNote) ? 'bottom' : 'top';
        }

        hitMarkers.push({
            time: cycleTime,
            lane: lane,
            cycleIndex: currentCycleIndex
        });
    }

    // 清除当前循环的标记（在新循环开始时调用）
    function clearCurrentCycle() {
        const prevCycleIndex = currentCycleIndex;
        currentCycleIndex = Math.floor(rm._t() / rm.totalDuration);

        // 如果进入新循环，清除旧的标记
        if (currentCycleIndex !== prevCycleIndex) {
            hitMarkers = hitMarkers.filter(marker => marker.cycleIndex === currentCycleIndex);
        }
    }

    // 渲染打击标记
    function render() {
        if (!rm || !hitMarkers.length) return;

        // 更新循环索引并清理旧标记
        clearCurrentCycle();

        const nowMs = rm._t() % rm.totalDuration;

        push();

        // 设置样式
        fill(MARKER_CONFIG.color + Math.round(255 * MARKER_CONFIG.alpha).toString(16).padStart(2, '0'));
        stroke(MARKER_CONFIG.strokeColor);
        strokeWeight(MARKER_CONFIG.strokeWeight);

        // 绘制所有当前循环的打击标记
        for (const marker of hitMarkers) {
            if (marker.cycleIndex !== currentCycleIndex) continue;

            // 计算标记的X位置（跟随滚动）
            const markerX = rm.getScrollX(marker.time);

            // 只绘制可见范围内的标记
            if (markerX < -50 || markerX > width + 50) continue;

            // 计算Y位置
            let markerY;
            if (marker.lane === 'top') {
                markerY = laneTopY();
            } else if (marker.lane === 'bottom') {
                markerY = laneBottomY();
            } else {
                // 默认在两轨道中间
                markerY = (laneTopY() + laneBottomY()) / 2;
            }

            // 绘制圆形标记
            circle(markerX, markerY, MARKER_CONFIG.radius * 2);
        }

        pop();
    }

    // 设置标记样式
    function setMarkerStyle(config) {
        Object.assign(MARKER_CONFIG, config);
    }

    // 获取当前标记数量（用于调试）
    function getMarkerCount() {
        return hitMarkers.filter(marker => marker.cycleIndex === currentCycleIndex).length;
    }

    // 手动清除所有标记
    function clearAllMarkers() {
        hitMarkers = [];
    }

    // 公共接口
    return {
        init,
        addHitMarker,
        render,
        setMarkerStyle,
        getMarkerCount,
        clearAllMarkers
    };
})();