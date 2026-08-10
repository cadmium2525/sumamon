// ==== PeerJS + Firebase RTDB マルチプレイ ====
// RTDBは部屋の発見だけに使い、対戦中の入力と状態はPeerJS(WebRTC)で送る。
const Multiplayer = {
  peer: null,
  peerId: null,
  role: null,
  room: null,
  roomId: null,
  localSelection: null,
  localPlayerIndex: 0,
  hostConnection: null,
  guestConnections: new Map(),
  remoteInputs: new Map(),
  latestState: null,
  roomsUnsubscribe: null,
  stateFrame: 0,
  inputFrame: 0,
  peerReadyPromise: null,
  pendingJoin: null,
  heartbeatTimer: null,
  peerReconnectTimer: null,

  init() {
    document.querySelectorAll('.multi-tab').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.multi-tab').forEach(item => item.classList.toggle('active', item === tab));
      document.querySelectorAll('.multi-pane').forEach(pane => pane.classList.toggle('hidden', pane.dataset.multiPane !== tab.dataset.multiTab));
      if (tab.dataset.multiTab === 'guest') this.refreshRooms();
    }));
    document.getElementById('multi-create-room').addEventListener('click', () => this.createRoomFromForm());
    document.getElementById('multi-find-rooms').addEventListener('click', () => this.refreshRooms());
    document.getElementById('multi-room-list').addEventListener('click', event => {
      const button = event.target.closest('[data-room-id]');
      if (button) this.joinRoom(button.dataset.roomId);
    });
    document.getElementById('multi-start-battle').addEventListener('click', () => this.startHostMatch());
    document.getElementById('multi-leave-room').addEventListener('click', () => this.leaveRoom(true));
  },

  openMenu() {
    const stageSelect = document.getElementById('multi-host-stage');
    stageSelect.innerHTML = Object.values(STAGES).map(stage => `<option value="${stage.key}">${stage.displayName}</option>`).join('');
    this.renderMasmonChoices('host');
    this.renderMasmonChoices('guest');
    this.setMessage('');
    AppFlow.showScreen('multi-menu');
  },

  renderMasmonChoices(kind) {
    const list = document.getElementById(`multi-${kind}-masmons`);
    const masmons = MasmonStore.loadAll().filter(monster => FIGHTERS[monster.baseFighterKey]);
    if (!masmons.length) {
      list.innerHTML = '<div class="multi-empty">先にCPU戦でマスモンを登録してください</div>';
      return;
    }
    list.innerHTML = masmons.map((monster, index) => {
      const fighter = FIGHTERS[monster.baseFighterKey];
      return `<label class="multi-masmon-card">
        <input type="radio" name="multi-${kind}-masmon" value="${monster.id}" ${index === 0 ? 'checked' : ''}>
        <img alt="">
        <span><strong>${this.escapeHtml(monster.name)}</strong><small>Lv.${monster.level}／${fighter.displayName}</small></span>
      </label>`;
    }).join('');
    // スキン（色変更）を反映する
    masmons.forEach((monster, index) => {
      const fighter = FIGHTERS[monster.baseFighterKey];
      const img = list.children[index]?.querySelector('img');
      if (img) Skin.paintInto(img, fighter.stockIcon || fighter.idleImage, monster.skin);
    });
  },

  selectionFor(kind) {
    const selected = document.querySelector(`input[name="multi-${kind}-masmon"]:checked`);
    const monster = selected && MasmonStore.loadAll().find(item => item.id === selected.value);
    if (!monster) return null;
    return {
      masmonId: monster.id,
      fighterKey: monster.baseFighterKey,
      name: monster.name,
      level: monster.level,
      trainingStats: { ...(monster.trainingStats || {}) },
      skin: monster.skin || null,
      aptitudes: { ...(monster.aptitudes || GROWTH.aptitudesFor(monster.baseFighterKey)) },
      // 完成後の値ではなく凸段階だけを送り、受信側で一度だけ再計算する。
      limitBreak: UserProfileStore.limitBreakOf(monster.baseFighterKey),
    };
  },

  async ensurePeer() {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected && this.peer.open && this.peerId) return this.peerId;
    if (this.peerReadyPromise) return this.peerReadyPromise;
    if (!window.Peer) throw new Error('PeerJSを読み込めませんでした。通信環境を確認してください');
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peerId = null;
    const peer = new Peer(undefined, { debug: 1 });
    this.peer = peer;
    this.bindPeerEvents(peer);
    this.peerReadyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PeerJSへの接続がタイムアウトしました')), 12000);
      peer.once('open', id => { clearTimeout(timer); resolve(id); });
      peer.once('error', error => { clearTimeout(timer); reject(error); });
    });
    try {
      this.peerId = await this.peerReadyPromise;
      return this.peerId;
    } finally {
      this.peerReadyPromise = null;
    }
  },

  bindPeerEvents(peer) {
    peer.on('open', id => {
      if (peer !== this.peer) return;
      this.peerId = id;
      clearTimeout(this.peerReconnectTimer);
      this.peerReconnectTimer = null;
      if (this.role === 'host' && this.roomId && this.room) {
        this.room.hostPeerId = id;
        this.room.accepting = true;
        FirebaseRTDB.update(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}`), {
          hostPeerId: id,
          accepting: true,
          heartbeatAt: FirebaseRTDB.serverTimestamp(),
        }).then(() => this.startRoomHeartbeat()).catch(() => {});
      }
    });
    peer.on('connection', connection => this.acceptGuestConnection(connection));
    peer.on('disconnected', () => {
      if (peer !== this.peer || peer.destroyed) return;
      this.stopRoomHeartbeat();
      if (this.role === 'host' && this.roomId) {
        this.room.accepting = false;
        FirebaseRTDB.update(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}`), { accepting: false }).catch(() => {});
      }
      try { peer.reconnect(); } catch (_) {}
      clearTimeout(this.peerReconnectTimer);
      this.peerReconnectTimer = setTimeout(() => {
        if (peer !== this.peer || !peer.disconnected) return;
        if (this.role === 'host' && this.roomId) {
          FirebaseRTDB.remove(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}`)).catch(() => {});
          this.setLobbyMessage('通信が切断されたため部屋を閉じました。部屋を作り直してください');
        }
      }, 10000);
    });
    peer.on('close', () => {
      if (peer !== this.peer) return;
      this.peerId = null;
      this.stopRoomHeartbeat();
      if (this.pendingJoin) this.pendingJoin.reject(new Error('PeerJSとの通信が終了しました'));
    });
    peer.on('error', error => {
      if (this.pendingJoin && error.type === 'peer-unavailable') {
        this.pendingJoin.reject(error);
        return;
      }
      const type = error.type || error.message;
      this.setMessage(`PeerJS接続エラー: ${type}`);
    });
  },

  startRoomHeartbeat() {
    this.stopRoomHeartbeat();
    if (this.role !== 'host' || !this.roomId || !this.peer?.open) return;
    const writeHeartbeat = () => FirebaseRTDB.update(
      FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}`),
      { heartbeatAt: FirebaseRTDB.serverTimestamp(), accepting: true },
    ).catch(() => {});
    writeHeartbeat();
    this.heartbeatTimer = setInterval(writeHeartbeat, 10000);
  },

  stopRoomHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  },

  requireServices() {
    if (!window.FirebaseRTDB) throw new Error('Realtime Databaseがまだ利用できません');
    if (!AppFlow.currentUser) throw new Error('ログインが必要です');
  },

  async createRoomFromForm() {
    try {
      this.requireServices();
      const selection = this.selectionFor('host');
      if (!selection) throw new Error('使用するマスモンを選択してください');
      this.setMessage('部屋を作成しています…');
      await this.leaveRoom(false);
      const peerId = await this.ensurePeer();
      const user = AppFlow.currentUser;
      const maxPlayers = Math.max(2, Math.min(4, Number(document.getElementById('multi-host-size').value) || 4));
      const stageKey = document.getElementById('multi-host-stage').value;
      const roomId = this.makeRoomId();
      const member = this.makeMember({ ...user, nickname: UserProfileStore.data.nickname || user.username }, peerId, selection, 0);
      const room = {
        roomId, hostUid: user.uid, hostPeerId: peerId,
        hostName: UserProfileStore.data.nickname || user.username,
        maxPlayers, stageKey, status: 'waiting', accepting: true,
        createdAt: Date.now(), heartbeatAt: FirebaseRTDB.serverTimestamp(),
        members: { [user.uid]: member },
      };
      const { ref, set, onDisconnect } = FirebaseRTDB;
      const roomRef = ref(FirebaseRTDB.db, `rooms/${roomId}`);
      await set(roomRef, room);
      await onDisconnect(roomRef).remove();
      this.role = 'host'; this.roomId = roomId; this.room = room; this.localSelection = selection; this.localPlayerIndex = 0;
      this.startRoomHeartbeat();
      this.renderLobby();
      AppFlow.showScreen('multi-lobby');
    } catch (error) {
      console.error(error);
      this.setMessage(error.message || '部屋を作成できませんでした');
    }
  },

  async refreshRooms() {
    try {
      this.requireServices();
      const { ref, query, orderByChild, equalTo, onValue, off } = FirebaseRTDB;
      if (this.roomsUnsubscribe) this.roomsUnsubscribe();
      const roomsQuery = query(ref(FirebaseRTDB.db, 'rooms'), orderByChild('status'), equalTo('waiting'));
      const handler = snapshot => this.renderRoomList(snapshot.val() || {});
      onValue(roomsQuery, handler, error => this.setMessage(`部屋一覧を取得できません: ${error.message}`));
      this.roomsUnsubscribe = () => off(roomsQuery, 'value', handler);
      this.setMessage('部屋を検索しています…');
    } catch (error) {
      this.setMessage(error.message || '部屋を検索できませんでした');
    }
  },

  renderRoomList(rooms) {
    const list = document.getElementById('multi-room-list');
    const now = Date.now();
    const entries = Object.values(rooms).filter(room => {
      if (!room || room.status !== 'waiting' || room.accepting === false) return false;
      const heartbeat = Number(room.heartbeatAt || room.createdAt || 0);
      return heartbeat > 0 && now - heartbeat < 45000;
    });
    this.availableRooms = Object.fromEntries(entries.map(room => [room.roomId, room]));
    list.innerHTML = entries.length ? entries.map(room => {
      const stage = STAGES[room.stageKey];
      const humans = Object.keys(room.members || {}).length;
      return `<button class="multi-room-card" data-room-id="${room.roomId}">
        <strong>${this.escapeHtml(room.hostName)}の部屋</strong>
        <span>${stage ? stage.displayName : room.stageKey}／${humans}・${room.maxPlayers}人</span>
        <small>ROOM ${room.roomId}</small>
      </button>`;
    }).join('') : '<div class="multi-empty">現在入れる部屋はありません</div>';
    this.setMessage('');
  },

  async joinRoom(roomId) {
    try {
      this.requireServices();
      const selection = this.selectionFor('guest');
      if (!selection) throw new Error('使用するマスモンを選択してください');
      const roomSnapshot = await FirebaseRTDB.get(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${roomId}`));
      const room = roomSnapshot.val();
      if (!room) throw new Error('部屋が見つかりません');
      const heartbeat = Number(room.heartbeatAt || room.createdAt || 0);
      if (room.status !== 'waiting' || room.accepting === false || Date.now() - heartbeat >= 45000) {
        throw new Error('この部屋は現在接続できません。部屋一覧を更新してください');
      }
      if (Object.keys(room.members || {}).length >= room.maxPlayers) throw new Error('この部屋は満員です');
      if (room.members?.[AppFlow.currentUser.uid]) throw new Error('ホストとは別のアカウントで参加してください');
      this.setMessage('ホストへ接続しています…');
      await this.leaveRoom(false);
      await this.ensurePeer();
      const connection = await this.connectToHost(room.hostPeerId);
      this.hostConnection = connection;
      this.role = 'guest'; this.roomId = roomId; this.room = room; this.localSelection = selection;
      connection.send({
        type: 'join',
        user: { ...AppFlow.currentUser, nickname: UserProfileStore.data.nickname || AppFlow.currentUser.username },
        peerId: this.peerId,
        selection,
      });
      connection.on('data', data => this.handleHostData(data));
      connection.on('close', () => this.handleHostClosed());
      connection.on('error', error => this.setLobbyMessage(`接続エラー: ${error.message}`));
    } catch (error) {
      console.error(error);
      this.hostConnection?.close();
      this.hostConnection = null;
      this.role = null; this.roomId = null; this.room = null; this.localSelection = null;
      const message = error.type === 'peer-unavailable'
        ? 'ホストが見つかりません。ホスト側で部屋を開いたまま、部屋一覧を更新して入り直してください'
        : (error.message || '部屋に参加できませんでした');
      this.setMessage(message);
    }
  },

  connectToHost(hostPeerId) {
    return new Promise((resolve, reject) => {
      const connection = this.peer.connect(hostPeerId, { serialization: 'json' });
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pendingJoin?.peerId === hostPeerId) this.pendingJoin = null;
        callback(value);
      };
      const timer = setTimeout(() => {
        connection.close();
        finish(reject, new Error('ホストへの接続がタイムアウトしました'));
      }, 12000);
      this.pendingJoin = { peerId: hostPeerId, reject: error => finish(reject, error) };
      connection.on('open', () => finish(resolve, connection));
      connection.on('error', error => finish(reject, error));
      connection.on('close', () => finish(reject, new Error('ホストへの接続が閉じられました')));
    });
  },

  acceptGuestConnection(connection) {
    if (this.role !== 'host') { connection.on('open', () => connection.close()); return; }
    connection.on('data', data => {
      if (data && data.type === 'join') this.acceptJoin(connection, data);
      else if (data && data.type === 'input') this.remoteInputs.set(Number(data.playerIndex), data.input || {});
    });
    connection.on('close', () => this.removeGuestByConnection(connection));
  },

  async acceptJoin(connection, data) {
    const user = data.user || {};
    const members = this.sortedMembers();
    if (!user.uid || this.room.status !== 'waiting' || members.length >= this.room.maxPlayers) {
      connection.send({ type: 'rejected', message: '部屋に参加できませんでした' });
      connection.close();
      return;
    }
    const occupied = new Set(members.map(member => member.playerIndex));
    const index = Array.from({ length: this.room.maxPlayers }, (_, i) => i).find(i => !occupied.has(i));
    const member = this.makeMember(user, data.peerId, data.selection, index);
    this.room.members[user.uid] = member;
    this.guestConnections.set(user.uid, connection);
    connection._smamonUid = user.uid;
    await FirebaseRTDB.set(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}/members/${user.uid}`), member);
    this.broadcastLobby();
    this.renderLobby();
  },

  handleHostData(data) {
    if (!data) return;
    if (data.type === 'rejected') { this.setMessage(data.message); this.leaveRoom(true); return; }
    if (data.type === 'lobby') {
      this.room = data.room;
      const member = this.sortedMembers().find(item => item.uid === AppFlow.currentUser.uid);
      this.localPlayerIndex = member ? member.playerIndex : 0;
      this.renderLobby();
      AppFlow.showScreen('multi-lobby');
    } else if (data.type === 'versus-go') {
      // ホストが対戦カード画面で「バトル開始」を押した合図
      this.versusGo();
    } else if (data.type === 'start') {
      this.beginNetworkBattle(data);
    } else if (data.type === 'state') {
      this.latestState = data;
    } else if (data.type === 'matchEnd') {
      if (!window._matchOver) window._matchOver = true;
      AppFlow.onMatchEnd({ ranking: data.ranking });
    }
  },

  broadcastLobby() {
    const packet = { type: 'lobby', room: this.room };
    this.guestConnections.forEach(connection => { if (connection.open) connection.send(packet); });
  },

  renderLobby() {
    if (!this.room) return;
    const stage = STAGES[this.room.stageKey];
    document.getElementById('multi-lobby-room').textContent = `ROOM ${this.room.roomId}／${stage ? stage.displayName : this.room.stageKey}／${this.room.maxPlayers}人対戦`;
    const members = this.sortedMembers();
    const lobby = document.getElementById('multi-lobby-members');
    lobby.innerHTML = Array.from({ length: this.room.maxPlayers }, (_, index) => {
      const member = members[index];
      if (!member) return `<div class="multi-member-slot empty"><strong>CPU Lv.9</strong><small>対戦開始時に補充</small></div>`;
      return `<div class="multi-member-slot"><img alt=""><span><strong>${this.escapeHtml(member.name)}</strong><small>${this.escapeHtml(member.selection.name)} Lv.${member.selection.level}</small></span></div>`;
    }).join('');
    // 相手のスキン（色変更）も反映する
    members.forEach((member, index) => {
      const def = FIGHTERS[member.selection.fighterKey];
      const img = lobby.children[index]?.querySelector('img');
      if (img && def) Skin.paintInto(img, def.stockIcon || def.idleImage, member.selection.skin);
    });
    document.getElementById('multi-start-battle').classList.toggle('hidden', this.role !== 'host');
  },

  async startHostMatch() {
    if (this.role !== 'host' || !this.room) return;
    const members = this.sortedMembers();
    const roster = members.map(member => ({ ...member.selection, playerUid: member.uid, playerName: member.name, isCpu: false }));
    let cpuIndex = 0;
    while (roster.length < this.room.maxPlayers) {
      const source = members[cpuIndex % members.length].selection;
      roster.push({ ...source, masmonId: null, name: `${source.name} CPU`, playerUid: `cpu-${cpuIndex + 1}`, playerName: `CPU${cpuIndex + 1}`, isCpu: true });
      cpuIndex++;
    }
    this.room.status = 'playing';
    await FirebaseRTDB.update(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}`), { status: 'playing' });
    const packet = { type: 'start', stageKey: this.room.stageKey, roster };
    this.guestConnections.forEach(connection => { if (connection.open) connection.send(packet); });
    this.beginNetworkBattle(packet);
  },

  beginNetworkBattle(packet) {
    const localUid = AppFlow.currentUser.uid;
    this.localPlayerIndex = packet.roster.findIndex(entry => entry.playerUid === localUid);
    if (this.localPlayerIndex < 0) this.localPlayerIndex = 0;
    const localEntry = packet.roster[this.localPlayerIndex];
    const options = {
      mode: 'multi', stageKey: packet.stageKey, multiplayerRoster: packet.roster,
      localPlayerIndex: this.localPlayerIndex, localFighterIndex: this.localPlayerIndex,
      p1MasmonId: localEntry.masmonId || this.localSelection?.masmonId || null,
      p1Key: localEntry.fighterKey, cpuLevel: 9,
    };
    AppFlow.lastLaunchOptions = options;
    AppFlow.playBattleIntro(options);
  },

  // ---- 対戦カード（開始前のステータス比較）の同期 ----
  // 全員に同じカードを見せ、ホストが押した合図で一斉に始める。
  _versusResolve: null,
  waitForVersusGo() {
    return new Promise(resolve => { this._versusResolve = resolve; });
  },
  versusGo() {
    const resolve = this._versusResolve;
    this._versusResolve = null;
    if (resolve) resolve(true);
  },
  sendVersusGo() {
    if (this.role !== 'host') return;
    const packet = { type: 'versus-go' };
    this.guestConnections.forEach(connection => { if (connection.open) connection.send(packet); });
    this.versusGo();
  },

  getRemoteInput(index) { return this.remoteInputs.get(index) || {}; },
  sendLocalInput(input) {
    if (this.role !== 'guest' || !this.hostConnection?.open) return;
    if (++this.inputFrame % 2 === 0) this.hostConnection.send({ type: 'input', playerIndex: this.localPlayerIndex, input: this.cleanInput(input) });
  },
  broadcastState(state) {
    if (this.role !== 'host' || ++this.stateFrame % 3 !== 0) return;
    const packet = { type: 'state', ...state };
    this.guestConnections.forEach(connection => { if (connection.open) connection.send(packet); });
  },
  consumeLatestState() { const state = this.latestState; this.latestState = null; return state; },
  broadcastMatchEnd(ranking) {
    if (this.role !== 'host') return;
    this.guestConnections.forEach(connection => { if (connection.open) connection.send({ type: 'matchEnd', ranking }); });
  },

  cleanInput(input) {
    const result = {};
    ['left','right','up','down','jump','attack','special','shield','grab'].forEach(key => { result[key] = !!input[key]; });
    result.stickX = Math.max(-1, Math.min(1, Number(input.stickX) || 0));
    result.stickY = Math.max(-1, Math.min(1, Number(input.stickY) || 0));
    return result;
  },

  makeMember(user, peerId, selection, playerIndex) {
    return { uid: user.uid, name: user.nickname || user.username || 'ブリーダー', peerId, selection, playerIndex, joinedAt: Date.now() };
  },
  sortedMembers() { return Object.values(this.room?.members || {}).sort((a, b) => a.playerIndex - b.playerIndex || a.joinedAt - b.joinedAt); },
  makeRoomId() { return Math.random().toString(36).slice(2, 8).toUpperCase(); },
  escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; },
  setMessage(message) { const el = document.getElementById('multi-menu-message'); if (el) el.textContent = message; },
  setLobbyMessage(message) { const el = document.getElementById('multi-lobby-room'); if (el) el.textContent = message; },

  async removeGuestByConnection(connection) {
    const uid = connection._smamonUid;
    if (!uid || !this.room?.members) return;
    delete this.room.members[uid]; this.guestConnections.delete(uid);
    this.sortedMembers().forEach((member, index) => { member.playerIndex = index; });
    if (window.FirebaseRTDB && this.roomId) {
      await FirebaseRTDB.set(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}/members`), this.room.members).catch(() => {});
    }
    this.broadcastLobby(); this.renderLobby();
  },

  handleHostClosed() {
    if (this.role !== 'guest') return;
    this.setMessage('ホストとの接続が終了しました');
    if (!window._matchOver) AppFlow.showScreen('multi-menu');
    this.role = null; this.room = null; this.roomId = null;
  },

  async leaveRoom(showMenu = false) {
    this.stopRoomHeartbeat();
    clearTimeout(this.peerReconnectTimer);
    this.peerReconnectTimer = null;
    this.pendingJoin = null;
    if (this.roomsUnsubscribe) { this.roomsUnsubscribe(); this.roomsUnsubscribe = null; }
    if (this.role === 'host' && this.roomId && window.FirebaseRTDB) {
      await FirebaseRTDB.remove(FirebaseRTDB.ref(FirebaseRTDB.db, `rooms/${this.roomId}`)).catch(() => {});
    }
    this.hostConnection?.close();
    this.guestConnections.forEach(connection => connection.close());
    this.guestConnections.clear(); this.remoteInputs.clear(); this.latestState = null;
    this.role = null; this.room = null; this.roomId = null; this.hostConnection = null;
    if (showMenu) this.openMenu();
  },
};

window.Multiplayer = Multiplayer;
