// public/javascripts/chat.js
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  // UI refs
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

  // extra UI: global chat tab and online count
  const globalCountSpan = (() => {
    // create a small DOM node to show global online count next to topbar brand
    const brand = document.querySelector('.brand');
    if (!brand) return null;
    const s = document.createElement('small');
    s.style.marginLeft = '12px';
    s.style.fontSize = '12px';
    s.style.opacity = '0.9';
    brand.appendChild(s);
    return s;
  })();

  // dynamic mic button
  let micBtn = null;

  let activeFriendId = null;
  let activeFriendName = null;
  let activeFriendOnline = false;
  let activeFriendLastSeen = null;
  let me = window.ME || {};

  function el(tag, cls){ const d = document.createElement(tag); if(cls) d.className = cls; return d; }
  function avatarHTML(name, idx, profilePic) {
    if (profilePic) return `<div class="avatar"><img class="avatar-img" src="${profilePic}" alt="avatar" /></div>`;
    const initials = (name || '').split(' ').map(s=>s[0]).join('').substring(0,2).toUpperCase();
    return `<div class="avatar avatar-${(idx||0)}">${initials}</div>`;
  }

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
      const li = el('li','friend-item');
      li.dataset.id = f.user._id;
      li.id = 'friend-' + f.user._id;

      const left = el('div','friend-left');
      left.innerHTML = f.user.profilePic ? avatarHTML(f.user.name, f.user.avatarIndex, f.user.profilePic) : avatarHTML(f.user.name, f.user.avatarIndex);

      const meta = el('div','friend-meta');
      meta.innerHTML = `<div class="name">${escapeHtml(f.user.name)} ${friendStatusHTML(f.user)}</div>
                        <div class="uname">@${escapeHtml(f.user.username)}</div>`;

      const last = el('div','friend-last');
      if (f.lastMessage && !f.lastMessage.unsent) {
        const content = f.lastMessage.content.length > 40 ? f.lastMessage.content.slice(0,40)+'...' : f.lastMessage.content;
        last.innerHTML = `<small class="${f.hasUnread ? 'unread' : 'muted'}">${escapeHtml(content)}</small>`;
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

  // fetch me & pending
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
      li.innerHTML = `${u.profilePic ? `<div class="avatar"><img class="avatar-img" src="${u.profilePic}" /></div>` : `<div class="avatar avatar-${u.avatarIndex}">${(u.name||u.username||'U').slice(0,2).toUpperCase()}</div>`}
        <div class="pending-meta"><div class="name">${escapeHtml(u.name)}</div><div class="uname">@${escapeHtml(u.username)}</div></div>`;
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
        row.innerHTML = `<div class="search-left">${u.profilePic ? `<div class="avatar"><img class="avatar-img" src="${u.profilePic}" /></div>` : `<div class="avatar avatar-${u.avatarIndex}">${(u.name||u.username).slice(0,2).toUpperCase()}</div>`}</div>
          <div class="search-mid"><div class="name">${escapeHtml(u.name)}</div><div class="uname">@${escapeHtml(u.username)}</div></div>`;
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

  //const socket = io();

  // Toggle Chat Views
  document.getElementById("friendsBtn").addEventListener("click", () => {
  document.getElementById("friendsChat").classList.remove("hidden");
  document.getElementById("globalChat").classList.add("hidden");
  });

  document.getElementById("globalBtn").addEventListener("click", () => {
  document.getElementById("globalChat").classList.remove("hidden");
  document.getElementById("friendsChat").classList.add("hidden");
  });

  // ---- Global Chat ----
  const globalForm = document.getElementById("globalForm");
  const globalInput = document.getElementById("globalInput");
  const globalMessages = document.getElementById("globalMessages");

  if (globalForm) {
    // Send message
    globalForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = globalInput.value.trim();
      if (text) {
        socket.emit("globalMessage", {
          text,
          username: window.ME.username,
          userId: window.ME._id
        });
        globalInput.value = "";
      }
    });

    // Receive & show messages
    socket.off("globalMessage"); // 🛠 prevent duplicate listener
    socket.on("globalMessage", (msg) => {
      const div = document.createElement("div");
      div.classList.add("msg", msg.userId === window.ME._id ? "msg-me" : "msg-other");

      let html = `
        <div><strong>${msg.username}</strong>: ${msg.text}</div>
        <div class="msg-time">${new Date().toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"})}</div>
      `;

      // show "Add Friend" button only if not self
      if (msg.userId !== window.ME._id) {
        html += `
          <div>
            <button class="btn-small add-friend-btn" data-id="${msg.userId}" data-username="${msg.username}">
              Add Friend
            </button>
          </div>
        `;
      }

      div.innerHTML = html;
      globalMessages.appendChild(div);
      globalMessages.scrollTop = globalMessages.scrollHeight;
    });

    // Add Friend button click
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("add-friend-btn")) {
        const friendId = e.target.dataset.id;
        const friendName = e.target.dataset.username;
        socket.emit("friendRequest", {
          from: window.ME._id,
          to: friendId,
          fromName: window.ME.username
        });
        alert("Friend request sent to: " + friendName);
      }
    });

    // Receive Friend Request
    socket.on("friendRequest", (data) => {
      alert(`${data.fromName} sent you a friend request!`);
      // yahan UI update karke "Accept/Reject" button bhi laga sakte ho
    });
  }




  // typing debounce
  let typingTimeout = null;
  function startTyping() {
    if (!activeFriendId) return;
    socket.emit('typing', { to: activeFriendId });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('stop-typing', { to: activeFriendId });
    }, 900);
  }

  // --- VOICE recording (same as before) ---
  let mediaRecorder = null;
  let audioChunks = [];
  function createMicButtonIfNeeded() {
    if (micBtn) return;
    micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'btn-small';
    micBtn.id = 'micBtn';
    micBtn.textContent = '🎙';
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
              socket.emit('voice message', { to: activeFriendId, content: dataUrl });
            };
            reader.readAsDataURL(blob);
            audioChunks = [];
          };
          mediaRecorder.start();
          micBtn.textContent = '⏺ Recording...';
          setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
            micBtn.textContent = '🎙';
          }, 10000);
        } else {
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

  // open chat (private)
  async function openChat(friendId, friendName) {
    activeFriendId = friendId;
    activeFriendName = friendName;
    chatHeader.innerHTML = '';
    typingIndicator.textContent = '';
    messagesDiv.innerHTML = '';
    msgForm.style.display = 'flex';
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
    socket.emit('messages-read', { by: me._id, withUser: friendId });
    loadFriends();

    // update header (avatar + badge + last seen)
    const friendEl = document.querySelector('#friend-' + friendId);
    let avatarInner = `<div class="avatar">${(friendName||'U').slice(0,2).toUpperCase()}</div>`;
    let online = false;
    let lastSeen = null;
    if (friendEl) {
      const statusDot = friendEl.querySelector('.status-dot');
      online = statusDot && statusDot.classList.contains('online');
      if (statusDot && statusDot.title && statusDot.title.startsWith('Last seen')) {
        lastSeen = statusDot.title.replace('Last seen: ', '');
      }
      const avatarDiv = friendEl.querySelector('.avatar');
      if (avatarDiv) avatarInner = avatarDiv.outerHTML;
    }
    // build header
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

  function createMessageNode(m) {
    const d = el('div','msg');
    d.dataset.msgid = m._id;
    d.classList.add(String(m.sender) === String(me._id) ? 'msg-me' : 'msg-other');

    const time = new Date(m.createdAt);
    const timeStr = time.toLocaleString();

    // reactions display
    const reactionsHtml = (m.reactions && m.reactions.length) ? `<div class="msg-reactions">${m.reactions.map(r => `<span class="react">${escapeHtml(r.emoji)}</span>`).join('')}</div>` : '';

    if (m.type === 'voice') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = m.content;
      d.innerHTML = `<div class="msg-text"></div><div class="msg-time">${timeStr}</div>${reactionsHtml}`;
      d.querySelector('.msg-text').appendChild(audio);
    } else if (m.type === 'image') {
      d.innerHTML = `<div class="msg-text"><img style="max-width:240px;border-radius:8px" src="${m.content}" /></div><div class="msg-time">${timeStr}</div>${reactionsHtml}`;
    } else {
      d.innerHTML = `<div class="msg-text">${escapeHtml(m.content)}</div><div class="msg-time">${timeStr}</div>${reactionsHtml}`;
    }

    // actions for own messages: unsend + react
    if (String(m.sender) === String(me._id)) {
      const actionWrap = el('div','msg-actions');
      const unsendBtn = el('button','btn-small'); unsendBtn.textContent = 'Unsend';
      unsendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Unsend this message?')) return;
        // emit socket unsend or call REST for safety
        socket.emit('unsend_message', { msgId: m._id });
      });
      actionWrap.appendChild(unsendBtn);

      // add small reaction picker for own message (optional)
      const reactBtn = el('button','btn-small'); reactBtn.textContent = 'React';
      reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = prompt('Pick an emoji to react (e.g. 👍,❤️,😂):');
        if (emoji) socket.emit('react_message', { msgId: m._id, emoji });
      });
      actionWrap.appendChild(reactBtn);

      d.appendChild(actionWrap);
    } else {
      // for other messages, allow react
      const reactBtn = el('button','btn-small'); reactBtn.textContent = 'React';
      reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emoji = prompt('Pick an emoji to react (e.g. 👍,❤️,😂):');
        if (emoji) socket.emit('react_message', { msgId: m._id, emoji });
      });
      d.appendChild(reactBtn);
    }

    return d;
  }

  function appendMessage(m) {
    if (m.unsent) {
      // if a message was unsent, remove it if present
      const existing = document.querySelector(`[data-msgid="${m._id}"]`);
      if (existing) existing.remove();
      return;
    }
    const node = createMessageNode(m);
    messagesDiv.appendChild(node);
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // submit text message (private)
  msgForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text || !activeFriendId) return;
    socket.emit('private message', { to: activeFriendId, content: text });
    msgInput.value = '';
  });

  msgInput && msgInput.addEventListener('input', () => {
    startTyping();
  });

  // socket listeners
  socket.on('new message', (m) => {
    const otherId = (m.sender === me._id) ? m.receiver : m.sender;
    if (activeFriendId && (String(otherId) === String(activeFriendId))) {
      appendMessage(m); messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else {
      loadFriends();
    }
  });

  // group message handler
  socket.on('new_group_message', (m) => {
    // if currently viewing same group (not implemented fully in UI), append
    // optionally implement group UI later
    console.log('group msg', m);
  });


  socket.on('global_online_count', (n) => {
    if (globalCountSpan) globalCountSpan.textContent = `● Global online: ${n}`;
  });

  socket.on('message_unsent', ({ msgId }) => {
    const el = document.querySelector(`[data-msgid="${msgId}"]`);
    if (el) el.remove();
    // refresh friend preview
    loadFriends();
  });

  socket.on('message_reaction', ({ msgId, emoji }) => {
    const el = document.querySelector(`[data-msgid="${msgId}"]`);
    if (!el) return;
    // append reaction visually
    let rwrap = el.querySelector('.msg-reactions');
    if (!rwrap) {
      rwrap = el.querySelector('.msg-time').insertAdjacentElement('afterend', el('div','msg-reactions'));
    }
    const s = document.createElement('span');
    s.className = 'react';
    s.textContent = emoji;
    rwrap.appendChild(s);
  });

  socket.on('user-online', ({ userId }) => {
    const el = document.querySelector('#friend-' + userId + ' .status-dot');
    if (el) el.classList.add('online');
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
    if (activeFriendId && String(activeFriendId) === String(userId)) {
      const badge = document.getElementById('header-badge');
      if (badge) { badge.classList.remove('online'); badge.classList.add('offline'); }
      const ls = document.getElementById('chat-lastseen');
      if (ls && lastSeen) ls.textContent = 'Last seen: ' + (new Date(lastSeen)).toLocaleString();
    }
    loadFriends();
  });

  socket.on('typing', ({ from }) => {
    if (String(from) === String(activeFriendId)) { typingIndicator.textContent = 'Typing...'; }
  });
  socket.on('stop-typing', ({ from }) => {
    if (String(from) === String(activeFriendId)) { typingIndicator.textContent = ''; }
  });

  socket.on('messages-read', ({ by }) => {
    loadFriends();
  });

  socket.on('friend-request', (payload) => { fetchMeAndRender(); loadFriends(); });
  socket.on('friend-accepted', (payload) => { alert(`${payload.user.name} accepted your friend request`); loadFriends(); fetchMeAndRender(); });
  socket.on('error-message', (txt) => alert(txt));

  // profile modal toggles
  openProfile.addEventListener('click', ()=> profileModal.classList.remove('hidden'));
  closeProfile && closeProfile.addEventListener('click', ()=> profileModal.classList.add('hidden'));

  // avatar choices
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

  profileName.value = me.name || '';
  profileBio.value = me.bio || '';

  // refresh periodically
  setInterval(()=>{ loadFriends(); fetchMeAndRender(); }, 15_000);

  // util helper to create element by tag/cls (used in message reaction insertion)
  function el(tag, cls) { const d = document.createElement(tag); if (cls) d.className = cls; return d; }
});

