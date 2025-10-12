const { startGlobalMouseHook, stopGlobalMouseHook, startGlobalKeyboardHook, stopGlobalKeyboardHook } = require('./index');

console.log('🧪 Global Mouse/Keyboard Hook Test');
console.log('===================================');

let mouseCount = 0;
let keyboardCount = 0;

function handleMouseEvent(event) {
    if (!event) {
        console.log('⚠️  Received null mouse event, skipping');
        return;
    }
    
    mouseCount++;
    const buttonNames = { 1: 'Left', 2: 'Right', 3: 'Middle', 4: 'Side', 5: 'Extra' };
    const buttonName = buttonNames[event.button_code] || `Button${event.button_code}`;
    
    console.log(`🖱️  Mouse #${mouseCount}: ${buttonName} ${event.event_type} at (${event.x}, ${event.y})`);
}

function handleKeyEvent(event) {
    if (!event) {
        console.log('⚠️  Received null key event, skipping');
        return;
    }
    
    keyboardCount++;
    
    // Простые коды для демонстрации
    const keyMap = {
        27: 'Escape', 32: 'Space', 13: 'Enter', 8: 'Backspace',
        16: 'Shift', 17: 'Ctrl', 18: 'Alt'
    };
    
    const keyName = keyMap[event.code] || `Key${event.code}`;
    console.log(`⌨️  Keyboard #${keyboardCount}: ${keyName} ${event.event_type}`);
    
    // Выход по Escape
    if (event.code === 27) {
        console.log('\n🛑 Escape pressed, stopping hooks...');
        stopHooks();
    }
}

function stopHooks() {
    stopGlobalMouseHook();
    stopGlobalKeyboardHook();
    console.log('✅ Hooks stopped');
    process.exit(0);
}

// Обработчик Ctrl+C
process.on('SIGINT', stopHooks);

try {
    console.log('🚀 Starting hooks...');
    startGlobalMouseHook(handleMouseEvent);
    startGlobalKeyboardHook(handleKeyEvent);
    
    console.log('\n✅ Hooks started successfully!');
    console.log('👉 Click mouse buttons and press keys to test');
    console.log('👉 Press ESC or Ctrl+C to stop\n');
    
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}