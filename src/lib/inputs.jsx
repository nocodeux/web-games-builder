// Shared input primitives that should be used anywhere a numeric value is
// edited. Native <input type="number" onChange={parseInt(...) || N}> forces
// the field back to N the moment the string parses to NaN — which happens
// every time the user clears it to type a new number. The components below
// hold local string state so the field can be temporarily empty, and only
// commit on blur or Enter.
//
// Rule: do NOT introduce raw <input type="number"> for committed numeric
// fields. Use NumericInput. If you need a list of integers, use the
// patterns in SpriteSheetManager (FramesInput / GapInput) which work the
// same way for arrays.

import React, { useEffect, useState } from 'react';

export function NumericInput({ value, onCommit, min, max, ...rest }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  const commit = () => {
    if (draft === '' || draft === '-') {
      setDraft(value == null ? '' : String(value));
      return;
    }
    let n = parseInt(draft, 10);
    if (Number.isNaN(n)) {
      setDraft(value == null ? '' : String(value));
      return;
    }
    if (typeof min === 'number') n = Math.max(min, n);
    if (typeof max === 'number') n = Math.min(max, n);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={e => { if (/^-?\d*$/.test(e.target.value)) setDraft(e.target.value); }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { commit(); e.target.blur(); } }}
      {...rest}
    />
  );
}
