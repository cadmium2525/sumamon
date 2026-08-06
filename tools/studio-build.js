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
  updateIndexHtml(source, version, title, body) {
    let out = source;
    const label = `0.${version}`;
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
    };
    if (spec.idleImage) fighter.idleImage = spec.idleImage;
    if (spec.stockIcon) fighter.stockIcon = spec.stockIcon;
    if (spec.spriteContentBox) fighter.spriteContentBox = spec.spriteContentBox;
    if (spec.stats) fighter.stats = spec.stats;
    else delete fighter.stats;
    if (spec.animations && Object.keys(spec.animations).length) {
      fighter.animations = { ...(previous.animations || {}), ...spec.animations };
    }
    data[spec.key] = fighter;
    return data;
  },

  // movesets.json へ技モーションを追加/更新する（バランス値は共通テーブルを継承したまま）
  applyMoveset(movesetsJson, key, moveAnimations) {
    const data = { ...movesetsJson };
    const fighter = { ...(data[key] || {}) };
    for (const [slot, animation] of Object.entries(moveAnimations)) {
      const [group, moveKey] = slot.split('.');
      const groupData = { ...(fighter[group] || {}) };
      const existing = groupData[moveKey] || {};
      groupData[moveKey] = { ...existing, extends: `${group}.${moveKey}`, animation };
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
