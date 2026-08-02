// イルミネ専用技。画像が用意されたら projectileSprite のパスへ置くだけで弓矢表示に差し替えられる。
window.FIGHTER_MOVESETS = window.FIGHTER_MOVESETS || {};
window.FIGHTER_MOVESETS.irumine = {
  special: {
    neutral: {
      name: 'ルミナスアロー', dmgBase: 8, kbBase: 4.5, angle: 32,
      duration: 24, active: [9, 9], range: 0, h: 0, yOff: 0,
      statKey: 'intelligence', endlag: 16,
      projectile: { speed: 12, width: 54, height: 12, lifetime: 95, spawnFrame: 9 },
      projectileSprite: 'assets/images/fighter/irumine/projectiles/arrow.png',
    },
    down: {
      name: 'ローリングボム', dmgBase: 10, kbBase: 6, angle: 58,
      duration: 25, active: [9, 9], range: 0, h: 0, yOff: 0,
      statKey: 'intelligence', endlag: 17,
      projectile: {
        type: 'bomb', speed: 5.5, width: 34, height: 34,
        lifetime: 150, spawnFrame: 9, gravity: 0.28,
        groundFriction: 0.985, explosionRadius: 105,
      },
      projectileSprite: 'assets/images/fighter/irumine/projectiles/bomb.png',
    },
  },
};
