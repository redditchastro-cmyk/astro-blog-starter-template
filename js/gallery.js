/*
 * RAS gallery: accessible lightbox for the gallery grid.
 * The grid itself is generated from data/gallery.json by tools/build.js,
 * so images still display (as normal links) without JavaScript.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    var grid = document.querySelector('[data-gallery]');
    if (!grid || typeof HTMLDialogElement === 'undefined') return;

    var dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.setAttribute('aria-labelledby', 'lightbox-title');
    dialog.innerHTML = '<div class="lightbox__inner">' +
      '<button type="button" class="lightbox__close" aria-label="Close image">&times;</button>' +
      '<img alt="">' +
      '<div class="lightbox__meta"><h2 id="lightbox-title"></h2><div class="lightbox__details"></div></div></div>';
    document.body.appendChild(dialog);

    var img = dialog.querySelector('img');
    var title = dialog.querySelector('#lightbox-title');
    var details = dialog.querySelector('.lightbox__details');
    var lastTrigger = null;

    dialog.querySelector('.lightbox__close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () { if (lastTrigger) lastTrigger.focus(); });

    grid.querySelectorAll('a[data-full]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var d = JSON.parse(link.getAttribute('data-meta') || '{}');
        img.src = link.getAttribute('data-full');
        img.alt = link.querySelector('img') ? link.querySelector('img').alt : '';
        title.textContent = d.title || '';
        var rows = [['Photographer', d.photographer], ['Equipment', d.equipment], ['Camera', d.camera],
          ['Exposure', d.exposure], ['Processing', d.processing]].filter(function (r) { return r[1]; });
        details.innerHTML = (d.description ? '<p>' + esc(d.description) + '</p>' : '') +
          (rows.length ? '<dl>' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' : '');
        lastTrigger = link;
        dialog.showModal();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
