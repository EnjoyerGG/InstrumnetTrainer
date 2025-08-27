// settingsPanel.js - 设置面板模块
// 提供齿轮按钮和可折叠的设置界面，包含速度控制和键盘指南

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
        },

        // 显示设置面板
        show() {
            this._isVisible = true;
            this._overlay.style.display = 'block';
            // 防止页面滚动
            document.body.style.overflow = 'hidden';
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