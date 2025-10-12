const { 
    startGlobalMouseHook, 
    startGlobalKeyboardHook, 
    stopAllHooks 
} = require('./index');

console.log('🎯 Input Hook Test - Final Fixed Version');
console.log('=========================================\n');

let mouseCount = 0;
let keyboardCount = 0;

// Константы для типов событий (должны совпадать с Rust)
const MOUSE_DOWN = 1;
const MOUSE_UP = 2;
const KEY_DOWN = 3;
const KEY_UP = 4;

function handleMouseEvent(err, data) {
    if (err) {
        console.log('❌ Mouse event error:', err);
        return;
    }
    
    if (!data || !Array.isArray(data)) {
        console.log('❌ Invalid mouse event data:', data);
        return;
    }
    
    const [buttonCode, eventType] = data;
    
    if (buttonCode === undefined || eventType === undefined) {
        console.log('❌ NULL mouse event');
        return;
    }
    
    mouseCount++;
    const action = eventType === MOUSE_DOWN ? 'DOWN' : 'UP  ';
    console.log(`🖱️  ${action} Mouse button ${buttonCode} (total: ${mouseCount})`);
}

function handleKeyEvent(err, data) {
    if (err) {
        console.log('❌ Keyboard event error:', err);
        return;
    }
    
    if (!data || !Array.isArray(data)) {
        console.log('❌ Invalid keyboard event data:', data);
        return;
    }
    
    const [keyCode, eventType] = data;
    
    if (keyCode === undefined || eventType === undefined) {
        console.log('❌ NULL key event');
        return;
    }
    
    keyboardCount++;
    const action = eventType === KEY_DOWN ? 'DOWN' : 'UP  ';
    console.log(`⌨️  ${action} Key code ${keyCode} (total: ${keyboardCount})`);
    
    // Exit on Escape key (code 1 or 27)
    if (keyCode === 1 || keyCode === 27) {
        console.log('\n🛑 Escape pressed, stopping...');
        stopTest();
    }
}

function stopTest() {
    console.log('\n🛑 Stopping all hooks...');
    stopAllHooks();
    
    setTimeout(() => {
        console.log(`\n📊 Final Results:`);
        console.log(`   Mouse events: ${mouseCount}`);
        console.log(`   Keyboard events: ${keyboardCount}`);
        console.log('\n✅ Test completed!');
        process.exit(0);
    }, 1000);
}

// Handle Ctrl+C
process.on('SIGINT', stopTest);

// Auto-stop after 30 seconds
setTimeout(stopTest, 30000);

try {
    console.log('🚀 Starting hooks...\n');
    
    startGlobalMouseHook(handleMouseEvent);
    startGlobalKeyboardHook(handleKeyEvent);
    
    console.log('✅ Hooks started successfully!');
    console.log('👉 Click mouse buttons and press keyboard keys');
    console.log('👉 Press Escape key or Ctrl+C to stop');
    console.log('👉 Auto-stop in 30 seconds\n');
    
} catch (error) {
    console.error('❌ Error starting hooks:', error);
    process.exit(1);
}