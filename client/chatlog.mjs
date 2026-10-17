/** 4F6B70/4FBEE0: (243,489) 434x84 log, six 13px rows, original 12px VScr at (677,490).
 * Browser text layout replaces IWzFont wrapping; wheel/drag plumbing is not a Win32 control.
 */
export function chatHistory({ root, list, bar }) {
  const prev = bar.querySelector('[data-chat-prev]');
  const next = bar.querySelector('[data-chat-next]');
  const thumb = bar.querySelector('[data-chat-thumb]');
  const track = bar.querySelector('[data-chat-track]');
  let drag, sticky = true;
  const max = () => Math.max(0, root.scrollHeight - root.clientHeight);
  function sync() {
    const end = max(), enabled = end > 0;
    bar.classList.toggle('disabled', !enabled);
    prev.disabled = next.disabled = !enabled;
    thumb.hidden = !enabled;
    thumb.style.top = `${12 + (end ? Math.round(46 * root.scrollTop / end) : 0)}px`;
  }
  function scroll(value) {
    root.scrollTop = Math.max(0, Math.min(max(), value));
    sticky = root.scrollTop >= max() - 1;
    sync();
  }
  prev.addEventListener('click', () => scroll(root.scrollTop - 13));
  next.addEventListener('click', () => scroll(root.scrollTop + 13));
  root.addEventListener('wheel', e => {
    if (!e.deltaY) return;
    e.preventDefault(); scroll(root.scrollTop + Math.sign(e.deltaY) * 39);
  }, {passive:false});
  track.addEventListener('mousedown', e => {
    const rect = bar.getBoundingClientRect(), scale = rect.height / 82;
    const local = (e.clientY - rect.top) / scale;
    scroll(root.scrollTop + (local < 12 + 46 * root.scrollTop / (max() || 1) ? -78 : 78));
    e.preventDefault();
  });
  thumb.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    drag = { y:e.clientY, scroll:root.scrollTop };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const scale = bar.getBoundingClientRect().height / 82;
    scroll(drag.scroll + (e.clientY - drag.y) / scale * max() / 46);
  });
  const release = () => { drag = undefined; };
  window.addEventListener('mouseup', release); window.addEventListener('blur', release);
  return {
    changed() {
      // Native caps its wrapped records at 64. Browser wrapping is not IWzFont; preserve readers' position.
      while (list.children.length > 64) {
        const height = list.firstElementChild.getBoundingClientRect().height /
          (root.getBoundingClientRect().height / 84 || 1);
        list.firstElementChild.remove(); root.scrollTop = Math.max(0, root.scrollTop - height);
      }
      if (sticky) root.scrollTop = max();
      sync();
    },
    latest() { scroll(max()); },
  };
}
