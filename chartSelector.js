// ChartSelector.js - 谱子选择器模块
// 用于加载和切换不同的节拍谱子

(function (root) {
    'use strict';

    const ChartSelector = {
        // 谱子配置列表
        charts: [
            {
                id: 'bolero',
                name: 'Bolero (Original)',
                file: 'assets/bolero.json',
                description: 'Classic Ravel Bolero rhythm'
            },
            {
                id: 'tumbao',
                name: 'Tumbao',
                file: 'assets/tumbao.json',
                description: 'Traditional Tumbao pattern'
            }
        ],

        currentChart: null,
        currentChartId: 'bolero',
        isLoading: false,
        loadedCharts: new Map(), // 缓存已加载的谱子

        // 回调函数
        onChartChange: null,
        onLoadStart: null,
        onLoadComplete: null,
        onLoadError: null,

        // 初始化
        init(options = {}) {
            this.onChartChange = options.onChartChange || null;
            this.onLoadStart = options.onLoadStart || null;
            this.onLoadComplete = options.onLoadComplete || null;
            this.onLoadError = options.onLoadError || null;

            this.createUI();
            this.setupEventListeners();

            console.log('ChartSelector initialized with', this.charts.length, 'charts');
            return this;
        },

        // 创建UI元素
        createUI() {
            // 创建容器
            const container = document.createElement('div');
            container.id = 'chart-selector-container';
            container.style.cssText = `
    position: relative;
    display: inline-block;
    margin-right: 20px;         /* 增加右边距：从12px改为20px */
    margin-left: 10px;          /* 添加左边距 */
    margin-top: 5px;            /* 添加上边距 */
    margin-bottom: 5px;         /* 添加下边距 */
    vertical-align: middle;     /* 改变垂直对齐：从top改为middle */
`;

            // 创建主按钮
            const button = document.createElement('button');
            button.id = 'chart-selector-btn';
            button.innerHTML = `
                <span id="chart-current-name">Bolero</span>
                <span style="margin-left: 8px; font-size: 12px;">▼</span>
            `;
            button.style.cssText = `
                background: #444;
        color: #eee;
        border: 1px solid #555;
        border-radius: 6px;  /* 统一圆角，不再分离 */
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        height: 32px;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 100px;
        text-align: left;
        display: flex;
        justify-content: space-between;
        align-items: center;
        white-space: nowrap;
            `;



            // 创建下拉菜单
            const dropdown = document.createElement('div');
            dropdown.id = 'chart-selector-dropdown';
            dropdown.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: #333;
                border: 1px solid #555;
                border-top: none;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 1000;
                display: none;
                max-height: 300px;
                overflow-y: auto;
            `;

            // 添加谱子选项
            this.charts.forEach(chart => {
                const option = document.createElement('div');
                option.className = 'chart-option';
                option.dataset.chartId = chart.id;
                option.innerHTML = `
                    <div style="font-weight: 500; margin-bottom: 2px;">${chart.name}</div>
                    <div style="font-size: 11px; color: #aaa;">${chart.description}</div>
                `;
                option.style.cssText = `
                    padding: 12px 16px;
                    cursor: pointer;
                    border-bottom: 1px solid #444;
                    transition: background 0.15s ease;
                `;

                // 高亮当前选中项
                if (chart.id === this.currentChartId) {
                    option.style.background = '#4a5568';
                }

                dropdown.appendChild(option);
            });

            // 添加加载指示器
            const loadingIndicator = document.createElement('div');
            loadingIndicator.id = 'chart-loading-indicator';
            loadingIndicator.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; padding: 8px;">
                    <div style="
                        width: 16px; 
                        height: 16px; 
                        border: 2px solid #555; 
                        border-top: 2px solid #fff; 
                        border-radius: 50%; 
                        animation: spin 1s linear infinite;
                        margin-right: 8px;
                    "></div>
                    Loading chart...
                </div>
            `;
            loadingIndicator.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: #333;
                border: 1px solid #555;
                border-top: none;
                border-radius: 0 0 8px 8px;
                color: #eee;
                z-index: 1001;
                display: none;
            `;

            // 添加CSS动画
            if (!document.getElementById('chart-selector-styles')) {
                const style = document.createElement('style');
                style.id = 'chart-selector-styles';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .chart-option:hover {
                        background: #4a5568 !important;
                    }
                    .chart-option:last-child {
                        border-bottom: none;
                    }
                `;
                document.head.appendChild(style);
            }

            // 组装UI
            container.appendChild(button);
            container.appendChild(dropdown);
            container.appendChild(loadingIndicator);

            // 插入到start按钮前面
            const startBtn = document.getElementById('start-btn');
            if (startBtn && startBtn.parentNode) {
                startBtn.parentNode.insertBefore(container, startBtn);
            } else {
                console.warn('Could not find start button to position chart selector');
                document.body.appendChild(container);
            }

            this.elements = {
                container,
                button,
                arrowBtn: null,
                dropdown,
                loadingIndicator,
                currentName: document.getElementById('chart-current-name')
            };
        },

        // 设置事件监听器
        setupEventListeners() {
            const { button, dropdown } = this.elements;

            // 单个按钮点击事件
            const toggleDropdown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (this.isLoading) return;

                const isOpen = dropdown.style.display === 'block';
                if (isOpen) {
                    this.closeDropdown();
                } else {
                    this.openDropdown();
                }
            };

            button.addEventListener('click', toggleDropdown);

            // 选项点击
            dropdown.addEventListener('click', (e) => {
                const option = e.target.closest('.chart-option');
                if (option) {
                    const chartId = option.dataset.chartId;
                    this.selectChart(chartId);
                }
            });

            // 点击外部关闭下拉菜单
            document.addEventListener('click', (e) => {
                if (!this.elements.container.contains(e.target)) {
                    this.closeDropdown();
                }
            });

            // ESC键关闭下拉菜单
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.closeDropdown();
                }
            });

            // 鼠标悬停效果
            button.addEventListener('mouseenter', () => {
                if (!this.isLoading) {
                    button.style.background = '#555';
                    button.style.borderColor = '#666';
                }
            });

            button.addEventListener('mouseleave', () => {
                if (!this.isLoading) {
                    button.style.background = '#444';
                    button.style.borderColor = '#555';
                }
            });
        },

        // 打开下拉菜单
        openDropdown() {
            if (this.isLoading) return;

            this.elements.dropdown.style.display = 'block';
            // 更新箭头方向
            const arrowSpan = this.elements.button.querySelector('span:last-child');
            if (arrowSpan) {
                arrowSpan.innerHTML = '▲';
            }

            // 更新选中状态
            const options = this.elements.dropdown.querySelectorAll('.chart-option');
            options.forEach(option => {
                if (option.dataset.chartId === this.currentChartId) {
                    option.style.background = '#4a5568';
                } else {
                    option.style.background = '';
                }
            });
        },

        // 关闭下拉菜单
        closeDropdown() {
            this.elements.dropdown.style.display = 'none';

            // 恢复箭头方向
            const arrowSpan = this.elements.button.querySelector('span:last-child');
            if (arrowSpan) {
                arrowSpan.innerHTML = '▼';
            }
        },

        // 选择谱子
        async selectChart(chartId) {
            if (this.isLoading || chartId === this.currentChartId) {
                this.closeDropdown();
                return;
            }

            const chart = this.charts.find(c => c.id === chartId);
            if (!chart) {
                console.error('Chart not found:', chartId);
                return;
            }

            this.closeDropdown();

            try {
                await this.loadChart(chart);
            } catch (error) {
                console.error('Failed to load chart:', error);
                this.showError('Failed to load chart: ' + chart.name);
            }
        },

        // 加载谱子
        async loadChart(chart) {
            // 检查缓存
            if (this.loadedCharts.has(chart.id)) {
                console.log('Loading chart from cache:', chart.name);
                this.applyChart(chart, this.loadedCharts.get(chart.id));
                return;
            }

            this.showLoading(true);

            if (this.onLoadStart) {
                this.onLoadStart(chart);
            }

            try {
                console.log('Loading chart:', chart.name, 'from', chart.file);

                // 加载JSON文件
                const response = await fetch(chart.file);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const chartData = await response.json();

                // 验证数据结构
                this.validateChartData(chartData, chart);

                // 缓存数据
                this.loadedCharts.set(chart.id, chartData);

                // 应用谱子
                this.applyChart(chart, chartData);

            } catch (error) {
                console.error('Chart loading error:', error);
                this.showError(`Failed to load ${chart.name}: ${error.message}`);

                if (this.onLoadError) {
                    this.onLoadError(chart, error);
                }
                throw error;
            } finally {
                this.showLoading(false);
            }
        },

        // 应用谱子到系统
        applyChart(chart, chartData) {
            console.log('Applying chart:', chart.name);

            this.currentChart = chartData;
            this.currentChartId = chart.id;

            // 更新UI
            this.elements.currentName.textContent = chart.name;
            this.updateButtonStyle();

            // 调用回调函数
            if (this.onChartChange) {
                this.onChartChange(chart, chartData);
            }

            if (this.onLoadComplete) {
                this.onLoadComplete(chart, chartData);
            }

            console.log('Chart applied successfully:', chart.name);
        },

        // 验证谱子数据
        validateChartData(chartData, chart) {
            if (!chartData || typeof chartData !== 'object') {
                throw new Error('Invalid chart data format');
            }

            // 检查conga数组
            if (!Array.isArray(chartData.conga)) {
                throw new Error('Missing or invalid "conga" array');
            }

            if (chartData.conga.length === 0) {
                throw new Error('Empty chart data');
            }

            // 检查必需字段
            const firstNote = chartData.conga[0];
            const requiredFields = ['time', 'type'];
            for (const field of requiredFields) {
                if (!(field in firstNote)) {
                    throw new Error(`Missing required field: ${field}`);
                }
            }

            console.log(`Chart validation passed: ${chart.name} (${chartData.conga.length} notes)`);
        },

        // 显示/隐藏加载状态
        showLoading(show) {
            this.isLoading = show;

            if (show) {
                this.elements.loadingIndicator.style.display = 'block';
                this.elements.dropdown.style.display = 'none';
                this.elements.button.style.opacity = '0.6';
                this.elements.button.style.cursor = 'not-allowed';
            } else {
                this.elements.loadingIndicator.style.display = 'none';
                this.elements.button.style.opacity = '1';
                this.elements.button.style.cursor = 'pointer';
            }
        },

        // 显示错误信息
        showError(message) {
            // 创建临时错误提示
            const errorDiv = document.createElement('div');
            errorDiv.innerHTML = message;
            errorDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #dc2626;
                color: white;
                padding: 16px 24px;
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                z-index: 10000;
                font-size: 14px;
                max-width: 400px;
                text-align: center;
            `;

            document.body.appendChild(errorDiv);

            // 3秒后自动移除
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 3000);

            console.error('Chart selector error:', message);
        },

        // 更新按钮样式
        updateButtonStyle() {
            // 短暂显示绿色表示切换成功
            this.elements.button.style.background = '#22c55e';
            this.elements.button.style.borderColor = '#16a34a';

            // 500ms后恢复原色
            setTimeout(() => {
                this.elements.button.style.background = '#444';
                this.elements.button.style.borderColor = '#555';
            }, 500);
        },

        // 获取当前谱子信息
        getCurrentChart() {
            return {
                id: this.currentChartId,
                data: this.currentChart,
                info: this.charts.find(c => c.id === this.currentChartId)
            };
        },

        // 添加新谱子配置
        addChart(chartConfig) {
            this.charts.push(chartConfig);
            console.log('Added new chart:', chartConfig.name);
        },

        // 预加载所有谱子
        async preloadAllCharts() {
            console.log('Preloading all charts...');

            const loadPromises = this.charts.map(async chart => {
                try {
                    await this.loadChart(chart);
                    return { success: true, chart };
                } catch (error) {
                    console.error('Failed to preload:', chart.name, error);
                    return { success: false, chart, error };
                }
            });

            const results = await Promise.allSettled(loadPromises);
            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

            console.log(`Preloaded ${successful}/${this.charts.length} charts`);
            return results;
        }
    };

    // 导出到全局
    root.ChartSelector = ChartSelector;

})(window);