# Tutorial: Create a TUIFY App

A TUIFY app is a JSON object following the project schema. This guide walks through building a complete multi-screen app with a database.

---

## Step 1 — Project shell

```json
{
  "id": "my-app",
  "name": "My Retro App",
  "theme": "theme-retro",
  "viewMode": "mobile",
  "currentScreenId": "screen-home",
  "database": { "tables": [], "data": {} },
  "screens": []
}
```

**Themes:** `theme-retro` (default, green on black), `theme-nano` (bright green on black), `theme-bios` (white on blue), `theme-amber` (amber on black)
**viewMode:** `"mobile"` (360px canvas) or `"desktop"` (full width)

---

## Step 2 — Add a database

Add tables under `database.tables` and seed data under `database.data`:

```json
"database": {
  "tables": [
    {
      "name": "Products",
      "fields": [
        { "name": "id", "type": "INTEGER", "primary": true },
        { "name": "name", "type": "TEXT" },
        { "name": "price", "type": "REAL" },
        { "name": "category", "type": "TEXT" }
      ]
    }
  ],
  "data": {
    "Products": [
      { "id": 1, "name": "Widget A", "price": 9.99, "category": "tools" },
      { "id": 2, "name": "Widget B", "price": 19.99, "category": "tools" }
    ]
  }
}
```

Field types: `INTEGER`, `TEXT`, `REAL`, `BOOLEAN`, `BLOB`

---

## Step 3 — Home screen with a list

```json
{
  "id": "screen-home",
  "name": "Home",
  "rows": [
    {
      "id": "row-header",
      "layout": {
        "direction": "row",
        "justify": "space-between",
        "align": "center",
        "paddingTop": 16, "paddingBottom": 16,
        "paddingLeft": 16, "paddingRight": 16
      },
      "children": [
        {
          "id": "txt-title",
          "type": "Text",
          "props": { "text": "MY SHOP", "fontSize": 20, "textColor": "var(--accent)", "sizing": { "widthMode": "hug", "heightMode": "hug" } },
          "children": []
        },
        {
          "id": "btn-admin",
          "type": "Button",
          "props": { "text": "ADMIN", "action": "screen", "targetScreenId": "screen-admin", "sizing": { "widthMode": "hug", "heightMode": "hug" } },
          "children": []
        }
      ]
    },
    {
      "id": "row-list",
      "layout": { "direction": "column", "gap": 0, "paddingLeft": 8, "paddingRight": 8, "paddingBottom": 16 },
      "children": [
        {
          "id": "repeater-products",
          "type": "DataRepeater",
          "props": {
            "tableName": "Products",
            "layout": { "direction": "column", "gap": 8, "align": "stretch" },
            "sizing": { "widthMode": "fill", "heightMode": "hug" }
          },
          "children": [
            {
              "id": "frame-product",
              "type": "Frame",
              "props": {
                "title": "PRODUCT",
                "borderStyle": "single",
                "layout": { "direction": "row", "gap": 8, "align": "center", "justify": "space-between", "paddingTop": 8, "paddingLeft": 8, "paddingRight": 8, "paddingBottom": 8 },
                "sizing": { "widthMode": "fill", "heightMode": "hug" }
              },
              "children": [
                {
                  "id": "txt-name",
                  "type": "Text",
                  "props": { "text": "{{name}}", "fontSize": 13, "dataSourceType": "database", "dataField": "name", "sizing": { "widthMode": "fill", "heightMode": "hug" } },
                  "children": []
                },
                {
                  "id": "txt-price",
                  "type": "Text",
                  "props": { "text": "${{price}}", "fontSize": 13, "dataSourceType": "database", "dataField": "price", "sizing": { "widthMode": "hug", "heightMode": "hug" } },
                  "children": []
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Step 4 — Admin screen with a form

```json
{
  "id": "screen-admin",
  "name": "Add Product",
  "rows": [
    {
      "id": "row-back",
      "layout": { "direction": "row", "paddingTop": 12, "paddingLeft": 12 },
      "children": [
        {
          "id": "btn-back",
          "type": "Button",
          "props": { "text": "← BACK", "action": "screen", "targetScreenId": "screen-home", "sizing": { "widthMode": "hug", "heightMode": "hug" } },
          "children": []
        }
      ]
    },
    {
      "id": "row-form",
      "layout": { "direction": "column", "paddingLeft": 16, "paddingRight": 16, "paddingTop": 8 },
      "children": [
        {
          "id": "form-add",
          "type": "Form",
          "props": {
            "targetTable": "Products",
            "layout": { "direction": "column", "gap": 12, "align": "stretch" },
            "sizing": { "widthMode": "fill", "heightMode": "hug" }
          },
          "children": [
            {
              "id": "input-name",
              "type": "TextBox",
              "props": { "label": "PRODUCT NAME", "placeholder": "Enter name...", "dataField": "name", "sizing": { "widthMode": "fill", "heightMode": "hug" } },
              "children": []
            },
            {
              "id": "input-price",
              "type": "TextBox",
              "props": { "label": "PRICE", "placeholder": "0.00", "inputType": "number", "dataField": "price", "sizing": { "widthMode": "fill", "heightMode": "hug" } },
              "children": []
            },
            {
              "id": "btn-save",
              "type": "Button",
              "props": { "text": "ADD PRODUCT", "action": "submit", "sizing": { "widthMode": "fill", "heightMode": "hug" } },
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Key rules when generating app JSON

1. Every component needs a unique `id` (use short slugs or `Math.random().toString(36).slice(2,9)`)
2. All components need `children: []` even if they have no children
3. Container sizing defaults: containers → `widthMode: "fill"`, leaves → `widthMode: "hug"`
4. `DataRepeater.tableName` must match an entry in `database.tables[].name`
5. `Form.targetTable` must match a DB table name
6. `TextBox.dataField` must match a column in the Form's target table
7. Navigation targets (`targetScreenId`) must match an existing screen `id`
8. Never put DB-specific props (dataField, tableName) on components outside a Form/DataRepeater context
