// イルミネ専用技。画像が用意されたら projectileSprite のパスへ置くだけで弓矢表示に差し替えられる。
window.FIGHTER_MOVESETS = window.FIGHTER_MOVESETS || {};
window.FIGHTER_MOVESETS.irumine = {
  ground: {
    // 弱A技：既存のバランス値(MOVES.ground.neutral)はそのまま、見た目だけ専用スプライトに差し替え
    neutral: {
      ...MOVES.ground.neutral,
      animation: {
        frames: [
          'assets/images/fighter/irumine/neutral_attack/frame_001.png',
          'assets/images/fighter/irumine/neutral_attack/frame_002.png',
          'assets/images/fighter/irumine/neutral_attack/frame_003.png',
          'assets/images/fighter/irumine/neutral_attack/frame_004.png',
        ],
        frameDuration: 2,
        contentBox: { left: 22, top: 3, right: 372, bottom: 264 },
      },
    },
  },
  special: {
    neutral: {
      name: 'ルミナスアロー', dmgBase: 8, kbBase: 4.5, angle: 32,
      duration: 24, active: [9, 9], range: 0, h: 0, yOff: 0,
      statKey: 'intelligence', endlag: 16,
      projectile: { speed: 12, width: 108, height: 30, lifetime: 95, spawnFrame: 9 },
      projectileSprite: 'assets/images/fighter/irumine/projectiles/arrow.png',
      animation: {
        // 001(構え)→002(つがえ)→003(引き絞り)→004(発射)→005(弦戻り)→006(構え解除)
        // frameDuration:3 とすることで 004(発射コマ) の開始が elapsed=9 となり、
        // projectile.spawnFrame:9（矢が実際に飛び出すフレーム）とぴったり一致する。
        frames: [
          'assets/images/fighter/irumine/neutral_special/frame_001.png',
          'assets/images/fighter/irumine/neutral_special/frame_002.png',
          'assets/images/fighter/irumine/neutral_special/frame_003.png',
          'assets/images/fighter/irumine/neutral_special/frame_004.png',
          'assets/images/fighter/irumine/neutral_special/frame_005.png',
          'assets/images/fighter/irumine/neutral_special/frame_006.png',
        ],
        frameDuration: 3,
        // 344x256の実画像を解析：本体は上端y14〜足元y232、横中心x162（弓・矢・影は除外）
        contentBox: { left: 0, top: 14, right: 324, bottom: 232 },
      },
    },
    side: {
      // バスターソード：回転しながら相手を巻き込み連続ヒットする5段技(約2.1秒)。
      // frame_001(振りかぶり)→002(初撃)→[003→004→005]×5ループ(1ループ=1ヒット)→002(締め)で終了。
      // 1〜4段目はガード不能の怯ませ判定(ダメージ小)、5段目=最終段のみ吹っ飛ばす。
      name: 'バスターソード', dmgBase: 1.8, kbBase: 2, angle: 20,
      duration: 126, active: [16, 25], range: 74, h: 54, yOff: 2,
      statKey: 'intelligence', endlag: 14,
      travelSpeed: 1.6, // 相手の方向へ少しずつ前進しながら回転する
      // 各ループ(003→004→005 = 21F)の中央に1回ずつヒット判定を置く
      multiHit: [[16, 25], [37, 46], [58, 67], [79, 88], [100, 109]],
      linkKbScale: 0.12,
      linkHitstun: 26, // 次の段(最長21F後)まで確実に硬直させ、途中でガードに移行できないようにする
      finalHit: { dmgBase: 6.5, kbBase: 6.5, angle: 38 },
      animation: {
        frames: [
          'assets/images/fighter/irumine/side_special/frame_001.png',
          'assets/images/fighter/irumine/side_special/frame_002.png',
          'assets/images/fighter/irumine/side_special/frame_003.png',
          'assets/images/fighter/irumine/side_special/frame_004.png',
          'assets/images/fighter/irumine/side_special/frame_005.png',
          'assets/images/fighter/irumine/side_special/frame_003.png',
          'assets/images/fighter/irumine/side_special/frame_004.png',
          'assets/images/fighter/irumine/side_special/frame_005.png',
          'assets/images/fighter/irumine/side_special/frame_003.png',
          'assets/images/fighter/irumine/side_special/frame_004.png',
          'assets/images/fighter/irumine/side_special/frame_005.png',
          'assets/images/fighter/irumine/side_special/frame_003.png',
          'assets/images/fighter/irumine/side_special/frame_004.png',
          'assets/images/fighter/irumine/side_special/frame_005.png',
          'assets/images/fighter/irumine/side_special/frame_003.png',
          'assets/images/fighter/irumine/side_special/frame_004.png',
          'assets/images/fighter/irumine/side_special/frame_005.png',
          'assets/images/fighter/irumine/side_special/frame_002.png',
        ],
        frameDuration: 7,
        // 553x372の実画像を解析した本体bbox（frame_001の直立時の本体高さ243pxを基準／剣・軌跡は除外）
        contentBox: { left: 81, top: 81, right: 391, bottom: 324 },
      },
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
      animation: {
        frames: [
          'assets/images/fighter/irumine/down_special/frame_001.png',
          'assets/images/fighter/irumine/down_special/frame_002.png',
          'assets/images/fighter/irumine/down_special/frame_003.png',
          'assets/images/fighter/irumine/down_special/frame_004.png',
        ],
        frameDuration: 6,
        contentBox: { left: 6, top: 6, right: 257, bottom: 333 },
      },
    },
  },
};
