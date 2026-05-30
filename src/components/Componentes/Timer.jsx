import React, { useEffect, useState } from 'react';

function Timer({ interval = 1000, enabled = false }) {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTicks(t => t + 1), interval);
    return () => clearInterval(id);
  }, [enabled, interval]);

  return (
    <div className="retro-timer" style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
      [{enabled ? 'ACTIVE' : 'INACTIVE'}] Timer: {ticks} ticks
    </div>
  );
}

export default Timer;
