import { EditorView, basicSetup } from "codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

// Attach to window so we can use them in our editor.js
window.CodeMirror = {
    EditorView,
    basicSetup,
    sql,
    PostgreSQL,
    oneDark,
    indentWithTab,
    keymap,
    Prec
};
