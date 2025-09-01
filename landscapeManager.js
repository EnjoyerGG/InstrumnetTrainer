class LandscapeManager {
    constructor() {
        this.init();
    }

    init() {
        this.overlay = document.getElementById('orientationOverlay');
        this.forceBtn = document.getElementById('forceRotateBtn');
        this.isForced = false;
        this.isInitialized = false;

        // 等待DOM完全加载
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupAfterLoad();
            });
        } else {
            this.setupAfterLoad();
        }
    }

    setupAfterLoad() {
        this.overlay = document.getElementById('orientationOverlay');
        this.forceBtn = document.getElementById('forceRotateBtn');

        if (!this.overlay || !this.forceBtn) {
            console.warn('横屏管理器：未找到必要的DOM元素');
            return;
        }

        this.setupEventListeners();
        this.checkOrientation();
        this.isInitialized = true;

        // 定期检查方向变化
        setInterval(() => this.checkOrientation(), 500);

        console.log('横屏管理器初始化完成');
    }

    setupEventListeners() {
        // 方向变化事件
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.checkOrientation(), 100);
        });

        window.addEventListener('resize', () => {
            setTimeout(() => this.checkOrientation(), 100);
        });

        // 强制横屏按钮
        if (this.forceBtn) {
            this.forceBtn.addEventListener('click', () => {
                this.forceRotate();
            });
        }

        // 阻止页面滚动（移动端强制横屏时）
        document.addEventListener('touchmove', (e) => {
            if (this.isForced) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    isLandscape() {
        // 检查多种方式确定是否为横屏
        const orientation = screen.orientation || screen.mozOrientation || screen.msOrientation;

        if (orientation) {
            return orientation.angle === 90 || orientation.angle === -90 ||
                orientation.type.includes('landscape');
        }

        // 备用检测方法
        return window.innerWidth > window.innerHeight;
    }

    isMobile() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            'ontouchstart' in window ||
            navigator.maxTouchPoints > 0;
    }

    checkOrientation() {
        if (!this.isInitialized) return;

        if (!this.isMobile()) {
            this.hideOverlay();
            return;
        }

        const isLandscape = this.isLandscape();

        if (isLandscape || this.isForced) {
            this.hideOverlay();
            this.notifyOrientationChange(true);
        } else {
            this.showOverlay();
            this.notifyOrientationChange(false);
        }
    }

    forceRotate() {
        console.log('执行强制横屏显示');
        this.isForced = true;
        document.body.classList.add('force-landscape');
        this.hideOverlay();

        // 调整视口和通知应用
        setTimeout(() => {
            this.adjustViewport();
            this.notifyOrientationChange(true);
        }, 100);
    }

    adjustViewport() {
        // 获取实际的屏幕尺寸
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;

        // 在强制横屏模式下，使用横屏的宽高
        const landscapeWidth = Math.max(screenWidth, screenHeight);
        const landscapeHeight = Math.min(screenWidth, screenHeight);

        console.log(`调整视口至横屏: ${landscapeWidth}x${landscapeHeight}`);

        // 通知应用调整尺寸
        this.notifyOrientationChange(true, landscapeWidth, landscapeHeight);
    }

    showOverlay() {
        if (this.overlay && !this.overlay.classList.contains('hidden')) return;

        if (this.overlay) {
            this.overlay.classList.remove('hidden');
            console.log('显示横屏提示');
        }
    }

    hideOverlay() {
        if (this.overlay && this.overlay.classList.contains('hidden')) return;

        if (this.overlay) {
            this.overlay.classList.add('hidden');
            console.log('隐藏横屏提示');
        }
    }

    notifyOrientationChange(isLandscape, width = null, height = null) {
        // 获取实际尺寸
        let actualWidth, actualHeight;

        if (this.isForced && !isLandscape) {
            // 强制横屏情况下的尺寸计算
            actualWidth = Math.max(window.screen.width, window.screen.height);
            actualHeight = Math.min(window.screen.width, window.screen.height);
        } else {
            actualWidth = width || window.innerWidth;
            actualHeight = height || window.innerHeight;
        }

        console.log(`方向变化通知: ${isLandscape ? '横屏' : '竖屏'} ${actualWidth}x${actualHeight}`);

        // 通知现有的应用处理函数
        if (typeof window.onOrientationChange === 'function') {
            window.onOrientationChange(isLandscape, actualWidth, actualHeight);
        }

        // 触发自定义事件
        window.dispatchEvent(new CustomEvent('landscapechange', {
            detail: {
                isLandscape,
                width: actualWidth,
                height: actualHeight,
                forced: this.isForced
            }
        }));
    }

    // 获取当前状态的公共方法
    getStatus() {
        return {
            isLandscape: this.isLandscape(),
            isMobile: this.isMobile(),
            isForced: this.isForced,
            width: this.isForced ? Math.max(window.screen.width, window.screen.height) : window.innerWidth,
            height: this.isForced ? Math.min(window.screen.width, window.screen.height) : window.innerHeight,
            initialized: this.isInitialized
        };
    }

    // 重置强制横屏
    resetForceRotate() {
        console.log('重置强制横屏');
        this.isForced = false;
        document.body.classList.remove('force-landscape');
        this.checkOrientation();
    }

    // 手动触发检查（供外部调用）
    refresh() {
        this.checkOrientation();
    }
}

// 创建全局实例
window.landscapeManager = new LandscapeManager();