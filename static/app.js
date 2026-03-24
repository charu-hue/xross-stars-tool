const state = {
  screen: "home",
  decks: [],
  cards: [],
  importText: "",
  importError: "",
  importLoading: false,
  selectedDeck1Id: "",
  selectedDeck2Id: "",
  preselectedTactic1Index: "",
  preselectedTactic2Index: "",
  match: null,
  ui: {
    tacticModalPlayerId: null,
    usedTacticModalPlayerId: null,
    equipModal: {
      playerId: null,
      tacticId: null,
    },
  },
  manualCardForm: {
    name: "",
    type: "memoria",
    color: "red",
    cost: "0",
    atk: "0",
    hp: "0",
    effect: "",
    imageUrl: "",
  },
  manualDeckForm: {
    name: "",
    leaderIds: [],
    mainIds: [],
    tacticIds: [],
  },
};

const root = document.getElementById("root");

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneCard(card) {
  const cloned = cloneDeep(card);
  cloned.id = uid();
  return cloned;
}

function cloneDeckForMatch(deck) {
  return {
    ...cloneDeep(deck),
    leaders: deck.leaders.map(cloneCard),
    mainDeck: deck.mainDeck.map(cloneCard),
    tactics: deck.tactics.map(cloneCard),
    ppCard: deck.ppCard ? cloneCard(deck.ppCard) : null,
  };
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getRoundMaxPP(round) {
  if (round <= 1) return 3;
  if (round === 2) return 4;
  return 5;
}

function createLeaderState(card) {
  return {
    instanceId: uid(),
    card,
    currentHp: Number(card.hp || 0),
    isAwakened: false,
    isDown: false,
    nextAttackBonus: 0,
    equippedTactics: [],
  };
}

function createPlayerState(deck, playerId, round) {
  const shuffled = shuffle(deck.mainDeck);
  const maxPP = getRoundMaxPP(round);

  return {
    playerId,
    deckId: deck.id,
    deckName: deck.name,
    drawPile: shuffled.slice(4),
    hand: shuffled.slice(0, 4),
    trashPile: [],
    pp: maxPP,
    maxPP,
    leaders: deck.leaders.map(createLeaderState),
    field: [],
    tacticsDeckRemaining: [...deck.tactics],
    tacticsArea: [],
    usedTacticsVisible: [],
    ppCard: deck.ppCard || null,
    selectedTacticId: null,
    matchLog: [],
  };
}

function groupCards(cards) {
  const map = new Map();

  for (const card of cards) {
    const key = `${card.originalId || card.id}-${card.name}`;
    if (map.has(key)) {
      map.get(key).count += 1;
    } else {
      map.set(key, {
        key,
        name: card.name,
        count: 1,
        type: card.type,
        cost: card.cost,
      });
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function countSelections(ids) {
  const map = new Map();
  for (const id of ids) {
    map.set(id, (map.get(id) || 0) + 1);
  }
  return map;
}

async function api(path, options = {}) {
  const response = await fetch(`${window.APP_CONFIG.apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
}

async function loadInitialData() {
  const [cards, decks] = await Promise.all([api("/api/cards"), api("/api/decks")]);
  state.cards = cards;
  state.decks = decks;
  render();
}

function navigate(screen) {
  state.screen = screen;
  render();
}

function selectedDeck1() {
  return state.decks.find((deck) => deck.id === state.selectedDeck1Id) || null;
}

function selectedDeck2() {
  return state.decks.find((deck) => deck.id === state.selectedDeck2Id) || null;
}

function leaderCards() {
  return state.cards.filter((card) => card.type === "leader");
}

function mainCards() {
  return state.cards.filter((card) => card.type === "attack" || card.type === "memoria");
}

function tacticCards() {
  return state.cards.filter(
    (card) => card.type === "tactics" || card.type === "pp_ticket"
  );
}

function getPlayer(playerId) {
  if (!state.match) return null;
  return playerId === 1 ? state.match.player1 : state.match.player2;
}

function getOpponent(playerId) {
  if (!state.match) return null;
  return playerId === 1 ? state.match.player2 : state.match.player1;
}

function addMatchLog(playerId, message) {
  const player = getPlayer(playerId);
  if (!player) return;
  player.matchLog.unshift(message);
  if (player.matchLog.length > 40) {
    player.matchLog = player.matchLog.slice(0, 40);
  }
}

function clampPP(player) {
  if (player.pp < 0) player.pp = 0;
  if (player.pp > player.maxPP) player.pp = player.maxPP;
}

function getLeaderBaseHp(leader) {
  return leader.isAwakened
    ? Number(leader.card.awakenHp || leader.card.hp || 0)
    : Number(leader.card.hp || 0);
}

function normalizeLeaderState(leader) {
  if (leader.currentHp <= 0) {
    leader.currentHp = 0;
    leader.isDown = true;
  }
}

function checkRoundWinner() {
  if (!state.match || state.match.roundWinner) return;

  const p1AllDown = state.match.player1.leaders.every((leader) => leader.isDown);
  const p2AllDown = state.match.player2.leaders.every((leader) => leader.isDown);

  if (!p1AllDown && !p2AllDown) return;

  if (p1AllDown && p2AllDown) {
    state.match.roundWinner = 0;
    return;
  }

  state.match.roundWinner = p1AllDown ? 2 : 1;
}

function reviveLeadersForNextRound(player) {
  player.leaders.forEach((leader) => {
    leader.isDown = false;
    leader.currentHp = getLeaderBaseHp(leader);
    leader.nextAttackBonus = 0;
  });
}

function findFirstAliveLeader(player) {
  return player.leaders.find((leader) => !leader.isDown) || null;
}

function addNextAttackBonusToFirstAliveLeader(player, amount) {
  const leader = findFirstAliveLeader(player);
  if (!leader) return null;
  leader.nextAttackBonus = (leader.nextAttackBonus || 0) + amount;
  return leader;
}

function healFirstAliveLeader(player, amount) {
  const leader = findFirstAliveLeader(player);
  if (!leader) return null;

  const maxHp = getLeaderBaseHp(leader);
  leader.currentHp = Math.min(maxHp, leader.currentHp + amount);
  return leader;
}

function moveTacticToAreaByIndex(playerId, tacticIndex) {
  const player = getPlayer(playerId);
  if (!player) return;

  const index = Number(tacticIndex);
  if (Number.isNaN(index)) return;
  if (index < 0 || index >= player.tacticsDeckRemaining.length) return;

  const [tactic] = player.tacticsDeckRemaining.splice(index, 1);
  player.tacticsArea.push(tactic);
  addMatchLog(playerId, `${tactic.name} をタクティクスエリアに追加`);
}

function moveTopTacticToArea(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;

  if (player.tacticsDeckRemaining.length === 0) {
    addMatchLog(playerId, "タクティクスデッキに残りがないため、追加できません。");
    return;
  }

  const tactic = player.tacticsDeckRemaining.shift();
  player.tacticsArea.push(tactic);
  addMatchLog(playerId, `${tactic.name} をタクティクスエリアに追加`);
}

function randomTrashOneTacticFromDeckRemaining(playerId) {
  const player = getPlayer(playerId);
  if (!player) return;

  if (player.tacticsDeckRemaining.length === 0) {
    addMatchLog(playerId, "山札再構築時: タクティクスデッキ残りがないため、除外なし。");
    return;
  }

  const index = Math.floor(Math.random() * player.tacticsDeckRemaining.length);
  const [trashed] = player.tacticsDeckRemaining.splice(index, 1);
  player.usedTacticsVisible.push(trashed);
  addMatchLog(
    playerId,
    `山札再構築時: タクティクスデッキ残りから ${trashed.name} がランダムに除外された`
  );
}

function rebuildDeckIfNeeded(playerId) {
  const player = getPlayer(playerId);
  if (!player) return false;

  if (player.drawPile.length > 0) return true;
  if (player.trashPile.length === 0) return false;

  const rebuilt = shuffle(player.trashPile);
  player.drawPile = rebuilt;
  player.trashPile = [];
  addMatchLog(playerId, `トラッシュ ${rebuilt.length} 枚をシャッフルして山札に戻した`);

  randomTrashOneTacticFromDeckRemaining(playerId);
  return player.drawPile.length > 0;
}

function drawCards(playerId, amount) {
  const player = getPlayer(playerId);
  if (!player) return 0;

  let actual = 0;

  for (let i = 0; i < amount; i += 1) {
    if (player.drawPile.length === 0) {
      const rebuilt = rebuildDeckIfNeeded(playerId);
      if (!rebuilt) break;
    }

    if (player.drawPile.length === 0) break;

    player.hand.push(player.drawPile[0]);
    player.drawPile = player.drawPile.slice(1);
    actual += 1;
  }

  return actual;
}

function isEquipmentTactic(card) {
  return card?.tactics_type === "equipment";
}

function getAutoEffects(card, context) {
  const effectText = card.effect || "";
  const effects = [];

  const isSimpleTrigger =
    context.trigger === "onPlay" ||
    context.trigger === "afterAttack" ||
    context.trigger === "onAwaken";

  const hasConditionLike =
    effectText.includes("なら") ||
    effectText.includes("してもよい") ||
    effectText.includes("その中から") ||
    effectText.includes("オーバーキル") ||
    effectText.includes("他のリーダー") ||
    effectText.includes("受けたリーダー") ||
    effectText.includes("このアタック") ||
    effectText.includes("ターンに1回");

  if (!hasConditionLike && isSimpleTrigger) {
    if (effectText.includes("カードを2枚引く。")) {
      effects.push({ type: "draw", amount: 2 });
    } else if (effectText.includes("カードを1枚引く。")) {
      effects.push({ type: "draw", amount: 1 });
    }
  }

  if (!hasConditionLike && effectText.includes("PPを1回復")) {
    effects.push({ type: "pp", amount: 1 });
  }

  if (!hasConditionLike && effectText.includes("リーダー1体を20回復")) {
    effects.push({ type: "heal", amount: 20 });
  } else if (!hasConditionLike && effectText.includes("リーダー1体を30回復")) {
    effects.push({ type: "heal", amount: 30 });
  }

  if (effectText.includes("次のアタックのダメージ+80")) {
    effects.push({ type: "nextAttackBuff", amount: 80 });
  } else if (effectText.includes("次のアタックのダメージ+60")) {
    effects.push({ type: "nextAttackBuff", amount: 60 });
  } else if (effectText.includes("次のアタックのダメージ+50")) {
    effects.push({ type: "nextAttackBuff", amount: 50 });
  } else if (effectText.includes("次のアタックのダメージ+30")) {
    effects.push({ type: "nextAttackBuff", amount: 30 });
  }

  if (effectText.includes("手札を2枚捨てる")) {
    effects.push({
      type: "manualNotice",
      message: "手札を捨てる処理は手動で行ってください。",
    });
  }

  if (hasConditionLike) {
    effects.push({
      type: "manualNotice",
      message: "条件付き効果のため、必要に応じて手動で処理してください。",
    });
  }

  return effects;
}

function resolveAutoEffects(playerId, sourceCard, trigger) {
  const player = getPlayer(playerId);
  if (!player) return;

  const effects = getAutoEffects(sourceCard, { trigger });
  if (!effects.length) return;

  for (const effect of effects) {
    if (effect.type === "draw") {
      const actual = drawCards(playerId, effect.amount);
      addMatchLog(playerId, `${sourceCard.name} の効果で ${actual} 枚ドロー`);
    }

    if (effect.type === "pp") {
      player.pp += effect.amount;
      clampPP(player);
      addMatchLog(playerId, `${sourceCard.name} の効果で PP +${effect.amount}`);
    }

    if (effect.type === "heal") {
      const leader = healFirstAliveLeader(player, effect.amount);
      if (leader) {
        addMatchLog(playerId, `${sourceCard.name} の効果で ${leader.card.name} を ${effect.amount} 回復`);
      } else {
        addMatchLog(playerId, `${sourceCard.name}: 回復できるリーダーがいません`);
      }
    }

    if (effect.type === "nextAttackBuff") {
      const leader = addNextAttackBonusToFirstAliveLeader(player, effect.amount);
      if (leader) {
        addMatchLog(
          playerId,
          `${sourceCard.name} の効果で ${leader.card.name} の次のアタック +${effect.amount}`
        );
      } else {
        addMatchLog(playerId, `${sourceCard.name}: 強化できるリーダーがいません`);
      }
    }

    if (effect.type === "manualNotice") {
      addMatchLog(playerId, `${sourceCard.name}: ${effect.message}`);
    }
  }
}

async function handleImportDeck() {
  state.importLoading = true;
  state.importError = "";
  render();

  try {
    await api("/api/import-deck", {
      method: "POST",
      body: JSON.stringify({ input: state.importText }),
    });
    state.importText = "";
    state.decks = await api("/api/decks");
    alert("デッキを取り込みました。");
  } catch (error) {
    state.importError = error.message || "デッキ取込に失敗しました。";
  } finally {
    state.importLoading = false;
    render();
  }
}

async function handleCreateCard() {
  try {
    await api("/api/cards", {
      method: "POST",
      body: JSON.stringify(state.manualCardForm),
    });
    state.cards = await api("/api/cards");
    state.manualCardForm = {
      name: "",
      type: "memoria",
      color: "red",
      cost: "0",
      atk: "0",
      hp: "0",
      effect: "",
      imageUrl: "",
    };
    render();
    alert("カードを追加しました。");
  } catch (error) {
    alert(error.message || "カード追加に失敗しました。");
  }
}

async function handleDeleteCard(cardId) {
  if (!confirm("このカードを削除しますか？")) return;
  await api(`/api/cards/${cardId}`, { method: "DELETE" });
  state.cards = await api("/api/cards");
  render();
}

async function handleDeleteDeck(deckId) {
  if (!confirm("このデッキを削除しますか？")) return;
  await api(`/api/decks/${deckId}`, { method: "DELETE" });
  state.decks = await api("/api/decks");
  render();
}

function addSelection(type, id, max) {
  const target = state.manualDeckForm[type];
  if (target.length >= max) return;
  target.push(id);
  render();
}

function removeSelection(type, id) {
  const target = state.manualDeckForm[type];
  const index = target.lastIndexOf(id);
  if (index === -1) return;
  target.splice(index, 1);
  render();
}

async function handleSaveManualDeck() {
  const name = state.manualDeckForm.name.trim();
  const leaderIds = state.manualDeckForm.leaderIds;
  const mainIds = state.manualDeckForm.mainIds;
  const tacticIds = state.manualDeckForm.tacticIds;

  if (!name) {
    alert("デッキ名を入力してください。");
    return;
  }
  if (leaderIds.length !== 4) {
    alert("リーダーは4枚選択してください。");
    return;
  }
  if (mainIds.length !== 50) {
    alert("メインデッキは50枚選択してください。");
    return;
  }
  if (tacticIds.length !== 5) {
    alert("タクティクスは5枚選択してください。");
    return;
  }

  const leaders = leaderIds
    .map((id) => state.cards.find((card) => card.id === id))
    .filter(Boolean)
    .map(cloneCard);

  const mainDeck = mainIds
    .map((id) => state.cards.find((card) => card.id === id))
    .filter(Boolean)
    .map(cloneCard);

  const tactics = tacticIds
    .map((id) => state.cards.find((card) => card.id === id))
    .filter(Boolean)
    .map(cloneCard);

  try {
    await api("/api/decks", {
      method: "POST",
      body: JSON.stringify({
        name,
        leaders,
        mainDeck,
        tactics,
        ppCard: null,
        imageUrl: null,
      }),
    });
    state.decks = await api("/api/decks");
    state.manualDeckForm = {
      name: "",
      leaderIds: [],
      mainIds: [],
      tacticIds: [],
    };
    render();
    alert("手動デッキを保存しました。");
  } catch (error) {
    alert(error.message || "デッキ保存に失敗しました。");
  }
}

function handleStartMatch() {
  const deck1 = selectedDeck1();
  const deck2 = selectedDeck2();

  if (!deck1 || !deck2) {
    alert("デッキ1とデッキ2を選択してください。");
    return;
  }

  if (state.preselectedTactic1Index === "" || state.preselectedTactic2Index === "") {
    alert("1ラウンド目開始前に、両方のデッキでタクティクスを1枚選択してください。");
    return;
  }

  const round = 1;
  const cloned1 = cloneDeckForMatch(deck1);
  const cloned2 = cloneDeckForMatch(deck2);

  state.match = {
    player1: createPlayerState(cloned1, 1, round),
    player2: createPlayerState(cloned2, 2, round),
    turnPlayer: 1,
    round,
    roundWinner: null,
    roundWins1: 0,
    roundWins2: 0,
    winner: null,
  };

  moveTacticToAreaByIndex(1, state.preselectedTactic1Index);
  moveTacticToAreaByIndex(2, state.preselectedTactic2Index);

  if (state.match.player2.ppCard) {
    state.match.player2.tacticsArea.push(state.match.player2.ppCard);
    addMatchLog(2, `${state.match.player2.ppCard.name} をタクティクスエリアに追加`);
  }

  addMatchLog(1, "試合開始。初期手札 4 枚、PP 3/3");
  addMatchLog(2, "試合開始。初期手札 4 枚、PP 3/3");

  state.screen = "match";
  render();
}

function updatePlayer(playerId, updater) {
  if (!state.match) return;
  if (playerId === 1) {
    state.match.player1 = updater(state.match.player1);
  } else {
    state.match.player2 = updater(state.match.player2);
  }
  checkRoundWinner();
  render();
}

function drawOne(playerId) {
  updatePlayer(playerId, (player) => {
    const actual = drawCards(playerId, 1);
    if (actual > 0) {
      addMatchLog(playerId, `通常ドローで ${actual} 枚引いた`);
    }
    return player;
  });
}

function increaseDeckCount(playerId) {
  updatePlayer(playerId, (player) => {
    player.drawPile = [{ id: uid(), name: "不明カード", type: "memoria" }, ...player.drawPile];
    return player;
  });
}

function decreaseDeckCount(playerId) {
  updatePlayer(playerId, (player) => {
    if (player.drawPile.length > 0) {
      player.drawPile = player.drawPile.slice(1);
    }
    return player;
  });
}

function increaseTrash(playerId) {
  updatePlayer(playerId, (player) => {
    player.trashPile.push({ id: uid(), name: "不明カード", type: "memoria" });
    return player;
  });
}

function decreaseTrash(playerId) {
  updatePlayer(playerId, (player) => {
    if (player.trashPile.length > 0) {
      player.trashPile = player.trashPile.slice(0, -1);
    }
    return player;
  });
}

function changePP(playerId, diff) {
  updatePlayer(playerId, (player) => {
    player.pp += diff;
    clampPP(player);
    return player;
  });
}

function playCard(playerId, cardId) {
  updatePlayer(playerId, (player) => {
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return player;

    player.hand = player.hand.filter((c) => c.id !== cardId);
    player.field.push({
      instanceId: uid(),
      card,
      owner: playerId,
      isUsed: false,
    });

    addMatchLog(playerId, `${card.name} を場に出した`);
    resolveAutoEffects(playerId, card, "onPlay");

    return player;
  });
}

function trashHandCard(playerId, cardId) {
  updatePlayer(playerId, (player) => {
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return player;

    player.hand = player.hand.filter((c) => c.id !== cardId);
    player.trashPile.push(card);
    addMatchLog(playerId, `${card.name} を手札からトラッシュに送った`);
    return player;
  });
}

function toggleFieldUsed(playerId, instanceId) {
  updatePlayer(playerId, (player) => {
    player.field = player.field.map((fieldCard) => {
      if (fieldCard.instanceId === instanceId) {
        return { ...fieldCard, isUsed: !fieldCard.isUsed };
      }
      return fieldCard;
    });
    return player;
  });
}

function returnFieldToHand(playerId, instanceId) {
  updatePlayer(playerId, (player) => {
    const target = player.field.find((fieldCard) => fieldCard.instanceId === instanceId);
    if (!target) return player;

    player.field = player.field.filter((fieldCard) => fieldCard.instanceId !== instanceId);
    player.hand.push(target.card);
    addMatchLog(playerId, `${target.card.name} を場から手札に戻した`);
    return player;
  });
}

function trashFieldCard(playerId, instanceId) {
  updatePlayer(playerId, (player) => {
    const target = player.field.find((fieldCard) => fieldCard.instanceId === instanceId);
    if (!target) return player;

    player.field = player.field.filter((fieldCard) => fieldCard.instanceId !== instanceId);
    player.trashPile.push(target.card);
    addMatchLog(playerId, `${target.card.name} を場からトラッシュに送った`);
    return player;
  });
}

function attackWithLeader(playerId, leaderInstanceId) {
  updatePlayer(playerId, (player) => {
    const leader = player.leaders.find((l) => l.instanceId === leaderInstanceId);
    if (!leader) return player;
    if (leader.isDown) {
      addMatchLog(playerId, `${leader.card.name} はダウンしているためアタックできません`);
      return player;
    }

    const baseAtk = leader.isAwakened
      ? Number(leader.card.awakenAtk || leader.card.atk || 0)
      : Number(leader.card.atk || 0);

    const bonus = Number(leader.nextAttackBonus || 0);
    const total = baseAtk + bonus;

    addMatchLog(
      playerId,
      `${leader.card.name} がアタック。基本ATK ${baseAtk}${bonus ? ` + ボーナス ${bonus}` : ""} = ${total}`
    );

    leader.nextAttackBonus = 0;
    resolveAutoEffects(playerId, leader.card, "onAttack");
    resolveAutoEffects(playerId, leader.card, "afterAttack");

    return player;
  });
}

function changeLeaderHp(playerId, instanceId, diff) {
  updatePlayer(playerId, (player) => {
    player.leaders = player.leaders.map((leader) => {
      if (leader.instanceId === instanceId) {
        const nextLeader = { ...leader, currentHp: leader.currentHp + diff };
        normalizeLeaderState(nextLeader);
        return nextLeader;
      }
      return leader;
    });
    return player;
  });
}

function toggleLeaderFlag(playerId, instanceId, flag) {
  updatePlayer(playerId, (player) => {
    const before = player.leaders.find((leader) => leader.instanceId === instanceId);

    player.leaders = player.leaders.map((leader) => {
      if (leader.instanceId !== instanceId) return leader;

      const nextLeader = { ...leader, [flag]: !leader[flag] };

      if (flag === "isAwakened" && nextLeader.currentHp > 0) {
        const maxHp = getLeaderBaseHp(nextLeader);
        nextLeader.currentHp = Math.min(nextLeader.currentHp, maxHp);
      }

      return nextLeader;
    });

    const after = player.leaders.find((leader) => leader.instanceId === instanceId);

    if (flag === "isAwakened" && before && after && !before.isAwakened && after.isAwakened) {
      addMatchLog(playerId, `${after.card.name} が覚醒`);
      resolveAutoEffects(playerId, after.card, "onAwaken");
    }

    return player;
  });
}

function selectTactic(playerId, tacticId) {
  updatePlayer(playerId, (player) => {
    player.selectedTacticId = tacticId;
    return player;
  });
}

function openEquipModal(playerId, tacticId) {
  state.ui.equipModal = {
    playerId,
    tacticId,
  };
  render();
}

function closeEquipModal() {
  state.ui.equipModal = {
    playerId: null,
    tacticId: null,
  };
  render();
}

function equipSelectedTacticToLeader(playerId, leaderInstanceId) {
  updatePlayer(playerId, (player) => {
    const tacticId = state.ui.equipModal.tacticId;
    if (!tacticId) return player;

    const tactic = player.tacticsArea.find((t) => t.id === tacticId);
    if (!tactic) return player;

    const leader = player.leaders.find((l) => l.instanceId === leaderInstanceId);
    if (!leader || leader.isDown) return player;

    player.tacticsArea = player.tacticsArea.filter((t) => t.id !== tacticId);
    leader.equippedTactics.push(tactic);

    addMatchLog(playerId, `${tactic.name} を ${leader.card.name} に装備`);
    resolveAutoEffects(playerId, tactic, "onPlay");

    return player;
  });

  state.ui.equipModal = {
    playerId: null,
    tacticId: null,
  };
  render();
}

function markSelectedTacticUsed(playerId) {
  const player = getPlayer(playerId);
  if (!player || !player.selectedTacticId) return;

  const tactic = player.tacticsArea.find((t) => t.id === player.selectedTacticId);
  if (!tactic) return;

  if (isEquipmentTactic(tactic)) {
    openEquipModal(playerId, tactic.id);
    return;
  }

  updatePlayer(playerId, (nextPlayer) => {
    const nextTactic = nextPlayer.tacticsArea.find((t) => t.id === nextPlayer.selectedTacticId);
    if (!nextTactic) return nextPlayer;

    nextPlayer.tacticsArea = nextPlayer.tacticsArea.filter((t) => t.id !== nextPlayer.selectedTacticId);
    nextPlayer.usedTacticsVisible.push(nextTactic);

    addMatchLog(playerId, `${nextTactic.name} を使用`);
    resolveAutoEffects(playerId, nextTactic, "onPlay");

    return nextPlayer;
  });
}

function openTacticModal(playerId) {
  state.ui.tacticModalPlayerId = playerId;
  render();
}

function closeTacticModal() {
  state.ui.tacticModalPlayerId = null;
  render();
}

function openUsedTacticModal(playerId) {
  state.ui.usedTacticModalPlayerId = playerId;
  render();
}

function closeUsedTacticModal() {
  state.ui.usedTacticModalPlayerId = null;
  render();
}

function startNextRound() {
  if (!state.match) return;
  if (state.match.roundWinner == null) {
    alert("先にラウンド勝敗を確定してください。");
    return;
  }

  if (state.match.roundWinner === 1) {
    state.match.roundWins1 += 1;
  } else if (state.match.roundWinner === 2) {
    state.match.roundWins2 += 1;
  }

  if (state.match.roundWins1 >= 2) {
    state.match.winner = 1;
    render();
    return;
  }

  if (state.match.roundWins2 >= 2) {
    state.match.winner = 2;
    render();
    return;
  }

  if (state.match.round >= 3) {
    render();
    return;
  }

  state.match.round += 1;
  state.match.roundWinner = null;

  const round = state.match.round;
  const maxPP = getRoundMaxPP(round);

  [state.match.player1, state.match.player2].forEach((player) => {
    if (player.hand.length > 0) {
      player.trashPile.push(...player.hand);
      addMatchLog(player.playerId, `ラウンド終了処理: 手札 ${player.hand.length} 枚をトラッシュへ`);
      player.hand = [];
    }

    reviveLeadersForNextRound(player);

    player.maxPP = maxPP;
    player.pp = maxPP;

    moveTopTacticToArea(player.playerId);

    const drawn = drawCards(player.playerId, 4);
    addMatchLog(player.playerId, `ラウンド ${round} 開始。${drawn} 枚ドロー。PP ${maxPP}/${maxPP}`);
  });

  render();
}

function endTurn() {
  if (!state.match) return;
  state.match.turnPlayer = state.match.turnPlayer === 1 ? 2 : 1;
  render();
}

function setWinner(playerId) {
  if (!state.match) return;
  state.match.winner = playerId;
  render();
}

function finishMatch() {
  if (!confirm("対戦を終了してホームに戻りますか？")) return;
  state.match = null;
  state.ui.tacticModalPlayerId = null;
  state.ui.usedTacticModalPlayerId = null;
  state.ui.equipModal = { playerId: null, tacticId: null };
  state.screen = "home";
  render();
}

function homeHtml() {
  return `
    <section class="panel">
      <h2 class="section-title">メニュー</h2>

      <div class="menu-grid">
        <button class="primary-btn" onclick="navigate('setup')">一人回し開始</button>
        <button class="primary-btn" onclick="navigate('import')">デッキ取込</button>
        <button class="primary-btn" onclick="navigate('builder')">デッキ作成</button>
        <button class="primary-btn" onclick="navigate('cards')">カード登録</button>
      </div>

      <hr class="hr" />

      <h3 class="sub-title">保存済みデッキ</h3>

      ${
        state.decks.length === 0
          ? `<div class="empty-box">保存済みデッキはありません。</div>`
          : `<div class="list-column">
              ${state.decks
                .map(
                  (deck) => `
                <div class="list-item">
                  <div style="flex:1">
                    <div class="item-title">${escapeHtml(deck.name)}</div>
                    <div class="meta-text">
                      種別: ${escapeHtml(deck.source)} / リーダー ${deck.leaders.length} / メイン ${deck.mainDeck.length} / タクティクス ${deck.tactics.length}
                    </div>
                  </div>
                  <button class="danger-btn" onclick="handleDeleteDeck('${deck.id}')">削除</button>
                </div>`
                )
                .join("")}
            </div>`
      }
    </section>
  `;
}

function importHtml() {
  return `
    <section class="panel">
      <h2 class="section-title">デッキ取込</h2>
      <p class="description">
        デッキコードまたは公式URLを入力してください。<br />
        例:<br />
        f432ac90-a0e5-4cc4-b7ed-a9d8fe211c9b<br />
        https://xross-stars.com/deck/f432ac90-a0e5-4cc4-b7ed-a9d8fe211c9b
      </p>

      <textarea
        class="textarea"
        placeholder="デッキコードまたはURL"
        oninput="state.importText=this.value"
      >${escapeHtml(state.importText)}</textarea>

      ${state.importError ? `<div class="error-box">${escapeHtml(state.importError)}</div>` : ""}

      <div class="button-row">
        <button class="primary-btn" onclick="handleImportDeck()" ${
          state.importLoading ? "disabled" : ""
        }>
          ${state.importLoading ? "取込中..." : "取込する"}
        </button>
        <button class="secondary-btn" onclick="navigate('home')">戻る</button>
      </div>
    </section>
  `;
}

function cardsHtml() {
  return `
    <section class="panel">
      <h2 class="section-title">カード登録</h2>

      <div class="form-grid">
        <label class="label">
          カード名
          <input class="input" value="${escapeHtml(
            state.manualCardForm.name
          )}" oninput="state.manualCardForm.name=this.value" />
        </label>

        <label class="label">
          種別
          <select class="input" onchange="state.manualCardForm.type=this.value">
            ${["leader", "attack", "memoria", "tactics", "pp_ticket"]
              .map(
                (type) =>
                  `<option value="${type}" ${
                    state.manualCardForm.type === type ? "selected" : ""
                  }>${type}</option>`
              )
              .join("")}
          </select>
        </label>

        <label class="label">
          色
          <select class="input" onchange="state.manualCardForm.color=this.value">
            ${["red", "blue", "yellow", "green", "purple", "colorless"]
              .map(
                (color) =>
                  `<option value="${color}" ${
                    state.manualCardForm.color === color ? "selected" : ""
                  }>${color}</option>`
              )
              .join("")}
          </select>
        </label>

        <label class="label">
          コスト
          <input class="input" type="number" value="${escapeHtml(
            state.manualCardForm.cost
          )}" oninput="state.manualCardForm.cost=this.value" />
        </label>

        <label class="label">
          ATK
          <input class="input" type="number" value="${escapeHtml(
            state.manualCardForm.atk
          )}" oninput="state.manualCardForm.atk=this.value" />
        </label>

        <label class="label">
          HP
          <input class="input" type="number" value="${escapeHtml(
            state.manualCardForm.hp
          )}" oninput="state.manualCardForm.hp=this.value" />
        </label>

        <label class="label" style="grid-column:1/-1;">
          効果
          <textarea class="textarea" oninput="state.manualCardForm.effect=this.value">${escapeHtml(
            state.manualCardForm.effect
          )}</textarea>
        </label>

        <label class="label" style="grid-column:1/-1;">
          画像URL
          <input class="input" value="${escapeHtml(
            state.manualCardForm.imageUrl
          )}" oninput="state.manualCardForm.imageUrl=this.value" />
        </label>
      </div>

      <div class="button-row">
        <button class="primary-btn" onclick="handleCreateCard()">カード追加</button>
        <button class="secondary-btn" onclick="navigate('home')">戻る</button>
      </div>

      <hr class="hr" />
      <h3 class="sub-title">登録済みカード</h3>

      ${
        state.cards.length === 0
          ? `<div class="empty-box">まだカードは登録されていません。</div>`
          : `<div class="list-column">
              ${state.cards
                .map(
                  (card) => `
                <div class="list-item">
                  <div style="flex:1">
                    <div class="item-title">${escapeHtml(card.name)} (${escapeHtml(card.type)})</div>
                    <div class="meta-text">
                      色: ${escapeHtml(card.color || "-")} / コスト: ${card.cost ?? "-"} / ATK: ${card.atk ?? "-"} / HP: ${card.hp ?? "-"}
                    </div>
                  </div>
                  <button class="danger-btn" onclick="handleDeleteCard('${card.id}')">削除</button>
                </div>`
                )
                .join("")}
            </div>`
      }
    </section>
  `;
}

function builderSectionHtml(title, cards, counts, typeKey, max, allowDuplicates) {
  return `
    <div style="margin-top:18px;">
      <h3 class="sub-title">${escapeHtml(title)}</h3>
      ${
        cards.length === 0
          ? `<div class="empty-box">対象カードがありません。</div>`
          : `<div class="builder-grid">
              ${cards
                .map((card) => {
                  const count = counts.get(card.id) || 0;
                  return `
                    <div class="builder-card">
                      <div class="item-title">${escapeHtml(card.name)}</div>
                      <div class="meta-text">${escapeHtml(card.type)} / コスト ${card.cost ?? 0}</div>
                      <div class="meta-text">選択数: ${count}</div>
                      <div class="button-row">
                        <button class="small-btn" onclick="addSelection('${typeKey}','${card.id}',${max})" ${
                          !allowDuplicates && count >= 1 ? "disabled" : ""
                        }>＋</button>
                        <button class="small-btn" onclick="removeSelection('${typeKey}','${card.id}')" ${
                          count <= 0 ? "disabled" : ""
                        }>－</button>
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>`
      }
    </div>
  `;
}

function builderHtml() {
  const leaderCountMap = countSelections(state.manualDeckForm.leaderIds);
  const mainCountMap = countSelections(state.manualDeckForm.mainIds);
  const tacticCountMap = countSelections(state.manualDeckForm.tacticIds);

  return `
    <section class="panel">
      <h2 class="section-title">手動デッキ作成</h2>

      <label class="label">
        デッキ名
        <input class="input" value="${escapeHtml(
          state.manualDeckForm.name
        )}" oninput="state.manualDeckForm.name=this.value" />
      </label>

      <div class="counter-row">
        <div>リーダー: ${state.manualDeckForm.leaderIds.length} / 4</div>
        <div>メイン: ${state.manualDeckForm.mainIds.length} / 50</div>
        <div>タクティクス: ${state.manualDeckForm.tacticIds.length} / 5</div>
      </div>

      ${builderSectionHtml("リーダー選択", leaderCards(), leaderCountMap, "leaderIds", 4, false)}
      ${builderSectionHtml("メインデッキ選択", mainCards(), mainCountMap, "mainIds", 50, true)}
      ${builderSectionHtml("タクティクス選択", tacticCards(), tacticCountMap, "tacticIds", 5, true)}

      <div class="button-row" style="margin-top:18px;">
        <button class="primary-btn" onclick="handleSaveManualDeck()">デッキ保存</button>
        <button class="secondary-btn" onclick="navigate('home')">戻る</button>
      </div>
    </section>
  `;
}

function deckPreviewHtml(title, deck, preselectedIndex, selectKey) {
  if (!deck) {
    return `
      <div class="preview-card">
        <h3 class="sub-title">${escapeHtml(title)}</h3>
        <div class="empty-box">未選択</div>
      </div>
    `;
  }

  const grouped = groupCards(deck.mainDeck);

  return `
    <div class="preview-card">
      <h3 class="sub-title">${escapeHtml(title)}</h3>
      <div class="item-title">${escapeHtml(deck.name)}</div>
      <div class="meta-text">リーダー: ${escapeHtml(deck.leaders.map((x) => x.name).join(" / "))}</div>
      <div class="meta-text">メイン: ${deck.mainDeck.length}枚</div>
      <div class="meta-text">タクティクス: ${deck.tactics.length}枚</div>

      <div style="margin-top:12px;">
        <div class="meta-text">1ラウンド目開始前のタクティクス選択</div>
        <select class="input" onchange="${selectKey}=this.value; render();">
          <option value="">選択してください</option>
          ${deck.tactics
            .map(
              (t, index) => `
            <option value="${index}" ${String(preselectedIndex) === String(index) ? "selected" : ""}>
              ${escapeHtml(t.name)}
            </option>`
            )
            .join("")}
        </select>
      </div>

      ${
        deck.imageUrl
          ? `<img class="deck-image" src="${escapeHtml(deck.imageUrl)}" alt="${escapeHtml(deck.name)}" />`
          : ""
      }

      <div style="margin-top:12px;">
        <div class="meta-text">メインデッキ内訳</div>
        <div class="compact-list">
          ${grouped
            .slice(0, 10)
            .map(
              (item) => `<div class="compact-item">${escapeHtml(item.name)} ×${item.count}</div>`
            )
            .join("")}
          ${
            grouped.length > 10
              ? `<div class="compact-item">...他 ${grouped.length - 10} 種類</div>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function setupHtml() {
  return `
    <section class="panel">
      <h2 class="section-title">一人回し開始</h2>

      ${
        state.decks.length === 0
          ? `
            <div class="empty-box">先にデッキを取り込むか作成してください。</div>
            <div class="button-row">
              <button class="secondary-btn" onclick="navigate('home')">戻る</button>
            </div>
          `
          : `
            <div class="form-grid">
              <label class="label">
                デッキ1
                <select class="input" onchange="state.selectedDeck1Id=this.value; state.preselectedTactic1Index=''; render();">
                  <option value="">選択してください</option>
                  ${state.decks
                    .map(
                      (deck) => `
                    <option value="${deck.id}" ${
                        state.selectedDeck1Id === deck.id ? "selected" : ""
                      }>${escapeHtml(deck.name)}</option>`
                    )
                    .join("")}
                </select>
              </label>

              <label class="label">
                デッキ2
                <select class="input" onchange="state.selectedDeck2Id=this.value; state.preselectedTactic2Index=''; render();">
                  <option value="">選択してください</option>
                  ${state.decks
                    .map(
                      (deck) => `
                    <option value="${deck.id}" ${
                        state.selectedDeck2Id === deck.id ? "selected" : ""
                      }>${escapeHtml(deck.name)}</option>`
                    )
                    .join("")}
                </select>
              </label>
            </div>

            <div class="preview-grid">
              ${deckPreviewHtml(
                "デッキ1",
                selectedDeck1(),
                state.preselectedTactic1Index,
                "state.preselectedTactic1Index"
              )}
              ${deckPreviewHtml(
                "デッキ2",
                selectedDeck2(),
                state.preselectedTactic2Index,
                "state.preselectedTactic2Index"
              )}
            </div>

            <div class="button-row">
              <button class="primary-btn" onclick="handleStartMatch()">対戦開始</button>
              <button class="secondary-btn" onclick="navigate('home')">戻る</button>
            </div>
          `
      }
    </section>
  `;
}

function playerPanelHtml(title, player, isTurnPlayer) {
  return `
    <div class="match-block">
      <div class="block-header">
        <h3 class="sub-title">${escapeHtml(title)}${isTurnPlayer ? "（ターン中）" : ""}</h3>
        <button class="primary-btn" onclick="setWinner(${player.playerId})">勝利にする</button>
      </div>

      <div class="counter-row">
        <div>デッキ名: ${escapeHtml(player.deckName)}</div>
        <div>山札: ${player.drawPile.length}</div>
        <div>トラッシュ: ${player.trashPile.length}</div>
        <div>PP: ${player.pp} / ${player.maxPP}</div>
      </div>

      <div class="button-row-wrap">
        <button class="small-btn" onclick="drawOne(${player.playerId})">1ドロー</button>
        <button class="small-btn" onclick="changePP(${player.playerId},1)">PP +1</button>
        <button class="small-btn" onclick="changePP(${player.playerId},-1)">PP -1</button>
        <button class="small-btn" onclick="increaseDeckCount(${player.playerId})">山札 +1</button>
        <button class="small-btn" onclick="decreaseDeckCount(${player.playerId})">山札 -1</button>
        <button class="small-btn" onclick="increaseTrash(${player.playerId})">トラッシュ +1</button>
        <button class="small-btn" onclick="decreaseTrash(${player.playerId})">トラッシュ -1</button>
        <button class="small-btn" onclick="openTacticModal(${player.playerId})">タクティクスエリア (${player.tacticsArea.length})</button>
        <button class="small-btn" onclick="openUsedTacticModal(${player.playerId})">使用済みタクティクス (${player.usedTacticsVisible.length})</button>
      </div>

      <div class="meta-text" style="margin-top:10px;">タクティクスデッキ残り: ${player.tacticsDeckRemaining.length} 枚</div>

      <div class="leader-grid" style="margin-top:12px;">
        ${player.leaders
          .map(
            (leader) => `
          <div class="leader-card">
            ${
              leader.card.imageUrl
                ? `<img class="card-image" src="${escapeHtml(
                    leader.isAwakened
                      ? leader.card.awakenImageUrl || leader.card.imageUrl
                      : leader.card.imageUrl
                  )}" alt="${escapeHtml(leader.card.name)}" />`
                : `<div class="no-image">No Image</div>`
            }
            <div class="item-title">${escapeHtml(leader.card.name)}</div>
            <div class="meta-text">HP: ${leader.currentHp}</div>
            <div class="meta-text">次のアタック補正: +${leader.nextAttackBonus || 0}</div>
            <div class="meta-text">
              状態:
              ${leader.isAwakened ? " 覚醒" : " 通常"} /
              ${leader.isDown ? " ダウン" : " 非ダウン"}
            </div>
            <div class="meta-text">
              装備:
              ${
                leader.equippedTactics.length > 0
                  ? escapeHtml(leader.equippedTactics.map((t) => t.name).join(" / "))
                  : "なし"
              }
            </div>

            <div class="button-row-wrap">
              <button class="small-btn" onclick="changeLeaderHp(${player.playerId},'${leader.instanceId}',-10)">-10</button>
              <button class="small-btn" onclick="changeLeaderHp(${player.playerId},'${leader.instanceId}',10)">+10</button>
              <button class="small-btn" onclick="toggleLeaderFlag(${player.playerId},'${leader.instanceId}','isAwakened')">覚醒</button>
              <button class="small-btn" onclick="toggleLeaderFlag(${player.playerId},'${leader.instanceId}','isDown')">ダウン</button>
              <button class="small-btn" onclick="attackWithLeader(${player.playerId},'${leader.instanceId}')">アタック</button>
            </div>
          </div>
        `
          )
          .join("")}
      </div>

      <div class="tactics-box" style="margin-top:12px;">
        <div class="meta-text">ログ</div>
        ${
          player.matchLog.length === 0
            ? `<div class="empty-box">ログはまだありません。</div>`
            : `<div class="compact-list" style="margin-top:8px;">
                ${player.matchLog
                  .map((log) => `<div class="compact-item">${escapeHtml(log)}</div>`)
                  .join("")}
              </div>`
        }
      </div>
    </div>
  `;
}

function handPanelHtml(title, playerId, cards) {
  return `
    <div class="match-block">
      <h3 class="sub-title">${escapeHtml(title)}</h3>
      ${
        cards.length === 0
          ? `<div class="empty-box">手札はありません。</div>`
          : `<div class="card-grid">
              ${cards
                .map(
                  (card) => `
                <div class="hand-card">
                  ${
                    card.imageUrl
                      ? `<img class="card-image" src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}" />`
                      : `<div class="no-image">No Image</div>`
                  }
                  <div class="item-title">${escapeHtml(card.name)}</div>
                  <div class="meta-text">${escapeHtml(card.type)} / コスト ${card.cost ?? 0}</div>
                  <div class="button-row-wrap">
                    <button class="small-btn" onclick="playCard(${playerId},'${card.id}')">場に出す</button>
                    <button class="small-btn" onclick="trashHandCard(${playerId},'${card.id}')">トラッシュ</button>
                  </div>
                </div>`
                )
                .join("")}
            </div>`
      }
    </div>
  `;
}

function fieldSideHtml(title, owner, fields) {
  return `
    <div>
      <h4 class="field-title">${escapeHtml(title)}</h4>
      <div class="card-grid">
        ${fields
          .map(
            (fieldCard) => `
          <div class="hand-card">
            ${
              fieldCard.card.imageUrl
                ? `<img class="card-image" src="${escapeHtml(fieldCard.card.imageUrl)}" alt="${escapeHtml(fieldCard.card.name)}" />`
                : `<div class="no-image">No Image</div>`
            }
            <div class="item-title">${escapeHtml(fieldCard.card.name)}</div>
            <div class="meta-text">${fieldCard.isUsed ? "使用済み" : "未使用"}</div>
            <div class="button-row-wrap">
              <button class="small-btn" onclick="toggleFieldUsed(${owner},'${fieldCard.instanceId}')">使用切替</button>
              <button class="small-btn" onclick="returnFieldToHand(${owner},'${fieldCard.instanceId}')">手札へ</button>
              <button class="small-btn" onclick="trashFieldCard(${owner},'${fieldCard.instanceId}')">トラッシュ</button>
            </div>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function tacticModalHtml() {
  const playerId = state.ui.tacticModalPlayerId;
  if (!playerId) return "";

  const player = getPlayer(playerId);
  if (!player) return "";

  return `
    <div class="modal-overlay" onclick="closeTacticModal()">
      <div class="modal-window" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="sub-title">プレイヤー${playerId} タクティクスエリア</h3>
          <button class="secondary-btn" onclick="closeTacticModal()">閉じる</button>
        </div>

        ${
          player.tacticsArea.length === 0
            ? `<div class="empty-box">タクティクスエリアにカードはありません。</div>`
            : `<div class="card-grid">
                ${player.tacticsArea
                  .map(
                    (tactic) => `
                  <div class="hand-card ${player.selectedTacticId === tactic.id ? "selected-card" : ""}">
                    ${
                      tactic.imageUrl
                        ? `<img class="card-image" src="${escapeHtml(tactic.imageUrl)}" alt="${escapeHtml(tactic.name)}" />`
                        : `<div class="no-image">No Image</div>`
                    }
                    <div class="item-title">${escapeHtml(tactic.name)}</div>
                    <div class="meta-text">${escapeHtml(tactic.type)} / コスト ${tactic.cost ?? 0}</div>
                    <div class="meta-text">
                      ${isEquipmentTactic(tactic) ? "装備タクティクス" : "通常タクティクス"}
                    </div>
                    <div class="button-row-wrap">
                      <button class="small-btn" onclick="selectTactic(${player.playerId},'${tactic.id}')">選択</button>
                    </div>
                  </div>`
                  )
                  .join("")}
              </div>`
        }

        <div class="button-row" style="margin-top:16px;">
          <button class="primary-btn" onclick="markSelectedTacticUsed(${player.playerId})">選択中のタクティクスを使用</button>
          <button class="secondary-btn" onclick="closeTacticModal()">閉じる</button>
        </div>
      </div>
    </div>
  `;
}

function usedTacticModalHtml() {
  const playerId = state.ui.usedTacticModalPlayerId;
  if (!playerId) return "";

  const player = getPlayer(playerId);
  if (!player) return "";

  return `
    <div class="modal-overlay" onclick="closeUsedTacticModal()">
      <div class="modal-window" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="sub-title">プレイヤー${playerId} 使用済みタクティクス</h3>
          <button class="secondary-btn" onclick="closeUsedTacticModal()">閉じる</button>
        </div>

        ${
          player.usedTacticsVisible.length === 0
            ? `<div class="empty-box">使用済みタクティクスはありません。</div>`
            : `<div class="card-grid">
                ${player.usedTacticsVisible
                  .map(
                    (tactic) => `
                  <div class="hand-card">
                    ${
                      tactic.imageUrl
                        ? `<img class="card-image" src="${escapeHtml(tactic.imageUrl)}" alt="${escapeHtml(tactic.name)}" />`
                        : `<div class="no-image">No Image</div>`
                    }
                    <div class="item-title">${escapeHtml(tactic.name)}</div>
                    <div class="meta-text">${escapeHtml(tactic.type)} / コスト ${tactic.cost ?? 0}</div>
                  </div>`
                  )
                  .join("")}
              </div>`
        }

        <div class="button-row" style="margin-top:16px;">
          <button class="secondary-btn" onclick="closeUsedTacticModal()">閉じる</button>
        </div>
      </div>
    </div>
  `;
}

function equipModalHtml() {
  const playerId = state.ui.equipModal.playerId;
  const tacticId = state.ui.equipModal.tacticId;

  if (!playerId || !tacticId) return "";

  const player = getPlayer(playerId);
  if (!player) return "";

  const tactic = player.tacticsArea.find((t) => t.id === tacticId);
  if (!tactic) return "";

  return `
    <div class="modal-overlay" onclick="closeEquipModal()">
      <div class="modal-window" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="sub-title">装備先を選択</h3>
          <button class="secondary-btn" onclick="closeEquipModal()">閉じる</button>
        </div>

        <div class="meta-text" style="margin-bottom: 16px;">
          ${escapeHtml(tactic.name)} を装備するリーダーを選択してください。
        </div>

        <div class="leader-grid">
          ${player.leaders
            .map(
              (leader) => `
            <div class="leader-card">
              ${
                leader.card.imageUrl
                  ? `<img class="card-image" src="${escapeHtml(
                      leader.isAwakened
                        ? leader.card.awakenImageUrl || leader.card.imageUrl
                        : leader.card.imageUrl
                    )}" alt="${escapeHtml(leader.card.name)}" />`
                  : `<div class="no-image">No Image</div>`
              }
              <div class="item-title">${escapeHtml(leader.card.name)}</div>
              <div class="meta-text">HP: ${leader.currentHp}</div>
              <div class="meta-text">${leader.isDown ? "ダウン中" : "選択可能"}</div>
              <div class="button-row-wrap">
                <button
                  class="small-btn"
                  onclick="equipSelectedTacticToLeader(${player.playerId}, '${leader.instanceId}')"
                  ${leader.isDown ? "disabled" : ""}
                >
                  このリーダーに装備
                </button>
              </div>
            </div>`
            )
            .join("")}
        </div>

        <div class="button-row" style="margin-top:16px;">
          <button class="secondary-btn" onclick="closeEquipModal()">閉じる</button>
        </div>
      </div>
    </div>
  `;
}

function matchHtml() {
  const match = state.match;
  if (!match) return "";

  return `
    <section class="panel">
      <div class="match-header">
        <div>
          <h2 class="section-title">一人回し</h2>
          <div class="meta-text">
            ラウンド: ${match.round} / 現在ターン: プレイヤー${match.turnPlayer} /
            ラウンド勝利数 ${match.roundWins1}-${match.roundWins2}
          </div>
        </div>

        <div class="button-row">
          <button class="secondary-btn" onclick="startNextRound()">次ラウンドへ</button>
          <button class="secondary-btn" onclick="endTurn()">ターン終了</button>
          <button class="danger-btn" onclick="finishMatch()">終了</button>
        </div>
      </div>

      ${
        match.roundWinner === 1
          ? `<div class="win-box">このラウンドはプレイヤー1の勝利です。</div>`
          : match.roundWinner === 2
          ? `<div class="win-box">このラウンドはプレイヤー2の勝利です。</div>`
          : match.roundWinner === 0
          ? `<div class="win-box">このラウンドは引き分けです。</div>`
          : ""
      }

      ${
        match.winner
          ? `<div class="win-box">
              プレイヤー${match.winner} の試合勝利です。
              <div style="margin-top:12px;">
                <button class="primary-btn" onclick="finishMatch()">ホームへ戻る</button>
              </div>
            </div>`
          : ""
      }

      ${playerPanelHtml("デッキ1 リーダー", match.player1, match.turnPlayer === 1)}
      ${handPanelHtml("デッキ1 手札", 1, match.player1.hand)}

      <div class="match-block">
        <h3 class="sub-title">共通プレイエリア</h3>
        <div class="field-columns">
          ${fieldSideHtml("デッキ1の場", 1, match.player1.field)}
          ${fieldSideHtml("デッキ2の場", 2, match.player2.field)}
        </div>
      </div>

      ${playerPanelHtml("デッキ2 リーダー", match.player2, match.turnPlayer === 2)}
      ${handPanelHtml("デッキ2 手札", 2, match.player2.hand)}
    </section>

    ${tacticModalHtml()}
    ${usedTacticModalHtml()}
    ${equipModalHtml()}
  `;
}

function render() {
  if (!root) return;

  if (state.screen === "home") {
    root.innerHTML = homeHtml();
    return;
  }
  if (state.screen === "import") {
    root.innerHTML = importHtml();
    return;
  }
  if (state.screen === "cards") {
    root.innerHTML = cardsHtml();
    return;
  }
  if (state.screen === "builder") {
    root.innerHTML = builderHtml();
    return;
  }
  if (state.screen === "setup") {
    root.innerHTML = setupHtml();
    return;
  }
  if (state.screen === "match") {
    root.innerHTML = matchHtml();
  }
}

window.state = state;
window.navigate = navigate;
window.handleImportDeck = handleImportDeck;
window.handleCreateCard = handleCreateCard;
window.handleDeleteCard = handleDeleteCard;
window.handleDeleteDeck = handleDeleteDeck;
window.addSelection = addSelection;
window.removeSelection = removeSelection;
window.handleSaveManualDeck = handleSaveManualDeck;
window.handleStartMatch = handleStartMatch;
window.drawOne = drawOne;
window.increaseDeckCount = increaseDeckCount;
window.decreaseDeckCount = decreaseDeckCount;
window.increaseTrash = increaseTrash;
window.decreaseTrash = decreaseTrash;
window.changePP = changePP;
window.playCard = playCard;
window.trashHandCard = trashHandCard;
window.toggleFieldUsed = toggleFieldUsed;
window.returnFieldToHand = returnFieldToHand;
window.trashFieldCard = trashFieldCard;
window.attackWithLeader = attackWithLeader;
window.changeLeaderHp = changeLeaderHp;
window.toggleLeaderFlag = toggleLeaderFlag;
window.selectTactic = selectTactic;
window.markSelectedTacticUsed = markSelectedTacticUsed;
window.moveTopTacticToArea = moveTopTacticToArea;
window.startNextRound = startNextRound;
window.endTurn = endTurn;
window.setWinner = setWinner;
window.finishMatch = finishMatch;
window.openTacticModal = openTacticModal;
window.closeTacticModal = closeTacticModal;
window.openUsedTacticModal = openUsedTacticModal;
window.closeUsedTacticModal = closeUsedTacticModal;
window.openEquipModal = openEquipModal;
window.closeEquipModal = closeEquipModal;
window.equipSelectedTacticToLeader = equipSelectedTacticToLeader;
window.render = render;

loadInitialData().catch((error) => {
  root.innerHTML = `<section class="panel"><div class="error-box">${escapeHtml(
    error.message || "初期データの読み込みに失敗しました。"
  )}</div></section>`;
});