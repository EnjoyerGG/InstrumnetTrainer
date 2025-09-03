// debugPanel.js - 交互式调试面板系统
// 版本: 1.0
// 依赖: p5.js, ampHUD, drumTrigger, fftHUD (全局变量)

(function (root) {
    'use strict';

    /**
     * 交互式调试面板类
     * 提供图形化界面来替代复杂的热键操作
     */
    class DebugPanel {
        constructor() {
            this.visible = false;
            this.element = null;
            this.dragData = {
                isDragging: false,
                startX: 0,
                startY: 0,
                startLeft: 0,
                startTop: 0
            };
            this.updateInterval = null;
            this.messageTimeout = null;

            this.createPanel();
            this.bindEvents();
        }

        /**
         * 创建调试面板的DOM结构
         */
        createPanel() {
            // 创建主面板容器
            this.element = document.createElement('div');
            this.element.id = 'debug-panel';
            this.element.style.cssText = `
                position: fixed;
                top: 50px;
                right: 20px;
                width: 320px;
                background: rgba(20, 25, 35, 0.95);
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-radius: 8px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                color: #ffffff;
                z-index: 10000;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(10px);
                display: none;
                max-height: 80vh;
                overflow-y: auto;
                user-select: none;
            `;

            // 创建面板内容
            this.element.innerHTML = this.createPanelHTML();
            document.body.appendChild(this.element);
        }

        /**
         * 生成面板的HTML结构
         */
        createPanelHTML() {
            return `
                <div style="background: rgba(100, 120, 150, 0.8); padding: 8px; border-radius: 6px 6px 0 0; cursor: move; user-select: none; display: flex; justify-content: space-between; align-items: center;" id="debug-header">
                    <span style="font-weight: bold; color: #fff;">🔧 Debug Panel</span>
                    <button id="debug-close" style="background: rgba(255, 80, 80, 0.8); border: none; color: white; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 12px;">✕</button>
                </div>
                
                <div style="padding: 12px;">
                    <!-- 状态信息区域 -->
                    <div style="background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
                        <h4 style="margin: 0 0 8px 0; color: #00ff88; font-size: 13px;">📊 System Status</h4>
                        <div id="status-info" style="font-size: 11px; line-height: 1.4;"></div>
                    </div>

                    <!-- 振幅控制区域 -->
                    <div style="background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
                        <h4 style="margin: 0 0 8px 0; color: #ffaa00; font-size: 13px;">🎚️ Amplitude Controls</h4>
                        
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; margin-bottom: 4px; font-size: 11px;">Amplitude Mode:</label>
                            <select id="amp-mode-select" style="width: 100%; padding: 4px; background: rgba(50, 50, 50, 0.8); color: white; border: 1px solid #666; border-radius: 3px; font-size: 11px;">
                                <option value="fft-fixed">FFT-RMS (Fixed)</option>
                                <option value="fft-auto">FFT-RMS (Auto)</option>
                                <option value="fft-quick">FFT-RMS (Quick)</option>
                                <option value="p5-fixed">p5.Amplitude (Fixed)</option>
                                <option value="p5-auto">p5.Amplitude (Auto)</option>
                            </select>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label style="display: block; margin-bottom: 4px; font-size: 11px;">Compression Mode:</label>
                            <select id="compression-select" style="width: 100%; padding: 4px; background: rgba(50, 50, 50, 0.8); color: white; border: 1px solid #666; border-radius: 3px; font-size: 11px;">
                                <option value="none">None (Hard Clip)</option>
                                <option value="logarithmic">Logarithmic</option>
                                <option value="tanh">Tanh Soft Clip</option>
                                <option value="soft_clip">Polynomial</option>
                            </select>
                        </div>

                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <input type="checkbox" id="fast-response-check" style="margin-right: 6px;">
                            <label for="fast-response-check" style="font-size: 11px;">Fast Response Mode</label>
                        </div>

                        <div style="margin-bottom: 4px;">
                            <label style="display: block; margin-bottom: 4px; font-size: 11px;">Compression Ratio:</label>
                            <input type="range" id="compression-ratio" min="10" max="80" value="40" style="width: 70%; margin-right: 8px;">
                            <span id="compression-ratio-value" style="font-size: 11px;">40%</span>
                        </div>
                    </div>

                    <!-- 鼓触发控制区域 -->
                    <div style="background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
                        <h4 style="margin: 0 0 8px 0; color: #ff6688; font-size: 13px;">🥁 Drum Trigger</h4>
                        
                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                            <input type="checkbox" id="drum-enable-check" style="margin-right: 6px;">
                            <label for="drum-enable-check" style="font-size: 11px;">Enable Drum Trigger</label>
                        </div>

                        <div style="margin-bottom: 8px;">
                            <label style="display: block; margin-bottom: 4px; font-size: 11px;">Sensitivity Level:</label>
                            <div style="display: flex; gap: 4px;">
                                <button class="sensitivity-btn" data-level="1" style="padding: 4px 8px; background: rgba(100, 100, 100, 0.6); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">1</button>
                                <button class="sensitivity-btn" data-level="2" style="padding: 4px 8px; background: rgba(100, 100, 100, 0.6); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">2</button>
                                <button class="sensitivity-btn" data-level="3" style="padding: 4px 8px; background: rgba(100, 100, 100, 0.6); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">3</button>
                                <button class="sensitivity-btn" data-level="4" style="padding: 4px 8px; background: rgba(100, 100, 100, 0.6); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">4</button>
                                <button class="sensitivity-btn" data-level="5" style="padding: 4px 8px; background: rgba(100, 100, 100, 0.6); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">5</button>
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                            <button id="drum-reset-stats" style="padding: 4px 12px; background: rgba(150, 100, 50, 0.8); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 11px;">Reset Stats</button>
                            <button id="drum-show-stats" style="padding: 4px 12px; background: rgba(50, 150, 100, 0.8); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 11px;">Show Stats</button>
                        </div>

                        <div id="drum-stats" style="font-size: 10px; margin-top: 8px; padding: 6px; background: rgba(0, 0, 0, 0.4); border-radius: 3px; display: none;"></div>
                    </div>

                    <!-- FFT控制区域 -->
                    <div style="background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
                        <h4 style="margin: 0 0 8px 0; color: #6699ff; font-size: 13px;">📈 FFT Analysis</h4>
                        
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 11px;">Frequency Axis Mode:</label>
                            <select id="fft-axis-select" style="width: 100%; padding: 4px; background: rgba(50, 50, 50, 0.8); color: white; border: 1px solid #666; border-radius: 3px; font-size: 11px;">
                                <option value="linear">Linear</option>
                                <option value="hybrid">Hybrid (Log + Linear)</option>
                            </select>
                        </div>
                    </div>

                    <!-- 快捷操作区域 -->
                    <div style="background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 4px;">
                        <h4 style="margin: 0 0 8px 0; color: #cc99ff; font-size: 13px;">⚡ Quick Actions</h4>
                        
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                            <button id="trigger-test" style="padding: 4px 8px; background: rgba(255, 150, 0, 0.8); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">Test Trigger</button>
                            <button id="reset-all" style="padding: 4px 8px; background: rgba(255, 80, 80, 0.8); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">Reset All</button>
                            <button id="export-config" style="padding: 4px 8px; background: rgba(80, 150, 255, 0.8); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">Export Config</button>
                            <button id="show-hotkeys" style="padding: 4px 8px; background: rgba(150, 80, 255, 0.8); border: 1px solid #666; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">Show Hotkeys</button>
                        </div>
                    </div>
                </div>
            `;
        }

        /**
         * 绑定所有事件处理器
         */
        bindEvents() {
            const header = this.element.querySelector('#debug-header');
            const closeBtn = this.element.querySelector('#debug-close');

            // 拖拽功能
            header.addEventListener('mousedown', (e) => this.startDrag(e));
            document.addEventListener('mousemove', (e) => this.drag(e));
            document.addEventListener('mouseup', () => this.stopDrag());

            // 关闭按钮
            closeBtn.addEventListener('click', () => this.hide());

            // 振幅控制事件
            this.bindAmplitudeEvents();

            // 鼓触发控制事件
            this.bindDrumTriggerEvents();

            // FFT控制事件
            this.bindFFTEvents();

            // 快捷操作事件
            this.bindQuickActionEvents();
        }

        /**
         * 绑定振幅控制相关事件
         */
        bindAmplitudeEvents() {
            this.element.querySelector('#amp-mode-select').addEventListener('change', (e) => {
                this.applyAmplitudeMode(e.target.value);
            });

            this.element.querySelector('#compression-select').addEventListener('change', (e) => {
                this.applyCompressionMode(e.target.value);
            });

            this.element.querySelector('#fast-response-check').addEventListener('change', (e) => {
                if (typeof ampHUD !== 'undefined' && ampHUD) {
                    ampHUD.setFastResponse(e.target.checked);
                    this.showTemporaryMessage(`Fast Response: ${e.target.checked ? 'ON' : 'OFF'}`);
                }
            });

            const compressionRatio = this.element.querySelector('#compression-ratio');
            const compressionValue = this.element.querySelector('#compression-ratio-value');
            compressionRatio.addEventListener('input', (e) => {
                const value = e.target.value;
                compressionValue.textContent = value + '%';
                if (typeof ampHUD !== 'undefined' && ampHUD) {
                    ampHUD.setCompressionMode(ampHUD._compressionMode, value / 100);
                    this.showTemporaryMessage(`Compression Ratio: ${value}%`);
                }
            });
        }

        /**
         * 绑定鼓触发器相关事件
         */
        bindDrumTriggerEvents() {
            this.element.querySelector('#drum-enable-check').addEventListener('change', (e) => {
                if (typeof drumTrigger !== 'undefined' && drumTrigger) {
                    drumTrigger.enable(e.target.checked);
                    this.showTemporaryMessage(`Drum Trigger: ${e.target.checked ? 'ON' : 'OFF'}`);
                }
            });

            // 敏感度按钮
            this.element.querySelectorAll('.sensitivity-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const level = parseInt(e.target.dataset.level);
                    this.setSensitivity(level);
                });
            });

            // 鼓统计按钮
            this.element.querySelector('#drum-reset-stats').addEventListener('click', () => {
                if (typeof drumTrigger !== 'undefined' && drumTrigger) {
                    drumTrigger.resetStats();
                    this.showTemporaryMessage('Drum stats reset!');
                    this.hideDrumStats();
                }
            });

            this.element.querySelector('#drum-show-stats').addEventListener('click', () => {
                this.toggleDrumStats();
            });
        }

        /**
         * 绑定FFT控制相关事件
         */
        bindFFTEvents() {
            this.element.querySelector('#fft-axis-select').addEventListener('change', (e) => {
                if (typeof fftHUD !== 'undefined' && fftHUD && fftHUD.setAxis) {
                    fftHUD.setAxis({ mode: e.target.value });
                    this.showTemporaryMessage(`FFT Axis: ${e.target.value.toUpperCase()}`);
                }
            });
        }

        /**
         * 绑定快捷操作相关事件
         */
        bindQuickActionEvents() {
            this.element.querySelector('#trigger-test').addEventListener('click', () => {
                this.testTrigger();
            });

            this.element.querySelector('#reset-all').addEventListener('click', () => {
                this.resetAllSettings();
            });

            this.element.querySelector('#export-config').addEventListener('click', () => {
                this.exportConfiguration();
            });

            this.element.querySelector('#show-hotkeys').addEventListener('click', () => {
                this.showHotkeyReference();
            });
        }

        // === 拖拽相关方法 ===
        startDrag(e) {
            this.dragData.isDragging = true;
            this.dragData.startX = e.clientX;
            this.dragData.startY = e.clientY;
            this.dragData.startLeft = parseInt(this.element.style.left || this.element.offsetLeft);
            this.dragData.startTop = parseInt(this.element.style.top || this.element.offsetTop);
            e.preventDefault();
        }

        drag(e) {
            if (!this.dragData.isDragging) return;

            const deltaX = e.clientX - this.dragData.startX;
            const deltaY = e.clientY - this.dragData.startY;

            this.element.style.left = Math.max(0, Math.min(window.innerWidth - 320, this.dragData.startLeft + deltaX)) + 'px';
            this.element.style.top = Math.max(0, Math.min(window.innerHeight - 200, this.dragData.startTop + deltaY)) + 'px';
            this.element.style.right = 'auto';
        }

        stopDrag() {
            this.dragData.isDragging = false;
        }

        // === 显示/隐藏方法 ===
        show() {
            this.visible = true;
            this.element.style.display = 'block';
            this.syncWithCurrentState();
            this.startStatusUpdate();
        }

        hide() {
            this.visible = false;
            this.element.style.display = 'none';
            this.stopStatusUpdate();
        }

        toggle() {
            if (this.visible) {
                this.hide();
            } else {
                this.show();
            }
        }

        // === 状态同步方法 ===
        syncWithCurrentState() {
            try {
                this.syncAmplitudeState();
                this.syncDrumTriggerState();
                this.syncFFTState();
            } catch (error) {
                console.warn('Error syncing debug panel state:', error);
            }
        }

        syncAmplitudeState() {
            if (typeof ampHUD === 'undefined' || !ampHUD) return;

            const state = ampHUD.getAmplitudeState ? ampHUD.getAmplitudeState() : {};

            // 设置振幅模式
            let modeValue = 'fft-fixed';
            if (state.preferAmp) {
                modeValue = state.dynamicScale ? 'p5-auto' : 'p5-fixed';
            } else {
                if (state.dynamicScale) {
                    modeValue = state.instantAdapt ? 'fft-quick' : 'fft-auto';
                } else {
                    modeValue = 'fft-fixed';
                }
            }
            this.element.querySelector('#amp-mode-select').value = modeValue;

            // 设置压缩模式
            this.element.querySelector('#compression-select').value = ampHUD._compressionMode || 'logarithmic';

            // 设置快速响应
            this.element.querySelector('#fast-response-check').checked = ampHUD._fastResponse || false;

            // 设置压缩比例
            const ratio = Math.round((ampHUD._compressionRatio || 0.4) * 100);
            this.element.querySelector('#compression-ratio').value = ratio;
            this.element.querySelector('#compression-ratio-value').textContent = ratio + '%';
        }

        syncDrumTriggerState() {
            if (typeof drumTrigger === 'undefined' || !drumTrigger) return;
            this.element.querySelector('#drum-enable-check').checked = drumTrigger._isEnabled || false;
        }

        syncFFTState() {
            if (typeof fftHUD === 'undefined' || !fftHUD) return;
            this.element.querySelector('#fft-axis-select').value = fftHUD._axisMode || 'hybrid';
        }

        // === 功能实现方法 ===
        applyAmplitudeMode(mode) {
            if (typeof ampHUD === 'undefined' || !ampHUD) {
                this.showTemporaryMessage('Amplitude system not available');
                return;
            }

            const modes = {
                'fft-fixed': { preferAmp: false, dynamicScale: false },
                'fft-auto': { preferAmp: false, dynamicScale: true, instantAdapt: false },
                'fft-quick': { preferAmp: false, dynamicScale: true, instantAdapt: true },
                'p5-fixed': { preferAmp: true, dynamicScale: false },
                'p5-auto': { preferAmp: true, dynamicScale: true, instantAdapt: false }
            };

            const config = modes[mode];
            if (!config) return;

            if (config.preferAmp) {
                ampHUD.preferAmplitude(true);
            } else {
                ampHUD.preferAmplitude(false);
            }

            ampHUD.setDynamicScale(config.dynamicScale);
            if (config.dynamicScale && config.hasOwnProperty('instantAdapt')) {
                ampHUD.setInstantAdapt(config.instantAdapt);
            }

            this.showTemporaryMessage(`Amplitude: ${mode.replace('-', ' ').toUpperCase()}`);
        }

        applyCompressionMode(mode) {
            if (typeof ampHUD === 'undefined' || !ampHUD) {
                this.showTemporaryMessage('Amplitude system not available');
                return;
            }

            if (mode === 'none') {
                ampHUD._compressionMode = 'none';
            } else {
                ampHUD.setCompressionMode(mode, (ampHUD._compressionRatio || 0.4));
            }

            this.showTemporaryMessage(`Compression: ${mode.toUpperCase()}`);
        }

        setSensitivity(level) {
            if (typeof drumTrigger === 'undefined' || !drumTrigger) {
                this.showTemporaryMessage('Drum trigger not available');
                return;
            }

            // 更新按钮样式
            this.element.querySelectorAll('.sensitivity-btn').forEach(btn => {
                if (parseInt(btn.dataset.level) === level) {
                    btn.style.background = 'rgba(0, 255, 100, 0.8)';
                } else {
                    btn.style.background = 'rgba(100, 100, 100, 0.6)';
                }
            });

            const sensitivity = Math.pow(level / 5.0, 0.5);
            drumTrigger.setSensitivity(sensitivity);
            this.showTemporaryMessage(`Sensitivity: Level ${level}`);
        }

        toggleDrumStats() {
            const statsDiv = this.element.querySelector('#drum-stats');
            if (statsDiv.style.display === 'none') {
                this.showDrumStats();
            } else {
                this.hideDrumStats();
            }
        }

        showDrumStats() {
            const statsDiv = this.element.querySelector('#drum-stats');
            if (typeof drumTrigger !== 'undefined' && drumTrigger && drumTrigger.getStats) {
                const stats = drumTrigger.getStats();
                statsDiv.innerHTML = `
                    <strong>Drum Trigger Statistics:</strong><br>
                    Triggers: ${stats.totalTriggers || 0}<br>
                    Last Trigger: ${stats.lastTriggerTime || 'None'}<br>
                    Avg Level: ${(stats.avgLevel || 0).toFixed(3)}<br>
                    Peak Level: ${(stats.peakLevel || 0).toFixed(3)}
                `;
                statsDiv.style.display = 'block';
            } else {
                statsDiv.innerHTML = '<em>Statistics not available</em>';
                statsDiv.style.display = 'block';
            }
        }

        hideDrumStats() {
            const statsDiv = this.element.querySelector('#drum-stats');
            statsDiv.style.display = 'none';
        }

        testTrigger() {
            const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

            if (isMobile && typeof drumTrigger !== 'undefined' && drumTrigger && drumTrigger._onTrigger) {
                drumTrigger._onTrigger('GUI_TEST');
                this.showTemporaryMessage('Test trigger fired!');
            } else if (!isMobile) {
                this.showTemporaryMessage('Test trigger only available on mobile');
            } else {
                this.showTemporaryMessage('Drum trigger not available');
            }
        }

        resetAllSettings() {
            if (!confirm('Reset all debug settings to defaults?')) return;

            try {
                // 重置振幅设置
                if (typeof ampHUD !== 'undefined' && ampHUD) {
                    ampHUD.preferAmplitude(false);
                    ampHUD.setDynamicScale(true);
                    ampHUD.setInstantAdapt(false);
                    ampHUD.setCompressionMode('logarithmic', 0.4);
                    ampHUD.setFastResponse(true);
                }

                // 重置鼓触发
                if (typeof drumTrigger !== 'undefined' && drumTrigger) {
                    drumTrigger.enable(true);
                    drumTrigger.setSensitivity(0.6);
                    drumTrigger.resetStats();
                }

                // 重置FFT
                if (typeof fftHUD !== 'undefined' && fftHUD && fftHUD.setAxis) {
                    fftHUD.setAxis({ mode: 'hybrid' });
                }

                this.syncWithCurrentState();
                this.showTemporaryMessage('All settings reset to defaults!');
            } catch (error) {
                console.error('Error resetting settings:', error);
                this.showTemporaryMessage('Error resetting settings');
            }
        }

        exportConfiguration() {
            const config = {
                amplitude: {
                    preferAmp: (typeof ampHUD !== 'undefined' && ampHUD) ? ampHUD._preferAmp : false,
                    dynamicScale: (typeof ampHUD !== 'undefined' && ampHUD) ? ampHUD._dynamicScale : true,
                    instantAdapt: (typeof ampHUD !== 'undefined' && ampHUD) ? ampHUD._instantAdapt : false,
                    compressionMode: (typeof ampHUD !== 'undefined' && ampHUD) ? ampHUD._compressionMode : 'logarithmic',
                    compressionRatio: (typeof ampHUD !== 'undefined' && ampHUD) ? ampHUD._compressionRatio : 0.4,
                    fastResponse: (typeof ampHUD !== 'undefined' && ampHUD) ? ampHUD._fastResponse : true
                },
                drumTrigger: {
                    enabled: (typeof drumTrigger !== 'undefined' && drumTrigger) ? drumTrigger._isEnabled : false,
                    sensitivity: (typeof drumTrigger !== 'undefined' && drumTrigger) ? drumTrigger._sensitivity : 0.6
                },
                fft: {
                    axisMode: (typeof fftHUD !== 'undefined' && fftHUD) ? fftHUD._axisMode : 'hybrid'
                },
                timestamp: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `debug-config-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showTemporaryMessage('Configuration exported!');
        }

        showHotkeyReference() {
            const helpText = `
Debug Panel 热键参考
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
面板开关:
[D] 打开/关闭调试面板

传统热键 (面板关闭时可用):
[A] 振幅模式循环
[Z] 压缩模式循环  
[X] 响应速度切换 (桌面端)
[H] 显示帮助
[T] 鼓触发开关
[1-5] 鼓敏感度
[R] 重置鼓统计
[I] 显示鼓统计
[L] FFT轴模式切换

建议: 使用图形面板代替热键操作！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `;

            console.log(helpText);
            this.showTemporaryMessage('Hotkey reference logged to console');
        }

        // === 状态更新方法 ===
        startStatusUpdate() {
            this.updateStatus();
            this.updateInterval = setInterval(() => this.updateStatus(), 1000);
        }

        stopStatusUpdate() {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
        }

        updateStatus() {
            if (!this.visible) return;

            const statusDiv = this.element.querySelector('#status-info');
            let status = '';

            try {
                // 性能状态
                if (typeof performanceMode !== 'undefined') {
                    status += `<strong>Performance:</strong> ${performanceMode}<br>`;
                }

                if (typeof frameRate === 'function') {
                    status += `<strong>Frame Rate:</strong> ${(frameRate() || 0).toFixed(1)} fps<br>`;
                }

                if (typeof getAudioContext === 'function') {
                    status += `<strong>Audio Context:</strong> ${getAudioContext()?.state || 'unknown'}<br>`;
                }

                // 麦克风状态
                if (typeof mic !== 'undefined' && mic && mic.getLevel) {
                    const level = mic.getLevel();
                    status += `<strong>Mic Level:</strong> ${(level * 100).toFixed(1)}%<br>`;
                }

                // 鼓触发状态
                if (typeof drumTrigger !== 'undefined' && drumTrigger) {
                    const triggerCount = drumTrigger._triggerCount || 0;
                    status += `<strong>Triggers:</strong> ${triggerCount}<br>`;
                }

                // 游戏状态
                if (typeof running !== 'undefined') {
                    const gameState = running ? 'Running' : (typeof counting !== 'undefined' && counting ? 'Countdown' : 'Stopped');
                    status += `<strong>Game State:</strong> ${gameState}<br>`;
                }

                if (typeof rm !== 'undefined' && rm) {
                    status += `<strong>BPM:</strong> ${Math.round(rm.bpm || 0)}<br>`;
                    status += `<strong>Speed Factor:</strong> ${(rm.speedFactor || 0).toFixed(2)}`;
                }

            } catch (error) {
                status = `<span style="color: #ff6666;">Error updating status: ${error.message}</span>`;
            }

            statusDiv.innerHTML = status;
        }

        // === 消息显示方法 ===
        showTemporaryMessage(message, duration = 2000) {
            // 清除之前的消息
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
            }

            let msgDiv = document.getElementById('debug-temp-message');
            if (!msgDiv) {
                msgDiv = document.createElement('div');
                msgDiv.id = 'debug-temp-message';
                msgDiv.style.cssText = `
                    position: absolute;
                    top: -30px;
                    left: 0;
                    right: 0;
                    background: rgba(0, 255, 100, 0.9);
                    color: #000;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    text-align: center;
                    font-weight: bold;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    z-index: 10001;
                `;
                this.element.appendChild(msgDiv);
            }

            msgDiv.textContent = message;
            msgDiv.style.opacity = '1';

            this.messageTimeout = setTimeout(() => {
                msgDiv.style.opacity = '0';
                setTimeout(() => {
                    if (msgDiv.parentNode) {
                        msgDiv.parentNode.removeChild(msgDiv);
                    }
                }, 300);
            }, duration);
        }

        // === 清理方法 ===
        destroy() {
            this.hide();
            if (this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
            this.element = null;
        }
    }

    // 将 DebugPanel 暴露到全局作用域
    root.DebugPanel = DebugPanel;

})(window);