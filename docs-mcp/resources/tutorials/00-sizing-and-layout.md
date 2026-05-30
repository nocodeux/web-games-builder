# TUIFY Sizing & Layout Guide

## The Sizing System

Every component has a `sizing` prop with two fields:

```json
"sizing": {
  "widthMode": "hug" | "fill" | "fixed",
  "heightMode": "hug" | "fill" | "fixed"
}
```

| Mode | Meaning |
|------|---------|
| `hug` | Shrinks to fit content (like CSS `max-content`) |
| `fill` | Expands to fill parent's available space (like CSS `flex: 1`) |
| `fixed` | Explicit pixel size — uses the component's `width`/`height` prop |

### Rules of thumb
- Buttons: `widthMode: "hug"` by default. Use `"fill"` for full-width CTAs.
- Text: `widthMode: "hug"` for inline labels, `"fill"` for paragraphs.
- Row/Frame containers: usually `widthMode: "fill"` to span the screen.
- Images: `widthMode: "fixed"`, `heightMode: "fixed"` with explicit width/height.

---

## The Layout System (Flexbox)

Container components (Row, Window, Frame, Form, DataRepeater, Tabs, Overlay) have a `layout` prop:

```json
"layout": {
  "direction": "row" | "column",
  "gap": 8,
  "align": "flex-start" | "center" | "flex-end" | "stretch",
  "justify": "flex-start" | "center" | "flex-end" | "space-between" | "space-around",
  "wrap": false,
  "paddingTop": 0,
  "paddingRight": 0,
  "paddingBottom": 0,
  "paddingLeft": 0
}
```

### direction
- `"row"` → children laid out left to right
- `"column"` → children stacked top to bottom

### align (cross-axis)
- For `direction: "row"`: controls vertical alignment of children
- For `direction: "column"`: controls horizontal alignment of children

### justify (main-axis)
- For `direction: "row"`: controls horizontal distribution
- For `direction: "column"`: controls vertical distribution

---

## Screen Structure

A TUIFY screen is a vertical stack of **top-level rows**. Each row is a flex container.

```
Screen
├── row (layout: { direction: "row", justify: "space-between" })
│   ├── Text "HEADER"
│   └── Button "MENU"
├── row (layout: { direction: "column", gap: 12 })
│   └── DataRepeater
│       └── Frame (card template)
│           ├── Text (title)
│           └── Text (description)
└── row (layout: { direction: "row", justify: "center" })
    └── Button "LOAD MORE"
```

---

## Common Patterns

### Full-width card list
```json
{
  "layout": { "direction": "column", "gap": 12, "align": "stretch" },
  "sizing": { "widthMode": "fill", "heightMode": "hug" }
}
```

### Centered content
```json
{
  "layout": { "direction": "column", "align": "center", "justify": "center", "paddingTop": 40 },
  "sizing": { "widthMode": "fill", "heightMode": "hug" }
}
```

### Horizontal button group
```json
{
  "layout": { "direction": "row", "gap": 8, "justify": "flex-end", "align": "center" },
  "sizing": { "widthMode": "fill", "heightMode": "hug" }
}
```

### Grid of cards (wrap)
```json
{
  "layout": { "direction": "row", "gap": 12, "wrap": true, "align": "flex-start" },
  "sizing": { "widthMode": "fill", "heightMode": "hug" }
}
```
