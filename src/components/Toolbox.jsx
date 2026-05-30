import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from 'react-dnd';
import { playInteractionSound, getInteractionAssets, getInteractionSettings } from '../lib/interactionAudio';
import { resolveTutorialMedia } from '../lib/tutorialMedia';

// Sectioned palette. `requires: 'gameMode'` items are filtered out of
// non-game projects. Items with `preview: true` are shown but not yet
// draggable — their actual implementation lands in a later phase.
export const TOOLBOX_PALETTE = [
  { kind: 'section', label: 'UI' },
  { kind: 'item', type: 'Window', label: 'Window' },
  { kind: 'item', type: 'Frame', label: 'Frame' },
  { kind: 'item', type: 'Row', label: 'Row' },
  { kind: 'item', type: 'Button', label: 'Button' },
  { kind: 'item', type: 'Text', label: 'Text' },
  { kind: 'item', type: 'Input', label: 'Input' },
  { kind: 'item', type: 'CheckBox', label: 'CheckBox' },
  { kind: 'item', type: 'RadioButton', label: 'RadioButton' },
  { kind: 'item', type: 'Selector', label: 'Selector' },
  { kind: 'item', type: 'ListBox', label: 'ListBox' },
  { kind: 'item', type: 'Timer', label: 'Timer' },
  { kind: 'item', type: 'Shape', label: 'Shape' },
  { kind: 'item', type: 'Line', label: 'Line' },
  { kind: 'item', type: 'Image', label: 'Image' },
  { kind: 'item', type: 'Data', label: 'Data' },
  { kind: 'item', type: 'Table', label: 'Table' },
  { kind: 'item', type: 'DataRepeater', label: 'Repeater' },
  { kind: 'item', type: 'Form', label: 'Form' },
  { kind: 'item', type: 'Loader', label: 'Loader' },
  { kind: 'item', type: 'Tabs', label: 'Tabs' },
  { kind: 'item', type: 'Overlay', label: 'Overlay' },
  { kind: 'item', type: 'GradualBlur', label: 'GradualBlur' },

  { kind: 'section', label: 'EMBED' },
  { kind: 'item', type: 'GameEmbed', label: 'GameEmbed' },

  { kind: 'section', label: 'GAME', requires: 'gameMode' },
  { kind: 'item', type: 'GameEntity', label: 'GameEntity', requires: 'gameMode', dragType: 'GAME_COMPONENT' },
  // TileMap is configured per-Level in the Inspector — not a draggable component.
  { kind: 'item', type: 'SpawnPoint', label: 'SpawnPoint', requires: 'gameMode', dragType: 'GAME_COMPONENT' },
  { kind: 'item', type: 'Trigger', label: 'Trigger', requires: 'gameMode', dragType: 'GAME_COMPONENT' },
  { kind: 'item', type: 'Teleporter', label: 'Teleporter', requires: 'gameMode', dragType: 'GAME_COMPONENT' },
  { kind: 'item', type: 'ParticleEmitter', label: 'Particles', requires: 'gameMode', dragType: 'GAME_COMPONENT' },
  { kind: 'item', type: 'SoundEmitter', label: 'Sound', requires: 'gameMode', dragType: 'GAME_COMPONENT' },
  { kind: 'item', type: 'CollisionShape', label: 'Collision', requires: 'gameMode', preview: true },
  { kind: 'item', type: 'Camera', label: 'Camera', requires: 'gameMode', preview: true },
  { kind: 'item', type: 'GameView', label: 'GameView', requires: 'gameMode', preview: true },
];

function ToolboxItem({ type, label, preview, dragType, assets, soundSettings, tutorialConfig, onTutorialPreview }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: dragType || 'COMPONENT',
    item: { type },
    canDrag: () => !preview,
    collect: (monitor) => ({ isDragging: !!monitor.isDragging() })
  }), [preview, dragType]);

  const tutorialMedia = resolveTutorialMedia(tutorialConfig, assets, type, label);

  return (
    <div
      ref={preview ? null : drag}
      className="toolbox-item"
      style={{
        opacity: isDragging ? 0.4 : (preview ? 0.45 : 1),
        cursor: preview ? 'not-allowed' : 'grab',
      }}
      title={preview ? 'Available in a later phase' : 'Drag to canvas'}
      onMouseEnter={(e) => {
        if (!preview) playInteractionSound(getInteractionSettings(soundSettings), getInteractionAssets(assets), 'hover');
        if (tutorialMedia && onTutorialPreview) {
          onTutorialPreview({
            type,
            label,
            ...tutorialMedia,
            x: e.clientX,
            y: e.clientY,
          });
        }
      }}
      onMouseMove={(e) => {
        if (tutorialMedia && onTutorialPreview) {
          onTutorialPreview(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev);
        }
      }}
      onMouseLeave={() => {
        if (onTutorialPreview) onTutorialPreview(null);
      }}
      data-tutorial-video={tutorialMedia.url || ''}
    >
      {label}{preview ? ' (soon)' : ''}
    </div>
  );
}

export function TutorialVideoFollower({ preview }) {
  if (!preview || typeof document === 'undefined' || typeof window === 'undefined') return null;
  const width = 280;
  const height = 158;
  const x = Math.max(12, Math.min(window.innerWidth - width - 12, preview.x + 20));
  const y = Math.max(12, Math.min(window.innerHeight - height - 12, preview.y + 20));

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width,
        zIndex: 99999,
        border: '1px solid var(--border)',
        background: 'var(--panel-bg)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        fontSize: 10,
        color: 'var(--accent)',
        background: 'rgba(255,255,255,0.03)',
      }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.label}</span>
        <span style={{ color: 'var(--text-dim)' }}>tutorial</span>
      </div>
      {preview.youtube && preview.url ? (
        <iframe
          src={preview.embedUrl}
          title={preview.label}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            display: 'block',
            width: '100%',
            height,
            border: 0,
            background: '#000',
          }}
        />
      ) : preview.url ? (
        <video
          src={preview.url}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          style={{
            display: 'block',
            width: '100%',
            height,
            objectFit: 'cover',
            background: '#000',
          }}
        />
      ) : (
        <div style={{
          display: 'flex',
          width: '100%',
          height,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          boxSizing: 'border-box',
          color: 'var(--text)',
          fontSize: 11,
          lineHeight: 1.45,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.03)',
        }}>
          <div style={{ maxHeight: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {preview.description || preview.label}
          </div>
        </div>
      )}
      {!!preview.readMoreUrl && (
        <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'flex-end', pointerEvents: 'auto' }}>
          <a
            href={preview.readMoreUrl}
            target="_blank"
            rel="noreferrer"
            style={{ pointerEvents: 'auto', color: 'var(--accent)', fontSize: 10, textDecoration: 'none' }}
          >
            Read more
          </a>
        </div>
      )}
    </div>,
    document.body
  );
}

function SectionHeader({ label }) {
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 4,
        fontSize: 9,
        color: 'var(--accent)',
        opacity: 0.7,
        letterSpacing: 1,
        textTransform: 'uppercase',
        borderBottom: '1px dashed var(--border)',
        paddingBottom: 2,
      }}
    >
      {label}
    </div>
  );
}

function Toolbox({ gameMode = false, assets = null, soundSettings = null, tutorialConfig = null, tutorialActive = false }) {
  const [preview, setPreview] = useState(null);
  const visible = useMemo(() => TOOLBOX_PALETTE.filter(p => !p.requires || (p.requires === 'gameMode' && gameMode)), [gameMode]);

  React.useEffect(() => {
    if (!tutorialActive) setPreview(null);
  }, [tutorialActive]);

  return (
    <div className="toolbox">
      <h3>[TOOLBOX]</h3>
      {visible.map((p, i) =>
        p.kind === 'section'
          ? <SectionHeader key={`s-${i}`} label={p.label} />
          : <ToolboxItem
              key={p.type}
              type={p.type}
              label={p.label}
              preview={p.preview}
              dragType={p.dragType}
              assets={assets}
              soundSettings={soundSettings}
              tutorialConfig={tutorialConfig}
              onTutorialPreview={tutorialActive ? setPreview : null}
            />
      )}
      <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        drag to canvas
      </div>
      {tutorialActive && preview && <TutorialVideoFollower preview={preview} />}
    </div>
  );
}

export default Toolbox;
