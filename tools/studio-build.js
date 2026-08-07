// ==== モンスター作成スタジオ：コミット内容の組み立て ====
// 画像とデータだけでなく、Service Workerのキャッシュ対象・キャッシュ番号・version.json・
// 更新履歴まで面倒を見る。ここが漏れると「更新したのに反映されない」が起きるため、
// 手作業で忘れがちな部分こそツール側で必ず更新する。
const StudioBuild = {
  // service-worker.js の APP_SHELL へ画像パスを追記し、キャッシュ番号を1つ上げる
  updateServiceWorker(source, imagePaths) {
    let out = source;

    // smamon-app-vNN → NN+1
    const cacheMatch = out.match(/const CACHE_NAME = '([a-z-]+)v(\d+)';/);
    if (!cacheMatch) throw new Error('service-worker.js のキャッシュ名を認識できませんでした');
    const nextVersion = Number(cacheMatch[2]) + 1;
    out = out.replace(cacheMatch[0], `const CACHE_NAME = '${cacheMatch[1]}v${nextVersion}';`);

    // APP_SHELL に未登録の画像だけ足す
    const shellMatch = out.match(/const APP_SHELL = \[\n([\s\S]*?)\n\];/);
    if (!shellMatch) throw new Error('service-worker.js の APP_SHELL を認識できませんでした');
    const body = shellMatch[1];
    const existing = new Set([...body.matchAll(/'([^']+)'/g)].map(m => m[1]));
    const additions = imagePaths
      .map(path => `./${path}`)
      .filter(path => !existing.has(path));
    if (additions.length) {
      const lines = body.split('\n');
      const lastIndex = lines.length - 1;
      // 最終行の末尾にカンマが無いので付けてから追記する
      lines[lastIndex] = lines[lastIndex].replace(/,?\s*$/, ',');
      const inserted = additions.map(path => `  '${path}'`).join(',\n');
      out = out.replace(shellMatch[0], `const APP_SHELL = [\n${lines.join('\n')}\n${inserted}\n];`);
    }
    return { source: out, version: nextVersion, added: additions.length };
  },

  versionJson(version) {
    return `{\n  "version": "${version}"\n}\n`;
  },

  // index.html のバージョン表記と更新履歴を更新する
  // 表示用のバージョン文字列。99までは 0.99、100以降は 1.00 のように繰り上げる。
  versionLabel(version) {
    const n = Number(version) || 0;
    return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
  },

  updateIndexHtml(source, version, title, body) {
    let out = source;
    const label = this.versionLabel(version);
    const versionMatch = out.match(/<small class="home-version">Version [\d.]+<\/small>/);
    if (versionMatch) {
      out = out.replace(versionMatch[0], `<small class="home-version">Version ${label}</small>`);
    }
    const listMatch = out.match(/(<div class="home-history-list">\s*\n)/);
    if (listMatch) {
      const entry = `          <article><time>Version ${label}</time><strong>${this.escapeHtml(title)}</strong>` +
        `<p>${this.escapeHtml(body)}</p></article>\n`;
      out = out.replace(listMatch[0], listMatch[0] + entry);
    }
    return out;
  },

  escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  // fighters.json へモンスターを追加/更新する
  applyFighter(fightersJson, spec) {
    const data = { ...fightersJson };
    const previous = data[spec.key] || {};
    const fighter = {
      ...previous,
      key: spec.key,
      displayName: spec.displayName,
      color: spec.color,
      hurtboxWidth: spec.hurtboxWidth,
      hurtboxHeight: spec.hurtboxHeight,
      fallSpeed: spec.fallSpeed,
      proceduralMotion: spec.proceduralMotion,
    };
    // 技の強さ（倍率）。全て標準ならキーごと消して、余計な記述を残さない。
    if (spec.movePower) fighter.movePower = spec.movePower; else delete fighter.movePower;
    if (spec.parts) fighter.parts = spec.parts; else delete fighter.parts;
    if (spec.weapon) fighter.weapon = spec.weapon; else delete fighter.weapon;
    if (spec.idleImage) fighter.idleImage = spec.idleImage;
    if (spec.stockIcon) fighter.stockIcon = spec.stockIcon;
    if (spec.spriteContentBox) fighter.spriteContentBox = spec.spriteContentBox;
    if (spec.stats) fighter.stats = spec.stats;
    else delete fighter.stats;
    // 適性はゲーム側(js/growth-system.js)ではなくデータに持つ。
    // こうするとスタジオから編集でき、登録済みの値も読み取れる。
    if (spec.aptitudes) fighter.aptitudes = this.aptitudes(spec.aptitudes);
    else delete fighter.aptitudes;
    if (spec.animations && Object.keys(spec.animations).length) {
      fighter.animations = { ...(previous.animations || {}), ...spec.animations };
    }
    data[spec.key] = fighter;
    return data;
  },

  // movesets.json へ技モーション/飛び道具を追加・更新する。
  // moveData[slot] = { animation?, projectile?, projectileSprite? }
  applyMoveset(movesetsJson, key, moveData) {
    const data = { ...movesetsJson };
    const fighter = { ...(data[key] || {}) };
    for (const [slot, update] of Object.entries(moveData)) {
      const [group, moveKey] = slot.split('.');
      const groupData = { ...(fighter[group] || {}) };
      const existing = groupData[moveKey];
      // 新規の技は共通テーブル(MOVES)を継承する。
      // 既にその技が独自のバランス値を持っている場合はそのまま活かし、extendsを付け足さない
      // （付けると意図しない既定値が混ざり込む）。
      const next = existing ? { ...existing } : { extends: `${group}.${moveKey}` };
      if (update.animation) next.animation = update.animation;
      if (update.attack) {
        // 攻撃判定の設定。hitboxes があるコマ送りの判定は range/h/yOff を使わないため、
        // 古い固定judgeが残って二重にならないよう取り除く。
        const { hitboxes, multiHit, ...rest } = update.attack;
        Object.assign(next, rest);
        next.hitboxes = hitboxes;
        if (multiHit) next.multiHit = multiHit; else delete next.multiHit;
        delete next.range;
        delete next.h;
        delete next.yOff;
      }
      if (update.projectile) {
        next.projectile = update.projectile;
        if (update.projectileSprite) next.projectileSprite = update.projectileSprite;
      } else if (update.removeProjectile) {
        delete next.projectile;
        delete next.projectileSprite;
      }
      groupData[moveKey] = next;
      fighter[group] = groupData;
    }
    data[key] = fighter;
    return data;
  },

  // 適性（S〜E表記は使わずゲームと同じA〜E）
  aptitudes(values) {
    const keys = ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'];
    const out = {};
    keys.forEach(k => { out[k] = values[k] || 'C'; });
    return out;
  },
};
