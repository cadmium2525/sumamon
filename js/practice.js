const PRACTICE_COURSES = {
  desert: { name: 'マンディー砂漠', stat: 'power', statLabel: 'ちから', color: '#d79b43', duration: 60, description: '鉄板に書かれた技を出して関門を突破する。スコアを競う技の練習場' },
  jungle: { name: 'パレパレジャングル', stat: 'intelligence', statLabel: 'かしこさ', color: '#4eaa56', duration: 60, description: '石板の紋章を1から順に砕く。速さと正確さでスコアを競う' },
  coast: { name: 'トーブル海岸', stat: 'accuracy', statLabel: '命中', color: '#42b7dd', duration: 50, description: '動くターゲットを正確に狙う' },
  snow: { name: 'パパス雪山', stat: 'evasion', statLabel: '回避', color: '#a9dcf2', duration: 60, description: '強制スクロールする雪山を、落ちないよう登り続けろ' },
  volcano: { name: 'カウレア火山', stat: 'defense', statLabel: '丈夫さ', color: '#e45b35', duration: 50, description: '火山弾と溶岩から生き残る', level: 10 },
};

// ==== 「マンディー砂漠」＝技の練習場 ====
// 関門ごとに「この技で壊せ」という指定がランダムで決まり、鉄板に白チョークで書かれる。
// 指定どおりの技を当てれば1発で砕け、違う技は弾かれて減点。
//
// slot は Fighter.currentMoveSlot と同じ表記（"ground.up" 等）。
// 以前は「通常技/必殺技/スマッシュ」という大きな括りを技オブジェクトから推測していたが、
// スマッシュが通常技と誤判定されて壁が意図せず壊れていた。currentMoveSlot は
// startAttack の時点で確定する正確なIDなので、推測をやめてこれを使う。
// ※「空後」は入れていない。空中で方向を入れると fighter.js 側で facing がその向きへ
//   変わる仕様のため、後ろを入れた瞬間に「前」と判定され、空後は原理的に出せない。
//   出せない技を指定すると関門を永久に突破できなくなるので、プールから外してある。
const DESERT_MOVE_POOL = [
  { slot: 'ground.neutral',   label: '弱A',   hint: 'A' },
  { slot: 'ground.side',      label: '横強',   hint: '横を入れてからA' },
  // 上強は「上でジャンプ（タップジャンプ）」が入っていると、上を入れた時点で
  // 跳んでしまい空上になる。設定がONのプレイヤーには出題しない（下の絞り込み参照）。
  { slot: 'ground.up',        label: '上強',   hint: '上を入れてからA', needsTapJumpOff: true },
  { slot: 'ground.down',      label: '下強',   hint: '下を入れてからA' },
  { slot: 'ground.dashAttack', label: 'ダッシュ攻撃', hint: '走りながらA' },
  { slot: 'smash.side',       label: '横スマ', hint: '横とAを同時' },
  { slot: 'smash.up',         label: '上スマ', hint: '上とAを同時' },
  { slot: 'smash.down',       label: '下スマ', hint: '下とAを同時' },
  { slot: 'air.neutral',      label: '空N',   hint: '空中でA' },
  { slot: 'air.forward',      label: '空前',   hint: '空中で前＋A' },
  { slot: 'air.up',           label: '空上',   hint: '空中で上＋A' },
  { slot: 'air.down',         label: '空下',   hint: '空中で下＋A' },
  { slot: 'special.neutral',  label: 'NB',    hint: 'B' },
  { slot: 'special.side',     label: '横B',   hint: '横＋B' },
  { slot: 'special.up',       label: '上B',   hint: '上＋B' },
  { slot: 'special.down',     label: '下B',   hint: '下＋B' },
];

// 実際に出せる技だけに絞る。出せない技を指定してしまうと、その関門で詰んでしまう。
function desertAvailableMoves() {
  const tapJumpOn = window.GameSettings ? window.GameSettings.tapJumpEnabled !== false : true;
  return DESERT_MOVE_POOL.filter(entry => !(entry.needsTapJumpOff && tapJumpOn));
}

const DESERT_CONFIG = {
  ceilingY: 96,        // 天井の高さ。ここより上へは絶対に行けない（関門の飛び越え防止）
  groundY: 485,
  gateCount: 7,
  gateSpacing: 460,    // 関門の間隔(px)。穴を飛び越えてから構えるまでの余裕を見て決めた
  firstGateX: 640,
  gateWidth: 64,
  goalMargin: 360,     // 最後の関門からゴールまでの距離
  pitWidth: 120,
  scorePerGate: 120,   // 関門突破の得点
  scoreWrongMove: -25, // 違う技を当てた時の減点
  scorePerSecondLeft: 25, // ゴール到達時、残り1秒あたりの加点
  scoreNoMiss: 250,    // 一度もミスせずクリアした時のボーナス
  wrongKnockback: 4.2, // 弾かれた時に押し戻される速さ
  wrongStun: 16,       // 弾かれた時の硬直フレーム
  // 減点の連鎖を防ぐ猶予(フレーム)。技を手探りしている間、当たるたびに減点すると
  // あっという間に0点へ張り付き、スコアを競う意味が無くなってしまう。
  // この猶予の内は弾かれる演出だけ出して、減点とミス計上は行わない。
  wrongGraceFrames: 30,
  // 減点の総額の上限。上限が無いと、苦手な技で粘っているだけで
  // 突破した関門の得点まで食い潰し、6関門突破しても0点という結果になってしまう。
  // 「ミスは響くが、進んだぶんは必ず残る」ようにここで頭打ちにする。
  wrongPenaltyCap: 300,
};

// 合計スコア→ランク。Playwrightの疑似プレイ28回の分布から決めている。
// （地面のすり抜けを直して「下強・下スマの関門も突破できる」状態にしてから測り直した値。
//   すり抜けたままだと下方向の技を指定された関門で必ず詰み、分布が意味を成さなかった。）
// 実測：クリアできた21回は1265〜1940点に収まり、未クリアは0〜300点。
// クリアできなかった場合も「関門×120 − 減点(上限300)」は残るので、
// 6関門まで進めばC、4関門でもDが取れる。E は序盤で足踏みした場合。
const DESERT_RANK_SCORES = [
  { grade: 'S', min: 1500 },
  { grade: 'A', min: 1150 },
  { grade: 'B', min: 800 },
  { grade: 'C', min: 400 },
  { grade: 'D', min: 180 },
];
// Sランク報酬「ちから+20 / ライフ+8」を基準に、他ランクは既存のグレード倍率(S/A/B/C/D/E)で按分する
const DESERT_REWARD_BASE = { stat: 20, life: 8 };

// ==== 「パレパレジャングル」＝順番を読む反射神経の練習場 ====
// フェーズごとに足場と石板がランダムに組み直され、石板に刻まれた紋章の
// 番号どおり（1→2→…）に壊していく。順番を間違えるとそのフェーズは失敗。
// 成功でも失敗でもすぐ次のフェーズへ進み、60秒間ひたすら回し続ける。
const JUNGLE_CONFIG = {
  groundY: 485,
  ceilingY: 70,            // 石板を置く上限。これより上には出さない（届かなくなるため）
  readyFrames: 180,        // 開始前のルール説明(3秒)。この間は時間が減らない
  targetW: 46, targetH: 58,
  scorePerTarget: 60,      // 正しい順で1個壊すごとの素点（コンボ倍率が掛かる）
  scorePhaseClear: 140,    // フェーズを完答した時のボーナス（同じく倍率が掛かる）
  scoreWrongOrder: -90,    // 順番を間違えた時の減点（倍率は掛からない）
  comboBonusPerStep: 0.25, // コンボ1段あたりの倍率の上乗せ
  comboMaxMultiplier: 3,   // 倍率の上限。青天井にすると終盤の1フェーズで全部決まってしまう
  comboTimeLimit: 6.5,     // 完答までこの秒数以内なら「スピードクリア」でコンボ継続
  phaseGapFrames: 40,      // フェーズ間の演出（石板が砕ける/崩れ落ちる）の長さ
  platformMoveAfter: 0.35, // 経過率がこれを超えると足場の一部が動き出す
  // 足場を置く高さの帯。約90px刻みで、1段ずつなら単発ジャンプ(約190px)で必ず届く。
  // 基準ジャンプ力を変えたらここも見直すこと。
  bands: [395, 300, 212],
  platformWidth: [92, 156],
  wrongStun: 14,           // 順番を間違えた時の硬直フレーム
};

// フェーズ番号ではなく経過時間で石板の数を増やす。
// フェーズは失敗しても進むので、フェーズ数を基準にすると
// 「わざと間違えて数を稼ぐ」ほうが簡単な局面が出てしまう。
function jungleTargetCount(ratio) {
  if (ratio < 0.25) return 1 + Math.floor(Math.random() * 2);   // 1〜2
  if (ratio < 0.50) return 2 + Math.floor(Math.random() * 2);   // 2〜3
  if (ratio < 0.75) return 2 + Math.floor(Math.random() * 3);   // 2〜4
  return 3 + Math.floor(Math.random() * 3);                     // 3〜5
}

// 合計スコア→ランク。Playwrightの疑似プレイ34回の分布から決めている。
// 実測：275〜6890点に散らばり、中央値は約2650点。上振れするのは
// コンボが繋がり続けた時で、倍率が乗ってスコアが跳ね上がる。
// Sは上位25%あたり（コンボを絶やさず10フェーズ前後こなす水準）に置いた。
// ※石板の数・コンボ倍率・フェーズ間の待ち時間を変えたら測り直すこと。
const JUNGLE_RANK_SCORES = [
  { grade: 'S', min: 4200 },
  { grade: 'A', min: 3000 },
  { grade: 'B', min: 2000 },
  { grade: 'C', min: 1100 },
  { grade: 'D', min: 500 },
];
// Sランク報酬「かしこさ+20 / ライフ+8」を基準に、他ランクは既存のグレード倍率で按分する
const JUNGLE_REWARD_BASE = { stat: 20, life: 8 };

// 「パパス雪山」専用パラメータ。強制縦スクロールで追い立てられながら、
// 左右に揺れる足場を渡り、後半はツララを避けて少しでも高く登る。
// ここに挙げた数値は初速の目安（実測での再調整を前提とした初期案）。
const SNOW_CONFIG = {
  scrollDelay: 1.4,        // 開始から何秒は不動か（最初の足場を確認する猶予）
  scrollBaseSpeed: 0.75,   // スクロール速度の初速(px/フレーム)
  scrollMaxSpeed: 1.6,     // duration経過時点のスクロール速度上限(px/フレーム)
  killMargin: 34,          // 画面下端からこのぶん出たらゲームオーバー
  // 縦間隔・横間隔はジャンプ力の基準値(JUMP_POWER=-9.75 → 単発で約190px)に合わせてある。
  // 基準ジャンプ力を変えたらここも必ず測り直すこと（v1.13時点の-13では倍の高さが跳べたため、
  // 当時の値100〜150pxのままだと最初の足場にすら届かなくなった）。
  platformGapMin: 62,      // 足場の縦間隔(px)の最小値
  platformGapMax: 100,     // 足場の縦間隔(px)の最大値
  platformStepMin: 60,     // 足場の横方向のズレ(px)の最小値
  platformStepMax: 210,    // 足場の横方向のズレ(px)の最大値（空中で届く範囲に収める）
  platformWidth: [110, 150], // 足場の横幅の範囲(px)
  swayAmpRange: [10, 34],  // 足場が左右に揺れる振幅(px)
  swayPeriodRange: [70, 160], // 揺れの周期(フレーム)
  icicleStartTime: 24,     // 何秒経過からツララが降り始めるか
  icicleIntervalStart: 100, // ツララの出現間隔(フレーム)の初期値
  icicleIntervalEnd: 36,   // durationに達する頃の出現間隔(フレーム)
  icicleWarnFrames: 24,    // 落下前の予告（影が伸びる）フレーム数
  icicleFallSpeed: 8.5,    // ツララの落下速度(px/フレーム)
  icicleWidth: 22, icicleHeight: 46,
  icicleStunFrames: 22,    // 被弾時のノックバック硬直(フレーム)
};

// 到達標高(m。HUD表示と同じ「10px=1m」換算)→ランクのしきい値。これ未満はEランク。
//
// Sのしきい値は「60秒を落ちずに登り切ったら必ずS」になるよう、実測値ではなく
// スクロール量から逆算して決めている。60秒時点のキルラインは y=-3598 まで上がるので、
// 完走者は必ず (500-(-3598))/10 = 約410m を超えている。その下に置いた400がSの基準。
// （実測だけで決めると、足場の間隔がランダムなぶん完走でも473mまで落ちる回があり、
//   しきい値480では「登り切ったのにA」が出てしまった。）
// 途中で落ちた場合は、落ちた高さでA以下に分かれる。
// ※スクロール速度・制限時間・killMarginを変えたらこの計算をやり直すこと。
const SNOW_RANK_ALTITUDE = [
  { grade: 'S', min: 400 },
  { grade: 'A', min: 300 },
  { grade: 'B', min: 210 },
  { grade: 'C', min: 130 },
  { grade: 'D', min: 70 },
];
// Sランク報酬「回避+20 / ライフ+8」を基準に、他ランクは既存のグレード倍率(S/A/B/C/D/E)で按分する
const SNOW_REWARD_BASE = { stat: 20, life: 8 };

const PRACTICE_CONTROL_HELP = [
  '移動: 左スティック（左右）／ジャンプ: JUMPボタン（2段ジャンプ対応）',
  '通常技: Aボタン（方向+Aで強攻撃、方向とほぼ同時押しでスマッシュ）',
  '必殺技: Bボタン（方向+Bで横/上/下必殺技）',
  '空中技: 空中でA、シールド: SHIELDボタン、掴み: GRABボタン',
  '実際のバトルと全く同じ操作・技・モーションが使えます。',
];

// バトル本番(game.js内 buildOptions/resolveStats)と同じロジックの練習用簡易版。
// 練習用Fighterの見た目・当たり判定サイズをfighters-data.jsの定義から組み立てる。
// Fighter生成オプションはバトルと共通（fighters-data.js の buildFighterOptions）

function resolvePracticeStats(def, monster) {
  if (monster && monster.id) {
    return GROWTH.computeStatsAtLevel({ ...defaultStats(), trainingStats: monster.trainingStats }, monster.aptitudes, monster.level);
  }
  return def.stats ? { ...defaultStats(), ...def.stats } : defaultStats();
}

const PracticeGame = {
  active: false,
  admin: false,
  monster: null,
  courseKey: null,
  course: null,
  frame: 0,
  elapsed: 0,
  lastTime: 0,
  accumulator: 0,
  raf: 0,

  init() {
    this.canvas = document.getElementById('practice-canvas');
    this.ctx = this.canvas.getContext('2d');
    document.getElementById('practice-course-list').addEventListener('click', event => {
      const button = event.target.closest('[data-practice-course]');
      if (button && !button.disabled) this.start(button.dataset.practiceCourse, this.monster, false);
    });
    document.getElementById('practice-quit').addEventListener('click', () => this.quit());
    document.getElementById('practice-result-close').addEventListener('click', () => this.closeResult());
    document.getElementById('practice-intro-start').addEventListener('click', () => this._beginRun());
  },

  // メイン対戦と同じ仮想パッド(SharedVPad)を修行画面側に移設する
  _attachSharedPad() {
    window.SharedVPad?.moveTo(document.getElementById('practice-game-panel'));
  },
  _detachSharedPad() {
    const battleContainer = document.getElementById('game-container');
    if (battleContainer) window.SharedVPad?.moveTo(battleContainer);
  },

  _readInput() {
    const keyboard = window.SharedInput?.getPlayer1Input?.() || { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0 };
    const pad = window.SharedVPad?.getState?.() || { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0 };
    return typeof mergeInputs === 'function' ? mergeInputs(keyboard, pad) : keyboard;
  },

  openSelection(monster) {
    if (!monster) return;
    this.stop();
    this._detachSharedPad();
    this.admin = false;
    this.monster = monster;
    document.getElementById('practice-select-panel').classList.remove('hidden');
    document.getElementById('practice-game-panel').classList.add('hidden');
    document.getElementById('practice-intro-modal').classList.add('hidden');
    document.getElementById('practice-result-modal').classList.add('hidden');
    const def = FIGHTERS[monster.baseFighterKey] || FIGHTERS.irumine;
    const summary = document.getElementById('practice-monster-summary');
    summary.innerHTML = `<img alt=""><span><strong>${this.escape(monster.name)} Lv.${monster.level}</strong><small>修行チケット ${UserProfileStore.data.practiceTickets || 0}枚</small></span>`;
    Skin.paintInto(summary.querySelector('img'), def.idleImage, monster.skin);
    const tickets = Number(UserProfileStore.data.practiceTickets) || 0;
    document.getElementById('practice-course-list').innerHTML = Object.entries(PRACTICE_COURSES).map(([key, course]) => {
      // 伸び方は対象ステータスの適性で変わるため、コース選択時に確認できるようにする
      const rank = (monster.aptitudes && monster.aptitudes[course.stat]) || 'C';
      const locked = course.level && monster.level < course.level;
      const disabled = locked || tickets < 1;
      return `<button class="practice-course-card" data-practice-course="${key}" style="--course-color:${course.color}" ${disabled ? 'disabled' : ''}>
        <strong>${course.name}</strong><span>${course.statLabel} ↑↑<span class="practice-course-apt">適性<i class="stat-apt rank-${rank}" data-rank="${rank}">${rank}</i></span><br>ライフ ↑</span><small>${course.description}</small>
        <em>${locked ? `Lv.${course.level}で解禁` : tickets < 1 ? '修行券が必要' : '修行券 1枚'}</em>
      </button>`;
    }).join('');
  },

  startAdmin(courseKey, fighterKey) {
    const key = fighterKey || 'irumine';
    const monster = MasmonStore.loadAll().find(m => m.baseFighterKey === key) || {
      id: null, name: `テスト${FIGHTERS[key]?.displayName || key}`, level: 10, baseFighterKey: key,
      aptitudes: GROWTH.aptitudesFor(key), trainingStats: {},
    };
    AppFlow.showScreen('practice');
    this.start(courseKey, monster, true);
  },

  start(courseKey, monster, admin = false) {
    const course = PRACTICE_COURSES[courseKey];
    if (!course || !monster) return;
    if (!admin) {
      if (course.level && monster.level < course.level) return;
      if ((Number(UserProfileStore.data.practiceTickets) || 0) < 1) return;
      UserProfileStore.addPracticeTickets(-1);
      AppFlow._updateHomeProfile();
    }
    this.stop();
    this.admin = admin;
    this.monster = monster;
    this.courseKey = courseKey;
    this.course = course;
    this.frame = 0;
    this.elapsed = 0;
    this.accumulator = 0;

    // ---- 練習用Fighterを本番と全く同じクラスで生成する ----
    // これにより、通常技/必殺技/スマッシュ/空中技/2段ジャンプ/シールドなど
    // バトルで使える操作・モーションがそのまま修行でも使える。
    const def = FIGHTERS[monster.baseFighterKey] || FIGHTERS.irumine;
    const stats = resolvePracticeStats(def, monster);
    this.fighter = new Fighter('practice', stats, def.color, { x: 70, y: 485 - (def.hurtboxHeight || CONFIG.BASE_HURTBOX_H) }, buildFighterOptions(def, monster));
    this.fighter.stocks = 999; // 場外/撃墜処理は使わない（穴はコース側で個別に処理する）
    // ブラストラインは実質無効化：Fighter標準のKO処理を発火させない
    this.blastBounds = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
    this.projectiles = [];
    this.debris = [];
    this.gates = [];
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.avoided = 0;
    this.pitFalls = 0;
    this.hp = 3; // 火山コース用の簡易耐久（Fighter本体のstocksとは別管理）
    this._setupCourse();
    document.getElementById('practice-select-panel').classList.add('hidden');
    document.getElementById('practice-game-panel').classList.add('hidden');
    document.getElementById('practice-result-modal').classList.add('hidden');
    document.getElementById('practice-game-title').textContent = `${course.name}${admin ? '（管理者テスト）' : ''}`;
    this._showIntro();
  },

  _showIntro() {
    const course = this.course;
    document.getElementById('practice-intro-title').textContent = `${course.name}`;
    let text = course.description;
    if (this.courseKey === 'desert') {
      text = `灼熱の砂漠に築かれた、技を鍛えるための関門。制限時間1分でスコアを稼げ！\n道をふさぐ石柱には黒い鉄板が打ち付けられ、「横スマ」「下強」といった技の名前が白いチョークで書かれている。書かれた技をその石柱に当てれば、一撃で砕け散る。\n違う技を当てると弾き返され、スコアが下がる。鉄板をよく読んでから振ろう。\n石柱は天井まで届いているので、ジャンプや上必殺で飛び越えることはできない。正面から技で突破するしかない。\n落とし穴に落ちてもゲームオーバーにはならず、直前の関門からやり直しになる。失うのは時間だけだ。\n指定される技は毎回ランダムに変わる。全${DESERT_CONFIG.gateCount}関門を、ミスなく速く抜けるほど高得点。`;
    } else if (this.courseKey === 'jungle') {
      text = '古代遺跡の石板を、紋章に刻まれた番号の順（1→2→3…）に砕け！\n石板は毎回1〜5個、ランダムに組み直される足場の上に現れる。順番を間違えるとそのフェーズは失敗となり、残りの石板は黒く焦げて崩れ落ちる。\n成功でも失敗でもすぐ次のフェーズが始まる。1分間でどれだけ稼げるかを競おう。\n素早くノーミスで完答し続けるとコンボが繋がり、獲得スコアに最大3倍の倍率がかかる。時間が経つほど石板は増え、足場も動き出す。';
    } else if (this.courseKey === 'snow') {
      text = '画面は少し待つと自動で上へスクロールを始める。追いつかれて画面の下にはみ出すと、その時点で即ゲームオーバー！\n足場は氷でできており、左右にゆっくり揺れる。乗ったまま油断すると滑り落ちるので、揺れに合わせて足場の中心をキープしよう。\n残り時間が半分を切ると、画面上からダメージ判定のある「ツララ」が降ってくる。影が伸びたら落下の合図、回避（ジャンプ・回避行動）でかわそう。\n評価は生き残った時間ではなく「どれだけ高く登ったか」で決まる。ゲームオーバーになっても、そこまでの最高到達点で採点される。';
    }
    document.getElementById('practice-intro-text').textContent = text;
    const hints = this.courseKey === 'desert'
      ? [
          `鉄板の技を当てて突破：1関門 +${DESERT_CONFIG.scorePerGate}点`,
          `違う技を当てる：${DESERT_CONFIG.scoreWrongMove}点（弾かれて隙もできる）`,
          `ゴール到達：残り1秒につき +${DESERT_CONFIG.scorePerSecondLeft}点`,
          `ノーミスでクリア：+${DESERT_CONFIG.scoreNoMiss}点`,
          '設定で「上でジャンプ」を切ると、上強も出題されるようになります',
        ].map(line => `<li><b>■</b>${this.escape(line)}</li>`)
      : this.courseKey === 'snow'
      ? ['強制スクロール：一定時間後、画面が自動で上へ進み続ける', '揺れる足場：周期も振幅もランダムで、乗るたびに揺れ方が変わる', 'ツララ：影の予告後に落下。当たるとノックバックして怯む', '評価：制限時間中に到達した最高標高でS〜Eを判定'].map(text2 => `<li><b>❄</b>${this.escape(text2)}</li>`)
      : this.courseKey === 'jungle'
      ? [
          `正しい順で砕く：1個 +${JUNGLE_CONFIG.scorePerTarget}点（コンボ倍率あり）`,
          `フェーズ完答：+${JUNGLE_CONFIG.scorePhaseClear}点（同じく倍率あり）`,
          `順番を間違える：${JUNGLE_CONFIG.scoreWrongOrder}点。コンボも途切れる`,
          `${JUNGLE_CONFIG.comboTimeLimit}秒以内にノーミス完答でコンボ継続（最大×${JUNGLE_CONFIG.comboMaxMultiplier}）`,
          '攻撃なら何でも壊せます。技の種類は問いません',
        ].map(line => `<li><b>◆</b>${this.escape(line)}</li>`)
      : [];
    const controls = PRACTICE_CONTROL_HELP.map(line => `<li><b>▶</b>${this.escape(line)}</li>`);
    document.getElementById('practice-intro-controls').innerHTML = [...hints, ...controls].join('');
    document.getElementById('practice-intro-modal').classList.remove('hidden');
  },

  _beginRun() {
    document.getElementById('practice-intro-modal').classList.add('hidden');
    document.getElementById('practice-game-panel').classList.remove('hidden');
    this._attachSharedPad();
    this.active = true;
    this.lastTime = 0;
    this.accumulator = 0;
    this._updateHud();
    this.raf = requestAnimationFrame(time => this.loop(time));
  },

  _setupCourse() {
    const f = this.fighter;
    this.worldWidth = 960;
    this.platforms = [{ x: 0, y: 485, w: 960, h: 55 }];
    this.targets = [];
    this.hazards = [];
    this.pits = [];
    this.checkpoints = null;
    this.lastCheckpoint = null;
    this.goalX = null;
    // カメラは砂漠(cameraX)と雪山(cameraY)でしか動かさないので、ここで必ず戻す。
    // 戻し忘れると、砂漠や雪山を遊んだ後に別のコースを始めた時、
    // 画面全体が前のコースのカメラ位置ぶんずれて何も見えなくなる。
    this.cameraX = 0;
    this.cameraY = 0;
    // 地面(y=485、雪山のみy=500)の上にきちんと立った状態でスタートする
    // （キャラごとに身長(hurtboxHeight)が異なるため、固定値ではなく実際の高さから逆算する）
    const groundY = this.courseKey === 'snow' ? 500 : 485;
    f.x = 70;
    f.y = groundY - f.h;
    f.vx = 0; f.vy = 0;
    if (this.courseKey === 'desert') {
      this._setupDesert(f);
    } else if (this.courseKey === 'jungle') {
      this._setupJungle(f);
    } else if (this.courseKey === 'coast') {
      this.platforms.push({ x: 360, y: 415, w: 240, h: 16 });
      for (let i = 0; i < 5; i++) this._spawnCoastTarget(i);
    } else if (this.courseKey === 'snow') {
      this._snowGroundY = groundY;
      this.platforms = [{ x: 20, y: groundY, w: 230, h: 20 }];
      // ジグザグに登る氷の足場を生成。縦間隔・横位置・揺れの振幅/周期はすべてランダムで、
      // 毎プレイ違う登り方になる（強制スクロールに追われるので覚えゲーにはしない）。
      let px = 90, py = groundY, dir = Math.random() < .5 ? 1 : -1;
      for (let i = 1; i <= 60; i++) {
        py -= SNOW_CONFIG.platformGapMin + Math.random() * (SNOW_CONFIG.platformGapMax - SNOW_CONFIG.platformGapMin);
        px += dir * (SNOW_CONFIG.platformStepMin + Math.random() * (SNOW_CONFIG.platformStepMax - SNOW_CONFIG.platformStepMin));
        if (px < 60) { px = 60; dir = 1; }
        if (px > 760) { px = 760; dir = -1; }
        if (Math.random() < 0.25) dir *= -1;
        const w = SNOW_CONFIG.platformWidth[0] + Math.random() * (SNOW_CONFIG.platformWidth[1] - SNOW_CONFIG.platformWidth[0]);
        const swayAmp = SNOW_CONFIG.swayAmpRange[0] + Math.random() * (SNOW_CONFIG.swayAmpRange[1] - SNOW_CONFIG.swayAmpRange[0]);
        const swayPeriod = SNOW_CONFIG.swayPeriodRange[0] + Math.random() * (SNOW_CONFIG.swayPeriodRange[1] - SNOW_CONFIG.swayPeriodRange[0]);
        this.platforms.push({ baseX: px, x: px, y: py, w, h: 15, swayAmp, swayPeriod, swayPhase: Math.random() * Math.PI * 2 });
      }
      this.scrollTop = groundY - 540; // カメラ最上端の初期位置（＝地面付近が画面下に見える状態）
      this.bestAltitudeY = f.y; // これまでの最高到達点（yが小さいほど高い）。評価はこれを使う
      this.bestAltitudeM = 0;
      this.icicles = [];
      this.nextIcicle = 0;
      this.iceHits = 0;
    } else if (this.courseKey === 'volcano') {
      f.x = 460;
      this.nextHazard = 20;
    }
  },

  // ---- マンディー砂漠：関門・穴・天井を組み立てる ----
  _setupDesert(f) {
    const C = DESERT_CONFIG;
    const lastGateX = C.firstGateX + (C.gateCount - 1) * C.gateSpacing;
    this.goalX = lastGateX + C.goalMargin;
    this.worldWidth = this.goalX + 260;
    this.ceilingY = C.ceilingY;

    // 指定技はランダム。ただし同じ技が連続すると練習にならないので、直前とは必ず変える。
    const pool = desertAvailableMoves();
    this.gates = [];
    let previousSlot = null;
    for (let i = 0; i < C.gateCount; i++) {
      let pick;
      do { pick = pool[Math.floor(Math.random() * pool.length)]; }
      while (pool.length > 1 && pick.slot === previousSlot);
      previousSlot = pick.slot;
      this.gates.push({
        id: i, x: C.firstGateX + i * C.gateSpacing, w: C.gateWidth,
        slot: pick.slot, label: pick.label, hint: pick.hint,
        broken: false, flash: 0, shake: 0, wrongFlash: 0,
      });
    }

    // 穴は関門と関門のちょうど中間へ置く。着地してから次の関門の前に立つ余裕を残す。
    this.pits = [];
    for (let i = 0; i < this.gates.length - 1; i++) {
      const from = this.gates[i].x + this.gates[i].w;
      const to = this.gates[i + 1].x;
      this.pits.push({ x: Math.round((from + to) / 2 - C.pitWidth / 2), w: C.pitWidth });
    }

    // 穴の位置から地面（足場）を切り出す。
    // solid を付けないと2枚目以降が「下入力ですり抜ける浮遊足場」になり、
    // その上では下強・下スマを出そうとした瞬間に穴へ落ちてしまう。
    this.platforms = [];
    let cursor = 0;
    for (const pit of this.pits) {
      this.platforms.push({ x: cursor, y: C.groundY, w: pit.x - cursor, h: 55, solid: true });
      cursor = pit.x + pit.w;
    }
    this.platforms.push({ x: cursor, y: C.groundY, w: this.worldWidth - cursor, h: 55, solid: true });

    // 復帰地点は各関門の直前。穴に落ちてもやり直しになるだけで、失うのは時間だけ。
    // ただし関門の150px手前はちょうど穴の中に当たるので、必ず地面の上へ寄せる。
    // （穴の上に復帰させると、落ちた瞬間にまた落ちる無限ループになりかねない）
    const spawnY = C.groundY - f.h;
    this.checkpoints = [{ x: 70, y: spawnY }];
    for (const gate of this.gates) {
      let x = gate.x - 150;
      for (const pit of this.pits) {
        if (x < pit.x + pit.w && x + f.w > pit.x) x = pit.x + pit.w + 16; // 穴の右岸へ
      }
      this.checkpoints.push({ x: Math.min(x, gate.x - f.w - 8), y: spawnY });
    }
    this.lastCheckpoint = this.checkpoints[0];

    this.wrongHits = 0;
    this.wrongCooldown = 0;
    this.wrongPenalty = 0;
    f.x = 70;
    f.y = spawnY;
  },

  // ---- パレパレジャングル ----
  _setupJungle(f) {
    const C = JUNGLE_CONFIG;
    this.worldWidth = 960;
    this.phase = 0;
    this.phaseTargets = 0;      // 現在のフェーズの石板の数
    this.nextOrder = 1;         // 次に壊すべき番号
    this.combo = 0;
    this.bestCombo = 0;
    this.clearedPhases = 0;
    this.failedPhases = 0;
    this.destroyedTotal = 0;
    this.readyTimer = C.readyFrames; // 開始前のルール説明
    this.phaseGap = 0;
    this.phaseStartTime = 0;
    this.phaseFailed = false;
    this.particles = [];
    this.floatTexts = [];
    f.x = 460;
    f.y = C.groundY - f.h;
    this._startJunglePhase();
  },

  // フェーズを1つ組み立てる。足場も石板も毎回ランダムに置き直す。
  _startJunglePhase() {
    const C = JUNGLE_CONFIG;
    this.phase++;
    this.nextOrder = 1;
    this.phaseFailed = false;
    this.phaseStartTime = this.elapsed;
    const ratio = Math.min(1, this.elapsed / this.course.duration);

    // 地面は必ず全幅。solid を付けて下入力ですり抜けないようにする
    // （砂漠と同じ理由。付けないと下強・下スマを出そうとして落下する）。
    this.platforms = [{ x: 0, y: C.groundY, w: 960, h: 55, solid: true }];
    // 各帯に0〜2枚の足場をばら撒く。1段ずつなら必ず単発ジャンプで届く高さにしてある。
    const moving = ratio >= C.platformMoveAfter;
    for (const bandY of C.bands) {
      const count = Math.random() < 0.28 ? 0 : (Math.random() < 0.55 ? 1 : 2);
      for (let i = 0; i < count; i++) {
        const w = C.platformWidth[0] + Math.random() * (C.platformWidth[1] - C.platformWidth[0]);
        const x = 40 + Math.random() * (880 - w);
        const y = bandY + (Math.random() - 0.5) * 26;
        const p = { x, y, w, h: 16, baseX: x, baseY: y, log: Math.random() < 0.45 };
        // 残り時間が減るほど足場が動き出す。動く足場に乗った石板も一緒に動く。
        if (moving && Math.random() < 0.35 + ratio * 0.3) {
          p.moveAxis = Math.random() < 0.62 ? 'x' : 'y';
          p.moveAmp = (p.moveAxis === 'x' ? 40 : 26) * (0.6 + Math.random() * 0.7);
          p.movePeriod = 150 + Math.random() * 140;
          p.movePhase = Math.random() * Math.PI * 2;
        }
        this.platforms.push(p);
      }
    }

    // 石板は足場（地面を含む）の上に立てる。動く足場の上なら一緒に動くよう
    // 「どの足場のどこか」で持たせ、毎フレーム位置を引き直す。
    const want = jungleTargetCount(ratio);
    // 置き場所の候補：各足場の中央と、地面の等間隔スロット
    const spots = [];
    for (let i = 1; i < this.platforms.length; i++) spots.push({ index: i, offsetX: this.platforms[i].w / 2 });
    for (const gx of [110, 260, 410, 560, 710, 850]) spots.push({ index: 0, offsetX: gx });
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }

    // 重なる候補は捨てる。重なると番号が読めず、狙った石板を当てられない。
    // （足場の石板と、その真下の地面の石板が重なる組み合わせが実際に出ていた）
    const placed = [];
    const pad = 14;
    for (const spot of spots) {
      if (placed.length >= want) break;
      const p = this.platforms[spot.index];
      const rect = {
        x: Math.max(6, Math.min(960 - C.targetW - 6, p.x + spot.offsetX - C.targetW / 2)),
        y: Math.max(C.ceilingY, p.y - C.targetH - 4),
        w: C.targetW, h: C.targetH,
      };
      const clash = placed.some(q =>
        rect.x < q.rect.x + q.rect.w + pad && rect.x + rect.w + pad > q.rect.x &&
        rect.y < q.rect.y + q.rect.h + pad && rect.y + rect.h + pad > q.rect.y);
      if (clash) continue;
      placed.push({ spot, rect });
    }

    // 実際に置けた数をそのままフェーズの目標数にする。
    // ここを want のままにすると、置けなかった番号が盤面に存在しないのに
    // 要求され続け、そのフェーズを永久に完答できなくなる。
    this.phaseTargets = placed.length;
    this.targets = placed.map((entry, i) => ({
      id: i, order: i + 1, jungle: true,
      anchor: entry.spot.index, offsetX: entry.spot.offsetX,
      w: C.targetW, h: C.targetH,
      x: entry.rect.x, y: entry.rect.y, destroyed: false, charred: 0,
      // 紋章の光り方を石板ごとにずらす（全部同時に脈打つと機械的に見える）
      glowSeed: Math.random() * Math.PI * 2,
    }));
    this._syncJungleTargets();
  },

  // 足場の動きに合わせて石板の位置を引き直す
  _syncJungleTargets() {
    const C = JUNGLE_CONFIG;
    for (const t of this.targets) {
      const p = this.platforms[t.anchor];
      if (!p) continue;
      t.x = p.x + t.offsetX - t.w / 2;
      t.y = p.y - t.h - 4;
      // 画面外へはみ出さないよう最低限のクランプ
      t.x = Math.max(6, Math.min(960 - t.w - 6, t.x));
      t.y = Math.max(C.ceilingY, t.y);
    }
  },

  _updateJungle() {
    const C = JUNGLE_CONFIG;
    const f = this.fighter;

    // 開始前のルール説明の間は時間を進めない（_tickで加算済みのぶんを戻す）
    if (this.readyTimer > 0) {
      this.readyTimer--;
      this.elapsed = 0;
      return;
    }

    // 足場の往復移動。当たり判定より前に動かす（同フレームでズレないように）
    for (const p of this.platforms) {
      if (!p.moveAxis) continue;
      const t = Math.sin((this.frame + p.movePhase * 40) / p.movePeriod * Math.PI * 2) * p.moveAmp;
      if (p.moveAxis === 'x') p.x = p.baseX + t; else p.y = p.baseY + t;
    }
    this._syncJungleTargets();

    // フェーズ間の演出中。終わったら次のフェーズを組む
    if (this.phaseGap > 0) {
      this.phaseGap--;
      for (const t of this.targets) if (t.charred > 0) t.charred++;
      if (this.phaseGap === 0) this._startJunglePhase();
      return;
    }

    // 落下しても即やり直せるよう、地面へ戻すだけにする（このコースに穴は無い）
    if (f.y > 600) { f.x = 460; f.y = C.groundY - f.h; f.vx = 0; f.vy = 0; }
  },

  // 石板に攻撃が当たった時の判定
  _resolveJungleHit(target) {
    const C = JUNGLE_CONFIG;
    if (this.phaseGap > 0 || this.readyTimer > 0) return;
    if (target.order === this.nextOrder) {
      // 正解：砕けて、緑と金の粒子が弾ける
      target.destroyed = true;
      this.destroyedTotal++;
      this.nextOrder++;
      const gained = Math.round(C.scorePerTarget * this._jungleMultiplier());
      this.score += gained;
      this._spawnJungleParticles(target, 'good');
      this._addFloatText(target.x + target.w / 2, target.y, `+${gained}`, '#b6ff9a');
      if (window.AudioManager) {
        // 番号が進むほど高い音になり、順番が合っていることが耳でも分かる
        const step = Math.min(4, target.order - 1);
        AudioManager.playTone({ freq: 620 + step * 110, toFreq: 940 + step * 130, type: 'sine', dur: 0.16, volume: 0.5 });
        AudioManager.playTone({ freq: 1240 + step * 220, type: 'sine', dur: 0.1, volume: 0.18, delay: 0.02 });
      }
      if (this.nextOrder > this.phaseTargets) this._clearJunglePhase();
      return;
    }
    // 不正解：フェーズ失敗
    this._failJunglePhase(target);
  },

  // コンボ倍率。ノーミス＆スピードクリアを重ねるほど伸びる
  _jungleMultiplier() {
    const C = JUNGLE_CONFIG;
    return Math.min(C.comboMaxMultiplier, 1 + this.combo * C.comboBonusPerStep);
  },

  _clearJunglePhase() {
    const C = JUNGLE_CONFIG;
    this.clearedPhases++;
    const spent = this.elapsed - this.phaseStartTime;
    const fast = spent <= C.comboTimeLimit;
    const bonus = Math.round(C.scorePhaseClear * this._jungleMultiplier());
    this.score += bonus;
    // コンボが繋がるのは「ノーミス」かつ「速い」時だけ。遅いと途切れる（が0には戻さない）
    if (fast) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
    } else {
      this.combo = 0;
    }
    this._addFloatText(480, 200, fast ? `PHASE CLEAR!  ×${this._jungleMultiplier().toFixed(2)}` : 'PHASE CLEAR', fast ? '#ffe27a' : '#c9e8b6');
    if (window.AudioManager) {
      // 完答は上昇するアルペジオ。速ければもう1音足して派手にする
      [0, 0.06, 0.12].forEach((d, i) => AudioManager.playTone({
        freq: [660, 880, 1320][i], type: 'sine', dur: 0.2, volume: 0.42, delay: d,
      }));
      if (fast) AudioManager.playTone({ freq: 1760, type: 'sine', dur: 0.26, volume: 0.3, delay: 0.18 });
    }
    this.phaseGap = C.phaseGapFrames;
  },

  _failJunglePhase(wrongTarget) {
    const C = JUNGLE_CONFIG;
    this.failedPhases++;
    this.phaseFailed = true;
    this.combo = 0;
    this.score = Math.max(0, this.score + C.scoreWrongOrder);
    // 残っている石板がまとめて黒焦げになって崩れ落ちる
    for (const t of this.targets) if (!t.destroyed) t.charred = 1;
    if (wrongTarget) {
      wrongTarget.charred = 1;
      this._spawnJungleParticles(wrongTarget, 'bad');
      this._addFloatText(wrongTarget.x + wrongTarget.w / 2, wrongTarget.y, `${C.scoreWrongOrder}`, '#ff9b9b');
    }
    const f = this.fighter;
    f.hitstun = Math.max(f.hitstun, C.wrongStun);
    if (window.AudioManager) {
      // 濁ったブザー。2音を少しずらして鳴らすと不快な唸りになる
      AudioManager.playTone({ freq: 190, toFreq: 90, type: 'sawtooth', dur: 0.34, volume: 0.4 });
      AudioManager.playTone({ freq: 176, toFreq: 84, type: 'square', dur: 0.34, volume: 0.22, delay: 0.01 });
    }
    this.phaseGap = C.phaseGapFrames + 16;
  },

  _spawnJungleParticles(target, kind) {
    this.particles = this.particles || [];
    const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
    const count = kind === 'good' ? 30 : 20;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (kind === 'good' ? 1.6 : 0.9) + Math.random() * (kind === 'good' ? 4.6 : 2.4);
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - (kind === 'good' ? 1.4 : 0.2),
        size: 2 + Math.random() * (kind === 'good' ? 4.5 : 6),
        life: (kind === 'good' ? 34 : 26) + Math.random() * 26,
        maxLife: 60,
        kind,
        spin: (Math.random() - 0.5) * 0.4,
        angle: Math.random() * Math.PI,
      });
    }
  },

  _addFloatText(x, y, text, color) {
    this.floatTexts = this.floatTexts || [];
    this.floatTexts.push({ x, y, text, color, life: 52 });
  },

  _updateJungleEffects() {
    if (this.particles && this.particles.length) {
      for (const p of this.particles) {
        p.x += p.vx; p.y += p.vy;
        p.vy += p.kind === 'good' ? 0.13 : 0.3;
        p.vx *= 0.985;
        p.angle += p.spin;
        p.life--;
      }
      this.particles = this.particles.filter(p => p.life > 0);
    }
    if (this.floatTexts && this.floatTexts.length) {
      for (const t of this.floatTexts) { t.y -= 0.85; t.life--; }
      this.floatTexts = this.floatTexts.filter(t => t.life > 0);
    }
  },

  _spawnCoastTarget(id) {
    this.targets[id] = { id, x: 300 + Math.random() * 570, y: 105 + Math.random() * 260, w: 34, h: 34, vx: (Math.random() < .5 ? -1 : 1) * (1.2 + Math.random() * 1.8), target: true };
  },

  // ---- メインループ：本番バトルと同じ「固定60fpsステップ」で進める ----
  // (Fighterクラスの技の発生/持続フレーム等はすべて「1フレーム=1/60秒」前提のため、
  //  可変dtでapplyInput/updateを呼ぶと技の発生タイミングや2段ジャンプ判定がズレてしまう)
  loop(timestamp) {
    if (!this.active) return;
    try {
      const now = Number.isFinite(timestamp) ? timestamp : performance.now();
      if (!this.lastTime) this.lastTime = now;
      const elapsed = Math.max(0, Math.min(100, now - this.lastTime));
      this.lastTime = now;
      this.accumulator += elapsed;
      const STEP = 1000 / 60;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this._tick();
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5 && this.accumulator >= STEP) this.accumulator = 0;
    } catch (e) {
      console.error('修行ループ内でエラーが発生しました:', e);
    }
    this._draw();
    this._updateHud();
    if (this.active) this.raf = requestAnimationFrame(next => this.loop(next));
  },

  _tick() {
    this.frame++;
    this.elapsed += 1 / 60;
    // 足場の揺れはFighter.updateの当たり判定より前に反映する（同フレームでズレないように）
    if (this.courseKey === 'snow') this._swaySnowPlatforms();
    const inp = this._readInput();
    const f = this.fighter;
    // 関門の押し戻しは「動く前にどちら側に居たか」で決める。移動後の位置だけで
    // 判断すると、1フレームの移動量が大きい時に反対側へ弾き出されてすり抜ける。
    this._prevX = f.x;
    f.applyInput(inp);
    f.update(this.platforms, this.blastBounds);
    // 練習コースの外へ出ないよう左端だけ簡易クランプ（右端は各コースのゴール/画面設計に任せる）
    f.x = Math.max(0, f.x);
    if (this.courseKey !== 'desert') f.x = Math.min(this.worldWidth - f.w, f.x);

    this._checkMeleeHit();
    this._updateProjectiles();

    if (this.courseKey === 'desert') this._updateDesert();
    else if (this.courseKey === 'jungle') this._updateJungle();
    else if (this.courseKey === 'coast') this._updateCoast();
    else if (this.courseKey === 'snow') this._updateSnow();
    else if (this.courseKey === 'volcano') this._updateVolcano();

    if (this.courseKey === 'jungle') this._updateJungleEffects();

    if (this.courseKey !== 'snow' && this.courseKey !== 'desert' && this.courseKey !== 'jungle' && f.y > 570) {
      f.x = 60; f.y = 390; f.vx = 0; f.vy = 0;
      this.score = Math.max(0, this.score - 5);
    }
    if (this.elapsed >= this.course.duration) this.finish(false, 'timeup');
  },

  // 足場の左右の揺れ（周期・振幅は足場ごとにランダム）。氷なので踏ん張りが効かない想定。
  _swaySnowPlatforms() {
    for (const p of this.platforms) {
      if (!p.swayAmp) continue;
      p.x = p.baseX + Math.sin((this.frame + p.swayPhase) / p.swayPeriod * Math.PI * 2) * p.swayAmp;
    }
  },

  // 本番のcheckAttacks()と同じ仕組み：現在の攻撃判定(hitbox)を一度だけ対象に当てる
  _checkMeleeHit() {
    const f = this.fighter;
    const hb = f.getHitbox();
    if (!hb || f.hasHitThisAttack) return;
    if (this.courseKey === 'desert') {
      // 砂漠は「どの技で当てたか」が肝なので、技のIDごと関門へ渡す
      const gate = this._gateHitBy(hb);
      if (gate) { f.hasHitThisAttack = true; this._resolveGateHit(gate, f.currentMoveSlot); }
      return;
    }
    for (const target of this.targets) {
      if (!target || target.destroyed || !Physics.rectsOverlap(hb, target)) continue;
      f.hasHitThisAttack = true;
      this._applyHitToTarget(target);
    }
  },

  // 攻撃判定と重なっている、まだ壊れていない関門を返す
  _gateHitBy(box) {
    for (const gate of this.gates || []) {
      if (gate.broken) continue;
      if (Physics.rectsOverlap(box, { x: gate.x, y: this.ceilingY, w: gate.w, h: DESERT_CONFIG.groundY - this.ceilingY })) return gate;
    }
    return null;
  },

  // 関門に技が当たった時の判定。slot が指定と一致すれば1発で砕ける。
  // byProjectile: 飛び道具による判定か（本体は離れているのでノックバックさせない）
  _resolveGateHit(gate, slot, byProjectile = false) {
    const C = DESERT_CONFIG;
    if (slot && slot === gate.slot) {
      gate.broken = true;
      gate.flash = 18;
      this.score += C.scorePerGate;
      this._spawnGateDebris(gate);
      return true;
    }
    // 指定と違う技：弾かれて減点。何が違ったのか分かるよう、鉄板を赤く光らせる。
    gate.wrongFlash = 22;
    gate.shake = 10;
    // 直前に減点されたばかりなら、見た目だけ出して減点も硬直もしない。
    // ノックバックもここに入れておかないと、多段ヒットの技（横必殺など）で
    // 判定の窓ごとに何度も吹っ飛ばされてしまう。
    if ((this.wrongCooldown || 0) > 0) return false;
    this.wrongCooldown = C.wrongGraceFrames;
    // 飛び道具は本体が遠く離れているので、当てた本人は動かさない
    if (!byProjectile) {
      const f = this.fighter;
      f.vx = -f.facing * C.wrongKnockback;
      f.hitstun = Math.max(f.hitstun, C.wrongStun);
    }
    this.wrongHits++;
    const room = C.wrongPenaltyCap - (this.wrongPenalty || 0);
    const penalty = Math.min(room, -C.scoreWrongMove);
    if (penalty > 0) {
      this.wrongPenalty = (this.wrongPenalty || 0) + penalty;
      this.score = Math.max(0, this.score - penalty);
    }
    return false;
  },

  _spawnGateDebris(gate) {
    const C = DESERT_CONFIG;
    this.debris = this.debris || [];
    const cx = gate.x + gate.w / 2;
    for (let i = 0; i < 26; i++) {
      const t = Math.random();
      this.debris.push({
        x: cx + (Math.random() - 0.5) * gate.w,
        y: this.ceilingY + t * (C.groundY - this.ceilingY),
        vx: (Math.random() - 0.35) * 6.5,
        vy: -2 - Math.random() * 6,
        size: 4 + Math.random() * 11,
        spin: (Math.random() - 0.5) * 0.32,
        angle: Math.random() * Math.PI,
        life: 44 + Math.random() * 34,
      });
    }
  },

  _applyHitToTarget(target) {
    if (target.jungle) {
      this._resolveJungleHit(target);
    } else if (target.target) {
      this.hits++; this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += 4 + Math.min(6, this.combo);
      this._spawnCoastTarget(target.id);
    }
  },

  // ---- 飛び道具（ルミナスアロー/ローリングボム等、必殺技のprojectile設定）----
  _updateProjectiles() {
    const request = this.fighter.consumeProjectileRequest?.();
    if (request) {
      const cfg = request.config;
      const spritePath = request.move.projectileSprite;
      const sprite = spritePath ? (window.PreloadedImages?.get(spritePath) || new Image()) : null;
      if (sprite && !sprite.src) sprite.src = spritePath;
      const f = this.fighter;
      this.projectiles.push({
        // 飛び道具の必殺技（ルミナスアロー等）は本体に攻撃判定が出ないため、
        // 「どの技から出たか」を弾に持たせないと砂漠の関門を絶対に壊せなくなる。
        move: request.move, slot: f.currentMoveSlot, sprite, config: cfg,
        x: f.facing === 1 ? f.x + f.w : f.x - cfg.width,
        y: f.y + f.h * 0.42, vx: f.facing * cfg.speed, vy: 0,
        w: cfg.width, h: cfg.height, life: cfg.lifetime, hit: false, exploding: 0,
      });
    }
    for (const p of this.projectiles) {
      if (p.exploding > 0) { p.exploding--; if (p.exploding <= 0) p.hit = true; continue; }
      const isBomb = p.config.type === 'bomb';
      const previousBottom = p.y + p.h;
      p.x += p.vx;
      if (isBomb) {
        p.vy += p.config.gravity || 0.25;
        p.y += p.vy;
        for (const platform of this.platforms) {
          if (platform.gone) continue;
          const withinX = p.x + p.w > platform.x && p.x < platform.x + platform.w;
          if (withinX && p.vy >= 0 && previousBottom <= platform.y + 3 && p.y + p.h >= platform.y) {
            p.y = platform.y - p.h; p.vy = 0; p.vx *= p.config.groundFriction || 0.985;
            break;
          }
        }
      }
      p.life--;
      if (isBomb && p.life <= 0) {
        const radius = p.config.explosionRadius || 90;
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        if (this.courseKey === 'desert') {
          // 砂漠では爆風の広い判定を関門には使わない。半径105pxで見てしまうと、
          // 関門に触れてもいない位置で寿命が尽きただけでミス扱いになる。
          // 関門への判定は「爆弾が実際にぶつかった時」だけ（下の接触判定）。
        } else {
          for (const target of this.targets) {
            if (!target || target.destroyed) continue;
            const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
            if (Math.hypot(tx - cx, ty - cy) <= radius) this._applyHitToTarget(target);
          }
        }
        p.exploding = 12; p.vx = 0; p.vy = 0;
        continue;
      }
      if (isBomb) {
        // 爆弾は関門にぶつかった時点で炸裂させる。すり抜けさせると、
        // 寿命(150F)が尽きる頃には関門のはるか先まで転がっていて、
        // 「下必殺」を指定された関門を絶対に壊せなくなる。
        if (this.courseKey === 'desert' && !p.hit) {
          const gate = this._gateHitBy(p);
          if (gate) {
            this._resolveGateHit(gate, p.slot, true);
            p.exploding = 12; p.vx = 0; p.vy = 0;
          }
        }
        continue;
      }
      if (!p.hit) {
        if (this.courseKey === 'desert') {
          const gate = this._gateHitBy(p);
          if (gate) { this._resolveGateHit(gate, p.slot, true); p.hit = true; }
        } else {
          for (const target of this.targets) {
            if (!target || target.destroyed || !Physics.rectsOverlap(p, target)) continue;
            this._applyHitToTarget(target);
            p.hit = true;
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.hit && (p.life > 0 || p.exploding > 0) &&
      p.x > -200 && p.x < this.worldWidth + 200 && p.y < 900);
  },

  _updateDesert() {
    const f = this.fighter;

    // ---- 関門の飛び越え防止 ----
    // 「天井」と「全高の壁」の2枚構えにしてある。どちらか片方だけでは破られる：
    //   ・天井が無いと、2段ジャンプや上必殺(recoveryBoost)で壁の上を通れてしまう
    //   ・壁の判定に高さ制限を付けると、天井との隙間から抜けられてしまう
    // そこで壁はy方向を一切見ずに押し戻し、天井は毎フレーム頭を押さえる。
    if (f.y < this.ceilingY) {
      f.y = this.ceilingY;
      if (f.vy < 0) f.vy = 0; // 上向きの勢い（上必殺を含む）をここで殺す
    }
    // 「今重なっているか」だけを見ると、1フレームの移動量が壁の幅を超えた時に
    // 壁ごと飛び越して素通りしてしまう。動く前の位置と動いた後の位置を結んで、
    // 壁の面を横切ったかどうかで判定する（通過判定）。これなら速度に関係なく止まる。
    const prevX = Number.isFinite(this._prevX) ? this._prevX : f.x;
    for (const gate of this.gates) {
      if (gate.broken) continue;
      const left = gate.x, right = gate.x + gate.w;
      const wasLeft = prevX + f.w <= left;
      const wasRight = prevX >= right;
      if (wasLeft && f.x + f.w > left) {           // 左から壁の面を越えようとした
        f.x = left - f.w; f.vx = 0;
      } else if (wasRight && f.x < right) {        // 右から戻ろうとした
        f.x = right; f.vx = 0;
      } else if (f.x + f.w > left && f.x < right) { // 念のため：どちらでもないのに重なっている
        f.x = wasRight ? right : left - f.w; f.vx = 0;
      }
    }

    if (this.wrongCooldown > 0) this.wrongCooldown--;
    // 演出タイマー
    for (const gate of this.gates) {
      if (gate.flash > 0) gate.flash--;
      if (gate.wrongFlash > 0) gate.wrongFlash--;
      if (gate.shake > 0) gate.shake--;
    }
    this._updateDebris();

    // カメラは横スクロールでプレイヤーを追従
    this.cameraX = Math.max(0, Math.min(this.worldWidth - 960, f.x - 420));
    // チェックポイント更新
    for (const cp of this.checkpoints) {
      if (f.x >= cp.x && cp.x > this.lastCheckpoint.x) this.lastCheckpoint = cp;
    }
    // 落とし穴：ゲームオーバーにはせず、直前のチェックポイントへ戻す（タイムロスのみ）
    if (f.y > 560) {
      f.x = this.lastCheckpoint.x; f.y = this.lastCheckpoint.y; f.vx = 0; f.vy = 0;
      this.pitFalls++;
    }
    if (f.x + f.w >= this.goalX) this.finish(true);
  },

  _updateDebris() {
    if (!this.debris || !this.debris.length) return;
    for (const d of this.debris) {
      d.x += d.vx;
      d.y += d.vy;
      d.vy += 0.42;
      d.angle += d.spin;
      d.life--;
      const floor = DESERT_CONFIG.groundY - d.size / 2;
      if (d.y > floor) { d.y = floor; d.vy *= -0.32; d.vx *= 0.72; d.spin *= 0.6; }
    }
    this.debris = this.debris.filter(d => d.life > 0);
  },


  _updateCoast() {
    this.targets.forEach(target => {
      target.x += target.vx;
      if (target.x < 260 || target.x > 915) target.vx *= -1;
    });
  },

  _updateSnow() {
    const f = this.fighter;
    // 到達標高のベストを常時更新（評価はゲームオーバー後も「最も高く登った時点」を見る）
    if (f.y < this.bestAltitudeY) this.bestAltitudeY = f.y;
    this.bestAltitudeM = Math.max(0, Math.round((this._snowGroundY - this.bestAltitudeY) / 10));
    this.score = this.bestAltitudeM;

    // 強制縦スクロール：開始直後だけ猶予を置き、以降は時間経過で加速しながら上へ押し続ける
    if (this.elapsed >= SNOW_CONFIG.scrollDelay) {
      const progress = Math.min(1, (this.elapsed - SNOW_CONFIG.scrollDelay) / (this.course.duration - SNOW_CONFIG.scrollDelay));
      this.scrollTop -= SNOW_CONFIG.scrollBaseSpeed + (SNOW_CONFIG.scrollMaxSpeed - SNOW_CONFIG.scrollBaseSpeed) * progress;
    }
    this.cameraY = this.scrollTop;
    // 画面下端（+ killMargin）からフレームアウトしたら即ゲームオーバー
    const killY = this.scrollTop + 540 + SNOW_CONFIG.killMargin;
    if (f.y > killY) { this.finish(false, 'falls'); return; }

    // ツララ：残り時間の後半（icicleStartTime経過後）から降り始め、終盤ほど頻度が上がる
    if (this.elapsed >= SNOW_CONFIG.icicleStartTime) {
      this.nextIcicle--;
      if (this.nextIcicle <= 0) {
        const progress = Math.min(1, (this.elapsed - SNOW_CONFIG.icicleStartTime) / Math.max(1, this.course.duration - SNOW_CONFIG.icicleStartTime));
        this.nextIcicle = SNOW_CONFIG.icicleIntervalStart + (SNOW_CONFIG.icicleIntervalEnd - SNOW_CONFIG.icicleIntervalStart) * progress;
        this.icicles.push({
          x: 40 + Math.random() * (880 - SNOW_CONFIG.icicleWidth),
          y: this.scrollTop - 60, w: SNOW_CONFIG.icicleWidth, h: SNOW_CONFIG.icicleHeight,
          warn: SNOW_CONFIG.icicleWarnFrames, hit: false,
        });
      }
    }
    for (const ice of this.icicles) {
      if (ice.warn > 0) { ice.warn--; continue; }
      ice.y += SNOW_CONFIG.icicleFallSpeed;
      if (!ice.hit && Physics.rectsOverlap(f.getHurtbox(), ice)) {
        ice.hit = true;
        if (f.dodgeTimer > 0) {
          // 回避行動で無力化。評価対象の「回避」がまさに活きた場面なので記録だけ残す
          this.avoided++;
        } else {
          this.iceHits++;
          f.hitstun = Math.max(f.hitstun, SNOW_CONFIG.icicleStunFrames);
          f.vy = -3.5;
          f.vx = (f.x + f.w / 2 < ice.x + ice.w / 2 ? -1 : 1) * 3;
        }
      }
    }
    this.icicles = this.icicles.filter(ice => !ice.hit && ice.y < this.scrollTop + 640);
  },

  _updateVolcano() {
    const f = this.fighter;
    this.nextHazard--;
    if (this.nextHazard <= 0) {
      this.nextHazard = Math.max(18, 50 - this.elapsed * 0.45);
      this.hazards.push({ x: 35 + Math.random() * 880, y: -40, vx: (Math.random() - .5) * 2, vy: 4 + Math.random() * 3, w: 30 + Math.random() * 24, h: 30 + Math.random() * 24, type: 'rock' });
    }
    for (const hazard of this.hazards) {
      hazard.x += hazard.vx; hazard.y += hazard.vy;
      if (!hazard.hit && Physics.rectsOverlap(f.getHurtbox(), hazard)) {
        hazard.hit = true;
        if (f.shielding) { this.avoided++; this.score += 4; }
        else { this.hp--; f.vy = -7; this.score = Math.max(0, this.score - 8); }
      }
      if (!hazard.hit && hazard.y > 540) { hazard.hit = true; this.avoided++; this.score += 2; }
    }
    this.hazards = this.hazards.filter(hazard => !hazard.hit);
    if (this.hp <= 0) this.finish(false);
  },

  // 毎フレーム呼ばれるため、要素参照をキャッシュし表示が変わった時だけ書き換える
  _updateHud() {
    if (!this._hudTimeEl) {
      this._hudTimeEl = document.getElementById('practice-game-time');
      this._hudStatusEl = document.getElementById('practice-game-status');
    }
    const remaining = Math.max(0, Math.ceil((this.course?.duration || 0) - this.elapsed));
    if (remaining !== this._hudLastTime) {
      this._hudLastTime = remaining;
      this._hudTimeEl.textContent = `${remaining}`;
    }
    const status = this.courseKey === 'desert' ? `関門 ${this.gates.filter(g => g.broken).length}/${this.gates.length}　スコア ${this.score}　ミス ${this.wrongHits || 0}`
      : this.courseKey === 'jungle' ? `${this.score}点　次 ${this.nextOrder || 1}／${this.phaseTargets || 0}${this.combo > 0 ? `　${this.combo}コンボ ×${this._jungleMultiplier().toFixed(2)}` : ''}`
      : this.courseKey === 'coast' ? `命中 ${this.hits}　COMBO ${this.combo}`
      : this.courseKey === 'snow' ? `標高 ${this.bestAltitudeM || 0}m${this.elapsed >= SNOW_CONFIG.icicleStartTime ? '　⚠ツララ注意' : ''}`
      : `耐久 ♥${this.hp}　防御 ${this.avoided}`;
    if (status !== this._hudLastStatus) {
      this._hudLastStatus = status;
      this._hudStatusEl.textContent = status;
    }
  },

  finish(cleared, reason) {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    let normalized = 0;
    let grade;
    if (this.courseKey === 'desert') {
      // ゴールできた時だけ、残り時間とノーミスのボーナスが乗る
      if (cleared) {
        this.timeBonus = Math.max(0, Math.round(this.course.duration - this.elapsed)) * DESERT_CONFIG.scorePerSecondLeft;
        this.noMissBonus = this.wrongHits === 0 ? DESERT_CONFIG.scoreNoMiss : 0;
        this.score += this.timeBonus + this.noMissBonus;
      } else {
        this.timeBonus = 0;
        this.noMissBonus = 0;
      }
      const found = DESERT_RANK_SCORES.find(rank => this.score >= rank.min);
      grade = found ? found.grade : 'E';
      normalized = this.score;
    } else if (this.courseKey === 'jungle') {
      const found = JUNGLE_RANK_SCORES.find(rank => this.score >= rank.min);
      grade = found ? found.grade : 'E';
      normalized = this.score;
    }
    else if (this.courseKey === 'coast') normalized = Math.min(100, this.hits * 4 + this.bestCombo * 3 - this.misses * 2);
    else if (this.courseKey === 'snow') {
      const altitudeM = this.bestAltitudeM || 0;
      const found = SNOW_RANK_ALTITUDE.find(rank => altitudeM >= rank.min);
      grade = found ? found.grade : 'E';
      normalized = Math.max(0, Math.min(100, Math.round(altitudeM / SNOW_RANK_ALTITUDE[0].min * 100)));
    } else normalized = Math.min(100, this.elapsed / this.course.duration * 75 + this.avoided * 2 + (this.hp > 0 ? 10 : 0));
    normalized = Math.max(0, Math.round(normalized));
    if (!grade) grade = normalized >= 90 ? 'S' : normalized >= 75 ? 'A' : normalized >= 55 ? 'B' : normalized >= 30 ? 'C' : 'D';
    const brokenGates = this.courseKey === 'desert' ? this.gates.filter(g => g.broken).length : 0;
    let growthText = '管理者テストのため能力値は変化しません';
    if (!this.admin && this.monster.id) {
      const rewardBase = this.courseKey === 'desert' ? DESERT_REWARD_BASE
        : this.courseKey === 'snow' ? SNOW_REWARD_BASE
        : this.courseKey === 'jungle' ? JUNGLE_REWARD_BASE : null;
      const growth = rewardBase
        ? GROWTH.applyPracticeResult(this.monster, this.course.stat, grade, rewardBase.stat, rewardBase.life)
        : GROWTH.applyPracticeResult(this.monster, this.course.stat, grade);
      MasmonStore.update(this.monster);
      growthText = `${this.course.statLabel} +${growth[this.course.stat]}　ライフ +${growth.life}`;
    }
    document.getElementById('practice-result-grade').textContent = grade;
    document.getElementById('practice-result-title').textContent = cleared ? `${this.course.name} 修行成功！`
      : this.courseKey === 'snow' ? (reason === 'timeup' ? `${this.course.name} タイムアップ！` : `${this.course.name} 雪崩に飲まれた…`)
      : `${this.course.name} 修行終了`;
    document.getElementById('practice-result-score').textContent = this.courseKey === 'desert'
      ? (cleared
          ? `スコア ${this.score}（関門 ${brokenGates}/${this.gates.length}　残り時間 +${this.timeBonus}${this.noMissBonus ? `　ノーミス +${this.noMissBonus}` : `　ミス ${this.wrongHits}回`}）`
          : `スコア ${this.score}（関門 ${brokenGates}/${this.gates.length}　ミス ${this.wrongHits}回　ゴール未到達）`)
      : this.courseKey === 'snow'
      ? `到達標高 ${this.bestAltitudeM || 0}m　ツララ被弾 ${this.iceHits || 0}回　回避 ${this.avoided || 0}回`
      : this.courseKey === 'jungle'
      ? `スコア ${this.score}（石板 ${this.destroyedTotal || 0}個　完答 ${this.clearedPhases || 0}／${(this.clearedPhases || 0) + (this.failedPhases || 0)}フェーズ　最大 ${this.bestCombo || 0}コンボ）`
      : `評価スコア ${normalized}／100`;
    document.getElementById('practice-result-growth').textContent = growthText;
    document.getElementById('practice-result-modal').classList.remove('hidden');
  },

  quit() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this._detachSharedPad();
    if (this.admin) AppFlow.showScreen('debug');
    else this.openSelection(this.monster);
  },

  closeResult() {
    document.getElementById('practice-result-modal').classList.add('hidden');
    this._detachSharedPad();
    if (this.admin) AppFlow.showScreen('debug');
    else this.openSelection(this.monster);
  },

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this._detachSharedPad();
  },

  _draw() {
    const ctx = this.ctx;
    const themes = {
      desert: ['#ffe9b8', '#c9793a'], jungle: ['#5aaf69', '#173a29'], coast: ['#62cced', '#17678d'], snow: ['#d9f4ff', '#5a8fb3'], volcano: ['#e34b2e', '#351018'],
    };
    const [top, bottom] = themes[this.courseKey];
    const gradient = ctx.createLinearGradient(0, 0, 0, 540); gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 960, 540);
    const offsetY = -(this.cameraY || 0);
    const offsetX = -(this.cameraX || 0);
    if (this.courseKey === 'snow') {
      // 奥の山脈（スクロールに合わせてゆっくり流れる視差背景）
      const parallax = ((this.cameraY || 0) * 0.16) % 320;
      ctx.fillStyle = 'rgba(255,255,255,.30)';
      for (let i = -1; i < 4; i++) {
        const bx = i * 320 - parallax;
        ctx.beginPath(); ctx.moveTo(bx, 540); ctx.lineTo(bx + 160, 300 + (i % 2) * 40); ctx.lineTo(bx + 320, 540); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      for (let i = -1; i < 4; i++) {
        const bx = i * 320 - parallax * 0.55 + 160;
        ctx.beginPath(); ctx.moveTo(bx, 540); ctx.lineTo(bx + 140, 360); ctx.lineTo(bx + 280, 540); ctx.fill();
      }
      // 降り続ける雪
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      for (let i = 0; i < 45; i++) ctx.fillRect((i * 71 + this.frame * 0.7) % 960, (i * 53 + this.frame * 2.4) % 540, 3, 3);
    }
    if (this.courseKey === 'desert') this._drawDesertSky(ctx);
    if (this.courseKey === 'jungle') this._drawJungleBackground(ctx);
    ctx.save(); ctx.translate(offsetX, offsetY);
    if (this.courseKey === 'desert') {
      this._drawDesertGround(ctx);
    } else {
      for (const platform of this.platforms) {
        if (platform.gone) continue;
        if (this.courseKey === 'snow' && platform.swayAmp) { this._drawIcePlatform(ctx, platform); continue; }
        if (this.courseKey === 'jungle') { this._drawJunglePlatform(ctx, platform); continue; }
        ctx.fillStyle = this.courseKey === 'snow' ? '#e8f8ff' : this.courseKey === 'volcano' ? '#34242a' : '#5b4937';
        ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
        ctx.fillStyle = this.courseKey === 'snow' ? '#8bd5ef' : '#d8aa5a'; ctx.fillRect(platform.x, platform.y, platform.w, 4);
      }
    }
    if (this.courseKey === 'desert') this._drawDesertGates(ctx);
    if (this.courseKey === 'jungle') this._drawJungleTargets(ctx);
    for (const target of this.targets) {
      if (!target || target.destroyed || target.jungle) continue;
      if (target.target) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(target.x + target.w/2, target.y + target.h/2, target.w/2, 0, Math.PI*2); ctx.fill(); ctx.fillStyle='#ff3d45'; ctx.beginPath(); ctx.arc(target.x+target.w/2,target.y+target.h/2,9,0,Math.PI*2);ctx.fill(); }
      else { ctx.fillStyle = '#7d6a58'; ctx.fillRect(target.x,target.y,target.w,target.h); ctx.fillStyle='#ffd96b';ctx.fillRect(target.x,target.y,target.w*(target.hp/target.maxHp),5); }
    }
    for (const hazard of this.hazards) {
      ctx.fillStyle = hazard.type === 'spikes' ? '#dce7ed' : '#4a2020';
      if (hazard.type === 'spikes') { ctx.beginPath(); ctx.moveTo(hazard.x,hazard.y+hazard.h);ctx.lineTo(hazard.x+hazard.w/2,hazard.y);ctx.lineTo(hazard.x+hazard.w,hazard.y+hazard.h);ctx.fill(); }
      else { ctx.beginPath();ctx.arc(hazard.x+hazard.w/2,hazard.y+hazard.h/2,hazard.w/2,0,Math.PI*2);ctx.fill(); }
    }
    if (this.courseKey === 'snow') this._drawSnowIcicles(ctx);
    this._drawProjectiles(ctx);
    // ---- プレイヤー：本番と同じFighter.draw()でそのまま描画（全モーション対応）----
    this.fighter.draw(ctx);
    if (this.courseKey === 'jungle') this._drawJungleEffects(ctx);
    if (this.courseKey === 'snow') {
      // 強制スクロールに置き去りにされる境界＝ここより下に出ると即アウト
      const killY = (this.scrollTop || 0) + 540 + SNOW_CONFIG.killMargin;
      const grad = ctx.createLinearGradient(0, killY - 70, 0, killY + 220);
      grad.addColorStop(0, 'rgba(220,248,255,0)');
      grad.addColorStop(0.55, 'rgba(220,248,255,.7)');
      grad.addColorStop(1, 'rgba(245,252,255,.96)');
      ctx.fillStyle = grad;
      ctx.fillRect(-400, killY - 70, 1760, 400);
    }
    ctx.restore();
    // 舞う砂は最前面。ワールド座標ではなく画面座標で流す。
    if (this.courseKey === 'desert') this._drawDesertSand(ctx);
  },

  // ==== マンディー砂漠の描画 ====
  // 種を与えると毎回同じ値を返す擬似乱数。チョーク文字や岩肌のムラに使う。
  // Math.random()を使うと毎フレーム描き直しでガタガタ動いてしまうため、必ずこちらを使う。
  _noise(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  },

  _drawDesertSky(ctx) {
    const cam = this.cameraX || 0;
    // 灼熱の太陽。関門と重なっても邪魔にならないよう、輪郭は淡く霞ませる。
    const sunX = 815 - (cam * 0.04) % 200;
    const sun = ctx.createRadialGradient(sunX, 168, 6, sunX, 168, 170);
    sun.addColorStop(0, 'rgba(255,255,242,.95)');
    sun.addColorStop(.18, 'rgba(255,246,198,.62)');
    sun.addColorStop(.5, 'rgba(255,226,150,.24)');
    sun.addColorStop(1, 'rgba(255,214,130,0)');
    ctx.fillStyle = sun; ctx.fillRect(sunX - 180, -20, 360, 380);
    ctx.fillStyle = 'rgba(255,253,235,.85)';
    ctx.beginPath(); ctx.arc(sunX, 168, 30, 0, Math.PI * 2); ctx.fill();

    // 遠景のメサ（卓状台地）。空との境をはっきりさせて奥行きを作る。
    ctx.fillStyle = 'rgba(184,126,86,.32)';
    for (let i = 0; i < 5; i++) {
      const bx = ((i * 430) - cam * 0.07) % 2150 - 400;
      const top = 250 + (i % 3) * 26;
      ctx.beginPath();
      ctx.moveTo(bx, 470); ctx.lineTo(bx + 26, top + 14); ctx.lineTo(bx + 60, top);
      ctx.lineTo(bx + 210, top); ctx.lineTo(bx + 244, top + 18); ctx.lineTo(bx + 268, 470);
      ctx.closePath(); ctx.fill();
    }

    // 遠景の遺跡（砂丘の上に立つ石柱のシルエット。足元を砂丘線に合わせる）
    ctx.fillStyle = 'rgba(126,80,44,.38)';
    for (let i = 0; i < 8; i++) {
      const bx = ((i * 285) - cam * 0.16) % 2280 - 300;
      const h = 96 + (i % 3) * 40;
      const baseY = 452;
      ctx.fillRect(bx, baseY - h, 24, h);
      ctx.fillRect(bx - 9, baseY - h - 11, 42, 11);
      ctx.fillRect(bx - 7, baseY - 9, 38, 9);
    }

    // 3層の砂丘。手前ほど速く流れ、色を濃くして層を分ける（視差）
    const dunes = [
      { speed: 0.13, base: 424, amp: 54, color: 'rgba(214,158,96,.55)', step: 520 },
      { speed: 0.28, base: 458, amp: 42, color: 'rgba(190,128,70,.7)', step: 430 },
      { speed: 0.48, base: 490, amp: 32, color: 'rgba(160,98,50,.85)', step: 350 },
    ];
    for (const layer of dunes) {
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(-140, 540);
      const shift = (cam * layer.speed) % layer.step;
      for (let x = -140 - shift; x < 1140; x += layer.step) {
        ctx.quadraticCurveTo(x + layer.step * 0.5, layer.base - layer.amp, x + layer.step, layer.base);
      }
      ctx.lineTo(1140, 540); ctx.closePath(); ctx.fill();
    }

    // 地表付近の陽炎（横に揺れる薄い帯）
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const y = 430 + i * 13;
      ctx.globalAlpha = 0.05 + i * 0.012;
      ctx.fillStyle = '#fff3d2';
      ctx.fillRect(Math.sin(this.frame / 26 + i) * 16 - 30, y, 1040, 5);
    }
    ctx.restore();
  },

  // 手前を舞う砂。画面座標で描き、奥行きと「熱風」の空気感を出す。
  _drawDesertSand(ctx) {
    ctx.save();
    for (let i = 0; i < 46; i++) {
      const speed = 2.2 + (i % 5) * 1.5;
      const x = (960 - ((this.frame * speed + i * 137) % 1120)) - 80;
      const y = (i * 61 + Math.sin(this.frame / 22 + i) * 26) % 540;
      ctx.globalAlpha = 0.10 + (i % 4) * 0.06;
      ctx.fillStyle = '#fff0cc';
      ctx.fillRect(x, y, 12 + (i % 3) * 9, 1.6);
    }
    ctx.restore();
  },

  _drawDesertGround(ctx) {
    const C = DESERT_CONFIG;
    const cam = this.cameraX || 0;
    for (const platform of this.platforms) {
      if (platform.w <= 0) continue;
      const g = ctx.createLinearGradient(0, platform.y, 0, platform.y + platform.h);
      g.addColorStop(0, '#e3b567'); g.addColorStop(.18, '#c9954c'); g.addColorStop(1, '#8a5c2c');
      ctx.fillStyle = g;
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
      // 表面のハイライトと砂目
      ctx.fillStyle = 'rgba(255,236,186,.75)';
      ctx.fillRect(platform.x, platform.y, platform.w, 3);
      ctx.fillStyle = 'rgba(90,56,24,.22)';
      const from = Math.max(platform.x, cam - 40);
      const to = Math.min(platform.x + platform.w, cam + 1000);
      for (let x = Math.ceil(from / 16) * 16; x < to; x += 16) {
        const n = this._noise(x);
        ctx.fillRect(x, platform.y + 8 + n * 30, 9 + n * 7, 2);
      }
    }
    // 落とし穴：奥へ落ち込む闇と、縁のこぼれた砂
    for (const pit of this.pits) {
      const g = ctx.createLinearGradient(0, C.groundY, 0, C.groundY + 55);
      g.addColorStop(0, '#3a2410'); g.addColorStop(1, '#120a03');
      ctx.fillStyle = g;
      ctx.fillRect(pit.x, C.groundY, pit.w, 55);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.beginPath(); ctx.ellipse(pit.x + pit.w / 2, C.groundY + 5, pit.w / 2, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(226,180,110,.85)';
      ctx.beginPath(); ctx.moveTo(pit.x - 14, C.groundY); ctx.lineTo(pit.x, C.groundY); ctx.lineTo(pit.x, C.groundY + 14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(pit.x + pit.w + 14, C.groundY); ctx.lineTo(pit.x + pit.w, C.groundY); ctx.lineTo(pit.x + pit.w, C.groundY + 14); ctx.fill();
    }
    // 天井（岩盤）。砂と同系色だと画面が一色に見えるので、寒色寄りの石でくっきり分ける。
    const ceil = ctx.createLinearGradient(0, 0, 0, this.ceilingY);
    ceil.addColorStop(0, '#2e2620'); ceil.addColorStop(.62, '#4a3d33'); ceil.addColorStop(1, '#5d4c3c');
    ctx.fillStyle = ceil;
    ctx.fillRect(cam - 60, 0, 1100, this.ceilingY);
    // 天井の石積み
    ctx.strokeStyle = 'rgba(20,15,10,.5)'; ctx.lineWidth = 2;
    for (let x = Math.floor((cam - 60) / 78) * 78; x < cam + 1040; x += 78) {
      ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, this.ceilingY); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cam - 60, 18); ctx.lineTo(cam + 1040, 18); ctx.stroke();
    // 陽が当たる下端のふち
    ctx.fillStyle = 'rgba(255,214,150,.35)';
    ctx.fillRect(cam - 60, this.ceilingY - 4, 1100, 4);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(cam - 60, this.ceilingY, 1100, 10);
    // 天井から垂れる岩
    for (let x = Math.floor((cam - 60) / 90) * 90; x < cam + 1040; x += 90) {
      const n = this._noise(x * 0.7);
      const dh = 12 + n * 24;
      const g2 = ctx.createLinearGradient(0, this.ceilingY, 0, this.ceilingY + dh);
      g2.addColorStop(0, '#5d4c3c'); g2.addColorStop(1, '#33291f');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(x, this.ceilingY); ctx.lineTo(x + 22, this.ceilingY); ctx.lineTo(x + 11, this.ceilingY + dh);
      ctx.closePath(); ctx.fill();
    }
    // ゴール：石造りの門と旗
    this._drawDesertGoal(ctx);
  },

  _drawDesertGoal(ctx) {
    const C = DESERT_CONFIG;
    const gx = this.goalX;
    ctx.fillStyle = '#cfa96a';
    ctx.fillRect(gx + 6, this.ceilingY, 26, C.groundY - this.ceilingY);
    ctx.fillRect(gx + 150, this.ceilingY, 26, C.groundY - this.ceilingY);
    ctx.fillStyle = '#b08b4f';
    ctx.fillRect(gx - 4, this.ceilingY, 190, 26);
    ctx.fillStyle = 'rgba(255,240,200,.9)';
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('GOAL', gx + 91, this.ceilingY + 13);
    // はためく旗
    const wave = Math.sin(this.frame / 12) * 8;
    ctx.fillStyle = '#e8544a';
    ctx.beginPath();
    ctx.moveTo(gx + 32, 190);
    ctx.quadraticCurveTo(gx + 80, 205 + wave, gx + 128, 190);
    ctx.lineTo(gx + 128, 250);
    ctx.quadraticCurveTo(gx + 80, 265 + wave, gx + 32, 250);
    ctx.closePath(); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  },

  // 関門＝天井から地面まで届く石柱。中央に黒鉄板が打ち付けてある。
  _drawDesertGates(ctx) {
    const C = DESERT_CONFIG;
    const top = this.ceilingY, bottom = C.groundY, height = bottom - top;
    const cam = this.cameraX || 0;
    for (const gate of this.gates) {
      if (gate.broken) continue;
      // 画面外の関門は描かない。石積みの目地・鉄板・チョーク文字は1本あたりの
      // 描画量が多く、7本ぶんを毎フレーム描くとスマホでは無駄が大きい。
      if (gate.x + gate.w < cam - 60 || gate.x > cam + 1020) continue;
      const shake = gate.shake > 0 ? (this._noise(this.frame * 3.1 + gate.id) - 0.5) * 7 : 0;
      const x = gate.x + shake;
      // 石柱本体
      const g = ctx.createLinearGradient(x, 0, x + gate.w, 0);
      g.addColorStop(0, '#8d6a44'); g.addColorStop(.35, '#c49a63'); g.addColorStop(1, '#7a5735');
      ctx.fillStyle = g;
      ctx.fillRect(x, top, gate.w, height);
      // 積み石の目地
      ctx.strokeStyle = 'rgba(60,38,16,.45)'; ctx.lineWidth = 2;
      for (let row = 0; row < height / 46; row++) {
        const ry = top + row * 46;
        ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x + gate.w, ry); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,238,200,.28)';
      ctx.fillRect(x + 5, top, 7, height);
      // 間違った技を当てた直後は赤くフラッシュ
      if (gate.wrongFlash > 0 && Math.floor(gate.wrongFlash / 3) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,70,50,.42)';
        ctx.fillRect(x, top, gate.w, height);
      }
      this._drawMovePlate(ctx, gate, x);
    }
    this._drawDesertDebris(ctx);
  },

  // 黒い鉄板＋白チョーク書きの技名
  _drawMovePlate(ctx, gate, x) {
    const pw = 120, ph = 86;
    const px = x + gate.w / 2 - pw / 2;
    const py = 236;
    ctx.save();
    // 影
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(px + 4, py + 5, pw, ph);
    // 鉄板（黒鉄。上から光が当たる想定でわずかに明暗を付ける）
    const g = ctx.createLinearGradient(px, py, px, py + ph);
    g.addColorStop(0, '#3b3f46'); g.addColorStop(.5, '#22262b'); g.addColorStop(1, '#15181c');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    // 縁の面取り
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeRect(px + 5, py + 5, pw - 10, ph - 10);
    // 四隅のリベット
    ctx.fillStyle = '#6e7681';
    for (const [rx, ry] of [[px + 10, py + 10], [px + pw - 10, py + 10], [px + 10, py + ph - 10], [px + pw - 10, py + ph - 10]]) {
      ctx.beginPath(); ctx.arc(rx, ry, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath(); ctx.arc(rx - 1, ry - 1, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6e7681';
    }
    // チョークの技名と入力ヒント
    this._drawChalkText(ctx, gate.label, px + pw / 2, py + 34, 30, gate.id * 17 + 3);
    this._drawChalkText(ctx, gate.hint, px + pw / 2, py + 66, 13, gate.id * 17 + 91);
    ctx.restore();
  },

  // チョークで書いたような白文字。1文字ずつ位置と角度をわずかにずらし、
  // かすれと粉っぽさを重ねる。ずれ量は種から作るので毎フレーム同じ形になる。
  _drawChalkText(ctx, text, cx, cy, size, seed) {
    const chars = [...String(text)];
    ctx.save();
    ctx.font = `bold ${size}px "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const widths = chars.map(c => ctx.measureText(c).width);
    const spacing = size * 0.06;
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cursor = cx - total / 2;
    chars.forEach((ch, i) => {
      const n1 = this._noise(seed + i * 3.3);
      const n2 = this._noise(seed + i * 7.7 + 1);
      const n3 = this._noise(seed + i * 5.1 + 2);
      const gx = cursor + widths[i] / 2 + (n1 - 0.5) * size * 0.09;
      const gy = cy + (n2 - 0.5) * size * 0.13;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate((n3 - 0.5) * 0.09);
      // かすれ：わずかにずらした薄い文字を重ねて、線に粗さを出す
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillText(ch, (n1 - 0.5) * 1.8, (n2 - 0.5) * 1.8);
      ctx.fillStyle = 'rgba(236,242,248,.30)';
      ctx.fillText(ch, (n3 - 0.5) * 2.2, (n1 - 0.5) * 2.0);
      ctx.fillStyle = 'rgba(255,255,255,.94)';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      cursor += widths[i] + spacing;
    });
    // チョークの粉
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    for (let i = 0; i < 12; i++) {
      const n1 = this._noise(seed * 2 + i * 13.7);
      const n2 = this._noise(seed * 2 + i * 9.1 + 5);
      ctx.fillRect(cx - total / 2 + n1 * total, cy - size * 0.5 + n2 * size, 1.4, 1.4);
    }
    ctx.restore();
  },

  // 砕けた石柱の破片
  _drawDesertDebris(ctx) {
    if (!this.debris || !this.debris.length) return;
    for (const d of this.debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      ctx.globalAlpha = Math.max(0, Math.min(1, d.life / 30));
      ctx.fillStyle = '#b8905c';
      ctx.fillRect(-d.size / 2, -d.size / 2, d.size, d.size);
      ctx.fillStyle = 'rgba(255,236,196,.5)';
      ctx.fillRect(-d.size / 2, -d.size / 2, d.size, Math.max(1, d.size * 0.25));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  // ---- パレパレジャングルの描画 ----

  // 奥から手前へ4層。層ごとに色を濃くして、うっそうとした奥行きを作る。
  _drawJungleBackground(ctx) {
    // 木漏れ日（斜めの光の柱）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 210 + Math.sin((this.frame + i * 90) / 260) * 22;
      const grad = ctx.createLinearGradient(x, 0, x - 120, 540);
      grad.addColorStop(0, 'rgba(226,255,190,.20)');
      grad.addColorStop(1, 'rgba(226,255,190,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x - 34, 0); ctx.lineTo(x + 46, 0);
      ctx.lineTo(x - 78, 540); ctx.lineTo(x - 168, 540);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // 奥の樹冠（3層。手前ほど濃く・大きく）
    const canopy = [
      { y: 96,  r: 92,  step: 118, color: 'rgba(18,58,36,.55)', sway: 5 },
      { y: 62,  r: 118, step: 152, color: 'rgba(13,45,28,.72)', sway: 8 },
      { y: 24,  r: 142, step: 196, color: 'rgba(8,32,20,.88)', sway: 11 },
    ];
    for (let layer = 0; layer < canopy.length; layer++) {
      const c = canopy[layer];
      ctx.fillStyle = c.color;
      for (let i = -1; i * c.step < 1060; i++) {
        const bx = i * c.step + this._noise(layer * 31 + i) * 40;
        const wobble = Math.sin((this.frame + i * 60 + layer * 120) / 190) * c.sway;
        ctx.beginPath();
        ctx.ellipse(bx + wobble, c.y + this._noise(layer * 17 + i) * 26, c.r, c.r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 幹とぶら下がる蔓
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 178 + this._noise(i * 5.3) * 60;
      const w = 20 + this._noise(i * 2.7) * 16;
      ctx.fillStyle = 'rgba(30,22,14,.55)';
      ctx.fillRect(x, 0, w, 540);
      ctx.fillStyle = 'rgba(58,44,28,.35)';
      ctx.fillRect(x + w * 0.55, 0, w * 0.3, 540);
      // 蔓
      ctx.strokeStyle = 'rgba(46,96,52,.5)';
      ctx.lineWidth = 3;
      const vineX = x + w + 10 + this._noise(i * 9.1) * 40;
      const len = 150 + this._noise(i * 3.1) * 200;
      ctx.beginPath();
      ctx.moveTo(vineX, 0);
      for (let s = 0; s <= len; s += 24) {
        ctx.lineTo(vineX + Math.sin((s + this.frame * 0.5 + i * 40) / 46) * 12, s);
      }
      ctx.stroke();
    }

    // 舞う胞子（決定論的に動かすのでちらつかない）
    ctx.fillStyle = 'rgba(214,255,178,.5)';
    for (let i = 0; i < 34; i++) {
      const px = (i * 137 + Math.sin((this.frame + i * 40) / 130) * 40 + this.frame * 0.25) % 980 - 10;
      const py = (i * 83 + Math.sin((this.frame + i * 25) / 90) * 26 + this.frame * 0.18) % 560 - 10;
      const r = 1.4 + this._noise(i) * 2.2;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
  },

  // 苔むした岩／倒木の足場。地面（index 0）は一枚岩として別に描く。
  _drawJunglePlatform(ctx, p) {
    const isGround = p.y >= JUNGLE_CONFIG.groundY;
    if (isGround) {
      const grad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      grad.addColorStop(0, '#4a7c3f'); grad.addColorStop(0.18, '#3c5a2e'); grad.addColorStop(1, '#241c12');
      ctx.fillStyle = grad;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      // 表土の草
      ctx.fillStyle = '#5c9a48';
      for (let x = p.x; x < p.x + p.w; x += 7) {
        const h = 4 + this._noise(x * 0.9) * 7;
        ctx.fillRect(x, p.y - h + 2, 3, h);
      }
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      for (let x = p.x; x < p.x + p.w; x += 34) {
        ctx.beginPath();
        ctx.ellipse(x + 17, p.y + 22 + this._noise(x) * 12, 13, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.save();
    if (p.log) {
      // 倒木：木肌の縦筋と、両端の年輪
      const grad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      grad.addColorStop(0, '#7a5a34'); grad.addColorStop(0.5, '#5d4224'); grad.addColorStop(1, '#3a2916');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,20,10,.4)'; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const yy = p.y + p.h * (i / 5);
        ctx.beginPath(); ctx.moveTo(p.x + 4, yy); ctx.lineTo(p.x + p.w - 4, yy); ctx.stroke();
      }
      ctx.fillStyle = '#8a6a42';
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + p.h / 2, 4, p.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(p.x + p.w - 3, p.y + p.h / 2, 4, p.h / 2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      // 岩：角を落とした塊に陰影
      const grad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      grad.addColorStop(0, '#8b8b81'); grad.addColorStop(0.55, '#63635b'); grad.addColorStop(1, '#3d3d37');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      for (let x = p.x + 8; x < p.x + p.w - 8; x += 19) {
        ctx.fillRect(x, p.y + 5 + this._noise(x) * 4, 9, 2);
      }
    }
    // 上面の苔（どちらの足場にも生える）
    ctx.fillStyle = '#5f9c46';
    ctx.beginPath();
    ctx.roundRect(p.x, p.y - 1, p.w, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#78bd55';
    for (let x = p.x + 3; x < p.x + p.w - 3; x += 11) {
      const n = this._noise(x * 1.7 + p.baseY);
      if (n > 0.45) ctx.fillRect(x, p.y - 2 - n * 3, 5, 3 + n * 3);
    }
    // 縁から垂れる蔓
    ctx.strokeStyle = 'rgba(90,150,70,.75)'; ctx.lineWidth = 2;
    for (const vx of [p.x + p.w * 0.22, p.x + p.w * 0.74]) {
      const len = 10 + this._noise(vx + p.baseY) * 20;
      ctx.beginPath();
      ctx.moveTo(vx, p.y + p.h - 1);
      ctx.lineTo(vx + Math.sin((this.frame + vx) / 70) * 4, p.y + p.h + len);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 古代遺跡の石板。表面に淡く光る紋章と、番号ぶんの光点が刻まれている。
  _drawJungleTargets(ctx) {
    for (const t of this.targets) {
      if (!t || t.destroyed) continue;
      const charred = t.charred > 0;
      // 失敗後は黒焦げになって沈み込みながら崩れる
      const fallen = charred ? Math.min(1, t.charred / 26) : 0;
      ctx.save();
      ctx.translate(t.x + t.w / 2, t.y + t.h / 2 + fallen * 26);
      ctx.rotate(fallen * 0.4);
      ctx.globalAlpha = charred ? Math.max(0, 1 - fallen) : 1;
      const w = t.w, h = t.h;

      // 影
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(0, h / 2 + 5, w * 0.42, 5, 0, 0, Math.PI * 2); ctx.fill();

      // 石板本体
      const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      if (charred) { grad.addColorStop(0, '#3a332e'); grad.addColorStop(1, '#171310'); }
      else { grad.addColorStop(0, '#b9b0a0'); grad.addColorStop(0.5, '#8d8676'); grad.addColorStop(1, '#615b4f'); }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 6);
      ctx.fill();
      // 面取りのハイライト
      ctx.strokeStyle = charred ? 'rgba(90,70,55,.5)' : 'rgba(255,250,235,.45)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 5); ctx.stroke();
      // 石のムラ
      ctx.fillStyle = charred ? 'rgba(0,0,0,.4)' : 'rgba(70,62,50,.22)';
      for (let i = 0; i < 5; i++) {
        const n = this._noise(t.id * 13 + i * 7.3);
        ctx.fillRect(-w / 2 + 5 + n * (w - 16), -h / 2 + 6 + this._noise(t.id + i * 3.1) * (h - 18), 5 + n * 6, 2);
      }
      // 角の苔
      if (!charred) {
        ctx.fillStyle = 'rgba(96,150,72,.75)';
        ctx.beginPath(); ctx.ellipse(-w / 2 + 6, h / 2 - 6, 8, 5, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(w / 2 - 8, -h / 2 + 8, 6, 4, -0.3, 0, Math.PI * 2); ctx.fill();
      }

      if (!charred) {
        // 紋章：脈打つ光のリングと、その中の番号
        const pulse = 0.62 + 0.38 * Math.sin(this.frame / 22 + t.glowSeed);
        const isNext = t.order === this.nextOrder;
        // 次に壊すべき石板だけは金色に強く光らせ、狙いを迷わせない
        const hue = isNext ? '255,214,110' : '150,255,170';
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(0, -4, 2, 0, -4, 26 + pulse * 8);
        glow.addColorStop(0, `rgba(${hue},${(isNext ? 0.75 : 0.5) * pulse})`);
        glow.addColorStop(1, `rgba(${hue},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, -4, 28 + pulse * 8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.strokeStyle = `rgba(${hue},${0.55 + pulse * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -4, 14, 0, Math.PI * 2); ctx.stroke();
        // リングの外周に刻んだ小さな刻み
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + this.frame / 300;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 17, Math.sin(a) * 17 - 4);
          ctx.lineTo(Math.cos(a) * 20, Math.sin(a) * 20 - 4);
          ctx.stroke();
        }
        // 番号（視認性の要。太字＋発光で遠目にも読める）
        ctx.font = 'bold 22px "Hiragino Kaku Gothic ProN", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = `rgba(${hue},.95)`; ctx.shadowBlur = 12;
        ctx.fillStyle = isNext ? '#fff6dc' : '#eaffe8';
        ctx.fillText(String(t.order), 0, -3);
        ctx.shadowBlur = 0;
        // 番号ぶんの光点（数字が読めない距離でも個数で分かるようにする）
        for (let i = 0; i < t.order; i++) {
          const dx = (i - (t.order - 1) / 2) * 8;
          ctx.fillStyle = `rgba(${hue},${0.6 + pulse * 0.4})`;
          ctx.beginPath(); ctx.arc(dx, h / 2 - 9, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  _drawJungleEffects(ctx) {
    // 粒子
    for (const p of (this.particles || [])) {
      const a = Math.max(0, Math.min(1, p.life / 26));
      ctx.save();
      ctx.globalAlpha = a;
      if (p.kind === 'good') {
        ctx.globalCompositeOperation = 'lighter';
        // 緑と金を混ぜる
        ctx.fillStyle = p.size > 4 ? 'rgba(255,224,130,.95)' : 'rgba(168,255,150,.95)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.fillStyle = '#241c17';
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // 加点/減点の吹き出し
    for (const t of (this.floatTexts || [])) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / 26));
      ctx.font = 'bold 20px "Hiragino Kaku Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.72)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (this.readyTimer > 0) this._drawJungleReady(ctx);
  },

  // 開始前3秒のルール説明
  _drawJungleReady(ctx) {
    const C = JUNGLE_CONFIG;
    const t = this.readyTimer;
    // 最後の18フレームでフェードアウト
    const alpha = Math.min(1, t / 18);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,20,12,.72)';
    ctx.fillRect(0, 178, 960, 176);
    ctx.strokeStyle = 'rgba(150,255,170,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 178); ctx.lineTo(960, 178);
    ctx.moveTo(0, 354); ctx.lineTo(960, 354); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.shadowColor = 'rgba(150,255,170,.9)'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#eaffe0';
    ctx.fillText('光る紋章の順（1→2→3…）に', 480, 224);
    ctx.fillText('石板を破壊しろ！', 480, 266);
    ctx.shadowBlur = 0;
    ctx.font = '17px "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.fillStyle = '#b9e8bd';
    ctx.fillText('順番を間違えるとそのフェーズは失敗。素早く正確に、コンボを繋げ', 480, 306);
    // 残り秒数のカウントダウン
    ctx.font = 'bold 26px "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.fillStyle = '#ffe27a';
    ctx.fillText(String(Math.ceil(t / 60)), 480, 336);
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  // 氷の足場：霜がかった質感＋下端に垂れる氷柱（見た目のみ、当たり判定はplatform本体のまま）
  _drawIcePlatform(ctx, p) {
    const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    grad.addColorStop(0, '#f6fdff'); grad.addColorStop(0.5, '#cdeeff'); grad.addColorStop(1, '#86c9e8');
    ctx.fillStyle = grad;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(p.x, p.y, p.w, 3);
    ctx.strokeStyle = 'rgba(80,140,175,.4)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + p.w * 0.28, p.y); ctx.lineTo(p.x + p.w * 0.4, p.y + p.h);
    ctx.moveTo(p.x + p.w * 0.72, p.y); ctx.lineTo(p.x + p.w * 0.6, p.y + p.h);
    ctx.stroke();
    ctx.fillStyle = '#bfe9fb';
    const spikes = Math.max(2, Math.floor(p.w / 34));
    for (let i = 0; i < spikes; i++) {
      const sx = p.x + (i + 0.5) * (p.w / spikes);
      const sh = 5 + ((i * 37 + Math.floor(p.baseX)) % 8);
      ctx.beginPath(); ctx.moveTo(sx - 5, p.y + p.h); ctx.lineTo(sx + 5, p.y + p.h); ctx.lineTo(sx, p.y + p.h + sh); ctx.fill();
    }
  },

  // ツララ：warnの間は落下地点に影が伸びる予告のみ、0になったら実体が落下する
  _drawSnowIcicles(ctx) {
    for (const ice of this.icicles) {
      if (ice.warn > 0) {
        const ratio = 1 - ice.warn / SNOW_CONFIG.icicleWarnFrames;
        ctx.fillStyle = `rgba(255,255,255,${0.25 + ratio * 0.4})`;
        ctx.fillRect(ice.x + ice.w * 0.15, ice.y, ice.w * 0.7, 6 + ratio * 16);
        continue;
      }
      const grad = ctx.createLinearGradient(ice.x, ice.y, ice.x, ice.y + ice.h);
      grad.addColorStop(0, '#eafbff'); grad.addColorStop(1, '#8fd0ee');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ice.x, ice.y); ctx.lineTo(ice.x + ice.w, ice.y);
      ctx.lineTo(ice.x + ice.w * 0.5, ice.y + ice.h);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ice.x + ice.w * 0.32, ice.y + 4); ctx.lineTo(ice.x + ice.w * 0.42, ice.y + ice.h * 0.7); ctx.stroke();
    }
  },

  _drawProjectiles(ctx) {
    for (const p of this.projectiles) {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      if (p.exploding > 0) {
        const progress = 1 - p.exploding / 12;
        const radius = (p.config.explosionRadius || 90) * (0.45 + progress * 0.55);
        ctx.globalAlpha = Math.max(.15, p.exploding / 12);
        const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
        gradient.addColorStop(0, '#fff7b0'); gradient.addColorStop(.35, '#ff9f1a'); gradient.addColorStop(1, 'rgba(255,45,0,0)');
        ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.vx < 0) ctx.scale(-1, 1);
      if (p.sprite && p.sprite.complete && p.sprite.naturalWidth) {
        ctx.drawImage(p.sprite, -p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        ctx.fillStyle = '#fff58a';
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  },

  escape(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; },
};

window.PracticeGame = PracticeGame;
