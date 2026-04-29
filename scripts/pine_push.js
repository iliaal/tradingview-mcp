#!/usr/bin/env node
// Push a Pine source file to the TradingView editor, save, and add to chart.
//
// Usage:
//   ./scripts/pine_push.js                       # pushes scripts/current.pine
//   ./scripts/pine_push.js path/to/script.pine   # pushes a specific file
//
// Reliability lessons embedded (ported from prezis/tradingview-mcp 2026-04-29):
//   1. Optional CLI arg for source path (otherwise current.pine).
//   2. Pre-push cleanup: remove all chart instances of the indicator before
//      pushing, otherwise repeated pushes stack instances and hit TV's max-5
//      indicator limit.
//   3. Skip Ctrl+Enter when the button matcher already triggered Add/Update
//      (doing both double-adds the indicator).
//   4. Longer waits for heavy indicators (TV needs ~3x more time on Add to
//      chart for large scripts).

import CDP from 'chrome-remote-interface';
import { readFileSync } from 'fs';

const argPath = process.argv[2];
const srcPath = argPath
  ? (argPath.startsWith('/') ? argPath : new URL(`../${argPath}`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
  : new URL('../scripts/current.pine', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const src = readFileSync(srcPath, 'utf-8');
console.log(`Source: ${srcPath} (${src.length} bytes)`);

const targets = await (await fetch('http://localhost:9222/json/list')).json();
const t = targets.find(t => t.url?.includes('tradingview.com'));
if (!t) { console.error('No TradingView target'); process.exit(1); }
const c = await CDP({ host: 'localhost', port: 9222, target: t.id });
await c.Runtime.enable();

// Pre-push cleanup: remove existing chart instances of the indicator. Without
// this, repeated pushes stack instances (button click + Ctrl+Enter each add
// one) and TV's max-5 indicator limit blocks further pushes.
const indicatorName = (() => {
  const m = src.match(/indicator\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/);
  return m ? m[1] : null;
})();

if (indicatorName) {
  const removed = (await c.Runtime.evaluate({
    expression: `(function(){
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        var name = ${JSON.stringify(indicatorName)};
        var studies = chart.getAllStudies() || [];
        var matching = studies.filter(function(s){
          var n = (s.name || '').trim();
          return n === name || n.startsWith(name + ' ') || n.startsWith(name + '\\u00a0') || n.startsWith(name + '(');
        });
        var ids = matching.map(function(s){ return s.id; });
        ids.forEach(function(id){ chart.removeEntity(id); });
        return {removedCount: ids.length, ids: ids};
      } catch (e) {
        return {removedCount: 0, error: e.message};
      }
    })()`,
    returnByValue: true,
  })).result?.value || { removedCount: 0 };

  if (removed.removedCount > 0) {
    console.log(`Pre-push cleanup: removed ${removed.removedCount} existing instance(s) of "${indicatorName}"`);
    // TV needs time to finish the removal before adding new (heavy indicators take longer).
    await new Promise(r => setTimeout(r, 1500));
  } else if (removed.error) {
    console.log(`Pre-push cleanup ERROR (continuing): ${removed.error}`);
  }
}

// Inject source via Monaco env.editor
const escaped = JSON.stringify(src);
const set = (await c.Runtime.evaluate({
  expression: `(function(){var c=document.querySelector(".monaco-editor.pine-editor-monaco");if(!c)return false;var el=c;var fk;for(var i=0;i<20;i++){if(!el)break;fk=Object.keys(el).find(function(k){return k.startsWith("__reactFiber$")});if(fk)break;el=el.parentElement}if(!fk)return false;var cur=el[fk];for(var d=0;d<15;d++){if(!cur)break;if(cur.memoizedProps&&cur.memoizedProps.value&&cur.memoizedProps.value.monacoEnv){var env=cur.memoizedProps.value.monacoEnv;if(env.editor&&typeof env.editor.getEditors==="function"){var eds=env.editor.getEditors();if(eds.length>0){eds[0].setValue(${escaped});return true}}}cur=cur.return}return false})()`,
  returnByValue: true,
})).result?.value;

if (!set) { console.error('Could not inject into Pine editor'); await c.close(); process.exit(1); }
console.log(`Pushed ${src.split('\n').length} lines → Pine editor`);

// TV 3.1.0+ ships icon-only buttons whose label lives in the title attr, not
// textContent. Match both. Tag the result so we can decide whether the
// keyboard fallback is needed.
const clicked = (await c.Runtime.evaluate({
  expression: '(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var b=btns[i];if(!b.offsetParent)continue;var t=(b.textContent||"").trim();var ti=(b.getAttribute("title")||"").trim();if(/save and add to chart/i.test(t)){b.click();return "btn:"+t}if(/^(Add to chart|Update on chart)/i.test(t)||/^(Add to chart|Update on chart)/i.test(ti)){b.click();return "btn:"+(t||ti)}}for(var i=0;i<btns.length;i++){if(btns[i].className.indexOf("saveButton")!==-1&&btns[i].offsetParent!==null){btns[i].click();return "Pine Save"}}return null})()',
  returnByValue: true,
})).result?.value;

console.log('Compile:', clicked || 'keyboard fallback');

// Only fire keyboard fallback if the button matcher did NOT already trigger
// Add/Update. Doing both double-adds the indicator. "Pine Save" alone (no
// Add/Update found) still needs the keyboard fallback to add to chart.
const buttonAddedToChart = clicked && /^btn:(Add to chart|Update on chart)/i.test(clicked);
if (!buttonAddedToChart) {
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  console.log('Ctrl+Enter sent (Add to chart fallback)');
} else {
  console.log('Skipping Ctrl+Enter (button click already triggered Add/Update)');
}

// Handle the "Cannot add a script with unsaved changes" confirmation dialog
// that TV pops when source differs from the saved slot. Without clicking
// "Save and add to chart" the chart never updates.
await new Promise(r => setTimeout(r, 2400));
const dialogClicked = (await c.Runtime.evaluate({
  expression: '(function(){var btns=document.querySelectorAll("button");for(var i=0;i<btns.length;i++){var b=btns[i];if(!b.offsetParent)continue;var t=(b.textContent||"").trim();if(/^save and add to chart$/i.test(t)){b.click();return "dialog: "+t}}return null})()',
  returnByValue: true,
})).result?.value;
if (dialogClicked) console.log('Dialog handled:', dialogClicked);

// Heavy indicators need ~3x more compile-and-render time than the old default.
await new Promise(r => setTimeout(r, 6600));
const errors = (await c.Runtime.evaluate({
  expression: '(function(){var c=document.querySelector(".monaco-editor.pine-editor-monaco");if(!c)return[];var el=c;var fk;for(var i=0;i<20;i++){if(!el)break;fk=Object.keys(el).find(function(k){return k.startsWith("__reactFiber$")});if(fk)break;el=el.parentElement}if(!fk)return[];var cur=el[fk];for(var d=0;d<15;d++){if(!cur)break;if(cur.memoizedProps&&cur.memoizedProps.value&&cur.memoizedProps.value.monacoEnv){var env=cur.memoizedProps.value.monacoEnv;if(env.editor&&typeof env.editor.getEditors==="function"){var eds=env.editor.getEditors();if(eds.length>0){var model=eds[0].getModel();var markers=env.editor.getModelMarkers({resource:model.uri});return markers.map(function(m){return{line:m.startLineNumber,msg:m.message}})}}}cur=cur.return}return[]})()',
  returnByValue: true,
})).result?.value || [];

if (errors.length === 0) {
  console.log('Compiled clean — 0 errors');
} else {
  console.log(`${errors.length} errors:`);
  errors.forEach(e => console.log(`  Line ${e.line}: ${e.msg}`));
}

await c.close();
