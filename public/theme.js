/* Horizontal profile navigation. The native scrollbar and touch gestures remain available. */
(() => {
  const tabs = document.getElementById('tabs');
  const shell = document.getElementById('tabsShell');
  const previous = document.getElementById('tabsPrevious');
  const next = document.getElementById('tabsNext');
  if (!tabs || !shell || !previous || !next) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let scheduled = false;

  function updateControls() {
    scheduled = false;
    // A hidden profile has no measurable width. ResizeObserver updates it when opened.
    if (!tabs.clientWidth) return;
    // Measure against the full strip so arrows disappear when all tabs fit.
    const overflow = tabs.scrollWidth - (shell.clientWidth - 12) > 2;
    shell.classList.toggle('has-overflow', overflow);
    previous.hidden = next.hidden = !overflow;
    previous.disabled = !overflow || tabs.scrollLeft <= 2;
    next.disabled = !overflow || tabs.scrollLeft >= tabs.scrollWidth - tabs.clientWidth - 2;
  }

  function scheduleControls() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateControls);
  }

  function reveal(button) {
    if (!button || !tabs.clientWidth) return;
    const viewport = tabs.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    const padding = 8;
    let left = tabs.scrollLeft;
    if (target.left < viewport.left + padding) left += target.left - viewport.left - padding;
    else if (target.right > viewport.right - padding) left += target.right - viewport.right + padding;
    else return;
    tabs.scrollTo({left, behavior: reducedMotion.matches ? 'auto' : 'smooth'});
  }

  function move(direction) {
    tabs.scrollBy({left: direction * Math.max(180, tabs.clientWidth * .7), behavior: reducedMotion.matches ? 'auto' : 'smooth'});
  }

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  tabs.addEventListener('scroll', scheduleControls, {passive: true});
  tabs.addEventListener('focusin', event => reveal(event.target.closest('button[data-tab]')));
  const observer = new MutationObserver(records => {
    scheduleControls();
    if (records.some(record => record.attributeName === 'class' && record.target.matches('button[data-tab].active'))) {
      reveal(tabs.querySelector('button[data-tab].active'));
    }
  });
  observer.observe(tabs, {attributes: true, attributeFilter: ['class'], childList: true, subtree: true});
  if ('ResizeObserver' in window) new ResizeObserver(scheduleControls).observe(tabs);
  else window.addEventListener('resize', scheduleControls, {passive: true});
  scheduleControls();
})();
