// ==== スマモン 共通設定 ====
const CONFIG = {
  // ワールド/カメラ（広めに取って「奈落までの遠さ」を演出）
  CANVAS_W: 1400,
  CANVAS_H: 1000,
  GRAVITY: 0.25,
  MAX_FALL_SPEED: 6.3,
  GROUND_Y: 750,
  BLAST_MARGIN: 420, // 画面外どこまで飛んだらKOか（上下左右を広めに確保）

  // ==== ステータス → バトルへの反映カーブ ====
  // 以前は「一定値で頭打ち」だったため、ステータス上限999に対して
  // 130前後で全ての効果がカンストし、それ以降の育成が完全に無意味になっていた。
  // ここでは上限へ漸近するが決して到達しない曲線 bonus = MAX * g / (g + HALF) を使う。
  //   g    = ステータス - 基準値(ライフ100 / その他10)
  //   HALF = 上限の半分に届くのに必要な伸び幅
  // これにより「伸びるほど効果は緩やかになるが、1ポイントも無駄にならない」形になる。
  DAMAGE_STAT_MAX: 1.30,   DAMAGE_STAT_HALF: 170,   // ちから/かしこさ → 与ダメージ
  KB_POWER_MAX: 0.95,      KB_POWER_HALF: 200,      // ちから/かしこさ → 吹っ飛ばし力
  LIFE_DAMAGE_MAX: 0.40,   LIFE_DAMAGE_HALF: 260,   // ライフ → 被ダメージ軽減
  DEFENSE_KB_MAX: 0.45,    DEFENSE_KB_HALF: 230,    // 丈夫さ → 吹っ飛びにくさ（重さ）
  EVASION_SPEED_MAX: 0.70, EVASION_SPEED_HALF: 260, // 回避 → 移動速度（X方向のみ）
  EVASION_ENDLAG_MAX: 0.30, EVASION_ENDLAG_HALF: 220, // 回避 → 技の後隙・着地隙の短縮
  ACCURACY_CRIT_MAX: 0.22, ACCURACY_CRIT_HALF: 320, // 命中 → クリティカル率

  // 後隙・着地隙の短縮には下限を設ける。0フレームになると
  // 「振り得の技」が生まれてしまい、差し合いが成立しなくなるため。
  MIN_ENDLAG_FRAMES: 3,

  // 落下速度はステータスではなくモンスターごとの個性として持つ。
  // （回避に紐づけていた頃は、育てるほど復帰が難しくなり自滅が増える
  //   ＝育成するほど不利になるという逆転が起きていた）
  DEFAULT_FALL_SPEED: 1.0,

  // 吹っ飛び計算共通係数（各技のkbBaseと組み合わせて使用）
  KB_BASE_MULTIPLIER: 0.82,
  KB_DAMAGE_SCALE: 0.07,
  CRITICAL_CHANCE_BASE: 0.005,

  // 移動（通常は遅め、ダッシュで倍速程度に）
  WALK_SPEED_BASE: 1.6,
  DASH_SPEED_BASE: 3.2,

  // 左スティックの倒し込み量(0〜1)による 歩き/ダッシュ/ステップ の判定
  // ・DASH_TILT_THRESHOLD以上倒す = ダッシュ判定（保持し続ければ走り、すぐ離せば結果的に短い「ステップ」になる）
  // ・それ未満〜デッドゾーン以上 = 歩き（倒し込み量に比例した速度）
  DASH_TILT_THRESHOLD: 0.8,
  WALK_DEADZONE: 0.15,

  // 全モンスター共通のジャンプ初速。跳ぶ高さは初速の2乗に比例するので
  // （高さ = v^2 / 2g）、この値を動かすと見た目以上に高さが変わる点に注意。
  // -13 は高すぎて足場を軽々と飛び越えてしまったため、基準を3/4へ落とした。
  JUMP_POWER: -9.75,
  DEFAULT_JUMP_POWER: 1.0, // ジャンプ力倍率の既定値（モンスター個別で上書きする）
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

  // ==== スマブラ的な手触りを出すための挙動 ====
  // ヒットストップ（ヒットの瞬間に攻撃側・被弾側の双方が一瞬止まる）。
  // 「当てた感触」を生む最も重要な要素で、ダメージが大きいほど長く止まる。
  HITLAG_BASE: 3,
  HITLAG_PER_DAMAGE: 0.5,
  HITLAG_MAX: 20,
  HITLAG_SHIELD_MULTIPLIER: 0.7,

  // ヒットストップ（のけぞり）時間は吹っ飛び速度に比例
  HITSTUN_PER_KB: 3.2,
  HITSTUN_MIN: 8,
  HITSTUN_MAX: 70,

  // ベクトル変更（DI）：吹っ飛ばされる瞬間のスティック入力で軌道を最大何度ずらせるか
  DI_MAX_ANGLE_SHIFT: 18,

  // 急降下：落下中に下入力で落下速度を上げる
  FAST_FALL_MULTIPLIER: 1.65,

  // 吹っ飛び後の減速。スマブラでは吹っ飛び速度が毎フレーム減衰していくが、
  // 以前は一切減速せず、のけぞりが解けるまで等速で滑り続けていたため
  // 低%でもステージ端まで流されてしまっていた。
  KNOCKBACK_DECEL: 0.17,    // 空中でののけぞり中の減速量（1フレームあたり一定量）
  GROUND_FRICTION: 0.84,    // 接地中に操作できない状態（のけぞり・ダウン・着地隙）での摩擦

  // ジャストガード：攻撃が当たる直前にシールドを張ると成立
  JUST_SHIELD_WINDOW: 5,          // シールドを張ってから何フレーム以内のヒットで成立するか
  JUST_SHIELD_ATTACKER_LAG: 16,   // 成立時に攻撃側へ与える追加硬直
  JUST_SHIELD_FLASH_FRAMES: 20,   // 成立エフェクトの表示時間

  // 空中制御（本家同様、空中では加速度で慣性を変える。地上のような即時反転はしない）
  AIR_ACCEL: 0.135,          // 1フレームあたりの空中加速量
  AIR_MAX_SPEED_RATIO: 0.86, // 空中最高速度（ダッシュ速度に対する割合）
  AIR_FRICTION: 0.994,       // 慣性がゆっくり抜けていく割合（1に近いほど本家寄り）

  // しゃがみ：当たり判定が低くなり、飛び道具や横方向の攻撃を避けやすくなる
  CROUCH_HURTBOX_RATIO: 0.64,

  // 着地隙：空中攻撃を出したまま着地すると硬直する
  LANDING_LAG_DEFAULT: 10,

  // 受け身：吹っ飛び中に地面へ叩きつけられる直前にシールドを押すと成立
  TECH_WINDOW_FRAMES: 20,
  TECH_INVINCIBLE_FRAMES: 24,
  TECH_LOCKOUT_FRAMES: 40,

  // ワンパターン相殺：同じ技を連発すると威力が落ちる
  STALE_QUEUE_SIZE: 9,
  STALE_MAX_REDUCTION: 0.45,

  // 画面揺れ（強い一撃ほど大きく揺れる）
  SHAKE_PER_KB: 0.55,
  SHAKE_MAX: 13,

  STOCK_DEFAULT: 3,
  RESPAWN_INVINCIBLE_FRAMES: 90,
  TUMBLE_DAMAGE_THRESHOLD: 30,
  KO_CREDIT_WINDOW_MS: 8000,

  // シールド
  SHIELD_MAX: 100,
  SHIELD_DRAIN_PER_FRAME: 0.45,   // 押しっぱなしで約3.7秒で割れる
  SHIELD_REGEN_PER_FRAME: 0.3,
  SHIELD_BREAK_DAZE_FRAMES: 240, // 4秒 ピヨリ状態
  SHIELD_STUN_BASE: 3,            // ガード硬直（与ダメージに比例して伸びる）
  SHIELD_STUN_PER_DAMAGE: 0.4,
  SHIELD_CHIP_SCALE: 1.15,        // 与ダメージに比例してシールドを削る量
  SHIELD_PUSHBACK_MAX: 3.4,       // ガード時の後退速度上限

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

  // 仮想パッドの既定配置。各ボタンの「中心位置」を画面に対する割合(0〜1)で持つ。
  // 割合で持つことで、端末の画面サイズが変わっても同じ位置関係を保てる。
  DEFAULT_PAD_LAYOUT: {
    stick:  { x: 0.112, y: 0.760 },
    shield: { x: 0.800, y: 0.655 },
    jump:   { x: 0.876, y: 0.655 },
    grab:   { x: 0.952, y: 0.655 },
    b:      { x: 0.876, y: 0.855 },
    a:      { x: 0.952, y: 0.855 },
  },

  // 仮想パッドのボタンごとの基準サイズ(px)。padScaleを掛けて実サイズになる。
  PAD_BUTTON_SIZES: { shield: 58, jump: 58, grab: 58, b: 62, a: 72, stick: 110 },

  // 仮想パッドの設定（プレイヤーが設定画面で変更可能・localStorageへ保存）
  DEFAULT_PAD_CONFIG: {
    showJumpButton: true,   // スティック上入力でもジャンプ可能なため任意
    showShieldButton: true,
    showBButton: true,
    tapJumpEnabled: true,   // スティック上入力をジャンプとして扱うか
    padScale: 1,            // ボタンの大きさ倍率（0.7〜1.6）
    stickScale: 1,          // スティックの大きさ倍率（0.7〜1.6）
    padOpacity: 0.85,       // ボタンの不透明度（0.3〜1）
    mirrored: false,        // 左右反転（左利き向け）
    layout: null,           // 位置をカスタムした場合のみ { a:{x,y}, ... } が入る
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
