/*
 * RAS site script: navigation and small page enhancements.
 * Loaded in <head> (it is tiny) so the "js" class is set before first paint.
 */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  function closeAllSubmenus(except) {
    document.querySelectorAll('.submenu-toggle[aria-expanded="true"]').forEach(function (btn) {
      if (btn !== except) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    var desktop = window.matchMedia('(min-width: 1025px)');

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.querySelectorAll('.submenu-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') !== 'true';
        if (desktop.matches) closeAllSubmenus(btn);
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    // On mobile, open the section that contains the current page.
    var active = nav.querySelector('.is-active > .submenu-toggle');
    if (active && !desktop.matches) active.setAttribute('aria-expanded', 'true');

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var openBtn = nav.querySelector('.submenu-toggle[aria-expanded="true"]');
      if (openBtn && desktop.matches) {
        openBtn.setAttribute('aria-expanded', 'false');
        openBtn.focus();
      } else if (toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', function (e) {
      if (desktop.matches && !nav.contains(e.target)) closeAllSubmenus(null);
    });

    // Close a desktop dropdown when keyboard focus leaves it.
    nav.addEventListener('focusout', function (e) {
      if (!desktop.matches) return;
      var li = e.target.closest('li[data-section]');
      if (li && !li.contains(e.relatedTarget)) {
        var btn = li.querySelector('.submenu-toggle');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });

    desktop.addEventListener('change', function () {
      setOpen(false);
      closeAllSubmenus(null);
    });
  }

  // Show/hide time-sensitive content, e.g. "entries open" vs "entries closed".
  // <div data-show-before="2026-09-30T23:59:00+01:00"> / data-show-after="..."
  function initTimed() {
    var now = Date.now();
    document.querySelectorAll('[data-show-before], [data-show-after]').forEach(function (el) {
      var before = el.getAttribute('data-show-before');
      var after = el.getAttribute('data-show-after');
      var show = true;
      if (before && now >= Date.parse(before)) show = false;
      if (after && now < Date.parse(after)) show = false;
      el.hidden = !show;
    });
  }

  function init() {
    initNav();
    initTimed();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
