const { startGlobalMouseHook, stopGlobalMouseHook, startGlobalKeyboardHook,
stopGlobalKeyboardHook } = require('./index');

console.log('🎯 Testing Mouse/Keyboard Hook - Code Display Only');
console.log('=================================================');

let mouseCount = 0;
let keyboardCount = 0;

function handleMouseEvent(event) {
    if (!event) {
        console.log('⚠️  NULL mouse event');
        return;
    }
    
    mouseCount++;
    console.log(`🖱️  MOUSE #${mouseCount}: button=${event.button_code} action=${event.event_type}`);
}

function handleKeyEvent(event) {
    if (!event) {
        console.log('⚠️  NULL key event');
        return;
    }
    
    keyboardCount++;
    console.log(`⌨️  KEYBOARD #${keyboardCount}: code=${event.code} action=${event.event_type}`);
    
    // Exit on Escape (code 1 on Linux, 27 on Windows)
    if (event.code === 1 || event.code === 27) {
        console.log('\n🛑 Escape pressed, stopping...');
        stopHooks();
    }
}

function stopHooks() {
    stopGlobalMouseHook();
    stopGlobalKeyboardHook();
    console.log('✅ Hooks stopped');
    console.log(`📊 Final: ${mouseCount} mouse events, ${keyboardCount} keyboard events`);
    process.exit(0);
}

process.on('SIGINT', stopHooks);

try {
    console.log('🚀 Starting hooks...');
    startGlobalMouseHook(handleMouseEvent);
    startGlobalKeyboardHook(handleKeyEvent);
    
    console.log('\n✅ Hooks started!');
    console.log('👉 Click mouse buttons and press keys to test');
    console.log('👉 Press ESC or Ctrl+C to stop\n');
    
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}