import {subscribeBackgroundStatus} from './background-client.js?v=aviation-operations-1';
// Saving/computing is visible; selection and panning remain usable.
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
  let saving = store.isSaving(), computing = 0;
  function sync() {
    indicator.hidden = !saving && computing === 0;
    indicator.textContent = computing ? '計算中… 地図の移動・拡大は操作できます。' : '保存中… 完了するまでページを閉じないでください。';
  }
  const unsubscribe = store.subscribeSaving(value => { saving = value; sync(); });
  const stopComputing = subscribeBackgroundStatus(count => { computing = count; sync(); });
  function beforeUnload(event) {
    if (!store.isSaving() && !computing) return;
    event.preventDefault();
    event.returnValue = '';
  }
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    unsubscribe(); stopComputing(); indicator.remove();
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
