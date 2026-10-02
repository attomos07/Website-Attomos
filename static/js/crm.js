// Conversaciones — se llenan en vivo desde el bot de WhatsApp (ver
// initWhatsAppCRM/upsertWhatsAppMessage más abajo). Instagram/Messenger/etc.
// todavía no están conectados a nada real, así que por ahora no hay datos
// de esos canales aquí — cuando se conecten, se agregan igual que WhatsApp.
const conversations = [];

const tagStyles = {
  coaching:"bg-coaching", descremado:"bg-descremado", empresa:"bg-empresa",
  humano:"bg-humano", no_cualificado:"bg-no_cualificado"
};
const customChannelSvg = {
  wechat: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path d="M9.3 3.4C4.9 3.4 1.4 6.3 1.4 9.8c0 2 1.1 3.8 2.9 5l-.7 2.2 2.5-1.2c.8.2 1.7.3 2.6.3h.4a5.9 5.9 0 0 1-.2-1.5c0-3.6 3.5-6.5 7.9-6.5h.3C16.6 5.2 13.2 3.4 9.3 3.4z" fill="#07C160"/><circle cx="6.4" cy="8.5" r="1" fill="#fff"/><circle cx="11.3" cy="8.5" r="1" fill="#fff"/><path d="M16.9 10c-3.8 0-6.9 2.6-6.9 5.7 0 3.2 3.1 5.7 6.9 5.7.7 0 1.5-.1 2.1-.3l2.2 1.1-.6-1.9c1.4-1 2.4-2.5 2.4-4.1 0-3.2-3.1-6.2-6.9-6.2z" fill="#07C160"/><circle cx="15" cy="15.1" r="0.9" fill="#fff"/><circle cx="18.9" cy="15.1" r="0.9" fill="#fff"/></svg>',
  kakaotalk: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="22" height="22" rx="6" fill="#FEE500"/><path d="M12 5.6c-4.4 0-8 2.8-8 6.3 0 2.2 1.5 4.2 3.7 5.3l-.9 3.1 3.5-2c.5.1 1.1.1 1.7.1 4.4 0 8-2.8 8-6.5s-3.6-6.3-8-6.3z" fill="#3C1E1E"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="22" height="22" rx="6" fill="#00C300"/><path d="M12 5.2c-4.4 0-8 2.9-8 6.4 0 3.1 2.8 5.7 6.6 6.3-.3.9-.6 2.3-.6 2.5 0 .2.1.2.3.1.2-.1 2.6-1.7 3.6-2.4.6.1 1.3.1 2 .1h.1c4.4 0 8-2.9 8-6.6s-3.6-6.4-8-6.4z" fill="#fff"/></svg>',
};

const channelIcons = {
  whatsapp:{icon:"lni-whatsapp", brand:"#25D366", label:"WhatsApp Business"},
  instagram:{icon:"lni-instagram", brand:"#E4405F", label:"Instagram Direct"},
  messenger:{icon:"lni-facebook-messenger", brand:"#0084FF", label:"Messenger"},
  telegram:{icon:"lni-telegram", brand:"#229ED9", label:"Telegram"},
  wechat:{svg:"wechat", brand:"#07C160", label:"WeChat"},
  kakaotalk:{svg:"kakaotalk", brand:"#FEE500", label:"KakaoTalk"},
  line:{svg:"line", brand:"#00C300", label:"Line"},
};

function channelBadgeHtml(channelKey){
  const ch = channelIcons[channelKey];
  if(ch.icon){
    return `<i class="lni ${ch.icon}" style="color:${ch.brand}"></i>`;
  }
  return `<span class="chan-icon">${customChannelSvg[ch.svg]}</span>`;
}

let state = { channel:null, tag:null, filter:"mias", activeId: null };
let contactsViewActive = false;

function getContacts(){
  const map = new Map();
  conversations.forEach(c=>{ if(!map.has(c.name)) map.set(c.name, c); });
  return Array.from(map.values());
}

function filtered(){
  return conversations.filter(c=>{
    if(state.channel && c.channel !== state.channel) return false;
    if(state.tag && !c.tags.includes(state.tag)) return false;
    if(state.filter==="mias" && c.scope!=="mias") return false;
    if(state.filter==="sin" && c.scope!=="sin") return false;
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if(q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function updateCounts(){
  document.getElementById('countAll').textContent = conversations.length;
  document.getElementById('countWhatsapp').textContent = conversations.filter(c=>c.channel==="whatsapp").length;
  document.getElementById('countInstagram').textContent = conversations.filter(c=>c.channel==="instagram").length;
  document.getElementById('countMessenger').textContent = conversations.filter(c=>c.channel==="messenger").length;
  document.getElementById('countTelegram').textContent = conversations.filter(c=>c.channel==="telegram").length;
  document.getElementById('countWechat').textContent = conversations.filter(c=>c.channel==="wechat").length;
  document.getElementById('countKakaotalk').textContent = conversations.filter(c=>c.channel==="kakaotalk").length;
  document.getElementById('countLine').textContent = conversations.filter(c=>c.channel==="line").length;
  document.getElementById('badgeMias').textContent = conversations.filter(c=>c.scope==="mias").length;
  document.getElementById('badgeSin').textContent = conversations.filter(c=>c.scope==="sin").length;
  document.getElementById('badgeTodos').textContent = conversations.length;
  document.getElementById('countContacts').textContent = getContacts().length;
}

function renderList(){
  const list = filtered();
  const el = document.getElementById('convList');
  el.innerHTML = "";
  if(list.length===0){
    el.innerHTML = '<div class="empty-list">No hay conversaciones activas en este grupo.</div>';
    return;
  }
  list.forEach(c=>{
    const div = document.createElement('div');
    div.className = "conv-item" + (c.id===state.activeId ? " active" : "");
    const ch = channelIcons[c.channel];
    div.innerHTML = `
      <div class="avatar">${c.initials}
        <span class="ch-badge">${channelBadgeHtml(c.channel)}</span>
      </div>
      <div class="conv-info">
        <div class="conv-top">
          <span class="conv-name">${c.name}</span>
          <span class="conv-time">${c.time}</span>
        </div>
        <div class="conv-snippet">${c.snippet}</div>
        <div class="conv-tags">
          ${c.tags.map(t=>`<span class="mini-tag ${tagStyles[t]}">${t}</span>`).join("")}
        </div>
      </div>`;
    div.onclick = ()=>{ state.activeId = c.id; renderList(); renderChat(); };
    el.appendChild(div);
  });
}

function renderChat(){
  const c = conversations.find(x=>x.id===state.activeId);
  if(!c){
    document.getElementById('chatAvatar').textContent = "";
    document.getElementById('chatName').textContent = "Selecciona una conversación";
    document.getElementById('chatChannel').innerHTML = "";
    document.getElementById('windowBanner').style.display = "none";
    document.getElementById('aiControlBar').style.display = "none";
    document.getElementById('messages').innerHTML = '<div class="empty-list">Selecciona una conversación.</div>';
    return;
  }
  document.getElementById('aiControlBar').style.display = "";
  const ch = channelIcons[c.channel];
  document.getElementById('chatAvatar').textContent = c.initials;
  document.getElementById('chatName').textContent = c.name;
  document.getElementById('chatChannel').innerHTML = `${channelBadgeHtml(c.channel)} ${ch.label}`;
  document.getElementById('windowBanner').style.display = c.windowRestricted ? "flex" : "none";
  renderAIControlBar(c);

  const msgsEl = document.getElementById('messages');
  msgsEl.innerHTML = "";
  c.messages.forEach(m=>{
    if(m.from==="sys"){
      const d = document.createElement('div');
      d.className = "sys-note";
      d.textContent = m.text;
      msgsEl.appendChild(d);
      return;
    }
    const row = document.createElement('div');
    row.className = "msg-row " + m.from + (m._new ? " sending" : "");
    const attHtml = m.attachment ? attachmentBubbleHtml(m.attachment, !!m.text) : "";
    row.innerHTML = `<div class="bubble">${attHtml}${m.text || ""}</div><div class="msg-time">${m.time}</div>`;
    msgsEl.appendChild(row);
    delete m._new;
  });
  msgsEl.scrollTop = msgsEl.scrollHeight;

  // Panel derecho
  document.getElementById('detailAvatar').textContent = c.initials;
  document.getElementById('detailName').textContent = c.name;
  document.getElementById('detailStatus').textContent = "● " + c.availability;
  document.getElementById('detailPhone').textContent = c.phone;
  document.getElementById('detailAvail').textContent = c.availability;
  document.getElementById('detailTags').innerHTML = c.tags.map(t=>
    `<span class="tag-chip ${tagStyles[t]}"><span class="dot dot-${t}"></span>${t}</span>`
  ).join("") || '<span style="font-size:12px;color:var(--gray-400)">Sin etiquetas</span>';
}

function showContactsView(){
  contactsViewActive = true;
  document.getElementById('contactsView').classList.add('active');
  document.querySelector('.list-col').style.display = 'none';
  document.querySelector('.chat-col').style.display = 'none';
  document.getElementById('detailCol').style.display = 'none';
  renderContactsGrid();
}

function hideContactsView(){
  contactsViewActive = false;
  document.getElementById('contactsView').classList.remove('active');
  document.querySelector('.list-col').style.display = '';
  document.querySelector('.chat-col').style.display = '';
  applyGrid();
}

function renderContactsGrid(){
  const el = document.getElementById('contactsGrid');
  el.innerHTML = "";
  const q = document.getElementById('contactsSearchInput').value.trim().toLowerCase();
  const contacts = getContacts().filter(c=>!q || c.name.toLowerCase().includes(q));
  if(contacts.length===0){
    el.innerHTML = '<div class="empty-list">No hay contactos.</div>';
    return;
  }
  contacts.forEach(c=>{
    const ch = channelIcons[c.channel];
    const div = document.createElement('div');
    div.className = "contact-card";
    div.innerHTML = `
      <div class="avatar">${c.initials}
        <span class="ch-badge">${channelBadgeHtml(c.channel)}</span>
      </div>
      <div class="contact-card-info">
        <div class="contact-card-name">${c.name}</div>
        <div class="contact-card-phone">${c.phone}</div>
      </div>`;
    div.onclick = ()=>{ openContact(c); };
    el.appendChild(div);
  });
}

function openContact(c){
  hideContactsView();
  state.filter = "todos"; state.channel = null; state.tag = null;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('.tab[data-filter="todos"]').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelector('.nav-item[data-scope="all"]').classList.add('active');
  document.getElementById('scopeTitle').textContent = "Todos los canales";
  document.getElementById('scopeDot').style.background = "var(--accent)";
  state.activeId = c.id;
  renderList();
  renderChat();
}

function selectContacts(el){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  showContactsView();
}

function selectScope(scope, el){
  if(contactsViewActive) hideContactsView();
  state.channel = null; state.tag = null;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('scopeTitle').textContent = "Todos los canales";
  document.getElementById('scopeDot').style.background = "var(--accent)";
  renderList();
}
function selectChannel(channel, el){
  if(contactsViewActive) hideContactsView();
  state.channel = channel; state.tag = null;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('scopeTitle').textContent = channelIcons[channel].label;
  document.getElementById('scopeDot').style.background = channelIcons[channel].brand;
  renderList();
}
function selectTag(tag, el){
  if(contactsViewActive) hideContactsView();
  state.tag = tag; state.channel = null;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('scopeTitle').textContent = "#" + tag;
  document.getElementById('scopeDot').style.background = "var(--gray-400)";
  renderList();
}
function selectFilter(filter, el){
  state.filter = filter;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  renderList();
}
function selectComposerTab(tab, el){
  document.querySelectorAll('.composer-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('composerText').placeholder = tab==="nota"
    ? "Escribe una nota privada (solo visible para tu equipo)..."
    : "Escribe un mensaje... (Shift + Enter para nueva línea)";
}
function handleComposerKeydown(e){
  if(e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
}

function sendMessage(){
  const textEl = document.getElementById('composerText');
  const text = textEl.value.trim();
  if(!text && !pendingAttachment) return;
  const c = conversations.find(x=>x.id===state.activeId);

  // ── Conversación real de WhatsApp: mandar por el backend, no localmente ──
  // El mensaje aparece en el chat cuando llega de vuelta por el stream (SSE),
  // así todas las pestañas del CRM (y este humano) ven exactamente lo mismo.
  if(c.channel === "whatsapp" && c.live && text && !pendingAttachment){
    sendWhatsAppMessage(c.phone, text);
    textEl.value = "";
    return;
  }

  const now = new Date();
  const time = now.toLocaleTimeString('es-MX',{hour:'numeric',minute:'2-digit'});
  const attLabels = {image:"📷 Imagen", video:"🎥 Video", audio:"🎵 Audio", file:"📎 " + (pendingAttachment ? pendingAttachment.name : "")};
  c.messages.push({from:"out", text, time, _new:true, attachment: pendingAttachment});
  c.snippet = text || attLabels[pendingAttachment.type];
  c.time = time;
  textEl.value = "";
  pendingAttachment = null;
  renderAttachmentPreview();
  renderChat();
  renderList();
}

function toggleHeaderMenu(e){
  e.stopPropagation();
  document.getElementById('headerMenu').classList.toggle('open');
}
function closeHeaderMenu(){
  document.getElementById('headerMenu').classList.remove('open');
}
document.addEventListener('click', closeHeaderMenu);

/* ===== Configuración: submenu y exportación ===== */
function toggleConfigMenu(el){
  el.classList.toggle('open');
  document.getElementById('configSubmenu').classList.toggle('open');
}

function openExportModal(){
  document.getElementById('exportModal').classList.add('open');
}
function closeExportModal(){
  document.getElementById('exportModal').classList.remove('open');
  document.querySelectorAll('.export-status').forEach(s=>s.classList.remove('show'));
}

function showExportStatus(id){
  const el = document.getElementById(id);
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 2500);
}

function downloadBlob(content, filename, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildChatsText(){
  let out = "";
  conversations.forEach(c=>{
    out += `===== ${c.name} (${channelIcons[c.channel].label}) =====\n`;
    c.messages.forEach(m=>{
      if(m.from==="sys"){ out += `[Sistema] ${m.text}\n`; return; }
      const who = m.from==="out" ? "Yo" : c.name;
      const body = m.text || (m.attachment ? `[${m.attachment.type}] ${m.attachment.name}` : "");
      out += `${m.time} - ${who}: ${body}\n`;
    });
    out += "\n";
  });
  return out;
}

function exportChatsTxt(){
  downloadBlob(buildChatsText(), "chats_attomos.txt", "text/plain;charset=utf-8");
  showExportStatus('chatsStatus');
}

function exportChatsPdf(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(buildChatsText(), 180);
  let y = 15;
  lines.forEach(line=>{
    if(y > 285){ doc.addPage(); y = 15; }
    doc.text(line, 10, y);
    y += 6;
  });
  doc.save("chats_attomos.pdf");
  showExportStatus('chatsStatus');
}

function exportContactsExcel(){
  const rows = getContacts().map(c=>({
    Nombre: c.name,
    Telefono: c.phone,
    Canal: channelIcons[c.channel].label,
    Disponibilidad: c.availability,
    Etiquetas: c.tags.join(", ")
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contactos");
  XLSX.writeFile(wb, "contactos_attomos.xlsx");
  showExportStatus('contactsStatus');
}

function exportContactsPdf(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text("Contactos - Attomos CRM", 10, 15);
  doc.setFontSize(10);
  let y = 26;
  getContacts().forEach(c=>{
    if(y > 280){ doc.addPage(); y = 15; }
    doc.text(`${c.name}  |  ${c.phone}  |  ${channelIcons[c.channel].label}  |  ${c.tags.join(", ")}`, 10, y);
    y += 7;
  });
  doc.save("contactos_attomos.pdf");
  showExportStatus('contactsStatus');
}

/* ===== Adjuntar video: menú (grabar o subir) ===== */
function toggleVideoAttachMenu(e){
  e.stopPropagation();
  document.getElementById('videoAttachMenu').classList.toggle('open');
}
function closeVideoAttachMenu(){
  document.getElementById('videoAttachMenu').classList.remove('open');
}
document.addEventListener('click', closeVideoAttachMenu);

/* ===== Grabar video desde la cámara del dispositivo ===== */
let videoMediaRecorder = null;
let videoRecordedChunks = [];
let videoLiveStream = null;
let videoRecordingStartTime = null;
let videoRecordingTimerInterval = null;
let recordedVideoUrl = null;

async function openVideoRecordModal(){
  document.getElementById('videoRecordModal').classList.add('open');
  document.getElementById('videoRecordActionsIdle').style.display = 'flex';
  document.getElementById('videoRecordActionsRecording').style.display = 'none';
  document.getElementById('videoRecordActionsReview').style.display = 'none';
  document.getElementById('videoRecordTimer').style.display = 'none';
  const preview = document.getElementById('videoRecordPreview');
  preview.muted = true;
  preview.controls = false;
  preview.src = "";
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert("Este navegador no permite grabar video desde la cámara.");
    closeVideoRecordModal();
    return;
  }
  try{
    videoLiveStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    preview.srcObject = videoLiveStream;
  } catch(err){
    alert("No se pudo acceder a la cámara. Revisa los permisos del navegador.");
    closeVideoRecordModal();
  }
}

function startVideoRecording(){
  if(!videoLiveStream) return;
  videoRecordedChunks = [];
  videoMediaRecorder = new MediaRecorder(videoLiveStream);
  videoMediaRecorder.ondataavailable = e => { if(e.data.size > 0) videoRecordedChunks.push(e.data); };
  videoMediaRecorder.onstop = () => {
    const blob = new Blob(videoRecordedChunks, { type: videoMediaRecorder.mimeType || "video/webm" });
    recordedVideoUrl = URL.createObjectURL(blob);
    const preview = document.getElementById('videoRecordPreview');
    if(videoLiveStream){ videoLiveStream.getTracks().forEach(t=>t.stop()); videoLiveStream = null; }
    preview.srcObject = null;
    preview.src = recordedVideoUrl;
    preview.muted = false;
    preview.controls = true;
    preview.play();
    document.getElementById('videoRecordActionsRecording').style.display = 'none';
    document.getElementById('videoRecordActionsReview').style.display = 'flex';
    document.getElementById('videoRecordTimer').style.display = 'none';
  };
  videoMediaRecorder.start();
  videoRecordingStartTime = Date.now();
  document.getElementById('videoRecordActionsIdle').style.display = 'none';
  document.getElementById('videoRecordActionsRecording').style.display = 'flex';
  const timerEl = document.getElementById('videoRecordTimer');
  timerEl.style.display = 'flex';
  videoRecordingTimerInterval = setInterval(()=>{
    const secs = Math.floor((Date.now() - videoRecordingStartTime) / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2,'0');
    const s = String(secs % 60).padStart(2,'0');
    timerEl.textContent = `${m}:${s}`;
  }, 500);
}

function stopVideoRecording(){
  if(videoMediaRecorder && videoMediaRecorder.state === "recording"){
    videoMediaRecorder.stop();
  }
  clearInterval(videoRecordingTimerInterval);
}

function retakeVideoRecording(){
  if(recordedVideoUrl){ URL.revokeObjectURL(recordedVideoUrl); recordedVideoUrl = null; }
  openVideoRecordModal();
}

function useRecordedVideo(){
  if(!recordedVideoUrl) return;
  pendingAttachment = { type:"video", name:"Video grabado.webm", url: recordedVideoUrl };
  renderAttachmentPreview();
  recordedVideoUrl = null;
  closeVideoRecordModal();
}

function closeVideoRecordModal(){
  document.getElementById('videoRecordModal').classList.remove('open');
  clearInterval(videoRecordingTimerInterval);
  if(videoMediaRecorder && videoMediaRecorder.state === "recording"){
    videoMediaRecorder.stop();
  }
  if(videoLiveStream){
    videoLiveStream.getTracks().forEach(t=>t.stop());
    videoLiveStream = null;
  }
  const preview = document.getElementById('videoRecordPreview');
  if(preview){
    preview.pause();
    preview.srcObject = null;
  }
}

let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingStartTime = null;
let recordingTimerInterval = null;

function toggleVoiceRecording(){
  if(mediaRecorder && mediaRecorder.state === "recording"){
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
}

async function startVoiceRecording(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert("Este navegador no permite grabar audio desde el micrófono.");
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    recordingStream = stream;
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if(e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      pendingAttachment = { type:"audio", name:"Nota de voz.webm", url };
      renderAttachmentPreview();
      recordingStream.getTracks().forEach(t => t.stop());
      recordingStream = null;
    };
    mediaRecorder.start();
    recordingStartTime = Date.now();
    document.getElementById('micBtn').classList.add('recording');
    document.getElementById('micBtn').title = "Detener grabación";
    recordingTimerInterval = setInterval(()=>{
      const secs = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2,'0');
      const s = String(secs % 60).padStart(2,'0');
      document.getElementById('micTimer').textContent = `${m}:${s}`;
    }, 500);
  } catch(err){
    alert("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
  }
}

function stopVoiceRecording(){
  if(mediaRecorder && mediaRecorder.state === "recording"){
    mediaRecorder.stop();
  }
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micBtn').title = "Grabar nota de voz";
  clearInterval(recordingTimerInterval);
  document.getElementById('micTimer').textContent = "";
}

let pendingAttachment = null;
const attIcons = { image:"lni-image", video:"lni-video", audio:"lni-microphone", file:"lni-paperclip" };

function handleFileSelect(event, type){
  const file = event.target.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  pendingAttachment = { type, name:file.name, url };
  renderAttachmentPreview();
  event.target.value = "";
}

function clearAttachment(){
  pendingAttachment = null;
  renderAttachmentPreview();
}

/* ===== Arrastrar y soltar archivos sobre el chat ===== */
(function setupChatDragAndDrop(){
  const chatCol = document.querySelector('.chat-col');
  const overlay = document.getElementById('dropOverlay');
  let dragDepth = 0;

  function guessType(file){
    if(file.type.startsWith('image/')) return 'image';
    if(file.type.startsWith('video/')) return 'video';
    if(file.type.startsWith('audio/')) return 'audio';
    return 'file';
  }

  chatCol.addEventListener('dragenter', (e)=>{
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('active');
  });
  chatCol.addEventListener('dragover', (e)=>{
    e.preventDefault();
  });
  chatCol.addEventListener('dragleave', (e)=>{
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if(dragDepth === 0) overlay.classList.remove('active');
  });
  chatCol.addEventListener('drop', (e)=>{
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('active');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if(!file) return;
    const url = URL.createObjectURL(file);
    pendingAttachment = { type: guessType(file), name: file.name, url };
    renderAttachmentPreview();
  });
})();

function renderAttachmentPreview(){
  const el = document.getElementById('attachmentPreview');
  if(!pendingAttachment){ el.innerHTML = ""; return; }
  const a = pendingAttachment;
  let thumb = `<div class="att-icon"><i class="lni ${attIcons[a.type]}"></i></div>`;
  if(a.type === 'image') thumb = `<img src="${a.url}">`;
  if(a.type === 'video') thumb = `<video src="${a.url}"></video>`;
  el.innerHTML = `${thumb}<span class="att-name">${a.name}</span><span class="att-remove" onclick="clearAttachment()"><i class="lni lni-close"></i></span>`;
}

function attachmentBubbleHtml(a, hasText){
  const margin = hasText ? 'margin-bottom:6px;' : '';
  if(a.type === 'image') return `<img class="att-media" style="${margin}" src="${a.url}">`;
  if(a.type === 'video') return `<video class="att-media" style="${margin}" src="${a.url}" controls></video>`;
  if(a.type === 'audio') return `<audio style="${margin}display:block;" src="${a.url}" controls></audio>`;
  return `<div class="att-file-chip" style="${margin}"><i class="lni lni-paperclip"></i> ${a.name}</div>`;
}

let panelState = { left:true, right:false };

function applyGrid(){
  const left = panelState.left ? '232px' : '44px';
  const right = panelState.right ? '300px' : '0px';
  document.querySelector('.app').style.gridTemplateColumns = `${left} 320px 1fr ${right}`;
  document.getElementById('navRail').classList.toggle('collapsed', !panelState.left);
  document.getElementById('detailCol').style.display = panelState.right ? '' : 'none';
}
function toggleLeft(){ panelState.left = !panelState.left; applyGrid(); }
function toggleRight(){ panelState.right = !panelState.right; applyGrid(); }

let aiInControl = true;
function toggleAIControl(){
  const c = conversations.find(x=>x.id===state.activeId);
  if(!c) return;

  const goingHuman = (c.aiControl !== false); // true → estaba en IA, ahora pasa a humano
  c.aiControl = !goingHuman;

  renderAIControlBar(c);

  // Conversación real de WhatsApp → avisar al bot para que pause/reanude de verdad
  if(c.channel === "whatsapp" && c.live){
    controlWhatsAppConversation(c.phone, goingHuman ? "pause" : "resume");
  }
}

function renderAIControlBar(c){
  const bar = document.getElementById('aiControlBar');
  const text = document.getElementById('aiStatusText');
  const label = document.getElementById('aiControlLabel');
  const icon = document.getElementById('aiControlIcon');
  const inControl = c.aiControl !== false;
  aiInControl = inControl;
  if(inControl){
    bar.classList.remove('human');
    text.textContent = "La IA está respondiendo esta conversación";
    label.textContent = "Tomar control";
    icon.className = "lni lni-user";
  }else{
    bar.classList.add('human');
    text.textContent = "Tienes el control de esta conversación";
    label.textContent = "Dejar control a la IA";
    icon.className = "lni lni-cog";
  }
}

// ===================== WHATSAPP EN VIVO (CRM ↔ Bot) =====================
// Todo lo de abajo conecta este CRM con el bot de WhatsApp Web real, vía el
// hub del backend (crm_hub.go). Las demás pestañas del sidebar (Instagram,
// Messenger, etc.) siguen usando los datos de ejemplo de arriba por ahora.
//
// ⚠️ Verifica la forma real de la respuesta de GET /api/agents en tu backend
// (aquí se asume un array plano o {agents:[...]}) y ajusta `list` si difiere.

let crmAgentId = null;
let crmEventSource = null;
let nextLocalConvId = -1; // ids negativos para no chocar con los ids 1-4 de ejemplo

async function initWhatsAppCRM(){
  try{
    const res = await fetch('/api/agents');
    if(!res.ok) return;
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.agents || []);
    const waAgents = list.filter(a => a.botType === "atomic");
    if(waAgents.length === 0){
      console.log("[CRM] No hay un agente de WhatsApp Web (atomic) configurado todavía.");
      return;
    }
    // Tomamos el más reciente (mayor id), no el primero que aparezca —
    // así si tienes varios agentes de WhatsApp, el CRM sigue al último creado.
    const waAgent = waAgents.reduce((a, b) => (b.id > a.id ? b : a));
    crmAgentId = waAgent.id;
    console.log(`[CRM] Usando agente atomic id=${crmAgentId} (de ${waAgents.length} disponibles: ${waAgents.map(a=>a.id).join(", ")})`);
    connectWhatsAppStream();
  }catch(err){
    console.error("[CRM] Error obteniendo agentes:", err);
  }
}

function connectWhatsAppStream(){
  if(!crmAgentId) return;
  if(crmEventSource) crmEventSource.close();

  const streamUrl = `/api/agents/${crmAgentId}/crm/stream`;
  console.log(`[CRM] Abriendo stream: ${streamUrl}`);
  crmEventSource = new EventSource(streamUrl);

  crmEventSource.addEventListener('status', (e)=>{
    const data = JSON.parse(e.data);
    console.log("[CRM] Bot", data.botConnected ? "conectado" : "desconectado");
  });

  crmEventSource.addEventListener('message', (e)=>{
    upsertWhatsAppMessage(JSON.parse(e.data));
  });

  crmEventSource.addEventListener('control', (e)=>{
    const evt = JSON.parse(e.data);
    const c = findWhatsAppConversation(evt.phone);
    if(!c) return;
    c.aiControl = evt.text === "resume";
    if(c.id === state.activeId) renderAIControlBar(c);
  });

  crmEventSource.onerror = ()=>{
    // EventSource reintenta la conexión solo; no hace falta reconectar a mano.
    console.log("[CRM] Stream desconectado, reintentando...");
  };
}

function findWhatsAppConversation(phone){
  return conversations.find(c => c.channel === "whatsapp" && c.live && c.phone === phone);
}

function initialsFromName(name){
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("") || "?";
}

function upsertWhatsAppMessage(evt){
  let c = findWhatsAppConversation(evt.phone);
  const time = new Date(evt.timestamp || Date.now()).toLocaleTimeString('es-MX', {hour:'numeric', minute:'2-digit'});

  if(!c){
    const name = evt.contactName || evt.phone;
    c = {
      id: nextLocalConvId--,
      name, initials: initialsFromName(name),
      channel: "whatsapp", scope: "mias", phone: evt.phone,
      availability: "Disponible", tags: [], time, snippet: "",
      windowRestricted: false, aiControl: true, live: true,
      messages: []
    };
    conversations.unshift(c);
    // Si no hay nada seleccionado todavía (CRM recién abierto, sin
    // conversaciones), abrimos esta automáticamente en vez de dejar el
    // panel de chat vacío.
    if(state.activeId === null) state.activeId = c.id;
  }

  c.messages.push({ from: evt.direction === "in" ? "in" : "out", text: evt.text, time, _new: true });
  c.snippet = evt.text;
  c.time = time;
  if(evt.contactName) c.name = evt.contactName;

  // Reflejar quién tiene el control sin esperar al evento "control" aparte
  // (por si esta misma pestaña disparó el envío).
  if(evt.direction === "out" && evt.from === "human") c.aiControl = false;
  if(evt.direction === "out" && evt.from === "bot") c.aiControl = true;

  updateCounts();
  renderList();
  if(c.id === state.activeId) renderChat();
}

async function sendWhatsAppMessage(phone, text){
  if(!crmAgentId) return;
  try{
    const res = await fetch(`/api/agents/${crmAgentId}/crm/send`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({phone, text})
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      alert(err.error || "No se pudo enviar el mensaje. ¿El bot está conectado?");
    }
  }catch(err){
    console.error("[CRM] Error enviando mensaje:", err);
    alert("No se pudo enviar el mensaje.");
  }
}

async function controlWhatsAppConversation(phone, action){
  if(!crmAgentId) return;
  try{
    await fetch(`/api/agents/${crmAgentId}/crm/control`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({phone, action})
    });
  }catch(err){
    console.error("[CRM] Error cambiando control:", err);
  }
}

initWhatsAppCRM();

updateCounts();
renderList();
renderChat();
applyGrid();

// ============================================================================
// REDISEÑO iOS — CRM
// Controles segmentados (Mías/Sin asignar/Todos y Responder/Nota) con cápsula
// que se desliza y modales que salen con animación. No cambia la lógica:
// los clics siguen llegando a selectFilter() / selectComposerTab().
// ============================================================================
(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    function segmented(box, itemSelector) {
        if (!box || box.classList.contains('ios-seg')) return;
        box.classList.add('ios-seg');
        const thumb = document.createElement('span');
        thumb.className = 'ios-seg-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        box.prepend(thumb);

        const S = { x: 0, w: 0, h: 0, y: 0 };
        const V = { x: 0, w: 0, h: 0, y: 0 };
        const T = { x: 0, w: 0, h: 0, y: 0 };
        let raf = null, last = 0, ready = false, press = 1, pressT = 1, pressV = 0;

        function render() {
            const st = Math.min(Math.abs(V.x) / 2600, 0.14);
            thumb.style.opacity = ready ? 1 : 0;
            thumb.style.width = `${S.w}px`;
            thumb.style.height = `${S.h}px`;
            thumb.style.transform = `translate(${S.x}px, ${S.y}px) scale(${press * (1 + st)}, ${press * (1 - st * 0.4)})`;
        }
        function tick(now) {
            const dt = Math.min((now - last) / 1000, 1 / 30);
            last = now;
            let moving = false;
            ['x', 'w', 'h', 'y'].forEach((k) => {
                if (reduce.matches) { S[k] = T[k]; V[k] = 0; return; }
                V[k] += (-440 * (S[k] - T[k]) - 30 * V[k]) * dt;
                S[k] += V[k] * dt;
                if (Math.abs(S[k] - T[k]) > 0.1 || Math.abs(V[k]) > 0.5) moving = true;
            });
            pressV += (-600 * (press - pressT) - 30 * pressV) * dt;
            press += pressV * dt;
            if (Math.abs(press - pressT) > 0.001 || Math.abs(pressV) > 0.01) moving = true;
            render();
            if (!moving) {
                Object.assign(S, T); press = pressT;
                ['x', 'w', 'h', 'y'].forEach((k) => { V[k] = 0; });
                pressV = 0; render(); raf = null; return;
            }
            raf = requestAnimationFrame(tick);
        }
        function kick() {
            if (raf) return;
            last = performance.now();
            raf = requestAnimationFrame(tick);
        }
        function place(snap) {
            const a = box.querySelector(`${itemSelector}.active`);
            if (!a || !a.offsetWidth) return;
            T.x = a.offsetLeft; T.y = a.offsetTop; T.w = a.offsetWidth; T.h = a.offsetHeight;
            if (snap || !ready) { Object.assign(S, T); ['x', 'w', 'h', 'y'].forEach((k) => { V[k] = 0; }); }
            ready = true;
            render();
            kick();
        }
        // selectFilter()/selectComposerTab() cambian la clase .active: se sigue
        new MutationObserver(() => place(false)).observe(box, { subtree: true, attributes: true, attributeFilter: ['class'] });
        box.addEventListener('pointerdown', (e) => {
            if (e.target.closest(`${itemSelector}.active`)) { pressT = 0.95; kick(); }
        });
        const release = () => { pressT = 1; kick(); };
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => box.addEventListener(ev, release));
        if (window.ResizeObserver) new ResizeObserver(() => place(true)).observe(box);
        place(true);
    }

    // Modales: salida animada antes de que la lógica original los oculte
    function wrapClose(name, id) {
        const orig = window[name];
        if (typeof orig !== 'function' || orig.__ios) return;
        const wrapped = function () {
            const args = arguments, self = this;
            const modal = document.getElementById(id);
            if (!modal || !modal.classList.contains('open') || modal.classList.contains('ios-closing') || reduce.matches) {
                if (!modal || !modal.classList.contains('ios-closing')) orig.apply(self, args);
                return;
            }
            modal.classList.add('ios-closing');
            setTimeout(() => {
                modal.classList.remove('ios-closing');
                orig.apply(self, args);
            }, 220);
        };
        wrapped.__ios = true;
        window[name] = wrapped;
    }

    segmented(document.querySelector('.tabs'), '.tab');
    segmented(document.querySelector('.composer-tabs'), '.composer-tab');
    wrapClose('closeExportModal', 'exportModal');
    wrapClose('closeVideoRecordModal', 'videoRecordModal');

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.querySelector('#exportModal.open')) window.closeExportModal();
        else if (document.querySelector('#videoRecordModal.open')) window.closeVideoRecordModal();
    });
})();