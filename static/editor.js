// DOM Elements
const schemaTree = document.getElementById('schema-tree');
const tabBar = document.getElementById('tab-bar');
const runBtn = document.getElementById('run-query');
const resultsContainer = document.getElementById('results-container');
const resultsCount = document.getElementById('results-count');
const statusBar = document.getElementById('status-bar');
const schemaSearch = document.getElementById('schema-search');
const newTabBtn = document.getElementById('new-tab-btn');

let editor;
let allViews = [];
let sessions = [];
let activeSessionId = null;

const SESSIONS_KEY = 'quacksql_sessions_v3';
const ACTIVE_SESSION_KEY = 'quacksql_active_id_v3';

// Initialize Editor
async function initEditor() {
    const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
    const initialContent = activeSession ? activeSession.content : "SELECT * FROM kalshi_markets LIMIT 10;";
    
    try {
        const cm = window.CodeMirror;
        if (!cm) throw new Error("CodeMirror bundle not loaded");

        const { EditorView, basicSetup, sql, PostgreSQL, oneDark, indentWithTab, Prec, keymap } = cm;

        const sqlSchema = {};
        allViews.forEach(view => {
            // columns is now [{name, type}] — extract names for autocomplete
            sqlSchema[view.name] = (view.columns || []).map(c => c.name || c);
        });

        const saveListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                updateActiveSessionContent(update.state.doc.toString());
            }
        });

        editor = new EditorView({
            doc: initialContent,
            extensions: [
                basicSetup,
                Prec.highest(keymap.of([indentWithTab])),
                sql({ dialect: PostgreSQL, schema: sqlSchema }),
                oneDark,
                EditorView.lineWrapping,
                saveListener
            ],
            parent: document.getElementById('sql-editor')
        });

        statusBar.textContent = "Advanced Mode Active";
    } catch (err) {
        console.error('Editor initialization failed:', err);
        const container = document.getElementById('sql-editor');
        container.innerHTML = `<textarea id="sql-fallback" style="width:100%; height:100%; background:#0a0a0f; color:#e1e1e6; font-family:'JetBrains Mono', monospace; padding:20px; border:none; outline:none; font-size:1rem; resize:none;">${initialContent}</textarea>`;
        const fallback = document.getElementById('sql-fallback');
        fallback.oninput = () => updateActiveSessionContent(fallback.value);
        editor = {
            isFallback: true,
            state: { doc: { toString: () => fallback.value } },
            dispatch: (action) => {
                if (action.changes) {
                    fallback.value = action.changes.insert;
                    updateActiveSessionContent(fallback.value);
                }
            }
        };
        statusBar.textContent = "Basic Mode Active";
    }

    // Universal Tab interceptor
    document.getElementById('sql-editor').addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            if (editor && !editor.isFallback && editor.dispatch) {
                try {
                    const { from, to } = editor.state.selection.main;
                    editor.dispatch({
                        changes: { from, to, insert: "    " },
                        selection: { anchor: from + 4 }
                    });
                } catch (e) {}
            } else {
                const el = document.getElementById('sql-fallback');
                if (el) {
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    el.value = el.value.substring(0, start) + "    " + el.value.substring(end);
                    el.selectionStart = el.selectionEnd = start + 4;
                    updateActiveSessionContent(el.value);
                }
            }
        }
    }, true);
}

// Session Management
function loadSessions() {
    const stored = localStorage.getItem(SESSIONS_KEY);
    if (stored) {
        sessions = JSON.parse(stored);
    } else {
        sessions = [{ id: Date.now(), name: 'Query 1', content: '-- Write your SQL here\nSELECT * FROM kalshi_markets LIMIT 10;' }];
    }
    activeSessionId = parseInt(localStorage.getItem(ACTIVE_SESSION_KEY)) || sessions[0].id;
    if (!sessions.find(s => s.id === activeSessionId)) activeSessionId = sessions[0].id;
}

function saveSessions() {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
}

function renderTabs() {
    // Force horizontal layout via inline style — bypass CSS entirely
    tabBar.style.cssText = `
        display: flex;
        flex-direction: row;
        flex-wrap: nowrap;
        align-items: flex-end;
        overflow-x: auto;
        overflow-y: hidden;
        height: 100%;
        gap: 0;
    `;
    tabBar.innerHTML = '';

    sessions.forEach(session => {
        const tab = document.createElement('div');
        const isActive = session.id === activeSessionId;
        tab.style.cssText = `
            display: inline-flex;
            flex-direction: row;
            flex-shrink: 0;
            align-items: center;
            justify-content: center;
            gap: 8px;
            height: 32px;
            min-width: 140px;
            max-width: 220px;
            padding: 0 20px;
            margin-right: -8px;
            font-size: 0.75rem;
            cursor: pointer;
            white-space: nowrap;
            border-radius: 8px 8px 0 0;
            position: relative;
            z-index: ${isActive ? 10 : 1};
            background: ${isActive ? 'var(--bg-deep, #0a0a0f)' : 'rgba(255,255,255,0.04)'};
            color: ${isActive ? '#e1e1e6' : '#9494b8'};
            transition: background 0.15s;
        `;

        const title = document.createElement('span');
        title.textContent = session.name;
        title.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;';

        // Double-click to rename
        title.ondblclick = (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.value = session.name;
            input.style.cssText = `
                background: rgba(255,255,255,0.1);
                border: 1px solid #7c4dff;
                border-radius: 3px;
                color: #e1e1e6;
                font-size: 0.75rem;
                font-family: inherit;
                padding: 0 4px;
                width: 100px;
                outline: none;
            `;

            const save = () => {
                const newName = input.value.trim() || session.name;
                session.name = newName;
                saveSessions();
                renderTabs();
            };

            input.onblur = save;
            input.onkeydown = (ke) => {
                if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
                if (ke.key === 'Escape') { input.value = session.name; input.blur(); }
                ke.stopPropagation(); // Don't let keydown bubble to editor
            };

            title.replaceWith(input);
            input.focus();
            input.select();
        };

        tab.appendChild(title);

        const closeBtn = document.createElement('span');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            font-size: 0.6rem;
            opacity: 0.4;
            flex-shrink: 0;
            margin-left: 4px;
        `;
        closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; closeBtn.style.background = 'rgba(255,255,255,0.15)'; };
        closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.4'; closeBtn.style.background = 'transparent'; };
        closeBtn.onclick = (e) => { e.stopPropagation(); closeSession(session.id); };
        tab.appendChild(closeBtn);

        tab.onclick = () => switchSession(session.id);
        tab.onmouseenter = () => { if (!isActive) tab.style.background = 'rgba(255,255,255,0.08)'; };
        tab.onmouseleave = () => { if (!isActive) tab.style.background = 'rgba(255,255,255,0.04)'; };

        tabBar.appendChild(tab);
    });

    // Append "+" button right after the last tab
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'New Query';
    addBtn.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        margin-left: 4px;
        margin-bottom: 2px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        color: #9494b8;
        font-size: 1.1rem;
        cursor: pointer;
        transition: all 0.15s;
        align-self: flex-end;
    `;
    addBtn.onmouseenter = () => {
        addBtn.style.background = 'rgba(255,255,255,0.08)';
        addBtn.style.color = '#e1e1e6';
        addBtn.style.borderColor = 'rgba(255,255,255,0.12)';
    };
    addBtn.onmouseleave = () => {
        addBtn.style.background = 'transparent';
        addBtn.style.color = '#9494b8';
        addBtn.style.borderColor = 'transparent';
    };
    addBtn.onclick = newSession;
    tabBar.appendChild(addBtn);
}

function updateActiveSessionContent(content) {
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
        session.content = content;
        saveSessions();
    }
}

function switchSession(id) {
    if (id === activeSessionId) return; // Don't re-render if already active (required for dblclick rename to work)
    activeSessionId = id;
    const session = sessions.find(s => s.id === activeSessionId);
    
    if (editor) {
        if (!editor.isFallback) {
            editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: session.content }
            });
        } else {
            const fallback = document.getElementById('sql-fallback');
            if (fallback) fallback.value = session.content;
        }
    }
    
    saveSessions();
    renderTabs();
    resultsContainer.innerHTML = '<div class="empty-state">Execute a query to see results here</div>';
}

function newSession() {
    const id = Date.now();
    const name = `Query ${sessions.length + 1}`;
    sessions.push({ id, name, content: `-- ${name}\nSELECT * FROM ` });
    saveSessions();
    switchSession(id);
    
    // Scroll tabs to the right
    setTimeout(() => {
        tabBar.scrollLeft = tabBar.scrollWidth;
    }, 50);
}

function closeSession(id) {
    if (sessions.length <= 1) return;
    const index = sessions.findIndex(s => s.id === id);
    const wasActive = (id === activeSessionId);
    
    sessions = sessions.filter(s => s.id !== id);
    
    if (wasActive) {
        activeSessionId = sessions[Math.max(0, index - 1)].id;
        const session = sessions.find(s => s.id === activeSessionId);
        if (editor) {
            if (!editor.isFallback) {
                editor.dispatch({
                    changes: { from: 0, to: editor.state.doc.length, insert: session.content }
                });
            } else {
                const fallback = document.getElementById('sql-fallback');
                if (fallback) fallback.value = session.content;
            }
        }
    }
    
    saveSessions();
    renderTabs();
}

// Load Schema
async function loadSchema() {
    try {
        const response = await fetch('/api/schema');
        const data = await response.json();
        allViews = data.views;
        renderSchema(allViews);
    } catch (err) {
        console.error('Error loading schema:', err);
    }
}

function renderSchema(views) {
    schemaTree.innerHTML = '';
    views.forEach(view => {
        // --- Table header row ---
        const tableRow = document.createElement('div');
        tableRow.className = 'schema-table-row';

        const arrow = document.createElement('span');
        arrow.className = 'schema-arrow';
        arrow.textContent = '▶';

        const icon = document.createElement('span');
        icon.textContent = '📋';
        icon.style.fontSize = '0.8rem';

        const label = document.createElement('span');
        label.className = 'schema-table-name';
        label.textContent = view.name;

        const count = document.createElement('span');
        count.className = 'schema-col-count';
        count.textContent = `${(view.columns || []).length} cols`;

        tableRow.appendChild(arrow);
        tableRow.appendChild(icon);
        tableRow.appendChild(label);
        tableRow.appendChild(count);

        // --- Column list (hidden by default) ---
        const colList = document.createElement('div');
        colList.className = 'schema-col-list';
        colList.style.display = 'none';

        (view.columns || []).forEach(col => {
            const colName = col.name || col;
            const colType = col.type || '';

            const colRow = document.createElement('div');
            colRow.className = 'schema-col-row';

            const colNameEl = document.createElement('span');
            colNameEl.className = 'schema-col-name';
            colNameEl.textContent = colName;

            const colTypeEl = document.createElement('span');
            colTypeEl.className = 'schema-col-type';
            colTypeEl.textContent = colType;

            colRow.appendChild(colNameEl);
            colRow.appendChild(colTypeEl);
            colList.appendChild(colRow);
        });

        // Toggle expand/collapse on click
        let expanded = false;
        tableRow.onclick = () => {
            expanded = !expanded;
            colList.style.display = expanded ? 'block' : 'none';
            arrow.textContent = expanded ? '▼' : '▶';
            arrow.style.color = expanded ? 'var(--accent-primary)' : '';
            tableRow.classList.toggle('expanded', expanded);
        };

        schemaTree.appendChild(tableRow);
        schemaTree.appendChild(colList);
    });
}

// Execute Query
async function runQuery() {
    let sqlQuery = "";
    if (editor && !editor.isFallback) {
        const { from, to } = editor.state.selection.main;
        const selection = editor.state.sliceDoc(from, to);
        sqlQuery = selection.trim() ? selection : editor.state.doc.toString();
    } else {
        const el = document.getElementById('sql-fallback');
        if (el) {
            const selection = el.value.substring(el.selectionStart, el.selectionEnd);
            sqlQuery = selection.trim() ? selection : el.value;
        }
    }

    if (!sqlQuery.trim()) return;
    statusBar.textContent = "Executing...";
    runBtn.disabled = true;

    try {
        const response = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: sqlQuery })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail);
        renderResults(data);
        statusBar.textContent = `Success!`;
    } catch (err) {
        resultsContainer.innerHTML = `<div class="empty-state" style="color: var(--error)">Error: ${err.message}</div>`;
        statusBar.textContent = "Query failed";
    } finally {
        runBtn.disabled = false;
    }
}

function renderResults(data) {
    resultsContainer.innerHTML = '';
    resultsCount.textContent = `${data.total_rows || 0} rows`;
    if (!data.columns || data.columns.length === 0) {
        resultsContainer.innerHTML = '<div class="empty-state">Query returned no data.</div>';
        return;
    }
    const table = document.createElement('table');
    table.className = 'results-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    data.columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    data.rows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach(cell => {
            const td = document.createElement('td');
            const cellText = cell !== null ? String(cell) : 'NULL';
            td.textContent = cellText;
            
            // Add tooltip and click-to-copy
            td.title = cellText;
            td.style.cursor = 'pointer';
            td.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(cellText);
                    const originalBg = td.style.backgroundColor;
                    td.style.backgroundColor = 'rgba(124, 77, 255, 0.3)';
                    setTimeout(() => td.style.backgroundColor = originalBg, 200);
                } catch (e) {
                    console.error('Copy failed', e);
                }
            };
            
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    resultsContainer.appendChild(table);
}

// Search
schemaSearch.oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allViews.filter(v => v.name.toLowerCase().includes(term));
    renderSchema(filtered);
};

// Listeners
runBtn.onclick = runQuery;
if (newTabBtn) newTabBtn.onclick = newSession;

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') runQuery();
});

// Init
(async () => {
    loadSessions();
    renderTabs();
    await loadSchema();
    await initEditor();
})();
