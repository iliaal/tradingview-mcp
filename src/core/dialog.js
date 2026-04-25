/**
 * Modal dialog detection and dismissal.
 *
 * TV pops up several modal dialogs that block CDP-driven workflows when state
 * gets into a "did you mean?" condition — most commonly "Leave current replay?"
 * when changing symbol/timeframe with replay active. These dialogs frequently
 * have no role="dialog" and no class containing "dialog" — they're plain
 * divs identified only by their text. We detect them by text content and
 * click the canonical proceed/discard button.
 *
 * The DISMISS_PATTERNS table is the source of truth. Each entry:
 *   match    — regex tested against the dialog's textContent
 *   button   — regex tested against each button's textContent
 *   note     — short description for logging
 *
 * When adding a new pattern, prefer the most specific match text and the
 * least destructive button (avoid generic "OK" / "Yes" matches that could
 * confirm something destructive).
 */
import { evaluate as _evaluate } from '../connection.js';

const DISMISS_PATTERNS = [
  {
    match: /Leave current replay\??/i,
    button: /^Leave$/i,
    note: 'leave_replay',
  },
  {
    match: /Continue your last replay\??/i,
    button: /^close$/i,
    note: 'continue_replay',
  },
  {
    match: /You have unsaved changes/i,
    button: /^(Open anyway|Don'?t save|Discard|Abrir mesmo|Descartar|Não salvar|Abrir de todos|No guardar|Ouvrir quand|Ne pas enregistrer|Abandonner|Trotzdem öffnen|Nicht speichern|Verwerfen)$/i,
    note: 'unsaved_changes',
  },
  {
    // Pine "Save script" prompt — appears when adding unsaved script to chart.
    // Matched by exact button trio (Save + Cancel + close) since the dialog's
    // text bleeds into the surrounding Pine Editor container, making
    // text-only matching brittle. We click Cancel to discard the save.
    button_set: ['Save', 'Cancel', 'close'],
    button: /^Cancel$/i,
    note: 'save_script',
  },
];

const DISMISS_PATTERNS_JSON = JSON.stringify(
  DISMISS_PATTERNS.map(p => ({
    match: p.match ? p.match.source : null,
    button: p.button.source,
    button_set: p.button_set || null,
    note: p.note,
  }))
);

/**
 * Detect and dismiss any matching blocking dialogs in TV.
 * Returns an array of {note, button} entries describing what was dismissed.
 * Safe to call on every operation — returns [] when no dialog is present.
 *
 * @param {object} opts
 * @param {Function} [opts.evaluate] - injected evaluate (test override)
 */
export async function dismissBlockingDialogs({ evaluate = _evaluate } = {}) {
  const dismissed = await evaluate(`
    (function() {
      var patterns = ${DISMISS_PATTERNS_JSON};
      var dismissed = [];
      var alreadyMatched = {};
      // Two pattern types:
      //   match (regex on textContent, length-bounded for sanity) — used for
      //     dialogs with a clear short-text body.
      //   button_set (array of exact button-text strings) — used when the
      //     dialog's text bleeds into a surrounding container (e.g. Pine
      //     editor's Save Script prompt). Matches when ALL listed labels
      //     appear among the element's visible buttons AND the button-set
      //     count is small enough to be a dialog.
      // Fast-path narrow selector covers role="dialog" + dialog/popup/modal
      // class shapes. TV's modals all use one of these. Falls back to a
      // wider scan only when patterns exist that need text-bleed coverage
      // (button_set), and even then we limit to elements that contain at
      // least one button — most divs in the chart canvas don't.
      var hasButtonSet = false;
      for (var pi = 0; pi < patterns.length; pi++) {
        if (patterns[pi].button_set) { hasButtonSet = true; break; }
      }
      var narrow = document.querySelectorAll(
        '[role="dialog"], [class*="dialog"], [class*="Dialog"], ' +
        '[class*="popup"], [class*="Popup"], ' +
        '[class*="modal"], [class*="Modal"], ' +
        '[data-name*="dialog"], [data-name*="popup"]'
      );
      var candidates;
      if (hasButtonSet) {
        // Combine narrow set with all button-bearing visible containers,
        // deduped via a Set. Cheaper than querying every div, since most
        // panes in the chart canvas have zero buttons.
        var buttons = document.querySelectorAll('button');
        var seen = new Set();
        for (var ni = 0; ni < narrow.length; ni++) seen.add(narrow[ni]);
        for (var bi = 0; bi < buttons.length; bi++) {
          var bp = buttons[bi].parentElement;
          // Walk up at most 5 levels — dialog containers typically wrap
          // their button bar within a small subtree.
          for (var depth = 0; depth < 5 && bp; depth++) {
            seen.add(bp);
            bp = bp.parentElement;
          }
        }
        candidates = Array.from(seen);
      } else {
        candidates = narrow;
      }
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.offsetParent === null) continue;
        var text = el.textContent || '';

        for (var p = 0; p < patterns.length; p++) {
          if (alreadyMatched[patterns[p].note]) continue;
          var pat = patterns[p];

          // Path A: text-regex match (length-bounded)
          if (pat.match) {
            if (text.length > 600) continue;
            var matchRx = new RegExp(pat.match, 'i');
            if (!matchRx.test(text)) continue;
          } else if (pat.button_set) {
            // Path B: button-set fingerprint
            var visibleBtns = [];
            var allBtns = el.querySelectorAll('button');
            for (var b = 0; b < allBtns.length; b++) {
              if (allBtns[b].offsetParent === null) continue;
              visibleBtns.push((allBtns[b].textContent || allBtns[b].getAttribute('title') || '').trim());
            }
            // All required labels must be present, and the set must be
            // small (a real dialog has a handful of buttons, not dozens).
            var hasAll = pat.button_set.every(function(label) {
              return visibleBtns.indexOf(label) !== -1;
            });
            if (!hasAll) continue;
            // Tighter cap: real Save Script dialog has 3 buttons. Allow
            // up to len(button_set)+2 to absorb tiny variations (an extra
            // help/info button) without matching giant editor toolbars.
            if (visibleBtns.length > pat.button_set.length + 3) continue;
          } else {
            continue;
          }

          // Click the matching button
          var btnRx = new RegExp(pat.button, 'i');
          var btns2 = el.querySelectorAll('button');
          for (var j = 0; j < btns2.length; j++) {
            var btn = btns2[j];
            if (btn.offsetParent === null) continue;
            var label = (btn.textContent || btn.getAttribute('title') || '').trim();
            if (btnRx.test(label)) {
              btn.click();
              dismissed.push({ note: pat.note, button: label });
              alreadyMatched[pat.note] = true;
              break;
            }
          }
          break; // only process one pattern per container
        }
      }
      return dismissed;
    })()
  `);
  return dismissed || [];
}
