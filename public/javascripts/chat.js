// public/javascripts/chat.js
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const friendsList = document.getElementById('friendsList');
  const pendingList = document.getElementById('pendingList');
  const messagesDiv = document.getElementById('messages');
  const chatHeader = document.getElementById('chatHeader');
  const typingIndicator = document.getElementById('typingIndicator');
  const msgForm = document.getElementById('msgForm');
  const msgInput = document.getElementById('msgInput');

  const openProfile = document.getElementById('openProfile');
  const profileModal = document.getElementById('profileModal');
  const closeProfile = document.getElementById('closeProfile');
  const avatarChoices = document.getElementById('avatarChoices');
  const profileName = document.getElementById('profileName');
  const profileBio = document.getElementById('profileBio');

  // we'll add mic button dynamically into the form
  let micBtn = null;

  let activeFriendId = null;
  let activeFriendName = null;
  let activeFriendOnline = false;
  let activeFriendLastSeen = null;
  let me = window.ME || {};

  function el(tag, cls){ const d = document.createElement(tag); if(cls) d.className = cls; return d; }
  function avatarHTML(name, idx){
    const initials = (name || '').split(' ').map(s=>s[0]).join('').substring(0,2).toUpperCase();
    return `<div class="avatar avatar-${idx}">${initials}</div>`;
  }

  // show status string
  function friendStatusHTML(user) {
    if (user.online) return `<span class="status-dot online" title="Online"></span>`;
    if (user.lastSeen) {
      const dt = new Date(user.lastSeen);
      const s = dt.toLocaleString();
      return `<span class="status-dot" title="Last seen: ${s}"></span>`;
    }
    return `<span class="status-dot" title="Offline"></span>`;
  }

  // load friends
  async function loadFriends() {
    const res = await fetch('/friends');
    const data = await res.json();
    friendsList.innerHTML = '';
    data.friends.forEach(f => {
      const li = el('li', 'friend-item');
      li.dataset.id = f.user._id;
      li.id = 'friend-' + f.user._id;

      const left = el('div','friend-left');
      left.innerHTML = f.user.avatarIndex !== null && f.user.avatarIndex !== undefined ?
        avatarHTML(f.user.name, f.user.avatarIndex) : `<div class="avatar">${(f.user.name||f.user.username||'U').slice(0,2).toUpperCase()}</div>`;

      const meta = el('div','friend-meta');
      meta.innerHTML = `<div class="name">${f.user.name} ${friendStatusHTML(f.user)}</div>
                        <div class="uname">@${f.user.username}</div>`;

      const last = el('div','friend-last');
      if (f.lastMessage) {
        const content = f.lastMessage.content.length > 40 ? f.lastMessage.content.slice(0,40)+'...' : f.lastMessage.content;
        last.innerHTML = `<small class="${f.hasUnread ? 'unread' : 'muted'}">${content}</small>`;
      } else {
        last.innerHTML = `<small class="muted">No messages yet</small>`;
      }

      const actions = el('div','friend-actions');
      const removeBtn = el('button','btn-small');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (!confirm('Remove this friend?')) return;
        const r = await fetch('/friend/remove/' + f.user._id, { method: 'POST' });
        if (r.ok) { loadFriends(); }
      });

      actions.appendChild(removeBtn);
      li.appendChild(left); li.appendChild(meta); li.appendChild(last); li.appendChild(actions);

      li.addEventListener('click', () => openChat(f.user._id, f.user.name));
      friendsList.appendChild(li);
    });
  }

  // fetch me and pending requests
  async function fetchMeAndRender() {
    const r = await fetch('/api/me');
    if (!r.ok) return;
    const j = await r.json();
    me = j.user;
    renderPending(j.user.friendRequests || []);
    profileName.value = me.name || '';
    profileBio.value = me.bio || '';
    buildAvatarChoices(me.avatarIndex);
  }

  function renderPending(arr) {
    pendingList.innerHTML = '';
    if (!arr || !arr.length) { pendingList.innerHTML = '<li class="muted">No requests</li>'; return; }
    arr.forEach(u => {
      const li = el('li','pending-item');
      li.innerHTML = `${u.avatarIndex !== null && u.avatarIndex !== undefined ? `<div class="avatar avatar-${u.avatarIndex}">${(u.name||u.username||'U').slice(0,2).toUpperCase()}</div>` : `<div class="avatar">${(u.name||u.username).slice(0,2).toUpperCase()}</div>`}
        <div class="pending-meta"><div class="name">${u.name}</div><div class="uname">@${u.username}</div></div>`;
      const accept = el('button','btn-small'); accept.textContent = 'Accept';
      accept.addEventListener('click', async ()=> {
        const resp = await fetch('/friend/accept/' + u._id, { method: 'POST' });
        if (resp.ok) { alert('Friend added'); loadFriends(); fetchMeAndRender(); }
      });
      const decline = el('button','btn-small'); decline.textContent = 'Decline';
      decline.addEventListener('click', async ()=> {
        const resp = await fetch('/friend/decline/' + u._id, { method: 'POST' });
        if (resp.ok) { fetchMeAndRender(); loadFriends(); }
      });
      li.appendChild(accept); li.appendChild(decline);
      pendingList.appendChild(li);
    });
  }

  // initial
  loadFriends();
  fetchMeAndRender();

  // search
  let t = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = searchInput.value.trim();
      if (!q) { searchResults.innerHTML = ''; return; }
      const res = await fetch('/search?q=' + encodeURIComponent(q));
      const j = await res.json();
      searchResults.innerHTML = '';
      j.users.forEach(u => {
        const row = el('div','search-row');
        row.innerHTML = `<div class="search-left">${u.avatarIndex !== null && u.avatarIndex !== undefined ? `<div class="avatar avatar-${u.avatarIndex}">${(u.name||u.username).slice(0,2).toUpperCase()}</div>` : `<div class="avatar">${(u.name||u.username).slice(0,2).toUpperCase()}</div>`}</div>
          <div class="search-mid"><div class="name">${u.name}</div><div class="uname">@${u.username}</div></div>`;
        const add = el('button','btn-small'); add.textContent = 'Add';
        add.addEventListener('click', async () => {
          const rr = await fetch('/friend/request/' + u._id, { method: 'POST' });
          if (rr.ok) { alert('Request sent'); }
        });
        row.appendChild(add);
        searchResults.appendChild(row);
      });
    }, 300);
  });

  // typing debounce for client emit
  let typingTimeout = null;
  function startTyping() {
    if (!activeFriendId) return;
    socket.emit('typing', { to: activeFriendId });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('stop-typing', { to: activeFriendId });
    }, 900);
  }

  // --- VOICE recording setup
  let mediaRecorder = null;
  let audioChunks = [];
  function createMicButtonIfNeeded() {
    if (micBtn) return;
    micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'btn-small';
    micBtn.id = 'micBtn';
    micBtn.textContent = '🎙';
    // append to form
    msgForm.appendChild(micBtn);

    micBtn.addEventListener('click', async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          return alert('Media devices not supported in this browser.');
        }
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
          mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result; // base64 data URL
              // send via socket
              socket.emit('voice message', { to: activeFriendId, content: dataUrl });
            };
            reader.readAsDataURL(blob);
            audioChunks = [];
          };
          mediaRecorder.start();
          micBtn.textContent = '⏺ Recording...';
          // auto-stop after 10s to keep things simple
          setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
            micBtn.textContent = '🎙';
          }, 10000);
        } else {
          // stop if already recording
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            micBtn.textContent = '🎙';
          }
        }
      } catch (e) {
        console.error('mic error', e);
        alert('Could not start recording: ' + e.message);
        micBtn.textContent = '🎙';
      }
    });
  }

  // open chat
  async function openChat(friendId, friendName) {
    activeFriendId = friendId;
    activeFriendName = friendName;
    chatHeader.innerHTML = ''; // we'll populate header (name + avatar + badge + last seen)
    typingIndicator.textContent = '';
    messagesDiv.innerHTML = '';
    msgForm.style.display = 'flex';

    // create mic button (once)
    createMicButtonIfNeeded();

    const res = await fetch('/messages/' + friendId);
    if (res.status === 403) {
      messagesDiv.innerHTML = '<div class="muted">You are not friends with this user.</div>';
      msgForm.style.display = 'none';
      return;
    }
    const j = await res.json();
    j.messages.forEach(m => appendMessage(m));
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    // notify server via socket that we've read (server also marks read in GET route)
    socket.emit('messages-read', { by: me._id, withUser: friendId });
    // reload friends to clear unread flag
    loadFriends();

    // fetch friend details to show online/badge/lastSeen (use /search? or /api/me/populated friend list)
    // easiest: read friend element if present in friends list
    const friendEl = document.querySelector('#friend-' + friendId);
    let avatarInner = `<div class="avatar">${(friendName||'U').slice(0,2).toUpperCase()}</div>`;
    let online = false;
    let lastSeen = null;
    if (friendEl) {
      const statusDot = friendEl.querySelector('.status-dot');
      online = statusDot && statusDot.classList.contains('online');
      // try to get lastSeen tooltip
      if (statusDot && statusDot.title && statusDot.title.startsWith('Last seen')) {
        lastSeen = statusDot.title.replace('Last seen: ', '');
      }
      const avatarDiv = friendEl.querySelector('.avatar');
      if (avatarDiv) avatarInner = avatarDiv.outerHTML;
    }
    // build header HTML with avatar + badge + name + last-seen
    const headerLeft = el('div','chat-header-left');
    headerLeft.innerHTML = `<div class="header-avatar-wrap" id="header-avatar-wrap">${avatarInner}
      <span class="header-badge ${online ? 'online' : 'offline'}" id="header-badge"></span>
    </div>`;
    const headerMeta = el('div','chat-header-meta');
    const lastSeenText = online ? 'Online' : (lastSeen ? `Last seen: ${lastSeen}` : 'Offline');
    headerMeta.innerHTML = `<div class="chat-name">${escapeHtml(friendName)}</div><div class="chat-lastseen" id="chat-lastseen">${lastSeenText}</div>`;
    chatHeader.appendChild(headerLeft);
    chatHeader.appendChild(headerMeta);
  }

  function appendMessage(m) {
    const d = el('div','msg');
    d.classList.add(String(m.sender) === String(me._id) ? 'msg-me' : 'msg-other');
    const time = new Date(m.createdAt);
    if (m.type && m.type === 'voice') {
      // voice message: create audio element
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = m.content; // data URL stored by server
      d.innerHTML = `<div class="msg-text"></div><div class="msg-time">${time.toLocaleString()}</div>`;
      d.querySelector('.msg-text').appendChild(audio);
    } else {
      d.innerHTML = `<div class="msg-text">${escapeHtml(m.content)}</div><div class="msg-time">${time.toLocaleString()}</div>`;
    }
    messagesDiv.appendChild(d);
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // send text message
  msgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !activeFriendId) return;
    socket.emit('private message', { to: activeFriendId, content: text });
    msgInput.value = '';
  });

  // emit typing on input
  msgInput && msgInput.addEventListener('input', () => {
    startTyping();
  });

  // socket handlers
  socket.on('new message', (m) => {
    const otherId = (m.sender === me._id) ? m.receiver : m.sender;
    if (activeFriendId && (String(otherId) === String(activeFriendId))) {
      appendMessage(m); messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else {
      // update friends list to show unread
      loadFriends();
    }
  });

  socket.on('user-online', ({ userId }) => {
    const el = document.querySelector('#friend-' + userId + ' .status-dot');
    if (el) el.classList.add('online');
    // if current chat user went online, update header badge/lastseen
    if (activeFriendId && String(activeFriendId) === String(userId)) {
      const badge = document.getElementById('header-badge');
      if (badge) { badge.classList.remove('offline'); badge.classList.add('online'); }
      const ls = document.getElementById('chat-lastseen');
      if (ls) ls.textContent = 'Online';
    }
  });

  socket.on('user-offline', ({ userId, lastSeen }) => {
    const el = document.querySelector('#friend-' + userId + ' .status-dot');
    if (el) el.classList.remove('online');
    // update header badge/lastseen if this is active friend
    if (activeFriendId && String(activeFriendId) === String(userId)) {
      const badge = document.getElementById('header-badge');
      if (badge) { badge.classList.remove('online'); badge.classList.add('offline'); }
      const ls = document.getElementById('chat-lastseen');
      if (ls) ls.textContent = 'Last seen: ' + (new Date(lastSeen)).toLocaleString();
    }
    // optional: reload friends to show lastSeen
    loadFriends();
  });

  socket.on('typing', ({ from }) => {
    if (String(from) === String(activeFriendId)) {
      typingIndicator.textContent = 'Typing...';
    }
  });
  socket.on('stop-typing', ({ from }) => {
    if (String(from) === String(activeFriendId)) {
      typingIndicator.textContent = '';
    }
  });

  socket.on('messages-read', ({ by }) => {
    loadFriends();
  });

  socket.on('friend-request', (payload) => {
    fetchMeAndRender();
    loadFriends();
  });

  socket.on('friend-accepted', (payload) => {
    alert(`${payload.user.name} accepted your friend request`);
    loadFriends();
    fetchMeAndRender();
  });

  socket.on('error-message', (txt) => alert(txt));

  // profile modal
  openProfile.addEventListener('click', ()=> profileModal.classList.remove('hidden'));
  closeProfile && closeProfile.addEventListener('click', ()=> profileModal.classList.add('hidden'));

  // build avatar choices (10)
  function buildAvatarChoices(selected) {
    avatarChoices.innerHTML = '';
    for (let i=0;i<10;i++){
      const lbl = el('label','avatar-option');
      lbl.innerHTML = `<input type="radio" name="avatarIndex" value="${i}" ${selected===i ? 'checked' : ''} />
        <div class="avatar avatar-${i}">${(me.name||me.username||'U').slice(0,2).toUpperCase()}</div>`;
      avatarChoices.appendChild(lbl);
    }
  }
  buildAvatarChoices(me.avatarIndex);

  // pre-fill profile modal
  profileName.value = me.name || '';
  profileBio.value = me.bio || '';

  // refresh friends list periodically
  setInterval(()=>{ loadFriends(); fetchMeAndRender(); }, 15_000);
});
