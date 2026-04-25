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
    match: /You have unsaved changes/i,
    // Match the proceed/discard side: "Open anyway", "Don't save", "Discard",
    // and the equivalents in PT/ES/FR/DE (mirrors layout_switch regex).
    button: /^(Open anyway|Don'?t save|Discard|Abrir mesmo|Descartar|Não salvar|Abrir de todos|No guardar|Ouvrir quand|Ne pas enregistrer|Abandonner|Trotzdem öffnen|Nicht speichern|Verwerfen)$/i,
    note: 'unsaved_changes',
  },
];

const DISMISS_PATTERNS_JSON = JSON.stringify(
  DISMISS_PATTERNS.map(p => ({ match: p.match.source, button: p.button.source, note: p.note }))
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
      // Scan every visible div / section for matching text.
      // We can't rely on role="dialog" or [class*="dialog"] — TV's replay
      // dialog is a plain <div> with no semantic markers.
      var candidates = document.querySelectorAll('div, section');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.offsetParent === null) continue;
        var text = el.textContent || '';
        // Skip large containers (top-level layout) — modal text bodies are short.
        if (text.length > 600) continue;
        for (var p = 0; p < patterns.length; p++) {
          var matchRx = new RegExp(patterns[p].match, 'i');
          if (!matchRx.test(text)) continue;
          var btnRx = new RegExp(patterns[p].button, 'i');
          var btns = el.querySelectorAll('button');
          for (var j = 0; j < btns.length; j++) {
            var btn = btns[j];
            if (btn.offsetParent === null) continue;
            var label = (btn.textContent || btn.getAttribute('title') || '').trim();
            if (btnRx.test(label)) {
              btn.click();
              dismissed.push({ note: patterns[p].note, button: label });
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
