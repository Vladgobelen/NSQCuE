// Единое состояние UI. Никакой логики — только данные и сеттеры.
export const uiState = {
  isWebViewVisible: false,
  hidePanelTimeout: null,
  isPanelMicActive: false,
  capturedHotkey: new Set(),
  isSettingsOpen: false,
  isSoundsPanelOpen: false,
  isMouseInCaptureZone: false,
  isGameReady: false,
  isLaunchBlocked: false,
  isLoadingAddons: false,
  isAddonInstalling: false,
  downloadAttempts: {},
};