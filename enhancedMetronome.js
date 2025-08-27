// enhancedMetronome.js - 支持多种节奏模式的节拍器系统

const RhythmSelector = (() => {
    // 节奏模式数据
    const RHYTHM_MODES = {
        metronome: {
            name: 'Metronome',
            pattern: null // 使用原有的节拍器逻辑
        },
        clave32: {
            name: 'Son 3-2 Clave',
            pattern: 'clave32' // 使用JSON中的clave32字段
        },
        clave23: {
            name: 'Son 2-3 Clave',
            pattern: 'clave23' // 使用JSON中的clave23字段
        }
    };

    let currentMode = 'metronome';
    let dropdownVisible = false;

    // 获取当前模式
    function getCurrentMode() {
        return currentMode;
    }

    // 设置模式
    function setMode(mode) {
        if (RHYTHM_MODES[mode]) {
            currentMode = mode;
            updateUI();
            return true;
        }
        return false;
    }

    // 获取当前节奏模式数据
    function getCurrentPattern() {
        return RHYTHM_MODES[currentMode];
    }

    // 更新UI显示
    function updateUI() {
        const btn = select('#metro-toggle');
        const dropdown = select('#rhythm-dropdown');

        if (btn) {
            btn.html(RHYTHM_MODES[currentMode].name);
        }

        if (dropdown) {
            dropdown.style('display', 'none');
            dropdownVisible = false;
        }
    }

    // 创建下拉UI
    function createDropdownUI() {
        const container = select('#metro-toggle').parent();

        // 创建主按钮容器
        const btnGroup = createDiv().parent(container);
        btnGroup.id('metro-btn-group');
        btnGroup.style('position', 'relative');
        btnGroup.style('display', 'inline-block');

        // 移动原按钮到新容器
        const originalBtn = select('#metro-toggle');
        originalBtn.parent(btnGroup);
        originalBtn.style('border-radius', '4px 0 0 4px');
        originalBtn.style('margin-right', '0');

        // 创建下拉箭头按钮
        const arrowBtn = createButton('▼');
        arrowBtn.parent(btnGroup);
        arrowBtn.id('rhythm-arrow');
        arrowBtn.style('border-radius', '0 4px 4px 0');
        arrowBtn.style('border-left', 'none');
        arrowBtn.style('padding', '8px 6px');
        arrowBtn.style('min-width', '24px');
        arrowBtn.style('background', originalBtn.style('background'));
        arrowBtn.style('color', originalBtn.style('color'));
        arrowBtn.style('border', originalBtn.style('border'));
        arrowBtn.style('cursor', 'pointer');

        // 创建下拉菜单
        const dropdown = createDiv();
        dropdown.parent(btnGroup);
        dropdown.id('rhythm-dropdown');
        dropdown.style('position', 'absolute');
        dropdown.style('top', '100%');
        dropdown.style('left', '0');
        dropdown.style('right', '0');
        dropdown.style('background', '#333');
        dropdown.style('border', '1px solid #555');
        dropdown.style('border-radius', '0 0 4px 4px');
        dropdown.style('border-top', 'none');
        dropdown.style('display', 'none');
        dropdown.style('z-index', '1000');
        dropdown.style('box-shadow', '0 2px 8px rgba(0,0,0,0.3)');

        // 添加选项
        Object.entries(RHYTHM_MODES).forEach(([key, mode]) => {
            const option = createDiv(mode.name);
            option.parent(dropdown);
            option.addClass('rhythm-option');
            option.style('padding', '8px 12px');
            option.style('cursor', 'pointer');
            option.style('color', '#eee');
            option.style('border-bottom', '1px solid #444');

            // 悬停效果
            option.mouseOver(() => {
                option.style('background', '#555');
            });
            option.mouseOut(() => {
                option.style('background', 'transparent');
            });

            // 点击选择
            option.mousePressed(() => {
                setMode(key);
                toggleDropdown();

                // 通知节拍器系统变化
                if (typeof onRhythmModeChange === 'function') {
                    onRhythmModeChange(key, mode);
                }
            });
        });

        // 箭头按钮点击事件
        arrowBtn.mousePressed(toggleDropdown);

        // 点击外部关闭下拉菜单
        document.addEventListener('click', (e) => {
            const btnGroupEl = select('#metro-btn-group').elt;
            if (btnGroupEl && !btnGroupEl.contains(e.target) && dropdownVisible) {
                toggleDropdown();
            }
        });
    }

    // 切换下拉菜单显示
    function toggleDropdown() {
        const dropdown = select('#rhythm-dropdown');
        if (dropdown) {
            dropdownVisible = !dropdownVisible;
            dropdown.style('display', dropdownVisible ? 'block' : 'none');

            const arrowBtn = select('#rhythm-arrow');
            if (arrowBtn) {
                arrowBtn.html(dropdownVisible ? '▲' : '▼');
            }
        }
    }

    // 检查音符是否应该在当前模式下播放
    function shouldPlayNote(note, mode) {
        if (mode === 'metronome') {
            return true; // metronome 模式播放所有音符
        }

        // clave 模式根据 JSON 数据中的字段判断
        if (mode === 'clave32' && note.clave32 === 1) {
            return true;
        }
        if (mode === 'clave23' && note.clave23 === 1) {
            return true;
        }

        return false;
    }

    // 获取音符的重音强度
    function getNoteAccent(note, mode) {
        if (mode === 'metronome') {
            return note.accent || 0;
        }

        // clave 模式中，能播放的音符都视为重音
        if (shouldPlayNote(note, mode)) {
            return 1;
        }

        return 0;
    }

    // 公共接口
    return {
        init() {
            // 延迟创建UI，确保原按钮已存在
            setTimeout(() => {
                createDropdownUI();
                updateUI();
            }, 100);
            return this;
        },

        getCurrentMode,
        setMode,
        getCurrentPattern,
        getModes: () => RHYTHM_MODES,
        shouldPlayNote,
        getNoteAccent,

        // 向后兼容的方法（保留原有接口）
        shouldTick(eighthIndex, patternLength) {
            return true; // 这个方法现在主要用于UI，实际播放逻辑在新方法中
        },

        getAccent(eighthIndex) {
            return 1; // 向后兼容
        }
    };
})();