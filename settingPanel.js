// settingsPanel.js - 设置面板模块（优化版）
// 移除速度控制，专注于键盘指南和其他设置

(function (root) {
    const SettingsPanel = {
        _isVisible: false,
        _overlay: null,
        _panel: null,
        _gearBtn: null,

        init() {
            this._createGearButton();
            this._createSettingsPanel();
            this._bindEvents();
            return this;
        },

        _createGearButton() {
            // 创建齿轮按钮
            this._gearBtn = document.createElement('button');
            this._gearBtn.id = 'settings-btn';
            this._gearBtn.innerHTML = '⚙️';
            this._gearBtn.style.cssText = `
                margin-left: 8px;
                padding: 8px 12px;
                background: #555;
                color: white;
                border: 1px solid #666;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 40px;
                height: 36px;
            `;

            // 悬停效果
            this._gearBtn.addEventListener('mouseenter', () => {
                this._gearBtn.style.background = '#757575ff';
            });
            this._gearBtn.addEventListener('mouseleave', () => {
                this._gearBtn.style.background = '#323232ff';
            });

            // 插入到 UI 区域
            const uiDiv = document.getElementById('ui');
            if (uiDiv) {
                uiDiv.appendChild(this._gearBtn);
            }
        },

        _createSettingsPanel() {
            // 创建遮罩层
            this._overlay = document.createElement('div');
            this._overlay.id = 'settings-overlay';
            this._overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.5);
                display: none;
                z-index: 1000;
                backdrop-filter: blur(2px);
            `;

            // 创建设置面板
            this._panel = document.createElement('div');
            this._panel.id = 'settings-panel';
            this._panel.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2a2a2a;
                border: 2px solid #555;
                border-radius: 12px;
                padding: 24px;
                min-width: 400px;
                max-width: 600px;
                color: white;
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            `;

            this._panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h3 style="margin: 0; color: #fff; font-size: 18px;">⚙️ Settings & Keyboard Shortcuts</h3>
                    <button id="close-settings" style="background: none; border: none; color: #ccc; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 4px;" title="关闭">✕</button>
                </div>

                <!-- 键盘操作指南 -->
                <div style="margin-bottom: 20px; padding: 16px; background: #333; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #ffd400; font-size: 14px; font-weight: bold;">⌨️ Keyboard Shortcuts</h4>
                    <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 12px; line-height: 1.4;">
                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'d'</code>
                        <span style="color: #ccc;">Toggle debug mode (show detection panel)</span>
                        
                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'t'</code>
                        <span style="color: #ccc;">Enable/disable hit detection</span>
                        
                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'1'-'5'</code>
                        <span style="color: #ccc;">Set sensitivity (1 = lowest, 5 = highest)</span>
                        
                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'r'</code>
                        <span style="color: #ccc;">Reset stats</span>
                        
                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'i'</code>
                        <span style="color: #ccc;">Show current status</span>
                        
                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'m'</code>
                        <span style="color: #ccc;">Toggle AMP/RMS level detection</span>

                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'f'</code>
                        <span style="color: #ccc;">Toggle audio response speed (Fast/Smooth)</span>

                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'a'</code>
                        <span style="color: #ccc;">Toggle dynamic scaling (Fixed/Smooth)</span>

                        <code style="background: #444; padding: 2px 6px; border-radius: 3px; color: #ffd400;">'s'</code>
                        <span style="color: #ccc;">Toggle adaptation speed (Instant/Smooth)</span>
                    </div>
                </div>

                <!-- Interactive Controls -->
                <div style="margin-bottom: 20px; padding: 16px; background: #333; border-radius: 8px;">
                    <h4 style="margin: 0 0 16px 0; color: #ffd400; font-size: 14px; font-weight: bold;">🎛️ Interactive Controls</h4>

                    <!-- Sensitivity Slider -->
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                            <span style="color: #ccc; font-size: 13px;">Sensitivity Level:</span>
                            <span id="sensitivity-val" style="color: #ffd400; font-weight: bold; font-size: 13px; min-width: 50px;">middle</span>
                        </div>
                        <input id="sensitivity-slider" type="range" min="1" max="5" step="1" value="3" 
                               style="width: 100%; height: 6px; background: linear-gradient(90deg, #ff6b6b 0%, #ffaa00 25%, #ffd400 50%, #88ff00 75%, #00ff88 100%); 
                                      border-radius: 3px; outline: none; cursor: pointer; transition: all 0.2s ease;" />
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #666; margin-top: 2px;">
                            <span>low</span>
                            <span>middle</span>
                            <span>high</span>
                        </div>
                    </div>

                    <!-- Static Status Info -->
                    <div style="display: grid; gap: 8px; padding-top: 8px; border-top: 1px solid #444;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="color: #ccc; font-size: 13px;">Mic Input:</span>
                            <span style="color: #88ff00; font-size: 13px;">Active</span>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <span style="color: #ccc; font-size: 13px;">Performance Mode:</span>
                            <span style="color: #ffd400; font-size: 13px;">Auto</span>
                        </div>
                    </div>
                </div>
            `;

            this._overlay.appendChild(this._panel);
            document.body.appendChild(this._overlay);
        },

        _bindEvents() {
            // 齿轮按钮点击
            this._gearBtn?.addEventListener('click', () => {
                this.toggle();
            });

            // 关闭按钮
            const closeBtn = document.getElementById('close-settings');
            closeBtn?.addEventListener('click', () => {
                this.hide();
            });

            // 点击遮罩关闭
            this._overlay?.addEventListener('click', (e) => {
                if (e.target === this._overlay) {
                    this.hide();
                }
            });

            // ESC 键关闭
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this._isVisible) {
                    this.hide();
                    e.preventDefault();
                }
            });

            // 检测开关事件
            document.addEventListener('change', (e) => {
                if (e.target && e.target.id === 'detection-toggle') {
                    const isEnabled = e.target.checked;
                    if (window.drumTrigger) {
                        window.drumTrigger.enable(isEnabled);
                        console.log(`Audio detection: ${isEnabled ? 'ON' : 'OFF'}`);

                        // 更新开关标签
                        const label = e.target.nextElementSibling;
                        if (label) {
                            label.textContent = isEnabled ? 'Enabled' : 'Disabled';
                            label.style.color = isEnabled ? '#88ff00' : '#ff6b6b';
                        }
                    }
                }
            });

            // 灵敏度滑块事件
            document.addEventListener('input', (e) => {
                if (e.target && e.target.id === 'sensitivity-slider') {
                    const level = parseInt(e.target.value);
                    const sensitivity = level / 5.0;  // 转换为0.2到1.0的范围

                    if (window.drumTrigger) {
                        window.drumTrigger.setSensitivity(sensitivity);
                        console.log(`Audio sensitivity: ${level}/5 (${sensitivity.toFixed(1)})`);
                    }

                    // 更新显示标签
                    this.updateSensitivityDisplay(level);
                }
            });
        },

        // 更新灵敏度显示
        updateSensitivityDisplay(level) {
            const labels = ['', 'Low', 'Low+', 'Medium', 'High', 'Max'];
            const colors = ['', '#ff6b6b', '#ff9500', '#ffd400', '#88ff00', '#00ff88'];

            const valSpan = document.getElementById('sensitivity-val');
            if (valSpan && level >= 1 && level <= 5) {
                valSpan.textContent = labels[level];
                valSpan.style.color = colors[level];
            }
        },

        // 同步当前设置到UI
        syncSettings() {
            if (!this._isVisible) return;

            // 同步检测开关状态
            const toggleInput = document.getElementById('detection-toggle');
            const toggleLabel = toggleInput?.nextElementSibling;
            if (toggleInput && window.drumTrigger) {
                const isEnabled = window.drumTrigger._isEnabled;
                toggleInput.checked = isEnabled;
                if (toggleLabel) {
                    toggleLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
                    toggleLabel.style.color = isEnabled ? '#88ff00' : '#ff6b6b';
                }
            }

            // 同步灵敏度滑块（如果可以获取当前值）
            const sensitivitySlider = document.getElementById('sensitivity-slider');
            if (sensitivitySlider && window.drumTrigger && window.drumTrigger._sensitivity) {
                const currentSensitivity = window.drumTrigger._sensitivity;
                const level = Math.round(currentSensitivity * 5); // 转换回1-5级别
                sensitivitySlider.value = level;
                this.updateSensitivityDisplay(level);
            }
        },


        // 显示设置面板
        show() {
            this._isVisible = true;
            this._overlay.style.display = 'block';
            // 防止页面滚动
            document.body.style.overflow = 'hidden';

            // 同步当前设置到UI
            setTimeout(() => this.syncSettings(), 50);
        },

        // 隐藏设置面板
        hide() {
            this._isVisible = false;
            this._overlay.style.display = 'none';
            // 恢复页面滚动
            document.body.style.overflow = 'auto';
        },

        // 切换显示状态
        toggle() {
            if (this._isVisible) {
                this.hide();
            } else {
                this.show();
            }
        },

        // 获取当前状态
        isVisible() {
            return this._isVisible;
        }
    };

    root.SettingsPanel = SettingsPanel;
})(window);