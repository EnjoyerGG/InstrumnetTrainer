class ForceRotationManager {
    constructor() {
        this.isRotated = false;
        this.autoRotateEnabled = true;
        this.container = null;
        this.init();
    }

    init() {
        // 等待DOM加载
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    setup() {
        this.container = document.body;

        // 只有移动端才启用强制旋转功能
        if (!this.isMobile()) {
            console.log('桌面端检测：跳过强制旋转功能');
            return;
        }

        console.log('移动端检测：启用强制旋转功能');
        this.setupEventListeners();

        // 移动设备自动强制横屏
        if (this.shouldAutoRotate()) {
            console.log('检测到移动设备竖屏，准备自动强制横屏');
            setTimeout(() => this.forceRotate(), 300);
        }
    }

    setupEventListeners() {
        // 监听屏幕方向变化
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.handleOrientationChange(), 200);
        });

        window.addEventListener('resize', () => {
            this.handleResize();
        });

        // 全屏状态变化
        document.addEventListener('fullscreenchange', () => {
            this.handleFullscreenChange();
        });

        document.addEventListener('webkitfullscreenchange', () => {
            this.handleFullscreenChange();
        });
    }

    shouldAutoRotate() {
        return this.autoRotateEnabled &&
            this.isMobile() &&
            !this.isLandscape() &&
            !this.isRotated;
    }

    async forceRotate() {
        // 桌面端不执行强制旋转
        if (!this.isMobile()) {
            console.log('桌面端：跳过强制旋转请求');
            return;
        }

        if (this.isRotated) {
            console.log('已处于强制旋转状态');
            return;
        }

        console.log('移动端：执行强制横屏旋转');

        // 方法1: Screen Orientation API (优先使用)
        if (this.supportsOrientationAPI()) {
            try {
                await screen.orientation.lock('landscape');
                console.log('Screen Orientation API 强制横屏成功');
                this.isRotated = true;
                this.notifyChange();
                return;
            } catch (err) {
                console.log('Screen Orientation API 失败，使用CSS方案:', err.message);
            }
        }

        // 方法2: CSS Transform强制旋转
        this.applyCSSRotation();
    }

    applyCSSRotation() {
        console.log('应用CSS强制旋转');

        // 添加CSS类
        this.container.classList.add('force-landscape');

        // 调整meta视口
        this.adjustViewport();

        this.isRotated = true;
        this.notifyChange();
    }

    adjustViewport() {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
        }

        // 强制横屏时的视口设置
        meta.content = 'width=device-height, height=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    }

    resetRotation() {
        // 桌面端不执行重置旋转
        if (!this.isMobile()) {
            console.log('桌面端：跳过重置旋转请求');
            return;
        }

        if (!this.isRotated) return;

        console.log('移动端：重置屏幕旋转');

        // 解锁Screen Orientation API
        if (this.supportsOrientationAPI()) {
            try {
                screen.orientation.unlock();
            } catch (err) {
                console.log('解锁屏幕方向失败:', err.message);
            }
        }

        // 移除CSS强制旋转
        this.container.classList.remove('force-landscape');

        // 重置视口
        this.resetViewport();

        this.isRotated = false;
        this.notifyChange();
    }

    resetViewport() {
        const meta = document.querySelector('meta[name="viewport"]');
        if (meta) {
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
        }
    }

    async requestFullscreenAndRotate() {
        // 桌面端只请求全屏，不强制旋转
        if (!this.isMobile()) {
            console.log('桌面端：只请求全屏，不强制旋转');
            try {
                const element = document.documentElement;
                if (element.requestFullscreen) {
                    await element.requestFullscreen();
                } else if (element.webkitRequestFullscreen) {
                    await element.webkitRequestFullscreen();
                } else if (element.msRequestFullscreen) {
                    await element.msRequestFullscreen();
                }
            } catch (err) {
                console.error('桌面端全屏请求失败:', err);
            }
            return;
        }

        // 移动端：请求全屏并旋转
        console.log('移动端：请求全屏并强制旋转');
        try {
            // 请求全屏
            const element = document.documentElement;
            if (element.requestFullscreen) {
                await element.requestFullscreen();
            } else if (element.webkitRequestFullscreen) {
                await element.webkitRequestFullscreen();
            } else if (element.msRequestFullscreen) {
                await element.msRequestFullscreen();
            }

            // 全屏后强制横屏
            setTimeout(() => {
                if (!this.isRotated) {
                    this.forceRotate();
                }
            }, 300);

        } catch (err) {
            console.error('移动端全屏请求失败:', err);
            // 即使全屏失败也尝试强制旋转
            this.forceRotate();
        }
    }

    handleOrientationChange() {
        const isNowLandscape = this.isLandscape();
        console.log(`屏幕方向变化检测: ${isNowLandscape ? '横屏' : '竖屏'}`);

        if (isNowLandscape && this.isRotated) {
            // 如果设备自然转为横屏，可以取消CSS强制旋转
            this.container.classList.remove('force-landscape');
            console.log('检测到自然横屏，移除CSS强制旋转');
        } else if (!isNowLandscape && this.autoRotateEnabled && this.isMobile()) {
            // 如果又转回竖屏，重新强制横屏
            setTimeout(() => this.forceRotate(), 200);
        }

        this.notifyChange();
    }

    handleResize() {
        this.notifyChange();
    }

    handleFullscreenChange() {
        const isFullscreen = !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement);

        console.log(`全屏状态变化: ${isFullscreen ? '进入全屏' : '退出全屏'}`);

        if (isFullscreen && !this.isLandscape()) {
            // 进入全屏且非横屏，强制旋转
            setTimeout(() => this.forceRotate(), 200);
        }
    }

    notifyChange() {
        const detail = {
            isLandscape: this.getEffectiveLandscape(),
            isRotated: this.isRotated,
            width: this.getEffectiveWidth(),
            height: this.getEffectiveHeight(),
            isMobile: this.isMobile()
        };

        // 触发自定义事件
        window.dispatchEvent(new CustomEvent('rotationChange', { detail }));

        // 调用全局回调
        if (typeof window.onRotationChange === 'function') {
            window.onRotationChange(detail);
        }

        console.log('旋转状态通知:', detail);
    }

    // 工具方法
    supportsOrientationAPI() {
        return screen.orientation && screen.orientation.lock;
    }

    isMobile() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            'ontouchstart' in window ||
            navigator.maxTouchPoints > 0;
    }

    isLandscape() {
        return window.innerWidth > window.innerHeight;
    }

    getEffectiveLandscape() {
        return this.isRotated || this.isLandscape();
    }

    getEffectiveWidth() {
        if (this.isRotated && !this.isLandscape()) {
            // CSS强制旋转时返回旋转后的尺寸
            return Math.max(window.innerWidth, window.innerHeight);
        }
        return window.innerWidth;
    }

    getEffectiveHeight() {
        if (this.isRotated && !this.isLandscape()) {
            // CSS强制旋转时返回旋转后的尺寸
            return Math.min(window.innerWidth, window.innerHeight);
        }
        return window.innerHeight;
    }

    // 公共接口
    getStatus() {
        return {
            isRotated: this.isRotated,
            isLandscape: this.isLandscape(),
            effectiveLandscape: this.getEffectiveLandscape(),
            isMobile: this.isMobile(),
            width: this.getEffectiveWidth(),
            height: this.getEffectiveHeight(),
            autoRotateEnabled: this.autoRotateEnabled
        };
    }

    enableAutoRotate(enabled = true) {
        this.autoRotateEnabled = enabled;
        console.log(`自动旋转: ${enabled ? '启用' : '禁用'}`);
    }

    toggle() {
        if (this.isRotated) {
            this.resetRotation();
        } else {
            this.forceRotate();
        }
    }
}

// 添加必要的CSS样式
const forceRotationCSS = `
/* 强制横屏CSS */
body.force-landscape {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vh !important;
    height: 100vw !important;
    transform-origin: left top !important;
    transform: rotate(90deg) translateY(-100vh) !important;
    overflow: hidden !important;
}

/* 确保内容适应强制旋转 */
body.force-landscape * {
    max-width: none !important;
}

/* 隐藏滚动条 */
body.force-landscape {
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */
}

body.force-landscape::-webkit-scrollbar {
    display: none;  /* Chrome, Safari and Opera */
}
`;

// 注入CSS样式
const styleSheet = document.createElement('style');
styleSheet.textContent = forceRotationCSS;
document.head.appendChild(styleSheet);

// 创建全局实例
window.forceRotationManager = new ForceRotationManager();

// 提供便捷的全局方法
window.forceScreenLandscape = () => window.forceRotationManager.forceRotate();
window.resetScreenRotation = () => window.forceRotationManager.resetRotation();
window.toggleScreenRotation = () => window.forceRotationManager.toggle();
window.requestFullscreenRotation = () => window.forceRotationManager.requestFullscreenAndRotate();