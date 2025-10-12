const { startGlobalMouseHook, stopGlobalMouseHook, startGlobalKeyboardHook, stopGlobalKeyboardHook } = require('./index');

class InputMonitor {
    constructor() {
        this.mouseCount = 0;
        this.keyboardCount = 0;
        this.isWindows = process.platform === 'win32';
        this.startTime = Date.now();
        
        this.setupEventHandlers();
        this.startMonitoring();
    }
    
    setupEventHandlers() {
        process.on('SIGINT', this.cleanup.bind(this));
        process.on('SIGTERM', this.cleanup.bind(this));
    }
    
    handleMouseEvent(event) {
        if (!event) {
            console.log('⚠️  Received null mouse event, skipping');
            return;
        }
        
        this.mouseCount++;
        const buttonNames = {
            1: 'Left',
            2: 'Right', 
            3: 'Middle',
            4: 'Side',
            5: 'Extra'
        };
        
        const buttonName = buttonNames[event.button_code] || `Button${event.button_code}`;
        
        console.log(`🖱️  Mouse #${this.mouseCount}: ${buttonName} ${event.event_type} at (${event.x}, ${event.y})`);
        
        // Периодически показываем статистику
        if (this.mouseCount % 10 === 0) {
            this.showStats();
        }
    }
    
    handleKeyEvent(event) {
        if (!event) {
            console.log('⚠️  Received null key event, skipping');
            return;
        }
        
        this.keyboardCount++;
        
        // Специальные клавиши (Windows VK codes и Linux evdev codes)
        const keyMap = {
            // Windows VK codes
            8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl',
            18: 'Alt', 20: 'CapsLock', 27: 'Escape', 32: 'Space',
            33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home',
            37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
            45: 'Insert', 46: 'Delete',
            
            // Linux evdev codes (примерные)
            1: 'Escape', 14: 'Backspace', 15: 'Tab', 28: 'Enter',
            29: 'Ctrl', 42: 'Shift', 56: 'Alt', 57: 'Space',
            103: 'Up', 105: 'Left', 106: 'Right', 108: 'Down'
        };
        
        const keyName = keyMap[event.code] || `Key${event.code}`;
        
        console.log(`⌨️  Keyboard #${this.keyboardCount}: ${keyName} ${event.event_type}`);
        
        // Выход по Escape
        if (event.code === 27 || event.code === 1) {
            console.log('\n🛑 Escape pressed, stopping...');
            this.cleanup();
        }
        
        // Периодически показываем статистику
        if (this.keyboardCount % 10 === 0) {
            this.showStats();
        }
    }
    
    showStats() {
        const runningTime = (Date.now() - this.startTime) / 1000;
        const mouseRate = (this.mouseCount / runningTime).toFixed(2);
        const keyboardRate = (this.keyboardCount / runningTime).toFixed(2);
        
        console.log(`\n📊 Statistics:`);
        console.log(`   Running time: ${runningTime.toFixed(1)}s`);
        console.log(`   Mouse events: ${this.mouseCount} (${mouseRate}/s)`);
        console.log(`   Keyboard events: ${this.keyboardCount} (${keyboardRate}/s)`);
        console.log(`   Total events: ${this.mouseCount + this.keyboardCount}\n`);
    }
    
    async startMonitoring() {
        console.log('🚀 Starting Global Input Monitor');
        console.log('================================');
        console.log('Platform:', process.platform);
        console.log('Press mouse buttons and keyboard keys to test');
        console.log('Press ESC to exit');
        console.log('================================\n');
        
        try {
            // Запускаем хуки с привязкой контекста
            startGlobalMouseHook(this.handleMouseEvent.bind(this));
            startGlobalKeyboardHook(this.handleKeyEvent.bind(this));
            
            console.log('✅ Hooks started successfully!');
            
            // Периодическая статистика
            setInterval(() => {
                if (this.mouseCount > 0 || this.keyboardCount > 0) {
                    this.showStats();
                }
            }, 30000); // Каждые 30 секунд
            
        } catch (error) {
            console.error('❌ Failed to start hooks:', error);
            this.cleanup();
        }
    }
    
    cleanup() {
        console.log('\n🛑 Cleaning up hooks...');
        const totalTime = (Date.now() - this.startTime) / 1000;
        try {
            stopGlobalMouseHook();
            stopGlobalKeyboardHook();
            console.log('✅ Hooks stopped successfully');
            
            console.log('\n🎯 Final Report:');
            console.log(`   Total monitoring time: ${totalTime.toFixed(1)}s`);
            console.log(`   Mouse events: ${this.mouseCount}`);
            console.log(`   Keyboard events: ${this.keyboardCount}`);
            console.log(`   Total events: ${this.mouseCount + this.keyboardCount}`);
            console.log(`   Average events per second: ${((this.mouseCount + this.keyboardCount) / totalTime).toFixed(2)}`);
            
        } catch (error) {
            console.error('❌ Error stopping hooks:', error);
        }
        process.exit(0);
    }
}

// Запуск монитора
new InputMonitor();