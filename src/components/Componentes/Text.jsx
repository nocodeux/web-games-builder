import React, { useContext, useEffect, useRef } from 'react';
import { DataContext } from './DataRepeater';
import { playInteractionSound } from '../../lib/interactionAudio';
import { resolveDatabaseRecord } from '../../lib/databaseBinding';

const getThemeColor = (val, themeVar) => {
  if (!val || val.toLowerCase() === '#00ff00' || val.toLowerCase() === '#000000' || val === 'transparent') return `var(${themeVar})`;
  return val;
};

// Convert rendered HTML back to [tag] syntax when saving from contentEditable
function htmlToTags(html) {
  return html
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '[b]$1[/b]')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '[b]$1[/b]')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '[i]$1[/i]')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '[i]$1[/i]')
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '[u]$1[/u]')
    .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '[s]$1[/s]')
    .replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, '[s]$1[/s]')
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, '[sup]$1[/sup]')
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, '[sub]$1[/sub]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '');
}

function Text({
  text = 'Text1',
  textColor = '',
  fontSize = 12,
  alignment = 'left',
  linkUrl = '',
  action = 'none',
  width = 'auto',
  sizing = {},
  dataSourceType = 'manual',
  database = null,
  dataSourceTable = '',
  dataFilterField = '',
  dataFilterValue = '',
  dataField = '',
  requireLogin = false,
  soundActions = null,
  soundSettings = null,
  assets = null,
  isEditing = false,
  selected = false,
  showCaret = false,
  onCommitText,
}) {
  const data = useContext(DataContext);
  const isAuthenticated = false;
  const editRef = useRef(null);
  const pointerStartRef = useRef(null);

  const resolveTemplates = (txt, dataSource) => {
    if (!txt || !dataSource) return txt;
    return txt.replace(/\{\{(.*?)\}\}/g, (match, field) => {
      const trimmedField = field.trim();
      return dataSource[trimmedField] !== undefined ? String(dataSource[trimmedField]) : match;
    });
  };

  const sourceData = dataSourceType === 'database'
    ? resolveDatabaseRecord({
        database,
        tableName: dataSourceTable,
        filterField: dataFilterField,
        filterValue: dataFilterValue,
        templateSource: data,
        fallbackData: data,
      })
    : data;

  let resolvedText = (dataSourceType === 'database' && sourceData)
    ? (dataField ? String(sourceData[dataField] ?? '') : resolveTemplates(text, sourceData))
    : text;

  if (dataSourceType === 'database' && requireLogin && !isAuthenticated) {
    resolvedText = '[ Private Content Needs Login ]';
  }

  const formatText = (txt) => {
    if (!txt) return '';
    return txt
      .replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<strong>$1</strong>')
      .replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<em>$1</em>')
      .replace(/\[u\]([\s\S]*?)\[\/u\]/g, '<u style="text-decoration: underline;">$1</u>')
      .replace(/\[s\]([\s\S]*?)\[\/s\]/g, '<s style="text-decoration: line-through;">$1</s>')
      .replace(/\[sup\]([\s\S]*?)\[\/sup\]/g, '<sup>$1</sup>')
      .replace(/\[sub\]([\s\S]*?)\[\/sub\]/g, '<sub>$1</sub>');
  };

  const style = {
    color: getThemeColor(textColor, '--text'),
    fontSize: `${fontSize}px`,
    textAlign: alignment,
    width: sizing.widthMode === 'fill' ? '100%' : (typeof width === 'string' && width.includes('%') ? width : (width === 'auto' ? 'auto' : `${width}px`)),
    display: 'inline-block',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: '1.4',
    textDecoration: (linkUrl || (action && action !== 'none')) ? 'underline' : 'none',
    cursor: (action && action !== 'none') ? 'pointer' : 'inherit',
  };

  // Set initial HTML and focus when entering edit mode
  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.innerHTML = formatText(resolvedText);
      editRef.current.focus();
      // Cursor at end
      const range = document.createRange();
      range.selectNodeContents(editRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <span
        ref={editRef}
        contentEditable
        suppressContentEditableWarning
        className="canvas-text-editor"
        style={{
          ...style,
          outline: '1px dashed var(--accent)',
          outlineOffset: '2px',
          cursor: 'text',
          minWidth: 20,
          minHeight: '1em',
          textDecoration: 'none',
        }}
        onBlur={e => onCommitText && onCommitText(htmlToTags(e.currentTarget.innerHTML))}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onCommitText && onCommitText(null);
          }
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      />
    );
  }

  const showCaretNow = showCaret || (selected && !isEditing);

  const content = (
    <span
      style={style}
      className={showCaretNow ? 'text-has-caret' : undefined}
      onMouseEnter={() => {
        if (linkUrl || (action && action !== 'none')) {
          playInteractionSound(soundSettings, assets, 'hover', soundActions);
        }
      }}
      onClick={() => {
        if (linkUrl || (action && action !== 'none')) {
          playInteractionSound(soundSettings, assets, 'click', soundActions);
        }
      }}
      onPointerDown={e => { pointerStartRef.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={e => {
        const start = pointerStartRef.current;
        pointerStartRef.current = null;
        if ((linkUrl || (action && action !== 'none')) && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 28) {
          playInteractionSound(soundSettings, assets, 'swipe', soundActions);
        }
      }}
      dangerouslySetInnerHTML={{ __html: formatText(resolvedText) }}
    />
  );

  if (linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          textDecoration: 'none',
          display: sizing.widthMode === 'fill' ? 'block' : 'inline-block',
          width: sizing.widthMode === 'fill' ? '100%' : 'auto',
          cursor: 'inherit'
        }}
        onClick={e => {
          if (e.metaKey || e.ctrlKey) { e.stopPropagation(); return; }
          e.preventDefault();
        }}
      >
        {content}
      </a>
    );
  }

  return content;
}

export default Text;
