import hooks from './index.js';

hooks.startGlobalMouseHook((err, event) => {
  if (err) return console.error('Mouse:', err);
  console.log('🖱 Mouse:', event);
});

hooks.startGlobalKeyboardHook((err, event) => {
  if (err) return console.error('Key:', err);
  console.log('⌨ Key:', event);
});

setTimeout(() => process.exit(0), 20000);