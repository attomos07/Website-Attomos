/* =========================================================
   ORDEN DE LABORATORIO / GARANTÍA — lista de hojas llenadas
   (body[data-doc] = "laboratorio" | "garantia"), sus contadores
   y ver / PDF / imprimir / eliminar sin salir de la página.
   ========================================================= */
(function(){
  // Las dos pestañas (Orden de laboratorio y Garantía) pueden estar en la
  // página a la vez: cada una arranca con su <main data-doc> y sus ids llevan
  // el prefijo de data-pfx ("" o "g"). subnav-tabs vuelve a correr este
  // archivo al montar otra pestaña: cada una arranca una sola vez.
  document.querySelectorAll('main.opt-page[data-doc]').forEach(function(root){
    if (root._booted) return;
    root._booted = true;
    initDocs(root);
  });

function initDocs(ROOT){
  var PFX = ROOT.dataset.pfx || '';
  function $(id){ return document.getElementById(PFX + id); }
  var DOC = ROOT.dataset.doc === 'garantia' ? 'garantia' : 'laboratorio';
  var IS_GAR = DOC === 'garantia';

  function escapeHTML(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function fecha(iso){
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function hora(iso){
    return new Date(iso).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  }
  function normalize(s){ return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function startOfWeek(d){ var s = startOfDay(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; }
  function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  var MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  function parse(v, fb){ if (typeof v === 'string'){ try { return JSON.parse(v); } catch (e){ return fb; } } return v || fb; }

  var all = [];
  var templates = {}; // id -> plantilla (para dibujar la hoja)

  // GARANTÍA o REPARACIÓN (lo que se marcó en TIPO; sin marcar = garantía)
  function tipoOf(s){
    var t = normalize(((s.data || {}).fields || {}).tipo);
    return (/reparacion/.test(t) && !/garantia/.test(t)) ? 'reparacion' : 'garantia';
  }

  // Graduación de la orden: SPH / CYL / AXIS de R y L
  function rxSummary(s){
    var t = templates[s.templateId];
    var data = s.data || {};
    if (!t) return '';
    var els = parse(t.elements, []);
    var out = [];
    els.forEach(function(el){
      if (out.length || el.type !== 'table') return;
      var hs = (el.headers || []).map(normalize);
      var iS = hs.findIndex(function(h){ return /^(sph|esf)/.test(h); });
      if (iS < 0) return;
      var iC = hs.findIndex(function(h){ return /^(cyl|cil)/.test(h); });
      var iA = hs.findIndex(function(h){ return /^(axis|eje)/.test(h); });
      var rows = (data.tables || {})[el.id] || [];
      rows.forEach(function(r, ri){
        if (!r) return;
        var parts = [r[iS], iC >= 0 ? r[iC] : '', iA >= 0 && r[iA] ? 'x' + r[iA] : ''].filter(function(v){ return v && String(v).trim(); });
        if (parts.length) out.push('<b>' + escapeHTML((el.rowLabels || [])[ri] || '') + '</b> ' + escapeHTML(parts.join(' ')));
      });
    });
    return out.join(' · ');
  }

  /* ---------- contadores ---------- */
  function renderStats(){
    var now = new Date(), t0 = startOfDay(now), m0 = startOfMonth(now);
    var today = 0, month = 0, gar = 0, rep = 0, staff = {}, garBy = {};
    all.forEach(function(s){
      var d = new Date(s.createdAt);
      if (d >= t0) today++;
      if (d >= m0){
        month++;
        var who = (s.createdByName || '').trim() || 'Sin nombre';
        staff[who] = (staff[who] || 0) + 1;
        if (IS_GAR){
          if (tipoOf(s) === 'garantia'){ gar++; garBy[who] = (garBy[who] || 0) + 1; } else rep++;
        }
      }
    });
    var noun = IS_GAR ? ['hoja', 'hojas'] : ['orden', 'órdenes'];
    $('dsToday').textContent = today;
    $('dsTodaySub').textContent = today === 1 ? noun[0] : noun[1];
    $('dsMonth').textContent = month;
    $('dsMonthSub').textContent = (month === 1 ? noun[0] : noun[1]) + ' en ' + MONTHS[now.getMonth()];
    if (IS_GAR){
      $('dsGar').textContent = gar;
      $('dsGarSub').textContent = (gar === 1 ? 'garantía' : 'garantías') + (rep ? ' · ' + rep + (rep === 1 ? ' reparación' : ' reparaciones') : '');
    } else {
      $('dsTotal').textContent = all.length;
    }
    var names = Object.keys(staff).sort(function(a, b){ return staff[b] - staff[a] || a.localeCompare(b); });
    var max = names.length ? staff[names[0]] : 0;
    $('dsStaff').innerHTML = names.length ? names.map(function(n){
      return '<li class="' + (IS_GAR ? 'has-gar' : '') + '"><span class="ev-staff-name">' + escapeHTML(n) + '</span>' +
        '<span class="ev-staff-bar"><span style="width:' + Math.round(staff[n] / max * 100) + '%"></span></span>' +
        '<strong title="Hojas este mes">' + staff[n] + '</strong>' +
        (IS_GAR ? '<em class="ev-staff-gar' + (garBy[n] ? '' : ' is-zero') + '" title="Garantías este mes">' + (garBy[n] || 0) + '</em>' : '') +
        '</li>';
    }).join('') : '<li class="ev-staff-empty">Todavía no hay ' + noun[1] + ' este mes.</li>';
  }

  /* ---------- tabla ---------- */
  var listEl = $('docList');
  var countEl = $('docCount');
  var emptyEl = $('docEmpty');
  var searchInput = $('docSearch');
  var periodSel = $('docPeriod');
  var staffSel = $('docStaff');
  var typeSel = $('docType');

  function rowMenu(s){
    return '<div class="row-menu">' +
      '<button type="button" class="row-menu-btn" aria-label="Más acciones" aria-haspopup="true" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>' +
      '</button>' +
      '<div class="row-menu-dropdown">' +
        '<button type="button" class="row-menu-item" data-doc-act="ver" data-id="' + s.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg> Ver</button>' +
        '<a class="row-menu-item" href="' + '/optometria/nuevo?doc=' + (IS_GAR ? 'garantia' : 'laboratorio') + '&edit=' + s.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Editar</a>' +
        '<button type="button" class="row-menu-item" data-doc-act="pdf" data-id="' + s.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg> Exportar PDF</button>' +
        '<button type="button" class="row-menu-item" data-doc-act="print" data-id="' + s.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg> Imprimir</button>' +
        (s.examId ? '<a class="row-menu-item" href="/optometria/examen/' + s.examId + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg> Ver su examen</a>' : '') +
        '<div class="row-menu-sep"></div>' +
        '<button type="button" class="row-menu-item row-menu-item--danger" data-doc-act="delete" data-id="' + s.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg> Eliminar</button>' +
      '</div>' +
    '</div>';
  }

  function filtered(){
    var q = normalize(searchInput.value);
    var period = periodSel ? periodSel.value : 'all';
    var who = staffSel ? staffSel.value : '';
    var tipo = typeSel ? typeSel.value : '';
    var now = new Date();
    var from = period === 'today' ? startOfDay(now) : period === 'week' ? startOfWeek(now) : period === 'month' ? startOfMonth(now) : null;
    return all.filter(function(s){
      if (q && normalize(s.patientName).indexOf(q) < 0 && normalize(s.patientPhone).indexOf(q) < 0 &&
          !(s.folio && String(s.folio) === q.replace(/^n[ºo°]?\s*/, ''))) return false;
      if (from && new Date(s.createdAt) < from) return false;
      if (who && (s.createdByName || '') !== who) return false;
      if (tipo && tipoOf(s) !== tipo) return false;
      return true;
    });
  }

  function render(){
    var list = filtered();
    countEl.textContent = all.length
      ? (list.length === all.length ? all.length + (IS_GAR ? (all.length === 1 ? ' hoja registrada' : ' hojas registradas') : (all.length === 1 ? ' orden registrada' : ' órdenes registradas'))
                                    : list.length + ' de ' + all.length)
      : 'Todavía no hay ninguna.';
    emptyEl.style.display = all.length ? 'none' : 'block';
    emptyEl.innerHTML = IS_GAR
      ? 'Todavía no hay garantías ni reparaciones. Usa <strong>Nueva garantía</strong> para llenar la primera.'
      : 'Todavía no hay órdenes de laboratorio. Usa <strong>Nueva orden</strong> para llenar la primera.';
    listEl.innerHTML = list.length ? list.map(function(s){
      var third = IS_GAR
        ? (tipoOf(s) === 'garantia' ? '<span class="doc-tag is-gar">Garantía</span>' : '<span class="doc-tag">Reparación</span>')
        : '<span class="doc-rx">' + (rxSummary(s) || '<span class="doc-muted">—</span>') + '</span>';
      return '<tr>' +
        '<td>' + (s.folio ? '<span class="doc-folio">Nº ' + s.folio + '</span>' : '') +
          '<button type="button" class="exam-table-link doc-open" data-doc-act="ver" data-id="' + s.id + '">' + escapeHTML(s.patientName || 'Sin nombre') + '</button>' +
          (s.patientPhone ? '<div class="doc-muted">' + escapeHTML(s.patientPhone) + '</div>' : '') + '</td>' +
        '<td class="exam-table-date">' + fecha(s.createdAt) + '<div class="doc-muted">' + hora(s.createdAt) + '</div></td>' +
        '<td>' + third + '</td>' +
        '<td class="exam-table-by">' + escapeHTML(s.createdByName || '—') + '</td>' +
        '<td class="exam-table-actions">' + rowMenu(s) + '</td>' +
      '</tr>';
    }).join('') : (all.length ? '<tr><td colspan="5" class="exam-table-none">Ninguna coincide con los filtros.</td></tr>' : '');
  }

  function fillStaff(){
    if (!staffSel) return;
    var names = {};
    all.forEach(function(s){ if (s.createdByName) names[s.createdByName] = true; });
    var cur = staffSel.value;
    staffSel.innerHTML = '<option value="">Todos</option>' + Object.keys(names).sort().map(function(n){
      return '<option value="' + escapeHTML(n) + '"' + (n === cur ? ' selected' : '') + '>' + escapeHTML(n) + '</option>';
    }).join('');
    if (window.AvSelect && AvSelect.refresh) AvSelect.refresh(staffSel);
  }

  function loadTemplates(){
    var ids = {};
    all.forEach(function(s){ if (!(s.templateId in templates)) ids[s.templateId] = true; });
    return Promise.all(Object.keys(ids).map(function(id){
      return fetch('/api/optometria/plantillas/' + id, { headers: { Accept: 'application/json' } })
        .then(function(r){ return r.ok ? r.json() : null; })
        .catch(function(){ return null; })
        .then(function(t){ templates[id] = t; });
    }));
  }

  function load(first){
    return fetch('/api/optometria/ordenes-lab?kind=' + DOC, { headers: { Accept: 'application/json' } })
      .then(function(r){ if (!r.ok) throw new Error(); return r.json(); })
      .then(function(list){
        all = (list || []).map(function(s){ s.data = parse(s.data, { fields: {}, tables: {} }); return s; });
        return loadTemplates();
      })
      .then(function(){
        renderStats();
        if (first){ fillStaff(); render(); }
        else if (!document.querySelector('.row-menu.is-open')) render();
      })
      .catch(function(){ countEl.textContent = 'No se pudieron cargar las hojas.'; });
  }

  [searchInput, periodSel, staffSel, typeSel].forEach(function(el){
    if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', render);
  });
  if (window.AvSelect) AvSelect.enhanceAll(ROOT);
  load(true);
  setInterval(function(){ if (ROOT.offsetParent) load(false); }, 60000);
  if (window.AttomosLive) AttomosLive.on(['optometria', 'lab'], function(){ if (ROOT.offsetParent) load(false); });
  // Al volver a la pestaña (subnav-tabs) se recarga en silencio.
  ROOT.addEventListener('subnav:show', function(){ load(false); });

  // Aviso al volver de guardar una hoja
  (function(){
    var p = new URLSearchParams(location.search);
    if (location.pathname.indexOf(IS_GAR ? '/garantias' : '/ordenes-lab') < 0) return;
    if (p.get('ok') === '1' || p.get('editado') === '1'){
      var st = $('docStatus');
      st.textContent = p.get('editado') === '1' ? 'Cambios guardados ✓' : IS_GAR ? 'Hoja guardada ✓' : 'Orden guardada ✓ · ya le llegó al laboratorio';
      st.className = 'tpl-status ok';
      try { history.replaceState(history.state, '', location.pathname); } catch (err) {}
      setTimeout(function(){ st.textContent = ''; st.className = 'tpl-status'; }, 4000);
    }
  })();

  /* ---------- ver / PDF / imprimir / eliminar ---------- */
  function srcOf(s){
    // El modal de exámenes sirve igual para estas hojas.
    return { exam: s, template: templates[s.templateId] || null };
  }
  function subtitle(s){
    var parts = [fecha(s.createdAt) + ', ' + hora(s.createdAt)];
    if (s.createdByName) parts.push('Llenó ' + s.createdByName);
    if (s.updatedAt) parts.push('Editada ' + fecha(s.updatedAt) + (s.updatedByName ? ' por ' + s.updatedByName : ''));
    if (IS_GAR) parts.push(tipoOf(s) === 'garantia' ? 'Garantía' : 'Reparación');
    else parts.push('Orden de laboratorio' + (s.folio ? ' Nº ' + s.folio : ''));
    return parts.join(' · ');
  }
  var pendingDelete = null;
  var delModal = $('deleteDocModal');
  function closeDel(){ delModal.classList.remove('open'); document.body.style.overflow = ''; pendingDelete = null; }
  $('deleteDocClose').addEventListener('click', closeDel);
  $('deleteDocCancel').addEventListener('click', closeDel);
  delModal.addEventListener('click', function(e){ if (e.target === delModal) closeDel(); });
  $('deleteDocConfirm').addEventListener('click', function(){
    if (!pendingDelete) return;
    var b = this; b.disabled = true;
    fetch('/api/optometria/ordenes-lab/' + pendingDelete, { method: 'DELETE', headers: { Accept: 'application/json' } })
      .then(function(r){ if (!r.ok) throw new Error(); })
      .then(function(){
        var id = pendingDelete;
        all = all.filter(function(s){ return String(s.id) !== String(id); });
        closeDel(); renderStats(); render();
      })
      .catch(function(){ AvanteExamModal.toast('No se pudo eliminar. Intenta de nuevo.'); })
      .finally(function(){ b.disabled = false; });
  });

  ROOT.addEventListener('click', function(e){
    var a = e.target.closest('[data-doc-act]');
    if (!a) return;
    var s = all.filter(function(x){ return String(x.id) === a.dataset.id; })[0];
    if (!s) return;
    document.querySelectorAll('.row-menu.is-open').forEach(function(m){ m.classList.remove('is-open'); });
    var act = a.dataset.docAct;
    if (act === 'ver') AvanteExamModal.open(srcOf(s), { subtitle: subtitle(s), editUrl: '/optometria/nuevo?doc=' + (IS_GAR ? 'garantia' : 'laboratorio') + '&edit=' + s.id });
    else if (act === 'pdf') AvanteExamModal.exportPdf(srcOf(s));
    else if (act === 'print') AvanteExamModal.print(srcOf(s));
    else if (act === 'delete'){
      pendingDelete = s.id;
      $('deleteDocName').textContent = s.patientName || 'esta persona';
      delModal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  });

  if (window.feather) feather.replace();
}
})();