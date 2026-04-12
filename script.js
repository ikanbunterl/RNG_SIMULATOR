const Engine = {
  async init() {
    UI.init();
    try {
      const [cfgRes, itemRes] = await Promise.all([
        fetch('config.json').then(r => r.ok ? r.json() : Promise.reject('Config fail')),
        fetch('items.json').then(r => r.ok ? r.json() : Promise.reject('Items fail'))
      ]);
      
      CONFIG = this.sanitize(cfgRes);
      ITEMS = itemRes.map(item => this.sanitize(item)); 
      
      CONFIG.tier_gems = { 
        Common:5, Uncommon:10, Rare:25, Epic:80, 
        Legendary:300, Mythic:1500, Divine:8000, 
        Celestial:50000, 'April Fools':100 
      };
      
      this.loadSave();
      UI.updateAll();
      
      // ✅ TAMPILKAN GAME SETELAH DATA & SAVE SIAP
      document.querySelector('.app').classList.add('ready');
      console.log("✅ Game loaded successfully!");
    } catch (e) {
      // ✅ TETAP TAMPILKAN GAME WALAU FETCH GAGAL AGAR UI TIDAK HILANG
      document.querySelector('.app').classList.add('ready');
      console.error('❌ Init Error:', e);
      UI.showToast('Gagal memuat data. Cek koneksi!', 'error');
    }
  },
  sanitize(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sanitize(item));
    
    const clean = {};
    for (const k in obj) {
      const cleanKey = k.trim();
      const val = obj[k];
      clean[cleanKey] = (typeof val === 'string') ? val.trim() : this.sanitize(val);
    }
    return clean;
  },
  loadSave() {
    try {
      const raw = localStorage.getItem('rng_save');
      if (!raw) return;
      const ls = JSON.parse(raw);
      Object.assign(State, {
        gems: ls.gems ?? 0,
        luck: ls.luck ?? 1.0,
        spinDuration: ls.spinDuration ?? (CONFIG.settings ? CONFIG.settings.spinDuration : 800),
        pity: ls.pity ?? { Epic: 0, Legendary: 0, Mythic: 0 },
        inventory: ls.inventory ?? [],
        collection: new Set(ls.collection ?? []),
        duplicates: ls.duplicates ?? 0,
        spins: ls.spins ?? 0,
        eventTokens: ls.eventTokens ?? 0
      });
    } catch (e) { console.warn('Save file error/empty'); }
  },
  saveSave() {
    localStorage.setItem('rng_save', JSON.stringify({
      gems: State.gems,
      luck: State.luck,
      spinDuration: State.spinDuration,
      pity: State.pity,
      inventory: State.inventory,
      collection: [...State.collection],
      duplicates: State.duplicates,
      spins: State.spins,
      eventTokens: State.eventTokens
    }));
  },
  roll() {
    if (State.isRolling) return;
    if (State.inventory.length >= (CONFIG.settings ? CONFIG.settings.inventoryMax : 50)) {
      UI.showToast('📦 Inventaris penuh!', 'warning');
      this.stopAutoRoll();
      return;
    }
    State.isRolling = true;
    State.spins++;
    if (this.isEventActive()) State.eventTokens++;

    AudioCtx.play('spin');
    AudioCtx.vibrate(30);

    const rollVal = Math.random() * 1000000000 * State.luck;
    let tier = 'Common';
    const thresholds = Object.entries(CONFIG.tier_thresholds || {}).sort((a,b) => b[1] - a[1]);

    for (const [t, v] of thresholds) {
      if (rollVal >= v) { tier = t; break; }
    }

    Object.keys(State.pity).forEach(k => { 
      State.pity[k]++; 
      if (CONFIG.pity_system && State.pity[k] >= CONFIG.pity_system[k.toLowerCase()]) {
        tier = k;
      }
    });

    if (['Epic','Legendary','Mythic','Divine','Celestial','April Fools'].includes(tier)) {
      Object.keys(State.pity).forEach(k => State.pity[k] = 0);
    }

    let pool = ITEMS.filter(i => i.tier === tier && !i.event);
    if (this.isEventActive() && Math.random() < (CONFIG.event_chances ? CONFIG.event_chances.april_fools : 0.08)) {
      const eventPool = ITEMS.filter(i => i.tier === 'April Fools');
      if (eventPool.length > 0) {
        pool = eventPool;
        tier = 'April Fools';
      }
    }

    const baseItem = pool[Math.floor(Math.random() * pool.length)] || ITEMS[0];
    const isDup = State.collection.has(baseItem.id);
    const reward = (CONFIG.tier_gems[tier] || 5) + (isDup ? 2 : 0);

    if (isDup) {
      State.duplicates++;
    } else {
      State.collection.add(baseItem.id);
      State.inventory.push(baseItem.id);
    }
    State.gems += reward;

    this.saveSave();
    UI.startAnimation(baseItem, tier, isDup, reward);
  },
  finishSpin() {
    State.isRolling = false;
    if (State.multiSpinQueue > 0) {
      State.multiSpinQueue--;
      UI.updateMultiButtons();
      setTimeout(() => this.roll(), 150);
    } else if (State.autoRoll) {
      setTimeout(() => {
        if (State.autoRoll && !State.isRolling) this.roll();
      }, 500);
    } else {
      UI.updateSpinButton(false);
    }
  },
  startMulti(count) {
    if (State.isRolling || count <= 0) return;
    State.multiSpinQueue = count;
    State.autoRoll = true;
    UI.updateMultiButtons();
    UI.updateAutoToggle(true);
    this.roll();
  },
  stopAutoRoll() {
    State.autoRoll = false;
    State.multiSpinQueue = 0;
    UI.updateMultiButtons();
    UI.updateAutoToggle(false);
  },
  isEventActive() {
    return new Date().getMonth() === 3; // April
  },
  exportSave() {
    const data = localStorage.getItem('rng_save') || '{}';
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rng_save_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
  importSave(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        localStorage.setItem('rng_save', JSON.stringify(json));
        location.reload();
      } catch (err) {
        UI.showToast('❌ File save tidak valid!', 'error');
      }
    };
    reader.readAsText(file);
  }
};

document.addEventListener('DOMContentLoaded', () => Engine.init());