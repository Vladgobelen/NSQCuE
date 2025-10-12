const { platform, arch } = require('process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Platform Diagnostics');
console.log('======================');

console.log('Platform:', platform);
console.log('Architecture:', arch);

// Проверка существования нативного модуля
const nativeModulePath = path.join(__dirname, 'index.node');
if (fs.existsSync(nativeModulePath)) {
    console.log('✅ Native module exists:', nativeModulePath);
    
    try {
        const binding = require(nativeModulePath);
        console.log('✅ Native module loaded successfully');
        console.log('Available functions:', Object.keys(binding).filter(key => typeof binding[key] === 'function'));
    } catch (error) {
        console.error('❌ Failed to load native module:', error.message);
    }
} else {
    console.error('❌ Native module not found:', nativeModulePath);
    console.log('Run "npm run build" first');
}

// Проверка прав доступа (Linux)
if (platform === 'linux') {
    console.log('\n🔐 Linux Permission Check:');
    const devInput = '/dev/input';
    if (fs.existsSync(devInput)) {
        console.log('✅ /dev/input exists');
        
        try {
            const files = fs.readdirSync(devInput);
            const eventFiles = files.filter(f => f.startsWith('event'));
            console.log(`📁 Input devices found: ${eventFiles.length}`);
            eventFiles.slice(0, 5).forEach(file => {
                console.log(`   - ${file}`);
            });
            if (eventFiles.length > 5) {
                console.log(`   ... and ${eventFiles.length - 5} more`);
            }
        } catch (error) {
            console.error('❌ Cannot read /dev/input:', error.message);
            console.log('💡 Try running with sudo: sudo npm run test:debug');
        }
    } else {
        console.error('❌ /dev/input does not exist');
    }
}

console.log('\n🎯 Next steps:');
console.log('1. Run: npm run test:debug');
console.log('2. On Linux, if no events: sudo npm run test:debug');
console.log('3. Move mouse and press keys to test');