module.exports = {
  appId: 'com.nightwatch.updater',
  productName: 'Night Watch Updater',
  directories: {
    output: 'dist'
  },
  win: {
    target: 'nsis',
    icon: 'assets/icon.png'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
};