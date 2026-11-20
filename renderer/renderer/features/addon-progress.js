export function updateAddonProgress(name, progress) {
  const cards = document.querySelectorAll('.addon-card');
  for (const card of cards) {
    if (card.dataset.name !== name || !card.overlay) continue;
    card.overlay.style.setProperty('--progress', Math.min(progress, 1.0) * 100 + '%');
    card.overlay.classList.toggle('hidden', progress <= 0);
    card.overlay.style.opacity = progress > 0 ? '1' : '0';
    if (progress >= 1.0) {
      setTimeout(() => {
        card.overlay.classList.add('hidden');
        card.overlay.style.opacity = '';
      }, 300);
    }
    return;
  }
}