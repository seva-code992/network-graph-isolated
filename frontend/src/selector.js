import { h, clear, svgIcon, onOutsideClick, makeDraggable } from './dom.js';

const TICK = 'M2 7.5 5.5 11 12 3';
const SCROLLERS = ['.list-rows'];
const MAX_TSV_BYTES = 5 * 1024 * 1024;

const checkMark = (on) =>
  h('span', { class: 'check' + (on ? ' on' : ''), 'aria-hidden': 'true' }, on ? svgIcon(TICK) : null);

/**
 * Gene-selection dialog shown after "Network graph" is clicked.
 * onProceed(selection) gets [{id, gene_ids?}] (gene_ids omitted = whole list).
 */
export function createSelector({ api, listId, selectedGeneIds, initialSelection, onProceed, onClose }) {
  const s = {
    lists: [], details: new Map(), checked: new Set(), selected: new Map(), // listId -> Set|null(all)
    open: null, error: '', loading: true, species: [], imp: null,
  };
  const root = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Select genes' });
  let disposeOutside = () => {};
  // the dialog can be moved by dragging its title / empty areas (not the lists, which are for clicking)
  const drag = makeDraggable(root, () => root.querySelector('.selector, .details'), { skip: '.list-rows,.gene-panel,.details-card' });

  // ---------- state helpers ----------
  const total = (l) => l.n_genes;
  const count = (l) => (s.selected.get(l.id) === null || !s.selected.has(l.id) ? total(l) : s.selected.get(l.id).size);
  const isAll = (l) => count(l) === total(l);
  async function details(id) {
    if (!s.details.has(id)) s.details.set(id, await api.list(id));
    return s.details.get(id);
  }
  function materialise(id) {
    if (s.selected.get(id) == null) s.selected.set(id, new Set(s.details.get(id).genes.map((g) => g.id)));
    return s.selected.get(id);
  }
  const selectionOut = () =>
    s.lists.filter((l) => s.checked.has(l.id) && count(l) > 0).map((l) => {
      const sel = s.selected.get(l.id);
      return !sel || sel.size === total(l) ? { id: l.id } : { id: l.id, gene_ids: [...sel] };
    });

  // ---------- rendering ----------
  function render() {
    disposeOutside();
    // the dialog is rebuilt on every change; keep the scrolled-to position of the list box
    const scroll = Object.fromEntries(SCROLLERS.map((c) => [c, root.querySelector(c)?.scrollTop || 0]));
    clear(root);
    root.append(s.imp ? renderDetails() : renderSelector());
    drag.apply();
    for (const c of SCROLLERS) { const el = root.querySelector(c); if (el) el.scrollTop = scroll[c]; }
    placePanel();
  }

  // the gene panel opens right below the row it belongs to
  function placePanel() {
    const panel = root.querySelector('.gene-panel');
    const row = panel && root.querySelector(`.list-row[data-list-id="${panel.dataset.panelFor}"]`);
    if (!row) return;
    const card = root.querySelector('.selector').getBoundingClientRect();
    panel.style.top = `${row.getBoundingClientRect().bottom - card.top + 6}px`;
  }

  function renderSelector() {
    const proceedDisabled = s.loading || selectionOut().length === 0;
    const fileInput = h('input', { type: 'file', accept: '.tsv,.tab,.txt,text/tab-separated-values', hidden: true,
      onchange: (e) => importFile(e.target.files[0], e.target) });
    const card = h('div', { class: 'selector card' },
      h('h2', { class: 'selector-title' }, 'Selector'),
      h('button', { class: 'close-x', 'aria-label': 'Close', title: 'Close without creating a graph', onclick: onClose }, '×'),
      h('div', { class: 'select-lists-label' }, 'Select lists:'),
      h('div', { class: 'list-rows' }, s.loading ? h('div', { class: 'muted' }, 'Loading lists…')
        : s.lists.length ? s.lists.map(renderRow) : h('div', { class: 'muted' }, 'No saved lists yet – import a .tsv list.')),
      s.error && h('div', { class: 'error', role: 'alert' }, s.error),
      h('div', { class: 'selector-actions' },
        h('button', { class: 'pill primary', disabled: proceedDisabled, onclick: () => onProceed(selectionOut()),
          title: proceedDisabled ? 'Select at least one gene to continue' : 'Create the network graph from the selected genes' }, 'Proceed'),
        h('button', { class: 'pill', title: 'Upload a .tsv file: first column gene ID, second column description',
          onclick: () => fileInput.click() }, 'Import .tsv list'),
        fileInput));
    if (s.open) card.append(renderPanel());
    return card;
  }

  function renderRow(l) {
    const on = s.checked.has(l.id);
    const label = isAll(l) ? 'All genes' : `Selected genes (${count(l)})`;
    return h('div', { class: 'list-row' + (on ? ' on' : ''), dataset: { listId: l.id } },
      h('div', { class: 'row-main', title: on ? 'Click to exclude this list' : 'Click to include this list',
        onclick: () => toggleList(l.id) },
        h('span', { class: 'list-name' }, l.name),
        h('span', { class: 'species-tag' }, l.species)),
      h('button', { class: 'row-genes' + (s.open === l.id ? ' open' : ''), 'aria-expanded': String(s.open === l.id),
        title: 'Click to choose individual genes', onclick: (e) => { e.stopPropagation(); togglePanel(l.id); } },
        h('span', { class: 'genes-label' }, label), h('span', { class: 'caret' }, '▾')),
      h('span', { class: 'row-check', onclick: () => toggleList(l.id), title: on ? 'Click to exclude this list' : 'Click to include this list' }, checkMark(on)));
  }

  function renderPanel() {
    const l = s.lists.find((x) => x.id === s.open);
    const panel = h('div', { class: 'gene-panel', dataset: { panelFor: l.id } });
    const det = s.details.get(l.id);
    if (!det) {
      panel.append(h('div', { class: 'muted pad' }, 'Loading genes…'));
      return panel;
    }
    const sel = () => s.selected.get(l.id);
    const head = h('div', { class: 'panel-head' }, h('span', { class: 'panel-count' }),
      h('span', { class: 'panel-links' },
        h('button', { class: 'link', onclick: () => setAll(true) }, 'Select all'),
        h('button', { class: 'link', onclick: () => setAll(false) }, 'Clear')));
    const rows = new Map();
    const refresh = () => {
      head.querySelector('.panel-count').textContent = `${count(l)} of ${total(l)} selected`;
      for (const [id, { row, box }] of rows) {
        const on = !sel() || sel().has(id);
        row.classList.toggle('on', on);
        box.replaceChildren(on ? svgIcon(TICK, { size: 12 }) : '');
        box.classList.toggle('on', on);
      }
      const rowEl = root.querySelector(`.list-row[data-list-id="${l.id}"]`);
      if (rowEl) {
        rowEl.classList.toggle('on', s.checked.has(l.id));
        rowEl.querySelector('.genes-label').textContent = isAll(l) ? 'All genes' : `Selected genes (${count(l)})`;
        rowEl.querySelector('.row-check').replaceChildren(checkMark(s.checked.has(l.id)));
      }
      const proceed = root.querySelector('.pill.primary');
      if (proceed) proceed.disabled = selectionOut().length === 0;
    };
    const setGene = (id) => {
      const set = materialise(l.id);
      set.has(id) ? set.delete(id) : set.add(id);
      if (set.size > 0) s.checked.add(l.id); // picking genes implies including the list
      refresh();
    };
    const setAll = (on) => {
      s.selected.set(l.id, on ? null : new Set());
      if (on) s.checked.add(l.id);
      refresh();
    };
    const body = h('div', { class: 'panel-body' }, det.genes.map((g) => {
      const box = h('span', { class: 'check small' });
      const row = h('div', { class: 'gene-row', role: 'checkbox', tabindex: '0', title: 'Click to select / unselect this gene',
        onclick: () => setGene(g.id),
        onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setGene(g.id); } } },
        h('span', { class: 'gene-id' }, g.id),
        h('span', { class: 'gene-desc', title: g.description }, g.description), box);
      rows.set(g.id, { row, box });
      return row;
    }));
    panel.append(head, body);
    refresh();
    queueMicrotask(() => {
      disposeOutside = onOutsideClick([panel, ...root.querySelectorAll('.row-genes')], () => { s.open = null; render(); });
    });
    return panel;
  }

  // ---------- actions ----------
  function toggleList(id) {
    s.checked.has(id) ? s.checked.delete(id) : s.checked.add(id);
    render();
  }
  async function togglePanel(id) {
    s.open = s.open === id ? null : id;
    render();
    if (s.open === id && !s.details.has(id)) {
      try { await details(id); } catch (e) { s.error = e.message; s.open = null; }
      render();
    }
  }

  async function importFile(file, input) {
    if (!file) return;
    s.error = '';
    try {
      if (file.size > MAX_TSV_BYTES) throw new Error('The file is too large (limit 5 MB).');
      const parsed = await api.parseTsv(file.name, await file.text());
      s.imp = { filename: file.name, genes: parsed.genes, warnings: parsed.warnings, name: '', description: '', species: '', busy: false, error: '' };
    } catch (e) {
      s.error = `Could not import "${file.name}": ${e.message}`;
    }
    input.value = '';
    render();
  }

  function renderDetails() {
    const imp = s.imp;
    const name = h('input', { class: 'input', type: 'text', maxlength: '200', value: imp.name, id: 'imp-name',
      placeholder: 'e.g. Drought-response TFs in Pinus sylvestris', 'aria-label': 'List name',
      oninput: (e) => { imp.name = e.target.value; cont.disabled = !valid(); } });
    const species = h('select', { class: 'input select', 'aria-label': 'Species', title: 'Species of the genes in this list',
      onchange: (e) => { imp.species = e.target.value; cont.disabled = !valid(); } },
      h('option', { value: '', disabled: true, selected: !imp.species }, 'Species…'),
      s.species.map((sp) => h('option', { value: sp.code, selected: imp.species === sp.code },
        `${sp.name} (${sp.code})`)));
    const desc = h('textarea', { class: 'input', rows: '4', maxlength: '2000', id: 'imp-desc',
      placeholder: 'Optional — briefly describe the purpose of this list', 'aria-label': 'Description',
      oninput: (e) => { imp.description = e.target.value; } }, imp.description);
    const valid = () => imp.name.trim() && imp.species && !imp.busy;
    const cont = h('button', { class: 'btn-continue', disabled: !valid(), onclick: saveImport }, 'Continue →');
    return h('div', { class: 'details card' },
      h('div', { class: 'eyebrow' }, 'New gene list'),
      h('div', { class: 'details-title-row' }, h('h2', { class: 'details-title' }, 'Name your list'), species),
      h('div', { class: 'details-card' },
        h('label', { class: 'field-label', for: 'imp-name' }, 'List name'), name,
        h('div', { class: 'field-row' }, h('label', { class: 'field-label', for: 'imp-desc' }, 'Description'),
          h('span', { class: 'optional' }, 'Optional')),
        desc),
      h('div', { class: 'import-summary' }, `${imp.genes.length} genes from ${imp.filename}`,
        imp.warnings.map((w) => h('div', { class: 'warn' }, w))),
      imp.error && h('div', { class: 'error', role: 'alert' }, imp.error),
      h('div', { class: 'details-actions' },
        h('button', { class: 'link', onclick: () => { s.imp = null; render(); } }, 'Cancel'), cont));
  }

  async function saveImport() {
    const imp = s.imp;
    imp.busy = true; imp.error = '';
    try {
      const saved = await api.createList({ name: imp.name.trim(), species: imp.species,
        description: imp.description.trim(), genes: imp.genes });
      s.lists.push(saved);
      s.details.set(saved.id, { ...saved, genes: imp.genes });
      s.checked.add(saved.id); // new list: selected, with all its genes
      s.selected.set(saved.id, null);
      s.imp = null;
      s.open = null;
    } catch (e) {
      imp.busy = false;
      imp.error = e.message;
    }
    render();
    root.querySelector(`.list-row[data-list-id="${s.lists.at(-1)?.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  // ---------- init ----------
  const onKey = (e) => { if (e.key === 'Escape') (s.open ? ((s.open = null), render()) : onClose()); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', (e) => { if (e.target === root && !s.imp) onClose(); });

  (async () => {
    render();
    try {
      const [lists, species] = await Promise.all([api.lists(), api.species()]);
      s.species = species;
      const src = lists.find((l) => l.id === listId) || lists[0];
      s.lists = src ? [src, ...lists.filter((l) => l !== src)] : [];
      const prior = (initialSelection || []).filter((p) => lists.some((l) => l.id === p.id));
      if (prior.length) {
        // coming back via "Change selection": show what was selected, genes included
        s.lists = [...lists.filter((l) => prior.some((p) => p.id === l.id)), ...lists.filter((l) => !prior.some((p) => p.id === l.id))];
        for (const p of prior) { s.checked.add(p.id); s.selected.set(p.id, p.gene_ids ? new Set(p.gene_ids) : null); }
      } else if (src) {
        s.checked.add(src.id);
        // genes picked on the list page before clicking "Network graph" -> "Selected genes"
        s.selected.set(src.id, selectedGeneIds?.length ? new Set(selectedGeneIds) : null);
      }
    } catch (e) {
      s.error = e.message;
    }
    s.loading = false;
    render();
  })();

  return { el: root, destroy() { drag.destroy(); disposeOutside(); document.removeEventListener('keydown', onKey); root.remove(); } };
}
