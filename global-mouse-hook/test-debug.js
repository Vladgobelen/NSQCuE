const { startGlobalMouseHook, stopGlobalMouseHook, startGlobalKeyboardHook, stopGlobalKeyboardHook } = require('./index');

console.log('🐛 Debug Global Mouse/Keyboard Hook Test');
console.log('========================================');
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('Node version:', process.version);
console.log('');

let mouseCount = 0;
let keyboardCount = 0;
let lastMouseEvent = null;
let lastKeyEvent = null;

function handleMouseEvent(event) {
    if (!event) {
        console.log('⚠️  Received null mouse event, skipping');
        return;
    }
    
    mouseCount++;
    lastMouseEvent = event;
    const buttonNames = { 1: 'Left', 2: 'Right', 3: 'Middle', 4: 'Side', 5: 'Extra' };
    const buttonName = buttonNames[event.button_code] || `Button${event.button_code}`;
    
    console.log(`🖱️  MOUSE #${mouseCount}: ${buttonName} ${event.event_type} at (${event.x}, ${event.y})`);
    
    // Показываем статистику каждые 5 событий
    if (mouseCount % 5 === 0) {
        showStats();
    }
}

function handleKeyEvent(event) {
    if (!event) {
        console.log('⚠️  Received null key event, skipping');
        return;
    }
    
    keyboardCount++;
    lastKeyEvent = event;
    
    // Базовые коды клавиш для разных платформ
    const keyMap = {
        // Windows VK codes
        1: 'Escape', 8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift',
        17: 'Ctrl', 18: 'Alt', 20: 'CapsLock', 27: 'Escape', 32: 'Space',
        37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
        65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E',
        
        // Linux evdev codes (примерные)
        28: 'Enter', 57: 'Space', 103: 'Up', 105: 'Left', 106: 'Right', 108: 'Down'
    };
    
    const keyName = keyMap[event.code] || `Key${event.code}`;
    console.log(`⌨️  KEYBOARD #${keyboardCount}: ${keyName} ${event.event_type} (code: ${event.code})`);
    
    // Выход по Escape (код 1 на Linux, 27 на Windows)
    if (event.code === 1 || event.code === 27) {
        console.log('\n🛑 Escape pressed, stopping hooks...');
        stopHooks();
    }
    
    // Показываем статистику каждые 10 событий
    if (keyboardCount % 10 === 0) {
        showStats();
    }
}

function showStats() {
    console.log('\n📊 STATISTICS:');
    console.log(`   Mouse events: ${mouseCount}`);
    console.log(`   Keyboard events: ${keyboardCount}`);
    
    if (lastMouseEvent) {
        console.log(`   Last mouse: button=${lastMouseEvent.button_code} type=${lastMouseEvent.event_type}`);
    }
    
    if (lastKeyEvent) {
        console.log(`   Last key: code=${lastKeyEvent.code} type=${lastKeyEvent.event_type}`);
    }
    console.log('');
}

function stopHooks() {
    console.log('🛑 Stopping hooks...');
    try {
        stopGlobalMouseHook();
        stopGlobalKeyboardHook();
        console.log('✅ Hooks stopped successfully');
        
        // Финальная статистика
        console.log('\n🎯 FINAL STATISTICS:');
        console.log(`   Total mouse events: ${mouseCount}`);
        console.log(`   Total keyboard events: ${keyboardCount}`);
        
    } catch (error) {
        console.error('❌ Error stopping hooks:', error);
    }
    process.exit(0);
}

// Обработчики завершения
process.on('SIGINT', stopHooks);
process.on('SIGTERM', stopHooks);

// Таймер для показа статуса, если нет событий
let noEventsTimer = setTimeout(() => {
    if (mouseCount === 0 && keyboardCount === 0) {
        console.log('\n⚠️  No events received yet. Possible issues:');
        console.log('   - Check if hooks are properly installed');
        console.log('   - Try moving mouse and pressing keys');
        console.log('   - Press Ctrl+C to exit\n');
    }
}, 5000);

// Очистка таймера при получении событий
function clearNoEventsTimer() {
    if (noEventsTimer) {
        clearTimeout(noEventsTimer);
        noEventsTimer = null;
    }
}

// Запуск
try {
    console.log('🚀 Starting global hooks...');
    
    startGlobalMouseHook((event) => {
        clearNoEventsTimer();
        handleMouseEvent(event);
    });
    
    startGlobalKeyboardHook((event) => {
        clearNoEventsTimer();
        handleKeyEvent(event);
    });
    
    console.log('✅ Hooks started successfully!');
    console.log('\n👉 INSTRUCTIONS:');
    console.log('   - Move mouse and click buttons');
    console.log('   - Press keyboard keys');
    console.log('   - Press ESC to exit');
    console.log('   - Or press Ctrl+C to stop\n');
    
} catch (error) {
    console.error('❌ Failed to start hooks:', error);
    console.error('   Error details:', error.message);
    process.exit(1);
}