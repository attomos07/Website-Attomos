/* Editor de artículos del blog (panel admin de Attomos).
   Portado del editor del panel de Avante: negrita/cursiva/subrayado a mano,
   bloques, listas, enlaces, resaltado, tips, imágenes y programación. */
/* ---------- editor de texto enriquecido (tipo Word) ---------- */
(function(){
  var toolbar = document.getElementById('cbToolbar');
  var surface = document.getElementById('cbEditorSurface');
  var hiddenTextarea = document.getElementById('blogContent');
  if (!toolbar || !surface || !hiddenTextarea) return;

  // Quita <b>/<i>/<u> vacíos (solo con el caracter invisible que usa
  // toggleInlineTag para "abrir" el formato) — si el admin activó negrita
  // pero nunca llegó a escribir nada ahí, no debe quedar guardado ni debe
  // verse el botón activo por default al volver a abrir la entrada.
  //
  // Importante: se salta la etiqueta donde el cursor está posicionado
  // ahora mismo (el formato "recién activado", esperando a que se
  // escriba algo adentro) — si no, se borraría apenas se activa. Todo
  // lo demás que haya quedado vacío y "abandonado" sí se limpia, para
  // que no se quede flotando en medio del texto real: si un tag vacío
  // así se queda ahí mientras sigues escribiendo o haciendo doble/triple
  // clic para seleccionar palabras, el navegador puede terminar
  // metiendo texto real dentro de él y se ve negrita/cursiva sin que
  // el admin lo haya pedido.
  function stripEmptyFormatTags(root){
    var sel = window.getSelection();
    var caretNode = (sel && sel.rangeCount) ? sel.anchorNode : null;
    root.querySelectorAll('b, i, u').forEach(function(el){
      if (el.textContent.replace(/\u200B/g, '') !== '') return;
      if (caretNode && el.contains(caretNode)) return;
      el.remove();
    });
    root.normalize();
  }

  // Precarga: el textarea oculto ya trae el HTML guardado (si es edición),
  // decodificado de forma segura por el propio navegador al leer .value.
  if (hiddenTextarea.value.trim()) {
    surface.innerHTML = hiddenTextarea.value;
  }
  stripEmptyFormatTags(surface);

  var ALIGN_CMDS = ['justifyLeft', 'justifyCenter', 'justifyRight'];

  // ---------- Negrita/cursiva/subrayado hechos a mano (sin execCommand) ----------
  // document.execCommand('bold'/'italic'/'underline') resultó poco confiable:
  // el botón se marcaba activo pero el texto no cambiaba. Esta versión
  // envuelve/desenvuelve el texto directamente con <b>/<i>/<u>.
  var TAG_BY_CMD = { bold: 'B', italic: 'I', underline: 'U' };

  function isFormatActive(tagName){
    // Editor genuinamente vacío (sin texto real todavía): nunca marcar
    // ningún botón como activo de entrada, sin importar qué diga la
    // selección del navegador en ese estado.
    if (surface.textContent.replace(/\u200B/g, '').trim() === '') return false;
    var sel = window.getSelection();
    if (!sel.rangeCount) return false;
    var node = sel.anchorNode;
    while (node && node !== surface) {
      if (node.nodeType === 1 && node.tagName === tagName) return true;
      node = node.parentNode;
    }
    return false;
  }

  function findAncestorTag(node, tagName){
    while (node && node !== surface) {
      if (node.nodeType === 1 && node.tagName === tagName) return node;
      node = node.parentNode;
    }
    return null;
  }

  function toggleInlineTag(tagName){
    surface.focus();
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);

    if (range.collapsed) {
      var existingTag = findAncestorTag(range.startContainer, tagName);
      if (existingTag) {
        // Ya estás "dentro" del formato con el cursor: sácalo. OJO — no
        // basta con mover el cursor a un punto "después" del elemento
        // (un límite entre nodos); varios navegadores igual siguen
        // escribiendo dentro del <b> si el cursor solo toca su borde.
        // Por eso se inserta un caracter real en un nodo de texto nuevo,
        // fuera del <b>, y el cursor se deja DENTRO de ese nodo — así
        // escribir ahí extiende ese texto plano, no el <b>.
        var marker = document.createTextNode('\u200B');
        if (existingTag.nextSibling) {
          existingTag.parentNode.insertBefore(marker, existingTag.nextSibling);
        } else {
          existingTag.parentNode.appendChild(marker);
        }
        var after = document.createRange();
        after.setStart(marker, 1);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      } else {
        // sin texto seleccionado: crea el tag vacío y mete el cursor
        // adentro, así lo próximo que escribas queda envuelto.
        var el = document.createElement(tagName);
        el.appendChild(document.createTextNode('\u200B'));
        range.insertNode(el);
        var newRange = document.createRange();
        newRange.setStart(el.firstChild, 1);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
      return;
    }

    // hay texto seleccionado: si ya está completamente envuelto en ese
    // tag, lo desenvuelve; si no, lo envuelve.
    var commonTag = findAncestorTag(range.commonAncestorContainer, tagName);
    if (commonTag && commonTag.textContent === range.toString()) {
      var parent = commonTag.parentNode;
      while (commonTag.firstChild) parent.insertBefore(commonTag.firstChild, commonTag);
      parent.removeChild(commonTag);
      return;
    }

    try {
      var contents = range.extractContents();
      var wrapper = document.createElement(tagName);
      wrapper.appendChild(contents);
      range.insertNode(wrapper);
      var newRange2 = document.createRange();
      newRange2.selectNodeContents(wrapper);
      sel.removeAllRanges();
      sel.addRange(newRange2);
    } catch(e) {
      // caso raro (selección cruza estructuras complejas): último recurso.
      try { document.execCommand(tagName === 'B' ? 'bold' : tagName === 'I' ? 'italic' : 'underline', false, null); }
      catch(e2) { /* ignorado */ }
    }
  }

  var highlightWrap = document.getElementById('cbHighlightWrap');
  var highlightBtn = document.getElementById('cbHighlightBtn');
  var highlightPalette = document.getElementById('cbHighlightPalette');

  function closeHighlightPalette(){
    highlightWrap && highlightWrap.classList.remove('is-open');
  }
  highlightBtn && highlightBtn.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    highlightWrap.classList.toggle('is-open');
  });
  document.addEventListener('click', function(e){
    if (highlightWrap && !highlightWrap.contains(e.target)) closeHighlightPalette();
  });

  /* ---------- modal genérico (enlace, título del tip, descripción de imagen) ---------- */
  var linkModalOverlay = document.getElementById('cbLinkModalOverlay');
  var linkInput = document.getElementById('cbLinkInput');
  var linkModalError = document.getElementById('cbLinkModalError');
  var linkModalTitle = document.getElementById('cbLinkModalTitle');
  var linkModalHint = document.getElementById('cbLinkModalHint');
  var linkModalConfirm = document.getElementById('cbLinkModalConfirm');
  var savedRange = null;
  var promptState = null;

  function saveRange(){
    var sel = window.getSelection();
    if (sel && sel.rangeCount && surface.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    } else {
      savedRange = null;
    }
  }
  function restoreRange(){
    surface.focus();
    var sel = window.getSelection();
    sel.removeAllRanges();
    if (savedRange) {
      sel.addRange(savedRange);
    } else {
      var r = document.createRange();
      r.selectNodeContents(surface);
      r.collapse(false);
      sel.addRange(r);
    }
  }

  function openPrompt(opts){
    return new Promise(function(resolve){
      promptState = { opts: opts, resolve: resolve };
      linkModalTitle.textContent = opts.title;
      linkModalHint.textContent = opts.hint || '';
      linkInput.placeholder = opts.placeholder || '';
      linkInput.value = opts.value || '';
      linkModalConfirm.textContent = opts.confirmText || 'Insertar';
      linkModalError.textContent = '';
      linkModalError.classList.remove('show');
      linkModalOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      setTimeout(function(){ linkInput.focus(); linkInput.select(); }, 10);
    });
  }
  function closePrompt(value){
    linkModalOverlay.classList.remove('open');
    document.body.style.overflow = '';
    var st = promptState;
    promptState = null;
    if (st) st.resolve(value);
  }
  function confirmPrompt(){
    if (!promptState) return;
    var v = (linkInput.value || '').trim();
    if (!v && !promptState.opts.allowEmpty) {
      linkModalError.textContent = promptState.opts.emptyError || 'Escribe un valor.';
      linkModalError.classList.add('show');
      linkInput.focus();
      return;
    }
    closePrompt(v);
  }

  linkModalConfirm.addEventListener('click', confirmPrompt);
  document.getElementById('cbLinkModalCancel').addEventListener('click', function(){ closePrompt(null); });
  document.getElementById('cbLinkModalClose').addEventListener('click', function(){ closePrompt(null); });
  linkModalOverlay.addEventListener('click', function(e){ if (e.target === linkModalOverlay) closePrompt(null); });
  linkInput.addEventListener('keydown', function(e){
    if (e.key === 'Enter') { e.preventDefault(); confirmPrompt(); }
    if (e.key === 'Escape') { e.preventDefault(); closePrompt(null); }
  });

  function escAttr(s){
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function insertLink(){
    saveRange();
    openPrompt({ title: 'Insertar enlace', hint: 'Pega la URL a la que quieres dirigir el texto seleccionado.', placeholder: 'https://...', emptyError: 'Escribe una URL.' })
      .then(function(url){
        if (!url) return;
        if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) url = 'https://' + url;
        restoreRange();
        var sel = window.getSelection();
        if (sel.isCollapsed) {
          document.execCommand('insertHTML', false, '<a href="' + escAttr(url) + '">' + escAttr(url) + '</a>');
        } else {
          document.execCommand('createLink', false, url);
        }
        // Enlaces externos en pestaña nueva
        surface.querySelectorAll('a[href^="http"]').forEach(function(a){
          if (a.host && a.host !== window.location.host) { a.target = '_blank'; a.rel = 'noopener'; }
        });
        refreshToolbarState();
      });
  }

  // Inserta un bloque (tip, imagen) después del bloque donde está el cursor.
  // Se hace con DOM y no con insertHTML porque Chrome "aplana" los <div>
  // dentro de un <p> y los convierte en <span style>.
  function topBlock(node){
    while (node && node.parentNode !== surface) node = node.parentNode;
    return node && node.parentNode === surface ? node : null;
  }
  function insertBlocks(nodes, caretTarget){
    restoreRange();
    var sel = window.getSelection();
    var anchor = sel.rangeCount ? topBlock(sel.getRangeAt(0).startContainer) : null;
    var empty = anchor && anchor.textContent.replace(/​/g, '').trim() === '' && !anchor.querySelector('img');
    var ref = anchor ? anchor.nextSibling : null;
    nodes.forEach(function(n){ surface.insertBefore(n, ref); });
    if (empty) anchor.remove();
    var after = nodes[nodes.length - 1];
    if (!after.nextSibling) {
      var p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      surface.appendChild(p);
    }
    var r = document.createRange();
    var target = caretTarget || after.nextSibling;
    r.selectNodeContents(target);
    r.collapse(!caretTarget);
    sel.removeAllRanges();
    sel.addRange(r);
    surface.focus();
    window.cbDirty = true;
    refreshToolbarState();
  }
  function ensureParagraph(){
    if (surface.innerHTML.replace(/<br\s*\/?>/g, '').trim() === '') {
      surface.innerHTML = '<p><br></p>';
      var r = document.createRange();
      r.setStart(surface.firstChild, 0);
      r.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
  surface.addEventListener('focus', ensureParagraph);
  surface.addEventListener('keydown', function(){ if (!surface.firstChild) ensureParagraph(); });

  function insertTip(){
    saveRange();
    var selected = savedRange ? savedRange.toString().trim() : '';
    openPrompt({ title: 'Caja de tip', hint: 'Título de la caja destacada (por ejemplo "Tip", "Importante" o "Dato").', placeholder: 'Tip', value: 'Tip', confirmText: 'Agregar', allowEmpty: true })
      .then(function(title){
        if (title === null) return;
        var tip = document.createElement('div');
        tip.className = 'bd-tip';
        tip.setAttribute('data-title', title || 'Tip');
        var tp = document.createElement('p');
        tp.textContent = selected || 'Escribe aquí el consejo.';
        tip.appendChild(tp);
        if (selected && savedRange) { savedRange.deleteContents(); }
        insertBlocks([tip], tp);
        refreshToolbarState();
      });
  }

  var inlineInput = document.getElementById('cbInlineImage');
  function insertImage(){
    saveRange();
    inlineInput.value = '';
    inlineInput.click();
  }
  inlineInput.addEventListener('change', function(){
    var file = inlineInput.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { window.cbToast('La imagen pesa más de 8 MB.', true); return; }
    var btn = toolbar.querySelector('[data-cmd="insertImage"]');
    btn.classList.add('cb-uploading');
    var fd = new FormData();
    fd.append('image', file);
    fetch('/admin/api/blog-imagen', { method: 'POST', body: fd, credentials: 'include' })
      .then(function(res){ return res.json().then(function(d){ if (!res.ok) throw new Error(d.error || 'No se pudo subir la imagen.'); return d; }); })
      .then(function(data){
        return openPrompt({ title: 'Descripción de la imagen', hint: 'Texto alternativo para Google y lectores de pantalla (opcional).', placeholder: 'Ej. Panel de Attomos con un agente conectado', confirmText: 'Insertar', allowEmpty: true })
          .then(function(alt){
            var img = document.createElement('img');
            img.src = data.url;
            img.alt = alt || '';
            insertBlocks([img]);
          });
      })
      .catch(function(err){ window.cbToast(err.message, true); })
      .then(function(){ btn.classList.remove('cb-uploading'); });
  });

  // Pegar: se queda solo con la estructura básica (sin estilos de Word/Google Docs).
  var ALLOWED = { P:1, H2:1, H3:1, UL:1, OL:1, LI:1, B:1, STRONG:1, I:1, EM:1, U:1, A:1, BLOCKQUOTE:1, BR:1, IMG:1 };
  function cleanNode(node, out){
    node.childNodes.forEach(function(ch){
      if (ch.nodeType === 3) { out.appendChild(document.createTextNode(ch.textContent)); return; }
      if (ch.nodeType !== 1) return;
      var tag = ch.tagName === 'H1' ? 'H2' : (ch.tagName === 'H4' || ch.tagName === 'H5' || ch.tagName === 'H6') ? 'H3' : ch.tagName;
      if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') tag = 'P';
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK') return;
      if (!ALLOWED[tag]) { cleanNode(ch, out); return; }
      if (tag === 'IMG' && !/^(https?:)?\/\//.test(ch.getAttribute('src') || '') && !/^\//.test(ch.getAttribute('src') || '')) return;
      var el = document.createElement(tag);
      if (tag === 'A' && ch.getAttribute('href') && !/^javascript:/i.test(ch.getAttribute('href'))) el.setAttribute('href', ch.getAttribute('href'));
      if (tag === 'IMG') { el.setAttribute('src', ch.getAttribute('src')); el.setAttribute('alt', ch.getAttribute('alt') || ''); }
      cleanNode(ch, el);
      out.appendChild(el);
    });
  }
  surface.addEventListener('paste', function(e){
    var cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    var html = cd.getData('text/html');
    var out;
    if (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var wrap = document.createElement('div');
      cleanNode(doc.body, wrap);
      out = wrap.innerHTML;
    } else {
      var text = cd.getData('text/plain') || '';
      out = text.split(/\n{2,}/).map(function(p){ return '<p>' + escAttr(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
    }
    document.execCommand('insertHTML', false, out);
  });

  toolbar.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    surface.focus();

    var cmd = btn.dataset.cmd;
    if (cmd === 'createLink') { insertLink(); return; }
    if (cmd === 'insertTip') { insertTip(); return; }
    if (cmd === 'insertImage') { insertImage(); return; }
    if (cmd === 'removeFormat') {
      document.execCommand('removeFormat', false, null);
      document.execCommand('unlink', false, null);
      refreshToolbarState();
      return;
    }
    if (cmd === 'formatBlock') {
      document.execCommand('formatBlock', false, '<' + btn.dataset.value + '>');
      refreshToolbarState();
      return;
    }
    if (cmd === 'hiliteColor') {
      var color = btn.dataset.value === 'transparent' ? 'transparent' : btn.dataset.value;
      try { document.execCommand('hiliteColor', false, color); }
      catch(err) { document.execCommand('backColor', false, color); }
      closeHighlightPalette();
      refreshToolbarState();
      return;
    }
    if (ALIGN_CMDS.indexOf(cmd) !== -1) {
      document.execCommand(cmd, false, null);
      // Las 3 alineaciones son mutuamente excluyentes — el estado real
      // de queryCommandState('justifyLeft'/etc.) es poco confiable entre
      // navegadores, así que aquí lo controlamos a mano: se activa la que
      // se acaba de presionar y se apagan las otras dos, sin esperar a
      // que el cursor se mueva dentro del texto.
      toolbar.querySelectorAll('button[data-cmd]').forEach(function(b){
        if (ALIGN_CMDS.indexOf(b.dataset.cmd) !== -1) b.classList.toggle('is-active', b === btn);
      });
      return;
    }
    if (TAG_BY_CMD[cmd]) {
      toggleInlineTag(TAG_BY_CMD[cmd]);
      refreshToolbarState();
      return;
    }
    document.execCommand(cmd, false, null);
    refreshToolbarState();
  });

  // Resalta los botones activos (negrita/cursiva/etc.) según dónde esté el cursor.
  function refreshToolbarState(){
    stripEmptyFormatTags(surface);
    Array.prototype.forEach.call(toolbar.querySelectorAll('button[data-cmd]'), function(btn){
      var cmd = btn.dataset.cmd;
      if (TAG_BY_CMD[cmd]) {
        btn.classList.toggle('is-active', isFormatActive(TAG_BY_CMD[cmd]));
        return;
      }
      if (cmd === 'createLink' || cmd === 'insertTip' || cmd === 'insertImage' || cmd === 'removeFormat' || cmd === 'undo' || cmd === 'redo' || cmd === 'formatBlock' || cmd === 'hiliteColor' || ALIGN_CMDS.indexOf(cmd) !== -1) return;
      try { btn.classList.toggle('is-active', document.queryCommandState(cmd)); }
      catch(e) { /* ignorado */ }
    });
  }
  // mousedown limpia ANTES de que el navegador calcule a qué "palabra"
  // corresponde un doble/triple clic — así ningún tag vacío abandonado
  // sigue ahí para que el navegador lo confunda con texto real.
  surface.addEventListener('mousedown', function(){ stripEmptyFormatTags(surface); });
  surface.addEventListener('keyup', refreshToolbarState);
  surface.addEventListener('mouseup', refreshToolbarState);
  surface.addEventListener('input', function(){ refreshToolbarState(); window.cbDirty = true; });
  document.execCommand('defaultParagraphSeparator', false, 'p');
  surface.addEventListener('focus', function(){
    stripEmptyFormatTags(surface);
    refreshToolbarState();
  });
  surface.addEventListener('blur', function(){
    stripEmptyFormatTags(surface);
    refreshToolbarState();
  });

  // Antes de mandar el form, vuelca el HTML del editor visual al textarea real.
  var form = document.getElementById('blogForm');
  form && form.addEventListener('submit', function(){
    stripEmptyFormatTags(surface);
    hiddenTextarea.value = surface.innerHTML.replace(/\u200B/g, '').replace(/<p><br><\/p>\s*$/,'').trim();
  }, true);
})();

/* ---------- dropdowns personalizados: Estado y Categoría
   (mismo patrón que "Elementos por página" en Configuración) ---------- */
function initRoleSelect(opts){
  var wrap = document.getElementById(opts.wrapId);
  var btn = document.getElementById(opts.btnId);
  var menu = document.getElementById(opts.menuId);
  var label = document.getElementById(opts.labelId);
  var hiddenInput = document.getElementById(opts.hiddenId);
  if (!wrap || !btn || !menu || !hiddenInput) return;

  function closeMenu(){
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function openMenu(){
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    wrap.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('.admin-role-option').forEach(function(opt){
    opt.addEventListener('click', function(){
      menu.querySelectorAll('.admin-role-option').forEach(function(o){ o.classList.remove('active'); });
      opt.classList.add('active');
      hiddenInput.value = opt.dataset.value;
      if (label) label.textContent = opt.textContent;
      closeMenu();
      if (opts.onChange) opts.onChange(opt.dataset.value);
    });
  });

  document.addEventListener('click', function(e){
    if (!wrap.contains(e.target)) closeMenu();
  });

  // Si no hay nada seleccionado todavía (categoría al crear una entrada
  // nueva), se preselecciona la primera opción disponible.
  if (!hiddenInput.value) {
    var first = menu.querySelector('.admin-role-option');
    if (first) {
      first.classList.add('active');
      hiddenInput.value = first.dataset.value;
      if (label) label.textContent = first.textContent;
    }
  }
}

initRoleSelect({
  wrapId: 'statusSelectWrap', btnId: 'statusSelectBtn', menuId: 'statusSelectMenu',
  labelId: 'statusSelectLabel', hiddenId: 'blogStatus',
  onChange: function(){ syncSchedule(); }
});
initRoleSelect({
  wrapId: 'categorySelectWrap', btnId: 'categorySelectBtn', menuId: 'categorySelectMenu',
  labelId: 'categorySelectLabel', hiddenId: 'blogCategory'
});

/* ---------- programación de publicación (solo si estado = publicado) ---------- */
var cbSchedule = document.getElementById('cbSchedule');
function syncSchedule(){
  var statusVal = document.getElementById('blogStatus').value;
  cbSchedule && cbSchedule.classList.toggle('is-open', statusVal === 'publicado');
}
syncSchedule();

/* ---------- time-picker (Hora) ---------- */
(function(){
  var wrap = document.getElementById('timePickerWrap');
  var btn = document.getElementById('timePickerBtn');
  var menu = document.getElementById('timePickerMenu');
  var label = document.getElementById('timePickerLabel');
  var hiddenInput = document.getElementById('blogPublishedTime');
  if (!wrap || !btn || !menu || !hiddenInput) return;

  function formatTime12(t){
    var parts = t.split(':').map(Number);
    var h = parts[0], m = parts[1];
    var period = h >= 12 ? 'p.m.' : 'a.m.';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + String(m).padStart(2, '0') + ' ' + period;
  }
  function buildOptions(){
    var opts = [];
    for (var mins = 0; mins < 24 * 60; mins += 30){
      var h = String(Math.floor(mins / 60)).padStart(2, '0');
      var mm = String(mins % 60).padStart(2, '0');
      opts.push(h + ':' + mm);
    }
    return opts;
  }
  var TIME_OPTIONS = buildOptions();

  menu.innerHTML = TIME_OPTIONS.map(function(t){
    return '<button type="button" class="time-picker-option' + (t === hiddenInput.value ? ' active' : '') + '" data-time="' + t + '">' + formatTime12(t) + '</button>';
  }).join('');

  function setValue(t){
    hiddenInput.value = t;
    label.textContent = formatTime12(t);
    menu.querySelectorAll('.time-picker-option').forEach(function(opt){
      opt.classList.toggle('active', opt.dataset.time === t);
    });
  }
  if (hiddenInput.value) setValue(hiddenInput.value);

  function open(){
    closeAllPickers();
    wrap.classList.add('is-open');
    var active = menu.querySelector('.time-picker-option.active');
    if (active) active.scrollIntoView({ block: 'center' });
  }
  function close(){ wrap.classList.remove('is-open'); }

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    wrap.classList.contains('is-open') ? close() : open();
  });
  menu.addEventListener('click', function(e){
    var opt = e.target.closest('.time-picker-option');
    if (!opt) return;
    setValue(opt.dataset.time);
    close();
  });
})();

/* ---------- date-picker (Fecha de publicación) ---------- */
(function(){
  var wrap = document.getElementById('datePickerWrap');
  var btn = document.getElementById('datePickerBtn');
  var menu = document.getElementById('datePickerMenu');
  var label = document.getElementById('datePickerLabel');
  var hiddenInput = document.getElementById('blogPublishedDate');
  var grid = document.getElementById('dpGrid');
  var monthLabel = document.getElementById('dpMonthLabel');
  if (!wrap || !btn || !menu || !hiddenInput || !grid) return;

  var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var today = new Date();
  var selected = hiddenInput.value ? hiddenInput.value.split('-').map(Number) : null; // [Y,M,D] M=1-12
  var viewYear = selected ? selected[0] : today.getFullYear();
  var viewMonth = selected ? selected[1] - 1 : today.getMonth();

  function pad(n){ return String(n).padStart(2, '0'); }
  function iso(y, m, d){ return y + '-' + pad(m + 1) + '-' + pad(d); }
  function displayLabel(y, m, d){ return pad(d) + '/' + pad(m + 1) + '/' + y; }

  function render(){
    monthLabel.textContent = MESES[viewMonth] + ' de ' + viewYear;

    var firstOfMonth = new Date(viewYear, viewMonth, 1);
    var startOffset = firstOfMonth.getDay(); // 0=domingo
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    var totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    var todayISO = iso(today.getFullYear(), today.getMonth(), today.getDate());
    var selectedISO = selected ? iso(selected[0], selected[1] - 1, selected[2]) : null;

    var html = '';
    for (var i = 0; i < totalCells; i++) {
      var dayNum, cellYear = viewYear, cellMonth = viewMonth, outside = false;
      if (i < startOffset) { dayNum = daysInPrevMonth - (startOffset - 1 - i); cellMonth -= 1; outside = true; }
      else if (i >= startOffset + daysInMonth) { dayNum = i - (startOffset + daysInMonth) + 1; cellMonth += 1; outside = true; }
      else { dayNum = i - startOffset + 1; }
      if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
      if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
      var cellISO = iso(cellYear, cellMonth, dayNum);
      var cls = 'cb-datepicker-day';
      if (outside) cls += ' is-outside';
      if (cellISO === todayISO) cls += ' is-today';
      if (cellISO === selectedISO) cls += ' is-selected';
      html += '<button type="button" class="' + cls + '" data-iso="' + cellISO + '">' + dayNum + '</button>';
    }
    grid.innerHTML = html;
  }

  function setValue(y, m, d){ // m: 0-11
    selected = [y, m + 1, d];
    hiddenInput.value = iso(y, m, d);
    label.textContent = displayLabel(y, m, d);
  }
  if (selected) setValue(selected[0], selected[1] - 1, selected[2]);

  document.getElementById('dpPrev').addEventListener('click', function(){
    viewMonth -= 1; if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; } render();
  });
  document.getElementById('dpNext').addEventListener('click', function(){
    viewMonth += 1; if (viewMonth > 11) { viewMonth = 0; viewYear += 1; } render();
  });
  document.getElementById('dpToday').addEventListener('click', function(){
    viewYear = today.getFullYear(); viewMonth = today.getMonth();
    setValue(today.getFullYear(), today.getMonth(), today.getDate());
    render();
  });
  document.getElementById('dpClear').addEventListener('click', function(){
    selected = null;
    hiddenInput.value = '';
    label.textContent = 'dd/mm/aaaa';
    render();
  });
  grid.addEventListener('click', function(e){
    var day = e.target.closest('.cb-datepicker-day');
    if (!day) return;
    var parts = day.dataset.iso.split('-').map(Number);
    setValue(parts[0], parts[1] - 1, parts[2]);
    close();
  });

  function open(){ closeAllPickers(); render(); wrap.classList.add('is-open'); }
  function close(){ wrap.classList.remove('is-open'); }

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    wrap.classList.contains('is-open') ? close() : open();
  });
})();

function closeAllPickers(){
  document.querySelectorAll('.time-picker.is-open, .cb-datepicker.is-open').forEach(function(p){ p.classList.remove('is-open'); });
}
document.addEventListener('click', function(e){
  if (!e.target.closest('.time-picker, .cb-datepicker')) closeAllPickers();
});

/* ---------- dropzone de portada ---------- */
(function(){
  var drop = document.getElementById('blogUploadDrop');
  var input = document.getElementById('blogImageInput');
  var preview = document.getElementById('blogUploadPreview');
  var placeholder = document.getElementById('blogUploadPlaceholder');
  if (!drop || !input) return;

  function showFile(file){
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { window.cbToast('La portada pesa más de 8 MB.', true); input.value = ''; return; }
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) { window.cbToast('Usa una imagen JPG, PNG, WebP o GIF.', true); input.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function(e){
      preview.src = e.target.result;
      preview.classList.remove('is-hidden');
      placeholder.classList.add('is-hidden');
    };
    reader.readAsDataURL(file);
  }

  drop.addEventListener('click', function(){ input.click(); });
  drop.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', function(){ showFile(input.files[0]); });

  ['dragenter', 'dragover'].forEach(function(evt){
    drop.addEventListener(evt, function(e){
      e.preventDefault(); e.stopPropagation();
      drop.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function(evt){
    drop.addEventListener(evt, function(e){
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove('is-dragover');
    });
  });
  drop.addEventListener('drop', function(e){
    var file = e.dataTransfer.files[0];
    if (!file) return;
    input.files = e.dataTransfer.files;
    showFile(file);
  });
})();

/* ---------- submit: crear o editar según data-blog-id ---------- */
(function(){
  var form = document.getElementById('blogForm');
  var errorEl = document.getElementById('blogFormError');
  var submitBtn = document.getElementById('blogSubmitBtn');
  if (!form) return;

  form.addEventListener('input', function(){ window.cbDirty = true; });
  form.addEventListener('change', function(){ window.cbDirty = true; });
  window.addEventListener('beforeunload', function(e){
    if (!window.cbDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    errorEl.textContent = '';

    var title = document.getElementById('blogTitle');
    if (!title.value.trim()) {
      errorEl.textContent = 'Escribe el título.';
      title.focus();
      return;
    }
    var surface = document.getElementById('cbEditorSurface');
    if (surface && surface.textContent.replace(/​/g, '').trim() === '' && !surface.querySelector('img')) {
      errorEl.textContent = 'Escribe el contenido del artículo.';
      return;
    }
    var preview = document.getElementById('blogUploadPreview');
    var input = document.getElementById('blogImageInput');
    if ((!input.files || !input.files.length) && preview.classList.contains('is-hidden')) {
      errorEl.textContent = 'Sube una imagen de portada.';
      return;
    }

    var blogId = form.dataset.blogId;
    var formData = new FormData(form);
    if (!input.files || !input.files.length) formData.delete('cover');

    var url = blogId ? ('/admin/api/blog/' + blogId) : '/admin/api/blog';
    var method = blogId ? 'PUT' : 'POST';

    submitBtn.disabled = true;
    var original = submitBtn.textContent;
    submitBtn.textContent = 'Guardando...';

    fetch(url, { method: method, body: formData, credentials: 'include' })
      .then(function(res){
        return res.json().catch(function(){ return {}; }).then(function(data){
          if (!res.ok) throw new Error(data.error || 'No se pudo guardar el artículo.');
          return data;
        });
      })
      .then(function(){
        window.cbDirty = false;
        window.location.href = '/admin/blog';
      })
      .catch(function(err){
        errorEl.textContent = err.message || 'No se pudo guardar el artículo. Intenta de nuevo.';
        submitBtn.disabled = false;
        submitBtn.textContent = original;
      });
  });

  // Ctrl/Cmd + S guarda
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : submitBtn.click();
    }
  });
})();

/* ---------- URL (slug) automática desde el título ---------- */
(function(){
  var title = document.getElementById('blogTitle');
  var slug = document.getElementById('blogSlug');
  if (!title || !slug) return;
  function slugify(s){
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-').slice(0, 90).replace(/-+$/, '');
  }
  title.addEventListener('input', function(){
    if (!slug.dataset.touched) slug.value = slugify(title.value);
  });
  slug.addEventListener('input', function(){ slug.dataset.touched = slug.value ? '1' : ''; });
  slug.addEventListener('blur', function(){ slug.value = slugify(slug.value); });
})();

/* ---------- contador de la descripción SEO ---------- */
(function(){
  var meta = document.getElementById('blogMeta');
  var count = document.getElementById('blogMetaCount');
  if (!meta || !count) return;
  function update(){
    var n = meta.value.length;
    count.textContent = n + ' / 160';
    count.classList.toggle('is-over', n > 160);
  }
  meta.addEventListener('input', update);
  update();
})();

/* ---------- toast ---------- */
window.cbToast = function(msg, isError){
  var el = document.getElementById('toast');
  if (!el) { if (isError) alert(msg); return; }
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(window.cbToastTimer);
  window.cbToastTimer = setTimeout(function(){ el.classList.remove('show'); }, 3200);
};