/* Attomos Finance — tabla de rendimientos (vanilla JS) */
(function () {
  'use strict';

  // =====================================================================
  // DATOS — edítalos aquí cuando cambie un rendimiento.
  //   maxRate:         tasa máxima anual (%)
  //   maxRateCap:      monto hasta el que aplica la tasa máxima (0 = todo el saldo)
  //   tiers:           tramos; upTo = tope acumulado en MXN (omítelo en el último)
  //   previousMaxRate: opcional, muestra "▲/▼ antes X%" (bórralo para ocultarlo)
  //   updatedAt:       fecha en que verificaste el dato (AAAA-MM-DD)
  // =====================================================================
  const PRODUCTS = [
    {
      id: 'revolut',
      institution: 'Revolut',
      product: 'Rendimientos Diarios',
      type: 'banco',
      maxRate: 15,
      maxRateCap: 25000,
      tierKind: 'monto',
      tiers: [
        { label: 'Primeros $25,000', rate: 15, upTo: 25000 },
        { label: '$25,000 – $1,000,000 (plan Estándar)', rate: 7, upTo: 1000000, note: 'Planes de pago: Ultra 7.8% · Metal 7.5% · Premium 7.3% · Plus 7%' },
        { label: 'Más de $1,000,000', rate: 5.3 },
      ],
      gatNominal: 16.18,
      gatReal: 11.98,
      requirements: [
        'El 15% solo aplica a los primeros $25,000; el excedente gana 7% (plan Estándar)',
        'Para conservar la tasa después del primer mes: 4 compras de al menos $50 con la tarjeta Revolut cada 30 días',
        'Agregar la tarjeta a Apple Pay o Google Pay',
        'O bien, tener un plan de pago (Plus, Premium, Metal o Ultra) y no cumplir nada más',
      ],
      noRequirements: false,
      protection: 'IPAB hasta 400,000 UDIs',
      liquidity: 'Inmediata, sin plazos',
      sourceUrl: 'https://www.revolut.com/es-MX/instant-access-savings/',
      updatedAt: '2026-10-10',
    },
    {
      id: 'openbank',
      institution: 'Openbank',
      product: 'Cuenta Débito Open+',
      type: 'banco',
      maxRate: 13,
      maxRateCap: 30000,
      tierKind: 'monto',
      tiers: [
        { label: 'Primeros $30,000', rate: 13, upTo: 30000 },
        { label: '$30,000 – $1,000,000', rate: 7.3, upTo: 1000000 },
        { label: 'Más de $1,000,000', rate: 7 },
      ],
      requirements: [
        'El 13% solo aplica a los primeros $30,000',
        'Hacer al menos 1 transacción al mes; si no, la tasa de los primeros $30,000 baja',
        'Cuenta Open+: mexicano, mayor de 18 e INE vigente',
      ],
      noRequirements: false,
      protection: 'IPAB hasta 400,000 UDIs',
      liquidity: 'Inmediata, sin plazos',
      sourceUrl: 'https://www.openbank.mx/cuenta-debito-open-plus',
      updatedAt: '2026-10-10',
    },
    {
      id: 'didi',
      institution: 'DiDi Cuenta',
      product: 'J.P. Sofiexpress',
      type: 'sofipo',
      maxRate: 15,
      maxRateCap: 10000,
      tierKind: 'monto',
      tiers: [
        { label: 'Primeros $10,000', rate: 15, upTo: 10000 },
        { label: 'Resto del saldo', rate: 7 },
      ],
      gatNominal: 16.18,
      gatReal: 11.77,
      requirements: [
        'El 15% solo aplica a los primeros $10,000; el resto gana 7%',
        'Depósitos limitados a 3,000 UDIS al mes (≈ $25,000)',
        'Sin compras mínimas, depósitos obligatorios ni membresías',
      ],
      noRequirements: true,
      protection: 'Fondo de Protección hasta ≈ $215,000',
      liquidity: 'Inmediata 24/7, sin plazos',
      sourceUrl: 'https://web.didiglobal.com/mx/jpsofiexpress/didi-cuenta/',
      updatedAt: '2026-10-10',
    },
    {
      id: 'mifel',
      institution: 'Banca Mifel',
      product: 'Cuenta Digital / Evoluciona',
      type: 'banco',
      maxRate: 10,
      maxRateCap: 500000,
      tierKind: 'monto',
      tiers: [
        { label: '$100 – $500,000', rate: 10, upTo: 500000 },
        { label: 'Más de $500,000', rate: 0, note: 'Sin tasa publicada en la página' },
      ],
      requirements: [
        'Genera rendimiento a partir de $100 de saldo',
        'Cuenta Digital: depósitos limitados a 3,000 UDIS al mes (≈ $25,000)',
        'Para depositar más, subir a Evoluciona (verificación adicional): tasa hasta $500,000 de saldo',
        'Sin saldo promedio mínimo mensual',
      ],
      noRequirements: false,
      protection: 'IPAB hasta 400,000 UDIs',
      liquidity: 'Inmediata 24/7',
      sourceUrl: 'https://www.mifel.com.mx/personas/cuentas-personales-mifel',
      updatedAt: '2026-10-10',
    },
    {
      id: 'cetes',
      institution: 'CETES',
      product: 'Gobierno Federal (Cetesdirecto)',
      type: 'gobierno',
      maxRate: 6.13,
      tierKind: 'plazo',
      tiers: [
        { label: '28 días', rate: 6.13, note: 'Subasta del 25/08/2026' },
        { label: '91 días', rate: 6.6, note: 'Subasta del 25/08/2026' },
      ],
      requirements: [
        'Inversión mínima de $100 en Cetesdirecto',
        'El dinero queda invertido hasta el vencimiento (28, 91, 182 o 364 días)',
        'La tasa cambia en cada subasta semanal (martes)',
      ],
      noRequirements: true,
      protection: 'Respaldo del Gobierno Federal',
      liquidity: 'Al vencimiento del plazo',
      sourceUrl: 'https://www.cetesdirecto.com/',
      updatedAt: '2026-08-25',
    },
  ];

  const fmtMoney = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  const fmtNum = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  const fmtRate = (v) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(v);
  const fmtDate = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

  const TYPE_LABELS = { sofipo: 'SOFIPO', banco: 'Banco', gobierno: 'Gobierno' };

  const els = {
    body: document.getElementById('ratesBody'),
    meta: document.getElementById('metaRow'),
    amount: document.getElementById('amountInput'),
    chips: document.getElementById('amountChips'),
    segmented: document.getElementById('segmented'),
    indicator: document.getElementById('segIndicator'),
  };

  const state = {
    products: PRODUCTS,
    amount: 25000,
    filter: 'all',
  };

  // ---------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function manualDate(str) {
    if (!str) return '';
    const d = new Date(str + 'T12:00:00');
    return isNaN(d) ? str : fmtDate.format(d);
  }

  /** Ganancia anual respetando los topes de cada tramo. */
  function annualReturn(p, amount) {
    if (!amount || amount <= 0) return 0;
    if (p.tierKind === 'plazo') {
      const r = p.tiers && p.tiers.length ? p.tiers[0].rate : p.maxRate;
      return amount * r / 100;
    }
    const tiers = p.tiers && p.tiers.length ? p.tiers : [{ rate: p.maxRate }];
    let remaining = amount;
    let floor = 0;
    let total = 0;
    for (const t of tiers) {
      const room = t.upTo ? Math.max(t.upTo - floor, 0) : Infinity;
      const part = Math.min(remaining, room);
      total += part * t.rate / 100;
      remaining -= part;
      if (t.upTo) floor = t.upTo;
      if (remaining <= 0) break;
    }
    return total;
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function renderMeta() {
    const products = state.products;
    if (!products.length) return;
    const best = Math.max(...products.map((p) => p.maxRate));
    const leaders = products.filter((p) => p.maxRate === best).map((p) => p.institution);
    const latest = products.map((p) => p.updatedAt).filter(Boolean).sort().pop();

    els.meta.innerHTML = `
      <span class="meta-pill">Mejor tasa hoy <strong>${fmtRate(best)}%</strong> · ${escapeHtml(leaders.join(', '))}</span>
      <span class="meta-pill"><span class="dot"></span>${products.length} opciones comparadas</span>
      ${latest ? `<span class="meta-pill">Actualizado el ${escapeHtml(manualDate(latest))}</span>` : ''}`;
  }

  function statusBlock(p) {
    return `<span class="source-time">Verificado el ${escapeHtml(manualDate(p.updatedAt))}</span>`;
  }

  function rateChange(p) {
    if (!p.previousMaxRate || p.previousMaxRate === p.maxRate) return '';
    const up = p.maxRate > p.previousMaxRate;
    return `<span class="rate-change ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} antes ${fmtRate(p.previousMaxRate)}%</span>`;
  }

  function tiersList(p) {
    if (!p.tiers || !p.tiers.length) return '<span class="tier-label">Tasa única</span>';
    return `<ul class="tiers">${p.tiers.map((t) => `
      <li>
        <span class="tier-label">${escapeHtml(t.label)}${t.note ? `<span class="tier-note">${escapeHtml(t.note)}</span>` : ''}</span>
        <span class="tier-rate">${t.rate ? fmtRate(t.rate) + '%' : '—'}</span>
      </li>`).join('')}</ul>`;
  }

  function reqsList(p) {
    const tag = p.noRequirements
      ? '<span class="no-req">✓ Sin requisitos de uso</span>'
      : '<span class="has-req">Con condiciones</span>';
    const items = (p.requirements || []).map((r) => `<li>${escapeHtml(r)}</li>`).join('');
    return `${tag}<ul class="reqs">${items}</ul>`;
  }

  function capText(p) {
    if (p.tierKind === 'plazo') return `CETES a ${escapeHtml(p.tiers?.[0]?.label || '28 días')}`;
    if (p.maxRateCap) return `hasta ${fmtMoney.format(p.maxRateCap)}`;
    return 'sobre todo el saldo';
  }

  function render() {
    const amount = state.amount;
    const rows = state.products
      .filter((p) => state.filter === 'all' || p.type === state.filter)
      .map((p) => {
        const gain = annualReturn(p, amount);
        return { p, gain, eff: amount > 0 ? (gain / amount) * 100 : p.maxRate };
      })
      .sort((a, b) => b.gain - a.gain || b.p.maxRate - a.p.maxRate);

    if (!rows.length) {
      els.body.innerHTML = '<tr class="empty-row"><td colspan="6">No hay opciones en esta categoría.</td></tr>';
      return;
    }

    const maxEff = Math.max(...rows.map((r) => r.eff), 0.01);
    els.body.innerHTML = rows.map(({ p, gain, eff }, i) => {
      const best = i === 0 && amount > 0 && gain > 0;
      return `
      <tr class="rate-row${best ? ' is-best' : ''}" style="animation-delay:${i * 45}ms">
        <td class="cell-inst">
          <div class="inst">
            <span class="inst-badge" aria-hidden="true">${escapeHtml(p.institution.charAt(0))}</span>
            <div>
              <div class="inst-name">${escapeHtml(p.institution)}</div>
              <div class="inst-product">${escapeHtml(p.product)}</div>
              <span class="type-chip ${escapeHtml(p.type)}">${TYPE_LABELS[p.type] || escapeHtml(p.type)}</span>
              <div class="inst-protection">
                <span class="prot-line">🛡 ${escapeHtml(p.protection)}</span>
                <span class="prot-line">${escapeHtml(p.liquidity)}</span>
              </div>
            </div>
          </div>
        </td>
        <td data-label="Tasa máxima">
          <div class="rate-big">${fmtRate(p.maxRate)}<small>%</small></div>
          <span class="rate-cap">${capText(p)}</span>
          ${rateChange(p)}
          ${p.gatNominal ? `<span class="rate-cap">GAT nominal ${fmtRate(p.gatNominal)}% · real ${fmtRate(p.gatReal)}%</span>` : ''}
        </td>
        <td data-label="Para tu monto" class="effective">
          ${best ? '<span class="best-tag">Mejor para tu monto</span>' : ''}
          <div class="effective-rate">${fmtRate(eff)}%</div>
          <span class="effective-gain">+${fmtMoney.format(gain)} al año</span>
          <div class="effective-bar"><span style="width:${Math.max((eff / maxEff) * 100, 2).toFixed(1)}%"></span></div>
        </td>
        <td data-label="Tramos" class="cell-tiers">${tiersList(p)}</td>
        <td data-label="Requisitos" class="cell-reqs">${reqsList(p)}</td>
        <td data-label="Fuente" class="source">
          ${statusBlock(p)}
          <a class="source-link" href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver página oficial ↗</a>
        </td>
      </tr>`;
    }).join('');
  }

  // ---------------------------------------------------------------------
  // Monto
  // ---------------------------------------------------------------------

  function setAmount(value, fromInput) {
    state.amount = Math.min(Math.max(Math.round(value) || 0, 0), 999999999);
    if (!fromInput) els.amount.value = fmtNum.format(state.amount);
    els.chips.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-active', Number(c.dataset.value) === state.amount);
    });
    render();
  }

  els.amount.addEventListener('input', () => {
    const digits = els.amount.value.replace(/\D/g, '');
    const value = Number(digits || 0);
    els.amount.value = digits ? fmtNum.format(value) : '';
    setAmount(value, true);
  });

  els.amount.addEventListener('focus', () => els.amount.select());

  els.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setAmount(Number(chip.dataset.value));
  });

  // ---------------------------------------------------------------------
  // Control segmentado líquido
  // ---------------------------------------------------------------------

  let stretchTimer = null;

  function placeIndicator(btn, animate) {
    const ind = els.indicator;
    const target = { left: btn.offsetLeft, width: btn.offsetWidth };
    if (!animate) {
      ind.style.transition = 'none';
      ind.style.left = target.left + 'px';
      ind.style.width = target.width + 'px';
      void ind.offsetWidth;
      ind.style.transition = '';
      return;
    }
    const curLeft = parseFloat(ind.style.left) || 0;
    const curRight = curLeft + (parseFloat(ind.style.width) || 0);
    const left = Math.min(curLeft, target.left);
    const right = Math.max(curRight, target.left + target.width);

    // Fase 1: se estira hasta cubrir origen y destino
    clearTimeout(stretchTimer);
    ind.classList.add('is-stretching');
    ind.style.left = left + 'px';
    ind.style.width = (right - left) + 'px';
    // Fase 2: se asienta en el destino con resorte
    stretchTimer = setTimeout(() => {
      ind.classList.remove('is-stretching');
      ind.style.left = target.left + 'px';
      ind.style.width = target.width + 'px';
    }, 170);
  }

  els.segmented.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.classList.contains('is-active')) return;
    els.segmented.querySelectorAll('.seg-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });
    state.filter = btn.dataset.filter;
    placeIndicator(btn, true);
    render();
  });

  function syncIndicator() {
    const active = els.segmented.querySelector('.seg-btn.is-active');
    if (active) placeIndicator(active, false);
  }

  // ---------------------------------------------------------------------
  // Scroll: colapso del título grande + minimizar el control al bajar
  // ---------------------------------------------------------------------

  let lastY = window.scrollY;
  let ticking = false;
  let minimized = false;

  function onScroll() {
    const y = window.scrollY;
    const p = Math.min(Math.max((y - 8) / 80, 0), 1);
    document.documentElement.style.setProperty('--p', p.toFixed(3));

    const delta = y - lastY;
    if (Math.abs(delta) > 6) {
      const shouldMin = delta > 0 && y > 260;
      if (shouldMin !== minimized) {
        minimized = shouldMin;
        els.segmented.classList.toggle('is-minimized', minimized);
        // re-posiciona el indicador cuando termina de cambiar el tamaño de los botones
        setTimeout(syncIndicator, 470);
      }
      lastY = y;
    }
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });

  window.addEventListener('resize', syncIndicator);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncIndicator);

  // ---------------------------------------------------------------------
  syncIndicator();
  onScroll();
  renderMeta();
  render();
})();