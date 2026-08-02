// ==== スマモン 共通設定 ====
const CONFIG = {
  // ワールド/カメラ（広めに取って「奈落までの遠さ」を演出）
  CANVAS_W: 1400,
  CANVAS_H: 1000,
  GRAVITY: 0.25,
  MAX_FALL_SPEED: 6.3,
  GROUND_Y: 750,
  BLAST_MARGIN: 260, // 画面外どこまで飛んだらKOか

  // 回避ステータス -> 落下速度への影響（ダッシュが速い代わりに落下も速い）
  EVASION_FALL_SCALE: 0.003,
  EVASION_FALL_BONUS_MAX: 0.3,

  // 吹っ飛び計算共通係数（各技のkbBaseと組み合わせて使用）
  KB_BASE_MULTIPLIER: 0.82,
  KB_DAMAGE_SCALE: 0.07,
  KB_POWER_SCALE: 0.006,
  KB_STAT_BONUS_MAX: 0.65,
  DEFENSE_SCALE: 0.003,
  DEFENSE_REDUCTION_MAX: 0.35,

  DAMAGE_STAT_SCALE: 0.01,
  DAMAGE_STAT_BONUS_MAX: 1.2,
  LIFE_DAMAGE_REDUCTION_SCALE: 0.002,
  LIFE_DAMAGE_REDUCTION_MAX: 0.35,
  CRITICAL_CHANCE_BASE: 0.005,
  ACCURACY_CRITICAL_SCALE: 0.0007,
  CRITICAL_CHANCE_MAX: 0.12,

  // 移動（通常は遅め、ダッシュで倍速程度に）
  WALK_SPEED_BASE: 1.6,
  DASH_SPEED_BASE: 3.2,
  EVASION_SPEED_SCALE: 0.006,
  EVASION_SPEED_BONUS_MAX: 0.55,

  // 左スティックの倒し込み量(0〜1)による 歩き/ダッシュ/ステップ の判定
  // ・DASH_TILT_THRESHOLD以上倒す = ダッシュ判定（保持し続ければ走り、すぐ離せば結果的に短い「ステップ」になる）
  // ・それ未満〜デッドゾーン以上 = 歩き（倒し込み量に比例した速度）
  DASH_TILT_THRESHOLD: 0.8,
  WALK_DEADZONE: 0.15,

  JUMP_POWER: -13, // 少しだけダウン
  MAX_JUMPS: 2, // 地上含め最大ジャンプ回数(2段ジャンプ)

  // 小ジャンプ/大ジャンプ（ジャンプ入力を早く離すと小ジャンプになる）
  SHORT_HOP_FRAMES: 6,          // このフレーム数以内にジャンプ入力を離すと小ジャンプ
  SHORT_HOP_CUT_MULTIPLIER: 0.5, // 小ジャンプ時の上昇速度カット率

  // 空中緊急回避（エアドッジ）
  AIR_DODGE_FRAMES: 22,       // 無敵で移動する時間
  AIR_DODGE_LAG_FRAMES: 32,   // 回避後の硬直（隙）
  AIR_DODGE_SPEED: 6.5,       // 方向入力ありの場合の移動速度

  // 崖掴まり
  LEDGE_GRAB_RANGE_X: 32,
  LEDGE_GRAB_RANGE_Y: 70,
  LEDGE_INVINCIBLE_FRAMES: 40,
  LEDGE_COOLDOWN_FRAMES: 20,     // 手を離した直後の再キャッチ防止
  LEDGE_MAX_HANG_FRAMES: 300,    // 掴まり続けられる最大時間（粘り防止）

  // 当たり判定の基準サイズ（技のrange/kbBase等はこのサイズを基準に調整されている）
  // 各ファイターの実際のhurtboxサイズがこれより大きい/小さい場合、
  // Fighter.attackScale (= this.h / BASE_HURTBOX_H) で技の間合い・シールド半径・掴み距離を比例調整する
  BASE_HURTBOX_W: 36,
  BASE_HURTBOX_H: 54,

  // 足場画像の上端から何%下を「実際にファイターが乗る面」にするか
  // （platform.png は上部に空間があるため、画像の一番上ではなく少し下が実際の足場面になる）
  PLATFORM_SURFACE_RATIO: 0.25,

  STOCK_DEFAULT: 3,
  RESPAWN_INVINCIBLE_FRAMES: 90,

  // シールド
  SHIELD_MAX: 100,
  SHIELD_DRAIN_PER_FRAME: 0.45,   // 押しっぱなしで約3.7秒で割れる
  SHIELD_REGEN_PER_FRAME: 0.3,
  SHIELD_BREAK_DAZE_FRAMES: 240, // 4秒 ピヨリ状態

  // 回避（シールド+方向）
  DODGE_SPOT_FRAMES: 24,   // その場回避
  DODGE_ROLL_FRAMES: 20,   // 横回避（ステップ）
  DODGE_ROLL_SPEED: 9,

  // 掴み
  GRAB_RANGE_DEFAULT: 55,
  GRAB_RELEASE_TIMEOUT_FRAMES: 100, // 投げ入力が無ければ自動解放

  // スマッシュ（溜め）
  // 方向入力がAより先行していれば強攻撃(tilt)、方向とAがほぼ同時ならスマッシュ、という判定に使用
  SMASH_SIMULTANEOUS_WINDOW_MS: 120, // この猶予内の同時押しならスマッシュ扱い
  SMASH_MAX_CHARGE_FRAMES: 180,      // 約3秒でカンスト
  SMASH_CHARGE_BONUS_MAX: 0.3,       // フルチャージで+30%（少し補正）

  // カメラ（スマブラ風：fighter同士の距離に応じて自動でズームイン/アウトする）
  CAMERA_MIN_ZOOM: 0.55,       // 最大までズームアウトした時の倍率（両者が離れている時）
  CAMERA_MAX_ZOOM: 1.9,        // 最大までズームインした時の倍率（両者が近い時。もっと寄れるように引き上げ）
  CAMERA_PADDING_X: 170,       // ズーム計算時、fighter同士の左右バウンディングボックスに足す余白（ワールド座標）
  CAMERA_PADDING_Y: 150,       // 同上（上下）
  CAMERA_SMOOTHING: 0.08,      // 位置・ズームの追従速度（大きいほど素早く追従する。0〜1）

  // 仮想パッドのボタン表示設定（プレイヤーが設定画面で変更可能・localStorageへ保存）
  DEFAULT_PAD_CONFIG: {
    showJumpButton: true,   // スティック上入力でもジャンプ可能なため任意
    showShieldButton: true,
    showBButton: true,
    tapJumpEnabled: true,   // スティック上入力をジャンプとして扱うか
  },
};

// デフォルトのテスト用モンスターステータス
function defaultStats() {
  return {
    life: 100,
    power: 10,
    intelligence: 10,
    accuracy: 10,
    evasion: 10,
    defense: 10,
  };
}
