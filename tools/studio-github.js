// ==== モンスター作成スタジオ：GitHub連携 ====
// Git Data API（blob → tree → commit → ref更新）を使い、
// 画像・JSON・Service Worker・バージョンの更新をまとめて「1回のコミット」で反映する。
// Contents APIでファイルを1つずつ書くとコミットが乱立し、途中で失敗すると
// 画像だけ入ってデータが古い、という中途半端な状態になるため必ずまとめて送る。
const StudioGitHub = {
  API: 'https://api.github.com',
  token: '',
  repo: '',
  branch: 'main',

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('smamon_studio_github') || '{}');
      this.token = saved.token || '';
      this.repo = saved.repo || 'cadmium2525/sumamon';
      this.branch = saved.branch || 'main';
    } catch (_) {
      this.repo = 'cadmium2525/sumamon';
      this.branch = 'main';
    }
    return { token: this.token, repo: this.repo, branch: this.branch };
  },

  saveSettings({ token, repo, branch }) {
    this.token = (token || '').trim();
    this.repo = (repo || '').trim();
    this.branch = (branch || 'main').trim();
    localStorage.setItem('smamon_studio_github',
      JSON.stringify({ token: this.token, repo: this.repo, branch: this.branch }));
  },

  clearToken() {
    this.token = '';
    localStorage.setItem('smamon_studio_github',
      JSON.stringify({ token: '', repo: this.repo, branch: this.branch }));
  },

  async _request(path, options = {}) {
    const response = await fetch(`${this.API}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) { /* 本文なし */ }
      const hint = response.status === 401 ? '（トークンが無効か期限切れです）'
        : response.status === 403 ? '（トークンの権限が不足しています。Contents を Read and write に）'
        : response.status === 404 ? '（リポジトリ名が違うか、トークンの対象に含まれていません）'
        : '';
      throw new Error(`GitHub ${response.status}: ${detail} ${hint}`.trim());
    }
    return response.status === 204 ? null : response.json();
  },

  // 接続テスト：リポジトリが見えるかを確認する。
  // 書き込み権限の有無はここでは断定しない。fine-grainedトークンでは
  // permissions.push が実際の権限を正しく反映しないことがあり、
  // 実際にはコミットできるのに「権限がありません」と誤って弾いてしまうため、
  // 判定できない場合は注意書きにとどめて先へ進ませる。
  async testConnection() {
    const repo = await this._request(`/repos/${this.repo}`);
    const canPush = !!(repo.permissions && repo.permissions.push);
    return { name: repo.full_name, canPush };
  },

  async getFile(path) {
    try {
      const data = await this._request(`/repos/${this.repo}/contents/${encodeURI(path)}?ref=${this.branch}`);
      if (Array.isArray(data) || !data.content) return null;
      // GitHubのbase64は改行入りなので取り除いてからデコードする
      const binary = atob(data.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (error) {
      if (String(error.message).includes('404')) return null;
      throw error;
    }
  },

  _base64(bytes) {
    let binary = '';
    const chunk = 0x8000; // 大きい画像で引数が多すぎるエラーにならないよう分割する
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  },

  // files: [{ path, text }] または [{ path, bytes }]
  async commitFiles(files, message, onProgress) {
    const report = (text) => { if (onProgress) onProgress(text); };

    report('現在のブランチを取得中…');
    const ref = await this._request(`/repos/${this.repo}/git/ref/heads/${this.branch}`);
    const baseCommitSha = ref.object.sha;
    const baseCommit = await this._request(`/repos/${this.repo}/git/commits/${baseCommitSha}`);

    const tree = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      report(`アップロード中 ${i + 1}/${files.length}: ${file.path}`);
      const blob = await this._request(`/repos/${this.repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify(file.bytes
          ? { content: this._base64(file.bytes), encoding: 'base64' }
          : { content: file.text, encoding: 'utf-8' }),
      });
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    report('ツリーを作成中…');
    const newTree = await this._request(`/repos/${this.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });

    report('コミット中…');
    const commit = await this._request(`/repos/${this.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
    });

    report('ブランチを更新中…');
    await this._request(`/repos/${this.repo}/git/refs/heads/${this.branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return commit.sha;
  },
};
