/**
 * Confirm dialog — in-page Yes/No overlay (CursorSites shared pattern).
 * Canonical source: cursor-sites-shared/ui/confirm-dialog.js
 * Spec: cursor-sites-shared/ui/CONFIRM_DIALOG.md
 */
(function (global) {
  'use strict';

  var active = null;

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closeActive() {
    if (!active) return;
    if (active.onKey) {
      document.removeEventListener('keydown', active.onKey, true);
    }
    if (active.el && active.el.parentNode) {
      active.el.parentNode.removeChild(active.el);
    }
    active = null;
  }

  /**
   * @param {{
   *   title?: string,
   *   message?: string,
   *   previewUrl?: string,
   *   confirmLabel?: string,
   *   cancelLabel?: string,
   *   danger?: boolean,
   *   onConfirm?: () => void,
   *   onCancel?: () => void
   * }} [opts]
   * @returns {Promise<boolean>}
   */
  function show(opts) {
    opts = opts || {};
    closeActive();

    return new Promise(function (resolve) {
      var settled = false;
      var overlay = document.createElement('div');
      var danger = !!opts.danger;
      overlay.className = 'confirm-dialog' + (danger ? ' confirm-dialog--danger' : '');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', opts.title || opts.message || 'Please confirm');

      var preview = '';
      if (opts.previewUrl) {
        preview =
          '<div class="confirm-dialog__preview"><img src="' +
          escapeHtml(opts.previewUrl) +
          '" alt="" /></div>';
      }

      var titleHtml = opts.title
        ? '<h2 class="confirm-dialog__title" id="confirm-dialog-title">' +
          escapeHtml(opts.title) +
          '</h2>'
        : '';
      if (opts.title) {
        overlay.setAttribute('aria-labelledby', 'confirm-dialog-title');
      }

      overlay.innerHTML =
        '<div class="confirm-dialog__box">' +
        preview +
        titleHtml +
        '<p class="confirm-dialog__message" data-help="sheet.confirm">' +
        escapeHtml(opts.message || 'Are you sure?') +
        '</p>' +
        '<div class="confirm-dialog__actions">' +
        '<button type="button" class="confirm-dialog__cancel">' +
        escapeHtml(opts.cancelLabel || 'Cancel') +
        '</button>' +
        '<button type="button" class="confirm-dialog__ok">' +
        escapeHtml(opts.confirmLabel || 'OK') +
        '</button>' +
        '</div></div>';

      var box = overlay.querySelector('.confirm-dialog__box');
      var cancelBtn = overlay.querySelector('.confirm-dialog__cancel');
      var okBtn = overlay.querySelector('.confirm-dialog__ok');

      function finish(confirmed) {
        if (settled) return;
        settled = true;
        closeActive();
        if (confirmed) {
          if (typeof opts.onConfirm === 'function') opts.onConfirm();
        } else if (typeof opts.onCancel === 'function') {
          opts.onCancel();
        }
        resolve(!!confirmed);
      }

      cancelBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        finish(false);
      });
      okBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        finish(true);
      });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) finish(false);
      });
      box.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      var onKey = function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      };
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(overlay);
      active = { el: overlay, onKey: onKey };
      (danger ? cancelBtn : okBtn).focus();
    });
  }

  global.ConfirmDialog = {
    show: show,
    close: closeActive
  };
})(typeof window !== 'undefined' ? window : this);
