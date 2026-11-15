// Saving is visible, but map selection/panning remains usable during disk writes.
export function mountSaveIndicator(store) {
  const indicator = document.createElement('p');
  indicator.textContent = '保存中… 完了するまでページを閉じないでください。';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  Object.assign(indicator.style, {
    position: 'fixed', right: '18px', top: '14px', zIndex: '100',
    margin: '0', padding: '9px 13px', border: '1px solid #608c98',
    borderRadius: '7px', background: '#102a36', color: '#d8eff0',
    fontSize: '12px', pointerEvents: 'none', maxWidth: 'calc(100% - 36px)'
  });
  document.body.append(indicator);
  const unsubscribe = store.subscribeSaving(saving => { indicator.hidden = !saving; });
  function beforeUnload(event) {
    if (!store.isSaving()) return;
    event.preventDefault();
    event.returnValue = '';
  }
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    unsubscribe(); indicator.remove();
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
