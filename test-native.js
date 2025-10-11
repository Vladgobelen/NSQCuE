// test-native.js
const os = require('os');
const path = require('path');

let mod = null;
try {
  if (os.platform() === 'linux') {
    mod = require('./global-mouse-hook.linux-x64-gnu.node');
  } else if (os.platform() === 'win32') {
    mod = require('./global-mouse-hook.win32-x64-msvc.node');
  }
} catch (e) {
  console.error('❌ Не удалось загрузить модуль:', e.message);
  process.exit(1);
}

console.log('✅ Модуль загружен. Тип:', typeof mod);
console.log('🔍 Свойства модуля:', Object.keys(mod));

if (typeof mod.start_global_keyboard_hook !== 'function') {
  console.error('❌ start_global_keyboard_hook — НЕ ФУНКЦИЯ');
  process.exit(1);
}

if (typeof mod.start_global_mouse_hook !== 'function') {
  console.error('❌ start_global_mouse_hook — НЕ ФУНКЦИЯ');
  process.exit(1);
}

console.log('✅ Обе функции существуют. Модуль технически валиден.');

// Попробуем вызвать — без await, просто проверим, не падает ли
try {
  const p1 = mod.start_global_keyboard_hook(() => {});
  const p2 = mod.start_global_mouse_hook(() => {});
  console.log('✅ Вызов функций прошёл без ошибки (возвращают Promise)');
  Promise.all([p1, p2]).then(() => {
    console.log('✅ Promises resolved — модуль, скорее всего, работает');
  }).catch(e => {
    console.error('⚠️ Promises rejected:', e.message);
  });
} catch (e) {
  console.error('💥 Ошибка при вызове:', e.message);
}