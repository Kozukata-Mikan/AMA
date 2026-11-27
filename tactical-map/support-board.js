export function mountSupportBoard(store, sections) {
  const entry = document.createElement('details');
  entry.dataset.workflowPanel = 'support';
  entry.dataset.toolCategory = 'progress';
  entry.open = true;
  const summary = document.createElement('summary');
  summary.textContent = '支援装備';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = '支援装備盤を開く';
  entry.append(summary, open);
  document.querySelector('aside').append(entry);

  const dialog = document.createElement('dialog');
  dialog.className = 'aviation-board';
  dialog.setAttribute('aria-label', '支援装備盤');
  const header = document.createElement('div');
  header.className = 'aviation-board-head';
  const title = document.createElement('h2');
  title.textContent = '支援装備盤';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '閉じる';
  header.append(title, close);
  const body = document.createElement('div');
  dialog.append(header, body);
  document.body.append(dialog);
  const disposers = sections.map(mount => mount(store, body));
  open.addEventListener('click', () => dialog.showModal());
  close.addEventListener('click', () => dialog.close());
  return () => {
    disposers.forEach(dispose => dispose());
    dialog.remove();
    entry.remove();
  };
}
